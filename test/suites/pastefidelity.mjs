/* ---------------------------------------------------------------------- *
 * pastefidelity.mjs — the manual paste is now the ONLY way the schedule
 * gets in, so it gets held to the standard the sync failed.
 *
 * The sync was switched off on 9 September after ten days of silent
 * corruption. Everything the department schedules now arrives through
 * "Paste the day in", which means a fault in this path has nowhere to hide
 * and no second source to correct it.
 *
 * So this checks the whole real workbook export — 474 rows out of
 * "Daily Input- Field Tasks" — for the four things that would matter:
 *
 *   nothing invented   every value traces back to its own source cell
 *   nothing lost       every row arrives, every word of every cell arrives
 *   nothing torn       no row becomes two, including the 25 whose task
 *                      description genuinely runs over several lines —
 *                      the exact cells the sync was breaking
 *   nothing unnamed    every technician resolves to a real person
 *
 * Run:  node test/suites/pastefidelity.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import fs from "node:fs";
import { parseSheetPaste } from "../../src/lib/importSheet.js";
import { isMisread } from "../../src/lib/sheetText.js";
import {
  squash, canonKey, canonTech, TECH_ALIASES, splitCrew, splitTrailingUnit,
} from "../../src/lib/normalize.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const RAW = fs.readFileSync("test/harness/paste.tsv", "utf8");
const { jobs, skipped, warnings } = parseSheetPaste(RAW, null);

/* The source, split independently of the parser — honouring the quoting a
   clipboard applies — so the comparison is against the sheet and not
   against the thing being tested. */
