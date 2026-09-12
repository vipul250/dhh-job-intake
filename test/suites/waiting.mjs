/* ---------------------------------------------------------------------- *
 * waiting.mjs — the two failures on Damac Prive A 3010A, 10 September.
 *
 * The close-out demanded a return date before it would let the job close.
 * Nobody in this department can say, on the evening of the tenth, when a
 * contractor will come. So the coordinator either invented a date or filed
 * the job as Not done — which is exactly how "Needs contractor / out of
 * scope" ended up in the not-done list in the first place.
 *
 * And the report on that same job was misread. "Time of Arrival :12.45
 * Time of Depature :1.35" is a fifty-minute visit. The parser read fifteen
 * minutes, because "Depature" is missing its r and `depart\w*` did not
 * match it — so the numbered list further along, "Work Completed : 1--Fcu
 * No chilled water supply", supplied a 1pm departure instead.
 *
 * Run:  node test/suites/waiting.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { parseWorkReport, pendingLanguage } from "../../src/lib/workReport.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

/* The report verbatim, from the database. */
const DAMAC = `Time of Arrival :12.45 Time of Depature :1.35 - Work Completed : 1--Fcu No chilled water supply.. Fuc chilled water supply and Return checked no chilled water passing..Both chilled water supply and Return valves checked it's dry...air vent also checked no water in line.. Need to check any due Payment (Empower).. checked with building team,they not allowing checked Empower BTU meter valves. Note: No cooling in the unit .. Need to follow up ASAP.`;

t("the misspelt departure is read, and the visit is fifty minutes", () => {
  const r = parseWorkReport(DAMAC);
  assert.equal(r.arrivalMin, 12 * 60 + 45);
  assert.equal(r.departureMin, 13 * 60 + 35, "1.35 is twenty-five to two, not one o'clock");
  assert.equal(r.minutes, 50, "it read 15 before this");
});

t("a numbered list is never a time", () => {
  const r = parseWorkReport("Work Completed : 1--Fcu no chilled water supply");
  assert.equal(r.departureMin, null, "'Completed : 1' is an item number");
  assert.equal(r.minutes, null);
});

t("every spelling of departure in use still parses", () => {
  for (const word of ["Departure", "Depature", "Departure", "departed"]) {
    const r = parseWorkReport(`Arrival 09.15 ${word} 10.05`);
    assert.equal(r.minutes, 50, word);
  }
});

t("the formats that already worked still work", () => {
  assert.equal(parseWorkReport("Arrived @ 7:58pm\nFinished @ 8:40pm").minutes, 42);
  assert.equal(parseWorkReport("Arrival Time: 10:40 AM\nDeparture Time: 11:25 AM").minutes, 45);
});

t("a bare hour with a meridiem is still a time", () => {
  assert.equal(parseWorkReport("Arrived 9am\nLeft 11am").minutes, 120);
});

t("an afternoon reading with no meridiem is still the afternoon", () => {
  const r = parseWorkReport("Arrival 1.10 Departure 3.40");
  assert.equal(r.arrivalMin, 13 * 60 + 10, "a maintenance visit at 1.10 is after lunch");
  assert.equal(r.minutes, 150);
});

t("a report that cannot be read yields nothing rather than a guess", () => {
  const r = parseWorkReport("Checked the unit, all fine");
  assert.equal(r.minutes, null);
  assert.equal(r.arrivalMin, null);
});

/* ------------- closed as Fixed while the text says otherwise ---------- *
 * 43 jobs in the database were closed as Fixed with pending language in
 * their own text. Fixed means nothing left to do, and in every one of those
 * cases the contradiction was on screen when it was clicked.
 *
 * This does not block anything — it quotes the sentence back. The
 * coordinator knows things the text does not.
 * --------------------------------------------------------------------- */

t("the sentence that contradicts Fixed is found and quoted", () => {
  assert.equal(pendingLanguage("Note: No cooling in the unit .. Need to follow up ASAP."),
    "Need to follow up ASAP");
  assert.ok(/PENDING/.test(pendingLanguage("*Work Report - PENDING / NEEDS APPOINTMENT FOR ACCESS")));
  assert.ok(pendingLanguage("RESCHEDULED - To be attended tomorrow after confirming"));
  assert.ok(pendingLanguage("Still needs the water heater before it can be finished"));
  assert.ok(pendingLanguage("Awaiting the contractor's quotation"));
});

t("the department's own way of saying there is nothing left is not caught", () => {
  /* "Pending Work: None." is house style and read the wrong way round is
     the strongest false positive there is. */
  for (const s of [
    "Kitchen area silicone work was required. Pending Work: None.",
    "Pending: none",
    "Pending Work - N/A",
    "Fixed the tap, no pending work",
    "No further follow-up required",
  ]) assert.equal(pendingLanguage(s), null, s);
});

t("an ordinary job description says nothing either way", () => {
  for (const s of ["Drain unclogging", "AC not cooling", "", null, undefined, "   "]) {
    assert.equal(pendingLanguage(s), null, JSON.stringify(s));
  }
});

t("a description stating the job is not a contradiction — measured, 8 of 9", () => {
  /* These are all real descriptions of jobs that were correctly closed as
     Fixed. The dialog does not read the description for exactly this
     reason; these assertions record what would happen if it did. */
  const realDescriptions = [
    "Pending work Need to replace kitchen sink bottle trap with pipe hose",
    "Owner - Light needs to be replaced",
    "Pending Work: Yes – Kitchen drawer running rail replacement, subject to approval",
  ];
  realDescriptions.forEach((d) =>
    assert.ok(pendingLanguage(d), `still matches the text: ${d.slice(0, 40)}`));
  /* The guard is the CALLER's — src/views/LiveBoard.jsx reads report and
     notes only. If that ever changes, 8 of every 9 prompts will be wrong. */
});

t("the quote is short enough to put on one line", () => {
  const long = "Pending " + "x".repeat(400);
  assert.ok(pendingLanguage(long).length <= 120);
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
