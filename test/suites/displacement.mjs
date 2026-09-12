/* ---------------------------------------------------------------------- *
 * displacement.mjs — was the call right?
 *
 * Twelve of the thirteen jobs that left 10 September were displaced by an
 * arriving guest complaint or appointment. Each is a coordinator deciding
 * the new work matters more than the work already scheduled. Both
 * priorities were already stored; nobody had put them side by side.
 *
 * The first run over the real database answered the question for 2 of 70
 * departures. Not because the comparison was wrong — because the ARRIVING
 * job had no priority in 56 of the 58 cases where it could be identified.
 * It gets added mid-day and nothing asked. The move dialog asks now.
 *
 * A lower priority winning is not a mistake and these checks say so in
 * their names. It is a description.
 *
 * Run:  node test/suites/displacement.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { displacementsForDay, displacementReport } from "../../src/lib/displacement.js";
import { makeTombstone } from "../../src/lib/job.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const job = (over) => ({
  id: "w1", state: "fixed", scheduledDate: "2026-09-10",
  property: "Binghatti Avenue", unit: "2201", description: "Bathroom ceiling light fell down",
  priority: "PRI-2", team: "Anthony", ...over,
});

const lost = (over) => ({
  id: "l1", property: "Azizi Riviera 4", unit: "521", team: "Anthony",
  description: "Balcony light faulty", priority: "PRI-3", ...over,
});

const tomb = (loser, winnerIdOrLabel, at = 1000) => ({
  ...makeTombstone(loser, "2026-09-13", "Vipul", "guest-complaint",
    typeof winnerIdOrLabel === "string" && !winnerIdOrLabel.startsWith("id:")
      ? { jobId: "", label: winnerIdOrLabel }
      : { jobId: String(winnerIdOrLabel).replace(/^id:/, ""), label: "" }),
  at,
});

/* ------------------------------ the pairing --------------------------- */

t("a linked winner is compared, and the day names both halves", () => {
  const day = [job(), tomb(lost(), "id:w1")];
  const [d] = displacementsForDay(day, "2026-09-10");
  assert.equal(d.resolvedBy, "link");
  assert.equal(d.comparable, true);
  assert.equal(d.lost.priority, "PRI-3");
  assert.equal(d.won.priority, "PRI-2");
  assert.equal(d.verdict, "higher", "a P2 taking a P3's slot is the higher priority winning");
});

t("the displaced job winning its own comparison is what we look at", () => {
  const day = [job({ priority: "PRI-4" }), tomb(lost({ priority: "PRI-1" }), "id:w1")];
  const [d] = displacementsForDay(day, "2026-09-10");
  assert.equal(d.verdict, "lower", "a P1 gave way to a P4");
  const r = displacementReport({ "2026-09-10": day });
  assert.equal(r.lower, 1);
  assert.equal(r.worthALook.length, 1);
});

t("equal priorities are named, not scored", () => {
  const day = [job({ priority: "PRI-3" }), tomb(lost({ priority: "PRI-3" }), "id:w1")];
  assert.equal(displacementsForDay(day, "2026-09-10")[0].verdict, "same");
});

/* ------------------------- naming without a link ---------------------- */

t("the coordinator's own words resolve when exactly one job fits", () => {
  const day = [job(), tomb(lost(), "Bingatti Avenue 2201, bad smell")];
  const [d] = displacementsForDay(day, "2026-09-10");
  assert.equal(d.resolvedBy, "label", "matched from the label, and marked as such");
  assert.equal(d.won.unit, "2201");
});

t("an ambiguous label is left unresolved rather than guessed", () => {
  /* Two jobs at unit 2201 on the day. A wrong pairing here reads as a
     coordinator making a bad call he did not make. */
  const day = [
    job({ id: "a" }),
    job({ id: "b", description: "Something else entirely" }),
    tomb(lost(), "Binghatti Avenue 2201"),
  ];
  const [d] = displacementsForDay(day, "2026-09-10");
  assert.equal(d.resolvedBy, null);
  assert.equal(d.comparable, false);
  assert.equal(d.won, null);
});

t("a label naming nothing on the day resolves to nothing", () => {
  const day = [job(), tomb(lost(), "no info on that")];
  const [d] = displacementsForDay(day, "2026-09-10");
  assert.equal(d.resolvedBy, null);
  assert.equal(d.comparable, false);
});

/* ------------------------- the honest denominator --------------------- */

t("a missing priority on either half makes it uncomparable, not a guess", () => {
  const noWinnerPri = [job({ priority: "" }), tomb(lost(), "id:w1")];
  assert.equal(displacementsForDay(noWinnerPri, "2026-09-10")[0].comparable, false);
  const noLostPri = [job(), tomb(lost({ priority: "" }), "id:w1")];
  assert.equal(displacementsForDay(noLostPri, "2026-09-10")[0].comparable, false);
});

t("coverage is reported, and it is the fraction that can be judged", () => {
  const r = displacementReport({
    "2026-09-10": [job(), tomb(lost(), "id:w1"), tomb(lost({ id: "l2" }), "no info on that", 2000)],
  });
  assert.equal(r.displacements, 2);
  assert.equal(r.comparable, 1);
  assert.equal(r.coverage, 50);
});

t("the real shape as of 12 September: winners carry no priority", () => {
  /* 56 of 58 identified winners were blank. The report must say nothing
     rather than imply the calls were fine. */
  const day = [job({ priority: "" }), tomb(lost(), "id:w1")];
  const r = displacementReport({ "2026-09-10": day });
  assert.equal(r.displacements, 1);
  assert.equal(r.comparable, 0);
  assert.equal(r.coverage, 0);
  assert.equal(r.higher + r.same + r.lower, 0, "no verdict is better than a made-up one");
});

t("a job moved twice is one displacement, not two", () => {
  const day = [job(), tomb(lost(), "id:w1", 1000), tomb(lost(), "id:w1", 2000)];
  assert.equal(displacementsForDay(day, "2026-09-10").length, 1);
});

t("a move with nothing recorded as taking the slot is not a displacement", () => {
  const day = [job(), { ...makeTombstone(lost(), "2026-09-13", "Vipul", "no-access", null), at: 1 }];
  assert.equal(displacementsForDay(day, "2026-09-10").length, 0);
});

t("the period filter holds", () => {
  const byDay = {
    "2026-09-10": [job(), tomb(lost(), "id:w1")],
    "2026-08-10": [job(), tomb(lost({ id: "l9" }), "id:w1")],
  };
  assert.equal(displacementReport(byDay, "2026-09").displacements, 1);
  assert.equal(displacementReport(byDay).displacements, 2);
  assert.equal(displacementReport(byDay, { from: "2026-09-01", to: "2026-09-30" }).displacements, 1);
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
