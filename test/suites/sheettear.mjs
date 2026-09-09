/* ---------------------------------------------------------------------- *
 * sheettear.mjs — the bug that cost ten days of data.
 *
 * A coordinator types a multi-line task description into one cell with
 * Alt+Enter. The clipboard quotes a cell like that, so the MANUAL paste has
 * always survived it — splitRows in importSheet.js honours the quoting.
 *
 * The Sheets API does not quote. It returns the raw value with the newlines
 * still in it, and api/sync-sheet.js used to join those with tabs and
 * nothing else. A bare newline inside a row ended the row: splitRows
 * started a new one, and every column after the description shifted left.
 *
 * What that looked like on the Live Board: technicians called "Paint ,
 * putty" and "water heater along with Flexible hose", properties called
 * "2 hr", unit statuses ("Vacant", "Occupied - GC") grouped as if they were
 * people, and — quietly, which is worse — good jobs that lost their
 * estimate to the fragment below them.
 *
 * Rows with single-line descriptions were untouched. That is why the damage
 * read as random instead of systematic, and why it ran for ten days.
 *
 * Run:  node test/suites/sheettear.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { valuesToTsv } from "../../api/sync-sheet.js";
import { parseSheetPaste } from "../../src/lib/importSheet.js";
import { isMisread, misreadSigns } from "../../src/lib/sheetText.js";
import fs from "node:fs";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const HEADER = [
  "Date", "Shift", "Team / Technician", "Property", "Unit / Villa No.", "Status",
  "Parking No.", "Time of Visit", "Guest Confirmed", "Task Description (Scope of Work)",
  "Material Needed? (Y/N)", "Material Details (what + qty)", "Estimated Time",
  "Pending? (Y/N)", "Pending Details", "Priority", "Notes", "In PMS? (Y/N)",
  "PMS Ticket / Task Ref", "Changed After 8pm Posting? (Y/N)", "What Changed / When",
];

const row = (over = {}) => {
  const base = {
    date: "2026-09-07", shift: "09:00-18:00", team: "Resty", property: "Binghatti Tulip",
    unit: "1105", status: "Occupied", parking: "P1-20", timeOfVisit: "", guestConfirmed: "N",
    description: "Pool Cleaning", materialNeeded: "N", materialDetails: "",
    estimatedTime: "1 hr", pending: "N", pendingDetails: "", priority: "P3-Medium",
    notes: "", inPms: "Y", pmsRef: "TSK1", changed: "N", whatChanged: "",
  };
  const m = { ...base, ...over };
  return [m.date, m.shift, m.team, m.property, m.unit, m.status, m.parking, m.timeOfVisit,
          m.guestConfirmed, m.description, m.materialNeeded, m.materialDetails,
          m.estimatedTime, m.pending, m.pendingDetails, m.priority, m.notes, m.inPms,
          m.pmsRef, m.changed, m.whatChanged];
};

/* The real cell out of the 7 September sheet, newlines and all. */
const MULTILINE = "Washroom shower floor area have paint issues\n" +
                  "Paint , putty needed\n" +
                  "water heater along with Flexible hose";

const parse = (values) => parseSheetPaste(valuesToTsv(values), null);

t("a multi-line description cell stays ONE job", () => {
  const { jobs } = parse([HEADER, row(), row({
    team: "Jabbar", property: "Golf Views A", unit: "321", status: "Vacant",
    parking: "B2-132", description: MULTILINE, materialNeeded: "Y",
    materialDetails: "Paint , putty", estimatedTime: "2 hr", priority: "P2-High",
    pmsRef: "TSK2",
  })]);
  assert.equal(jobs.length, 2, "the row tore into fragments again");
});

t("every column lands where it belongs", () => {
  const { jobs } = parse([HEADER, row({
    team: "Jabbar", property: "Golf Views A", unit: "321", status: "Vacant",
    parking: "B2-132", description: MULTILINE, materialNeeded: "Y",
    materialDetails: "Paint , putty", estimatedTime: "2 hr", priority: "P2-High",
    pmsRef: "TSK2",
  })]);
  const [j] = jobs;
  assert.equal(j.team, "Jabbar");
  assert.equal(j.property, "Golf Views A");
  assert.equal(j.unit, "321");
  assert.equal(j.status, "Vacant");
  /* The one that was silently wrong. A torn row gave its estimate away to
     the fragment below it, so the job read "no estimate" and dropped out of
     every load and cost figure without ever looking broken. */
  assert.equal(j.estimatedTime, "2 hr");
  assert.equal(j.materialDetails, "Paint , putty");
  assert.equal(j.priority, "PRI-2", "priority is canonicalised by the parser");
  assert.ok(j.description.startsWith("Washroom shower floor area"));
  assert.ok(/water heater along with Flexible hose/.test(j.description),
    "the last line of the cell must still be part of the description");
});

