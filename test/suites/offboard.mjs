/* ---------------------------------------------------------------------- *
 * offboard.mjs — rows that are not jobs, and time that is not productive.
 *
 * The finding this encodes: of 96 rows marked "not done" across 63 days,
 * 26 meant the work did not happen. 46 meant the row should not exist and
 * 11 meant somebody else did the work. The board reported all 96 as
 * failures, against named technicians.
 *
 * 10 September is the day the coordinator vouches for. It must read
 * 28 fixed, 4 diagnosed, 1 not done, 1 still open — not 7 failures.
 *
 * Run:  node test/suites/offboard.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import {
  setState, reassign, applyEdit, isOffBoard, isResolved,
  NOT_DONE_REASONS, OFF_BOARD_REASONS, OFF_BOARD_LABEL, actualDuration,
} from "../../src/lib/job.js";
import { returnsByUnit, timeByTech } from "../../src/lib/quality.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const job = (over) => ({
  id: "j1", state: "scheduled", scheduledDate: "2026-09-10", team: "Vitalis",
  property: "Dubai Marina Mall Hotel", unit: "2111",
  description: "Master bedroom sink cabinet damage need to fixed",
  arrivedAt: "", leftAt: "", actualMinutes: null, events: [],
  originDate: "2026-09-10", pushCount: 0, ...over,
});

/* ------------------------------ the model ----------------------------- */

t("the two reasons that meant 'delete this row' are out of NOT_DONE_REASONS", () => {
  assert.ok(!NOT_DONE_REASONS.includes("Wrong unit or wrong information on the job"));
  assert.ok(!NOT_DONE_REASONS.includes("Needs contractor / out of scope"));
  // and the ones that genuinely mean the work did not happen are still there
  assert.ok(NOT_DONE_REASONS.includes("No access / guest refused"));
  assert.ok(NOT_DONE_REASONS.includes("Ran out of time"));
});

t("every off-board reason has an id and a label", () => {
  OFF_BOARD_REASONS.forEach((r) => {
    assert.ok(r.id && r.label, JSON.stringify(r));
    assert.equal(OFF_BOARD_LABEL[r.id], r.label);
  });
  assert.ok(OFF_BOARD_REASONS.some((r) => r.id === "duplicate"));
  assert.ok(OFF_BOARD_REASONS.some((r) => r.id === "wrong-entry"));
  assert.ok(OFF_BOARD_REASONS.some((r) => r.id === "other-team"));
});

t("taking a row off the board records why, and what it duplicates", () => {
  const off = setState(job(), "cancelled", "Vipul", {
    reason: "Duplicate — this work is on another row",
    offBoard: "duplicate", duplicateOf: "j-other",
  });
  assert.equal(off.state, "cancelled");
  assert.equal(off.offBoard, "duplicate");
  assert.equal(off.duplicateOf, "j-other");
  assert.ok(isOffBoard(off));
  assert.ok(!isResolved(off.state), "off the board is not work done");
});

t("an off-board row keeps its whole history — nothing is deleted", () => {
  const before = setState(job(), "not_done", "Vipul", { reason: "Ran out of time" });
  const off = setState(before, "cancelled", "Vipul", { offBoard: "wrong-entry", reason: "Raised in error" });
  assert.ok(off.events.length >= 2);
  assert.equal(off.description, "Master bedroom sink cabinet damage need to fixed");
});

t("handing to another team records who has it", () => {
  const off = setState(job({ team: "Jabbar", description: "Remove DLX and QR code" }),
    "cancelled", "Vipul", { offBoard: "other-team", handedTo: "Housekeeping", reason: "Minor task" });
  assert.equal(off.offBoard, "other-team");
  assert.equal(off.handedTo, "Housekeeping");
});

/* --------------------------- reassignment ----------------------------- */