function splitSource(text) {
  const s = text.replace(/\r\n?/g, "\n");
  const out = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

const SRC = splitSource(RAW).slice(1).filter((r) => r.some((c) => squash(c)));
const COL = { _date: 0, shift: 1, team: 2, property: 3, unit: 4, status: 5, parking: 6,
              timeOfVisit: 7, guestConfirmed: 8, description: 9, materialNeeded: 10,
              materialDetails: 11, estimatedTime: 12, priority: 15, notes: 16 };

const words = (s) => canonKey(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);

t("every row arrives, none invented", () => {
  assert.equal(SRC.length, 474, "the fixture changed — re-check these numbers");
  assert.equal(jobs.length + skipped, SRC.length);
  assert.equal(skipped, 0);
  assert.equal(warnings.length, 0);
});

t("the 25 genuinely multi-line cells stay one row each", () => {
  const multi = SRC.filter((r) => (r[COL.description] || "").includes("\n"));
  assert.equal(multi.length, 25, "the fixture's multi-line count changed");
  /* If any of these tore, jobs.length would exceed SRC.length — which is
     precisely what the sync did to the live board for ten days. */
  assert.equal(jobs.length, SRC.length);
});

t("no word of a multi-line cell is lost", () => {
  SRC.forEach((r, i) => {
    if (!(r[COL.description] || "").includes("\n")) return;
    const got = new Set(words(jobs[i].description));
    const missing = words(r[COL.description]).filter((w) => !got.has(w));
    assert.equal(missing.length, 0,
      `row ${i + 2} lost ${missing.length} word(s): ${missing.slice(0, 5).join(" ")}`);
  });
});

t("nothing is dropped: a blank field means a blank cell", () => {
  let lost = 0;
  SRC.forEach((r, i) => {
    ["description", "estimatedTime", "team", "property"].forEach((f) => {
      if (!squash(jobs[i][f]) && squash(r[COL[f]])) lost++;
    });
  });
  assert.equal(lost, 0, `${lost} field(s) held a value in the sheet and arrived empty`);
});

t("nothing is invented: each field traces to its own cell", () => {
  /* Two fields are deliberately transformed and are checked separately:
     `priority` is canonicalised ("P3-Medium" -> "PRI-3"), and `unit` is
     recovered off the end of the property cell on the quarter of rows that
     leave the unit column empty. Everything else must be its own cell. */
  const exempt = new Set(["priority", "unit"]);
  const offenders = [];
  jobs.forEach((j, i) => {
    Object.entries(COL).forEach(([f, ci]) => {
      if (exempt.has(f)) return;
      const got = squash(j[f]);
      if (!got) return;
      const mine = words(got);
      if (!mine.size) return;
      const own = new Set(words(SRC[i][ci] || ""));
      const foreign = mine.filter((w) => !own.has(w)).length;
      if (foreign / mine.size > 0.5) offenders.push(`row ${i + 2} ${f}=${JSON.stringify(got.slice(0, 40))}`);
    });
  });
  assert.deepEqual(offenders, []);
});

t("a unit recovered from the property cell is never guessed", () => {
  let recovered = 0;
  jobs.forEach((j, i) => {
    const got = squash(j.unit);
    if (!got || squash(SRC[i][COL.unit])) return;
    recovered++;
    assert.ok(canonKey(SRC[i][COL.property]).includes(canonKey(got)),
      `row ${i + 2}: unit ${JSON.stringify(got)} appears in no cell of its row`);
  });
  assert.equal(recovered, 112, "the count changed — worth re-reading why");
});

t("no pasted row looks torn to the board", () => {
  const flagged = jobs.filter((j) => isMisread(j, j._date));
  assert.deepEqual(flagged.map((j) => j.team), []);
});

t("every technician resolves to a known person", () => {
  const known = new Set(Object.values(TECH_ALIASES).map(canonKey));
  const unknown = new Set();
  jobs.forEach((j) => splitCrew(j.team).forEach((n) => {
    const k = canonKey(canonTech(n));
    if (k && !known.has(k)) unknown.add(canonTech(n));
  }));
  /* An unknown spelling is not dropped, it becomes a NEW technician — so
     one typo silently halves somebody's measured workload. */
  assert.deepEqual([...unknown], []);
});

t("every row lands on a date", () => {
  assert.deepEqual(jobs.filter((j) => !j._date).map((j) => j.property), []);
});

/* ---------------------------------------------------------------------- *
 * The unit typed twice.
 *
 * splitTrailingUnit recovers a unit off the end of a building name when the
 * unit column is empty, and its original rule was "never touch a row that
 * already has a unit" — because a wrong split RENAMES A BUILDING, which is
 * a worse error than an unsplit one.
 *
 * That rule was too wide by one case. Four of the 474 real rows carry the
 * unit in BOTH cells — "Binghatti Tulip 305" with unit 305 — so the row
 * keys as `binghatti tulip 305::305` while the same unit written properly
 * keys as `binghatti tulip::305`. Three of the four have the correct
 * spelling elsewhere in the very same paste, so those units' visit history
 * splits in two, and "how many times have we been to this unit" is the
 * number the department wants for charging an owner.
 *
 * The rule is narrowed, not dropped: the tail comes off only when it is
 * IDENTICAL to the unit already in the unit column. Nothing is inferred —
 * the unit was already known, and a duplicate is being removed rather than
 * a name being guessed at. A building whose name genuinely ends in a number
 * is still safe twice over: "Azizi Riviera 24" fails the three-digit test,
 * and it would also have to match the unit cell exactly.
 * ---------------------------------------------------------------------- */

t("the unit typed in both cells is de-duplicated", () => {
  assert.deepEqual(splitTrailingUnit("Binghatti Tulip 305", "305"),
    { property: "Binghatti Tulip", unit: "305", split: true });
  assert.deepEqual(splitTrailingUnit("Marina Apartments 3 408", "408"),
    { property: "Marina Apartments 3", unit: "408", split: true });
  assert.deepEqual(splitTrailingUnit("5242 Tower 1 2901", "2901"),
    { property: "5242 Tower 1", unit: "2901", split: true });
  assert.deepEqual(splitTrailingUnit("Jumeirah Gate Tower 1 801", "801"),
    { property: "Jumeirah Gate Tower 1", unit: "801", split: true });
});

t("a building name that ends in a number is never renamed", () => {
  /* Two digits — part of the name, and the reason the three-digit rule
     exists. Even with the unit column agreeing, this must not be touched. */
  assert.deepEqual(splitTrailingUnit("Azizi Riviera 24", "24"),
    { property: "Azizi Riviera 24", unit: "24", split: false });
  assert.deepEqual(splitTrailingUnit("Azizi Riviera 10", "10"),
    { property: "Azizi Riviera 10", unit: "10", split: false });
  assert.deepEqual(splitTrailingUnit("Marina Apartments 3", "3"),
    { property: "Marina Apartments 3", unit: "3", split: false });
});

t("a tail that is NOT the unit is left where it is", () => {
  /* The dangerous case, and why equality is required rather than just the
     shape. "Sunrise Bay Tower 1 902" with unit 415 is either a typo or two
     different things; stripping 902 would rename the building on a guess. */
  assert.deepEqual(splitTrailingUnit("Sunrise Bay Tower 1 902", "415"),
    { property: "Sunrise Bay Tower 1 902", unit: "415", split: false });
  assert.deepEqual(splitTrailingUnit("Afnan 5 603", "604"),
    { property: "Afnan 5 603", unit: "604", split: false });
});

t("recovering a unit from an empty column still works unchanged", () => {
  assert.deepEqual(splitTrailingUnit("Afnan 5 603", ""),
    { property: "Afnan 5", unit: "603", split: true });
  assert.deepEqual(splitTrailingUnit("Palm Villa E41", ""),
    { property: "Palm Villa", unit: "E41", split: true });
  assert.deepEqual(splitTrailingUnit("Azizi Riviera 10", ""),
    { property: "Azizi Riviera 10", unit: "", split: false });
  assert.deepEqual(splitTrailingUnit("Warehouse", ""),
    { property: "Warehouse", unit: "", split: false });
});

t("Excel's float units and casing still match", () => {
  /* Unit cells arrive from Excel as "305.0", and a villa tail is upper-cased
     on the way out. Neither may defeat the comparison. */
  assert.equal(splitTrailingUnit("Binghatti Tulip 305", "305.0").property, "Binghatti Tulip");
  assert.equal(splitTrailingUnit("Palm Villa e41", "E41").property, "Palm Villa");
});

t("no row in the whole sheet keeps the unit in both places", () => {
  const doubled = jobs.filter((j) => {
    const u = squash(j.unit);
    return u.length > 1 && canonKey(j.property).endsWith(canonKey(u));
  });
  assert.deepEqual(doubled.map((j) => `${j.property} / ${j.unit}`), []);
});

/* ---------------------------------------------------------------------- *
 * The other tab in the workbook, and why it used to be a trap.
 *
 * "Printable Schedule (PDF)" is a QUERY view of the input tab, for printing.
 * It has a date selector and two instruction lines ABOVE its header, no Date
 * column at all, and its Parking and Status columns are the other way round.
 *
 * Pasting it whole used to shift every column one to the left and enter the
 * header row itself as a job — the same wreckage the sync produced. The
 * header is hunted for now, so it reads correctly whether or not the
 * instruction rows are included.
 * ---------------------------------------------------------------------- */

const PRINTABLE = [
  ["Select Date to Display:", "09-09-2026", "\u2191 Change the date to view/print a different day."],
  [""],
  ["Do not type anything into the data rows below — a single QUERY formula in row 6 fills all rows."],
  [""],
  ["Shift", "Team", "Property", "Unit", "Parking No.", "Status", "Time of Visit",
   "Guest Confirmed", "Task Description (Scope of Work)"],
  ["09:00-18:00", "Yousoufu", "Elite Residence", "3808", "P2-86", "Occupied - GC",
   "GC morning to evening", "Y", "bad smell issue"],
  ["09:00-18:00", "Abdul Riyaz", "Damac Towers by Paramount A", "5306", "", "Vacant",
   "", "N", "sanding and reapply"],
];
const tsv = (a) => a.map((r) => r.join("\t")).join("\n");

t("the Printable tab reads correctly even pasted whole", () => {
  const r = parseSheetPaste(tsv(PRINTABLE), "2026-09-09");
  assert.equal(r.jobs.length, 2, "the header row or an instruction line became a job");
  assert.equal(r.skipped, 0);
  const [a] = r.jobs;
  assert.equal(a.team, "Yousoufu");
  assert.equal(a.property, "Elite Residence");
  assert.equal(a.unit, "3808");
  /* Printable puts Parking BEFORE Status; matching is by name, so both land
     right even though the order differs from the input tab. */
  assert.equal(a.status, "Occupied - GC");
  assert.equal(a.parking, "P2-86");
  assert.equal(a.description, "bad smell issue");
  /* No Date column, so every row takes the day the board has open. */
  assert.equal(a._date, "2026-09-09");
  assert.ok(r.warnings.some((w) => /Ignored 2 row\(s\) above the header/.test(w)),
    "dropping rows silently is how a month goes wrong unnoticed");
});

t("selecting from the header row down reads the same", () => {
  const r = parseSheetPaste(tsv(PRINTABLE.slice(4)), "2026-09-09");
  assert.equal(r.jobs.length, 2);
  assert.equal(r.jobs[0].description, "bad smell issue");
  assert.equal(r.warnings.length, 0);
});

t("a task description is never mistaken for a header row", () => {
  /* Satisfies the loose shape test — contains "property" and "task" — and
     must not be taken as a header, or every row above it is discarded. */
  const rows = [
    ["Date", "Shift", "Team / Technician", "Property", "Unit / Villa No.", "Status",
     "Parking No.", "Time of Visit", "Guest Confirmed", "Task Description (Scope of Work)"],
    ["2026-09-09", "09:00-18:00", "Resty", "Binghatti Tulip", "1105", "Occupied", "P2-14", "", "N", "Pool Cleaning"],
    ["2026-09-09", "09:00-18:00", "Jabbar", "Bella Rose", "106", "Vacant", "GF-009", "", "Y",
     "Property manager asked to reschedule the task and check the date"],
  ];
  const r = parseSheetPaste(tsv(rows), "2026-09-09");
  assert.equal(r.jobs.length, 2, "a body row was treated as the header");
  assert.equal(r.jobs[0].team, "Resty");
  assert.equal(r.jobs[1].team, "Jabbar");
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
