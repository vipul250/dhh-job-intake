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
import { parseWorkReport } from "../../src/lib/workReport.js";

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

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
