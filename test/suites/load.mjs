/* ---------------------------------------------------------------------- *
 * load.mjs — what a technician's day adds up to.
 *
 * Written off a real dispute. On 10 September the board showed Jabbar at
 * 109% across 7 jobs and 5 buildings. He had SIX jobs and four buildings:
 * Sobha Hartland Waves 3411 went to housekeeping and he never went there,
 * and it was contributing thirty minutes of work plus a fifth building —
 * another thirty minutes of travel — to a visit that did not happen.
 *
 * The numbers below are his, exactly as they sit in the database.
 *
 * Run:  node test/suites/load.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { groupLoad } from "../../src/lib/load.js";
import { setState } from "../../src/lib/job.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const job = (over) => ({
  id: Math.random().toString(36).slice(2), state: "fixed", team: "Jabbar",
  scheduledDate: "2026-09-10", property: "", unit: "", description: "work",
  estimatedTime: "", actualMinutes: null, arrivedAt: "", leftAt: "", events: [], ...over,
});

/* Jabbar, 10 September 2026, verbatim. */
const JABBAR = [
  setState(job({ property: "Sobha Hartland Waves", unit: "3411", estimatedTime: "30 Mins" }),
    "not_done", "Vipul", { reason: "Assisgned to HK since its a minor task" }),
  job({ property: "Mesk 1 Midtown", unit: "1608", estimatedTime: "30 Mins", actualMinutes: 10 }),
  job({ property: "Mesk 1 Midtown", unit: "1502", estimatedTime: "1.30 Hours", actualMinutes: 20, state: "diagnosed" }),
  job({ property: "Mudon Views 4", unit: "614", estimatedTime: "1.5h", actualMinutes: 70 }),
  job({ property: "Mesk 1 Midtown", unit: "1101", estimatedTime: "1h", actualMinutes: 30 }),
  job({ property: "Golf Views A", unit: "321", estimatedTime: "2h", actualMinutes: 115 }),
  job({ property: "Binghatti Venus", unit: "2801", estimatedTime: "1 hr", actualMinutes: 10 }),
];

t("the board's own figure is reproduced — 7 jobs, 5 buildings, 109%", () => {
  const g = groupLoad(JABBAR, 30);
  assert.equal(g.jobs, 7);
  assert.equal(g.buildings, 5);
  assert.equal(g.travel, 120, "four moves at half an hour");
  assert.equal(g.committed, 588, "7h 48m of estimates plus 2h travel");
  assert.equal(g.loadPct, 109);
});

t("his recorded work is 4h 15m, and the board was showing none of it", () => {
  const g = groupLoad(JABBAR, 30);
  assert.equal(g.attended, 6, "six of the seven have a duration");
  assert.equal(g.actualMin - g.travel, 255, "10 + 20 + 70 + 30 + 115 + 10");
});

t("those are his own totals, not clock times, and it says so", () => {
  const g = groupLoad(JABBAR, 30);
  assert.equal(g.measured, 0, "not one arrival and departure");
  assert.equal(g.actualBasis, "reported");
});

t("once Sobha Hartland is accounted for, he has six jobs and four buildings", () => {
  const fixed = JABBAR.map((j, i) =>
    i === 0
      ? setState(j, "cancelled", "Vipul", { offBoard: "other-team", handedTo: "Housekeeping" })
      : j);
  const g = groupLoad(fixed, 30);
  assert.equal(g.jobs, 6, "the housekeeping row is not a job he did");
  assert.equal(g.offBoard, 1, "but it is still on his card");
  assert.equal(g.buildings, 4, "he never went to the fifth building");
  assert.equal(g.travel, 90, "three moves, not four");
  assert.equal(g.committed - g.travel, 438, "7h 18m of estimates — the 30m goes with it");
  assert.equal(g.committed, 528, "8h 48m planned, down from 9h 48m");
  assert.equal(g.loadPct, 98, "down from 109%");
});

t("and his actual day reads 5h 45m against 8h 48m planned", () => {
  const fixed = JABBAR.map((j, i) =>
    i === 0
      ? setState(j, "cancelled", "Vipul", { offBoard: "other-team", handedTo: "Housekeeping" })
      : j);
  const g = groupLoad(fixed, 30);
  assert.equal(g.actualMin, 345, "4h 15m of work plus 1h 30m of travel");
  assert.equal(g.actualPct, 64);
  assert.ok(g.actualPct < g.loadPct, "he took less than was planned for him");
});

t("a duplicate is not a job — the 2111 case", () => {
  const g = groupLoad([
    job({ property: "Dubai Marina Mall Hotel", unit: "2111", estimatedTime: "1h", actualMinutes: 45 }),
    setState(job({ property: "Dubai Marina Mall Hotel", unit: "2111", estimatedTime: "1h" }),
      "cancelled", "Vipul", { offBoard: "duplicate" }),
  ], 30);
  assert.equal(g.jobs, 1);
  assert.equal(g.offBoard, 1);
  assert.equal(g.buildings, 1);
  assert.equal(g.committed, 60, "one hour, not two");
});

/* ------------------------------ the rules ----------------------------- */

t("clock times make the figure measured, not reported", () => {
  const g = groupLoad([job({ property: "A", arrivedAt: "09:00", leftAt: "10:30" })], 30);
  assert.equal(g.actualBasis, "measured");
  assert.equal(g.actualMin, 90);
  assert.equal(g.measured, 1);
});

t("one typed total among clock times drops the whole figure to reported", () => {
  const g = groupLoad([
    job({ property: "A", arrivedAt: "09:00", leftAt: "10:00" }),
    job({ property: "B", actualMinutes: 60 }),
  ], 30);
  assert.equal(g.measured, 1);
  assert.equal(g.attended, 2);
  assert.equal(g.actualBasis, "reported", "a figure is only as good as its weakest part");
});

t("a day with nothing recorded has no actual figure, not a zero", () => {
  const g = groupLoad([job({ property: "A", estimatedTime: "1h" })], 30);
  assert.equal(g.actualPct, null, "0% would read as a man who did nothing");
  assert.equal(g.actualBasis, null);
});

t("travel uses whatever average it is given", () => {
  const three = ["A", "B", "C"].map((p) => job({ property: p, estimatedTime: "1h" }));
  assert.equal(groupLoad(three, 30).travel, 60, "two moves at the assumed half hour");
  assert.equal(groupLoad(three, 18).travel, 36, "two moves at a measured eighteen minutes");
});

t("travel rides on both figures or neither, so the bars compare like with like", () => {
  const two = [
    job({ property: "A", arrivedAt: "09:00", leftAt: "10:00" }),
    job({ property: "B", arrivedAt: "10:30", leftAt: "11:00" }),
  ];
  const g = groupLoad(two, 30);
  assert.equal(g.actualMin, 120, "90 minutes of work plus one 30-minute move");
  assert.equal(g.travel, 30);
});

t("a card of nothing but accounted-for rows charges him nothing", () => {
  const g = groupLoad([
    setState(job({ property: "A", estimatedTime: "2h" }), "cancelled", "V", { offBoard: "duplicate" }),
    setState(job({ property: "B", estimatedTime: "2h" }), "cancelled", "V", { offBoard: "wrong-entry" }),
  ], 30);
  assert.equal(g.jobs, 0);
  assert.equal(g.committed, 0);
  assert.equal(g.buildings, 0);
  assert.equal(g.loadPct, 0);
  assert.equal(g.offBoard, 2);
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
