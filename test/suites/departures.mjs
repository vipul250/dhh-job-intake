/* ---------------------------------------------------------------------- *
 * departures.mjs — one tombstone per job that left the day.
 *
 * This exists because of a twenty-day study, not a bug report. From
 * 10 September the department is recording the coordinators' posted plan
 * and then what actually happened, every day, to answer one question: how
 * much of a posted schedule survives contact with the day.
 *
 * "Jobs that left the day" is the numerator of that question, and it was
 * counting MOVES rather than JOBS. 1 September holds eight tombstones for
 * two jobs — one was moved four times. 10 September reported thirteen
 * departures for twelve jobs. A study run on those figures would have
 * overstated displacement by up to 75% on its worst day and nobody reading
 * the report could have seen it.
 *
 * Run:  node test/suites/departures.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { latestTombstones, makeTombstone, moveJob, isTombstone, reassign } from "../../src/lib/job.js";
import { feedQuality } from "../../src/lib/feed.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const job = (over) => ({
  id: "j1", state: "scheduled", scheduledDate: "2026-09-10", originDate: "2026-09-10",
  property: "Azizi Riviera 4", unit: "306", team: "Anthony", description: "Actuator replacement",
  estimatedTime: "1h", priority: "PRI-3", pushCount: 0, events: [], ...over,
});

t("a job moved once leaves one tombstone", () => {
  const { tomb } = moveJob(job(), "2026-09-13", "Vipul", "guest-complaint");
  assert.equal(latestTombstones([tomb]).length, 1);
});

t("a job moved twice still leaves one departure", () => {
  const a = makeTombstone(job(), "2026-09-13", "Vipul", "guest-complaint", null);
  const b = { ...makeTombstone(job(), "2026-09-13", "Vipul", "guest-complaint", null), at: a.at + 1000 };
  const kept = latestTombstones([a, b]);
  assert.equal(kept.length, 1, "one job left the day, however many times it was recorded");
  assert.equal(kept[0].at, b.at, "the later record is the one that is true");
});

t("the 1 September shape: eight records, two jobs", () => {
  const rows = [];
  ["Al Fattan Marine Tower", "Seven Palm Hotel and Residences"].forEach((p, n) => {
    for (let i = 0; i < 4; i++) {
      rows.push({ ...makeTombstone(job({ id: `job-${n}`, property: p }), "2026-09-02", "Vipul", "guest-complaint", null),
        at: 1000 + i });
    }
  });
  assert.equal(rows.filter(isTombstone).length, 8);
  assert.equal(latestTombstones(rows).length, 2, "two jobs left, not eight");
});

t("two different jobs to the same day are two departures", () => {
  const rows = [
    makeTombstone(job({ id: "a" }), "2026-09-13", "Vipul", "guest-complaint", null),
    makeTombstone(job({ id: "b" }), "2026-09-13", "Vipul", "guest-complaint", null),
  ];
  assert.equal(latestTombstones(rows).length, 2);
});

t("a job moved to one day and then another is still one departure", () => {
  /* He changed his mind about WHERE, not about whether it left. */
  const a = makeTombstone(job(), "2026-09-12", "Vipul", "guest-complaint", null);
  const b = { ...makeTombstone(job(), "2026-09-13", "Vipul", "guest-complaint", null), at: a.at + 1000 };
  const kept = latestTombstones([a, b]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].toDate, "2026-09-13", "where it ended up");
});

t("live jobs are never counted as departures", () => {
  assert.equal(latestTombstones([job(), job({ id: "j2" })]).length, 0);
  assert.equal(latestTombstones([]).length, 0);
  assert.equal(latestTombstones(null).length, 0);
});

t("the feed's moves-explained figure counts jobs, not records", () => {
  const withWhy = { ...makeTombstone(job({ id: "a" }), "2026-09-13", "V", "guest-complaint",
    { label: "Binghatti Avenue 2201, bad smell" }), at: 1 };
  const dupe = { ...withWhy, id: "tomb-dupe", at: 2 };
  const noWhy = makeTombstone(job({ id: "b" }), "2026-09-13", "V", "no-access", null);
  const [d] = feedQuality({ "2026-09-10": [job({ id: "live", state: "fixed" }), withWhy, dupe, noWhy] });
  assert.equal(d.moves, 2, "two jobs left, though three records exist");
  assert.equal(d.explainedPct, 50, "one of the two says what took the slot");
});

