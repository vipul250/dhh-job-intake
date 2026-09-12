/* ---------------------------------------------------------------------- *
 * taskparts.mjs — "this is 5 jobs in one" had better be true.
 *
 * The close-out offers to split a description into parts and tick off what
 * actually got done. On 12 September it offered this, on a real job:
 *
 *   This is 5 jobs in one. Tick what actually got done.
 *     [ ] Approved
 *     [ ] PC-2026-08-13
 *     [ ] along with general Inspection
 *     [ ] Long term Transition
 *     [ ] Read Description (Claim)
 *
 * None of those is a job. The dash branch was splitting a reference line.
 *
 * Measured across 1,582 real descriptions, that branch fired 72 times and
 * not one was a list of work — every case was a materials line or a
 * reference string. So it was deleted rather than tightened: any rule able
 * to separate "Fix the tap - replace the head" from "C440 - 2 pcs" is also
 * wrong about something, and the good case does not occur in two months of
 * this department's writing. When a technician means a list, he numbers it.
 *
 * Run:  node test/suites/taskparts.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { splitTaskParts } from "../../src/lib/job.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

/* -------------------- what must NOT be split any more ----------------- */

t("a reference line is not five jobs", () => {
  assert.deepEqual(
    splitTaskParts("Approved - PC-2026-08-13 - along with general Inspection - Long term Transition - Read Description (Claim)"),
    []
  );
});

t("a materials list is not a job list — all eight real shapes", () => {
  const real = [
    "P-247 – 1 pc (Bottle Trap) Magic Pipe – 1 pc (Purchased from Shop).",
    "Material: Materials Required*: - *White paint*: 1 liter - *Wall putty*: 0.5 kg - *Sanding paper",
    "E-111 LED Panel Light – 1 pc 60×60 Ceiling Panel – 1 pc",
    "Materials Used: C440 – 2 pcs Cleaning Chamois – Car Stock(Duct cleaning machine.)",
    "Materials Used: E-111 LED Panel Light – 1 pc C-680 – 1 pc",
    "Material Used: Clear white paint – 1 liter Wall putty 247 – 500 grams Sandpaper – 1 piece.",
    "Materials Used P-21 – 1 pcs (Car Stock) Small Grouting – Old Car Stock",
    "Bathroom sink pop-up – 1 pc (Purchased from Al Qamar Lamia Shop) Shower curtain rod – 1 pc",
  ];
  real.forEach((d) => assert.deepEqual(splitTaskParts(d), [], d.slice(0, 45)));
});

t("one job described with a dash stays one job", () => {
  assert.deepEqual(splitTaskParts("Remove DLX and QR code - Reset smart lock"), []);
  assert.deepEqual(splitTaskParts("Water leak from the ceiling — trace and stop"), []);
  assert.deepEqual(
    splitTaskParts("Pending work - IMP - Reducer replacement - Brass Female Thread Reducer 3/4 inch to 1/2 inch, 1 piece - Collect from shop"),
    []
  );
});

/* --------------------- what must STILL be split ----------------------- */

t("a numbered list is still a list", () => {
  assert.deepEqual(
    splitTaskParts("1. Fix the leaking tap 2. Replace the shower head 3. Clear the drain"),
    ["Fix the leaking tap", "Replace the shower head", "Clear the drain"]
  );
  assert.equal(splitTaskParts("1) Clean the AC grill 2) Check the drain pan").length, 2);
});

t("a number that is a measurement is not a list", () => {
  assert.deepEqual(splitTaskParts("Replace the hose, 3.5 hrs of work"), []);
});

t("lines and bullets are still a list", () => {
  assert.equal(splitTaskParts("- closed the valve\n- replaced the washer").length, 2);
  assert.equal(splitTaskParts("Clean the filter\nCheck the thermostat").length, 2);
});

t("semicolons are still a list", () => {
  assert.deepEqual(
    splitTaskParts("Curtains damage; second bedroom sink cabinet damage"),
    ["Curtains damage", "second bedroom sink cabinet damage"]
  );
});

t("nothing in, nothing out", () => {
  [null, undefined, "", "   ", "Drain unclogging"].forEach((d) =>
    assert.deepEqual(splitTaskParts(d), [], JSON.stringify(d)));
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