t("moved to another technician today: new owner, still owes an answer", () => {
  const r = reassign(job({ team: "Vitalis" }), "Yousoufu", "Vipul", "Vitalis on a guest complaint");
  assert.equal(r.team, "Yousoufu");
  assert.equal(r.state, "scheduled", "it is not finished — the new man still owes the answer");
  assert.equal(r.reassignedFrom, "Vitalis");
  assert.ok(!isResolved(r.state) && !isOffBoard(r));
});

t("reassignment does NOT count as a failure for the original technician", () => {
  const r = reassign(job({ team: "Bright" }), "Vitalis", "Vipul");
  assert.notEqual(r.state, "not_done");
  assert.equal(r.outcomeReason, "", "no failure reason is carried over");
});

t("the day's log shows who handed the work over", () => {
  const r = reassign(job({ team: "Vitalis" }), "Yousoufu", "Vipul");
  const last = r.events[r.events.length - 1];
  assert.equal(last.kind, "assigned", "team-only change must stay an 'assigned' event");
  assert.equal(last.by, "Vipul");
  assert.equal(last.changes[0].from, "Vitalis");
  assert.equal(last.changes[0].to, "Yousoufu");
});

t("a reassigned job that is then closed out credits the new technician", () => {
  const r = reassign(job({ team: "Vitalis" }), "Yousoufu", "Vipul");
  const done = setState(r, "fixed", "Vipul");
  assert.equal(done.team, "Yousoufu");
  assert.ok(isResolved(done.state));
});

/* ------------------ off-board rows leave the metrics ------------------ */

t("duplicates no longer inflate the visits denominator", () => {
  const real = job({ id: "a", state: "fixed", team: "Yousoufu" });
  const dupes = ["b", "c", "d"].map((id) =>
    setState(job({ id }), "cancelled", "Vipul", { offBoard: "duplicate", duplicateOf: "a" }));
  const rows = returnsByUnit([real, ...dupes], "2026-09");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visits, 1, "four rows, one piece of work, one visit");
});

t("without the fix the same unit read four visits", () => {
  const four = ["a", "b", "c", "d"].map((id) => job({ id, state: "fixed" }));
  assert.equal(returnsByUnit(four, "2026-09")[0].visits, 4);
});

/* --------------------------- productive time -------------------------- */

const timed = (over) => job({ arrivedAt: "09:00", leftAt: "10:30", ...over });

t("productive time counts only a visit with arrival AND departure", () => {
  const rows = timeByTech([
    timed({ id: "a", state: "fixed", team: "Jabbar" }),
    job({ id: "b", state: "fixed", team: "Jabbar", actualMinutes: 240 }),  // typed total
  ], "2026-09");
  const j = rows.find((r) => r.tech === "Jabbar");
  assert.equal(j.productiveMin, 90, "the typed 240 is not a measured visit");
  assert.equal(j.productive, 1);
  assert.equal(j.unmeasured, 1);
});

t("a technician who reached the property but produced nothing gets no productive time", () => {
  const rows = timeByTech([
    setState(timed({ id: "a", team: "Bright" }), "not_done", "Vipul", { reason: "No access / guest refused" }),
  ], "2026-09");
  const b = rows.find((r) => r.tech === "Bright");
  assert.equal(b.productiveMin, 0, "no access produced nothing");
  assert.equal(b.attendedMin, 90, "but the 90 minutes are not thrown away");
  assert.equal(b.attended, 1);
});

t("attended-then-cancelled is reported, never counted as productive", () => {
  const rows = timeByTech([
    setState(timed({ id: "a", team: "Bright" }), "cancelled", "Vipul",
      { offBoard: "called-off", reason: "Called off by the owner, PM or guest" }),
  ], "2026-09");
  const b = rows.find((r) => r.tech === "Bright");
  assert.equal(b.productiveMin, 0);
  assert.equal(b.attendedMin, 90);
});

t("an off-board row with no visit belongs to nobody's day", () => {
  const rows = timeByTech([
    setState(job({ id: "a", team: "Bright" }), "cancelled", "Vipul", { offBoard: "duplicate" }),
  ], "2026-09");
  assert.equal(rows.length === 0 || rows[0].jobs === 0, true);
});