t("no fragment is ever mistaken for a technician", () => {
  const { jobs } = parse([HEADER, row({
    team: "Jabbar", description: MULTILINE, materialDetails: "Paint , putty",
    status: "Occupied - GC",
  })]);
  /* These four are verbatim from the damaged board: two lines of a task
     description, a material list and a unit status, each of which became a
     "technician" with its own group and its own shift-load bar. */
  const bad = ["Paint , putty", "water heater along with Flexible hose",
               "Vacant", "Occupied - GC"];
  jobs.forEach((j) => assert.ok(!bad.includes(j.team),
    `"${j.team}" is not a person`));
});

t("a cell containing a tab or a quote also survives", () => {
  const { jobs } = parse([HEADER, row({
    description: 'Guest said "the tap\tdrips" — check washer',
    estimatedTime: "45 mins",
  })]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].estimatedTime, "45 mins");
  assert.ok(jobs[0].description.includes('"the tap'), "the quote was eaten");
});

t("ordinary single-line rows are unaffected by the fix", () => {
  const { jobs } = parse([HEADER, row(), row({ team: "Vitalis", unit: "2116" })]);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].team, "Resty");
  assert.equal(jobs[0].estimatedTime, "1 hr");
  assert.equal(jobs[1].team, "Vitalis");
});

/* ---------------------------------------------------------------------- *
 * The other half: the board has to SAY a day is damaged.
 *
 * Fixing the parser stops new damage. It does nothing for the ten days
 * already stored, and those days look plausible enough that they ran for
 * ten days without anybody being sure. misreadSigns already detected the
 * OLDER tear (the date column bleeding right into the scope of work); it
 * had no idea about this one, which shifts the other way.
 * ---------------------------------------------------------------------- */

/* Verbatim from the damaged board and from the reproduction above. */
const TORN = [
  { team: "Paint , putty", property: "2 hr", unit: "N", description: "TSK2" },
  { team: "water heater along with Flexible hose", property: "", unit: "", description: "" },
  { team: "Vacant", property: "1 hr", unit: "", description: "" },
  { team: "Occupied - GC", property: "30mins", unit: "N", description: "" },
  { team: "3hrs", property: "", unit: "", description: "" },
  { team: "Occupied", property: "", unit: "", description: "" },
];

/* Real rows out of test/harness/paste.tsv, including the shapes most likely
   to be mistaken for wreckage: a two-person crew, a three-person crew, a
   crew joined with the word "and", and an unassigned job. */
const REAL = [
  { team: "Shafeeq & Bijaya", property: "Binghatti Azure", unit: "1227", description: "AC PPM" },
  { team: "Resty", property: "Binghatti Tulip", unit: "1105", description: "Pool Cleaning" },
  { team: "Vitalis and bright", property: "Beach Vista Tower 1", unit: "1901", description: "Ceiling fixing" },
  { team: "Vitalis, Resty & Shafiq", property: "Palm Villa", unit: "E41", description: "Long-stay VVIP full inspection" },
  { team: "Jabbar", property: "Golf Views A", unit: "321", description: "Washroom shower floor paint issues" },
  { team: "", property: "Rawda Parkviews", unit: "1115", description: "Water dripping from ceiling" },
];

t("every torn shape on the damaged board is flagged", () => {
  TORN.forEach((j) => assert.ok(isMisread(j, "2026-09-07"),
    `not flagged: team=${JSON.stringify(j.team)} property=${JSON.stringify(j.property)}`));
});

t("no real job is flagged — a crew is not wreckage", () => {
  REAL.forEach((j) => assert.ok(!isMisread(j, "2026-09-07"),
    `false positive: ${JSON.stringify(j.team)} — ${misreadSigns(j, "2026-09-07").join("; ")}`));
});

t("a unit status or an estimate in the wrong column is conclusive alone", () => {
  /* The same standard the year-in-the-unit rule already sets: nobody in the
     department is called Vacant and no building is called "2 hr", so one
     sign is enough and no corroboration is needed. */
  assert.equal(misreadSigns({ team: "Vacant", property: "Binghatti Azure", unit: "1227",
                              description: "AC PPM" }, "2026-09-07").length, 1);
  assert.ok(isMisread({ team: "Vacant", property: "Binghatti Azure", unit: "1227",
                        description: "AC PPM" }, "2026-09-07"));
});

t("the whole real sheet produces no false positives", () => {
  const { jobs } = parseSheetPaste(fs.readFileSync("test/harness/paste.tsv", "utf8"), null);
  const flagged = jobs.filter((j) => isMisread(j, j._date));
  assert.equal(flagged.length, 0,
    `flagged ${flagged.length} of ${jobs.length} real rows, e.g. ` +
    flagged.slice(0, 3).map((j) => `${JSON.stringify(j.team)}/${JSON.stringify(j.property)}`).join(", "));
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
