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
  squash, canonKey, canonTech, TECH_ALIASES, splitCrew,
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

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