t("every productive figure carries its coverage", () => {
  const rows = timeByTech([
    timed({ id: "a", state: "fixed", team: "Jabbar" }),
    ...Array.from({ length: 9 }, (_, i) => job({ id: `x${i}`, state: "fixed", team: "Jabbar" })),
  ], "2026-09");
  const j = rows[0];
  assert.equal(j.jobs, 10);
  assert.equal(j.measured, 1);
  assert.equal(j.coverage.coverage, 10, "1 of 10 visits measured");
  assert.equal(j.coverage.provisional, true, "10% coverage cannot be quoted as a rate");
});

t("a technician with no measured visit has no hours figure — not zero hours", () => {
  const rows = timeByTech([job({ id: "a", state: "fixed", team: "Rizwan" })], "2026-09");
  assert.equal(rows[0].productiveHours, null, "0h would read as idleness");
});

t("two men on one job split the visit rather than doubling the day", () => {
  const rows = timeByTech([timed({ id: "a", state: "fixed", team: "Abdul Riyaz and Anthony" })], "2026-09");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].productiveMin + rows[1].productiveMin, 90);
});

/* ------------------- 10 September, the day he vouches for -------------- */

t("10 September reads one failure, not seven", () => {
  /* The seven rows the board called failures, classified the way the
     coordinator's own notes describe them. */
  const day = [
    setState(job({ id: "1", property: "Damac Prive A", unit: "3010A", team: "Bright" }),
      "diagnosed", "Vipul", { reason: "Needs a contractor — out of scope", stillNeeded: "Contractor quote" }),
    reassign(job({ id: "2", property: "Cloud A", unit: "2004", team: "Bright" }), "Vitalis", "Vipul"),
    setState(job({ id: "3", property: "Sobha Hartland Waves", unit: "3411", team: "Jabbar" }),
      "cancelled", "Vipul", { offBoard: "other-team", handedTo: "Housekeeping" }),
    setState(job({ id: "4", property: "Ocean Heights", unit: "903", team: "Vitalis" }),
      "not_done", "Vipul", { reason: "No access / guest refused" }),
    setState(job({ id: "5", team: "Yousoufu" }), "fixed", "Vipul"),
    setState(job({ id: "6", team: "Vitalis" }), "cancelled", "Vipul", { offBoard: "duplicate", duplicateOf: "5" }),
    setState(job({ id: "7", team: "Yousoufu" }), "cancelled", "Vipul", { offBoard: "duplicate", duplicateOf: "5" }),
  ];

  const notDone = day.filter((j) => j.state === "not_done");
  assert.equal(notDone.length, 1, "exactly one job did not happen");
  assert.equal(notDone[0].property, "Ocean Heights");

  assert.equal(day.filter(isOffBoard).length, 3);
  assert.equal(day.filter((j) => j.offBoard === "duplicate").length, 2);
  assert.equal(day.filter((j) => j.offBoard === "other-team").length, 1);
  assert.equal(day.filter((j) => j.state === "scheduled").length, 1, "the reassigned one still owes an answer");
  assert.equal(day.filter((j) => isResolved(j.state)).length, 2);
});

t("the 2111 tangle is one visit once the duplicates are off the board", () => {
  const rows = returnsByUnit([
    setState(job({ id: "5", team: "Yousoufu" }), "fixed", "Vipul"),
    setState(job({ id: "6" }), "cancelled", "Vipul", { offBoard: "duplicate", duplicateOf: "5" }),
    setState(job({ id: "7" }), "cancelled", "Vipul", { offBoard: "duplicate", duplicateOf: "5" }),
    setState(job({ id: "8" }), "cancelled", "Vipul", { offBoard: "duplicate", duplicateOf: "5" }),
  ], "2026-09");
  assert.equal(rows[0].visits, 1);
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