/* ---------------- moved to another day AND another man ---------------- *
 * Raised 12 September: "lets say i move the task for 12th, and when i open
 * 12th it lands on the same technincan but in reality its assigned to
 * someone else."
 * --------------------------------------------------------------------- */

t("the moved job carries the new technician", () => {
  const { moved: asIs, tomb } = moveJob(job({ team: "Anthony" }), "2026-09-12", "Vipul", "guest-complaint");
  const moved = reassign(asIs, "Vitalis", "Vipul", "New guest complaint took the slot");
  assert.equal(moved.team, "Vitalis", "the 12th shows who actually has it");
  assert.equal(moved.scheduledDate, "2026-09-12");
  assert.equal(moved.state, "scheduled");
  assert.equal(moved.reassignedFrom, "Anthony");
});

t("the day it left still records who was PLANNED to do it", () => {
  /* This is what the plan-versus-actual study reads. If the tombstone took
     the new name, the 11th would claim Vitalis was scheduled that day and
     the whole comparison would be against a plan nobody wrote. */
  const { tomb } = moveJob(job({ team: "Anthony" }), "2026-09-12", "Vipul", "guest-complaint");
  assert.equal(tomb.snapshot.team, "Anthony");
});

t("the handover is in the job's own history, not only in the move", () => {
  const { moved: asIs } = moveJob(job({ team: "Anthony" }), "2026-09-12", "Vipul", "guest-complaint");
  const moved = reassign(asIs, "Vitalis", "Vipul");
  const kinds = moved.events.map((e) => e.kind);
  assert.ok(kinds.includes("moved_in"), "it moved");
  assert.equal(kinds[kinds.length - 1], "assigned", "and then it changed hands");
});

t("moving without changing the technician leaves him on it", () => {
  const { moved } = moveJob(job({ team: "Anthony" }), "2026-09-12", "Vipul", "guest-complaint");
  assert.equal(moved.team, "Anthony");
  assert.ok(!moved.reassignedFrom, "nothing to record — nobody handed it over");
});

t("moving it to nobody leaves it unassigned, not wrongly assigned", () => {
  const { moved: asIs } = moveJob(job({ team: "Anthony" }), "2026-09-12", "Vipul", "guest-complaint");
  const moved = reassign(asIs, "", "Vipul");
  assert.equal(moved.team, "", "for whoever is free on the day");
  assert.equal(moved.reassignedFrom, "Anthony");
});

/* -------------- handed over WITHOUT leaving the day ------------------- *
 * 12 September: "i should have the option to choose the same date along
 * with the person whom it should be assigned to and its logical because as
 * the day progresses the coordinators does not know what is going to
 * happen."
 *
 * Staying on the day is not a move. The distinction matters beyond tidiness:
 * a tombstone here would be counted as a displacement by the study, and a
 * push count would make the job look deferred when it was simply handed to
 * the man who was free.
 * --------------------------------------------------------------------- */

t("a same-day handover writes no departure and no push", () => {
  const before = job({ team: "Anthony", pushCount: 0 });
  const after = reassign(before, "Vitalis", "Vipul", "New guest complaint took the slot");
  assert.equal(latestTombstones([after]).length, 0, "nothing left the day");
  assert.equal(after.pushCount, 0, "it was not deferred");
  assert.equal(after.scheduledDate, "2026-09-10", "and it did not move");
  assert.equal(after.team, "Vitalis");
});

t("the study does not see a same-day handover as a displacement", () => {
  const after = reassign(job({ team: "Anthony" }), "Vitalis", "Vipul");
  const [d] = feedQuality({ "2026-09-10": [after] });
  assert.equal(d.moves, 0, "no move to explain");
  assert.equal(d.jobs, 1);
});

t("a same-day handover still owes an answer", () => {
  const after = reassign(job({ team: "Anthony", state: "scheduled" }), "Vitalis", "Vipul");
  assert.equal(after.state, "scheduled", "Vitalis has not done it yet");
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
