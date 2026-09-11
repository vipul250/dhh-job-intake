/* ---------------------------------------------------------------------- *
 * quality.mjs — the quality set, and the honesty of its denominators.
 *
 * The finding this exists to encode: any measure denominated on "confirmed
 * done" runs on 74 of 857 real jobs. First-time fix therefore reads 98.6%
 * and moves on a single job, while returns read 37.3% of 306 reactive
 * visits. Both are right and they are incommensurable, so every figure has
 * to carry its own denominator or it will be quoted without one.
 *
 * Run:  node test/suites/quality.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import fs from "node:fs";
import { returnsByUnit, qualityReport, gapsBetweenJobs } from "../../src/lib/quality.js";
import { parseSheetPaste } from "../../src/lib/importSheet.js";
import { buildPropertyIndex } from "../../src/lib/propertyName.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const job = (over) => ({
  state: "fixed", scheduledDate: "2026-09-04", team: "Jabbar",
  property: "Bella Rose", unit: "106", description: "Leakage in the bathroom",
  arrivedAt: "", leftAt: "", originDate: "2026-09-04", pushCount: 0, ...over,
});

/* ------------------- returns per unit, the headline ------------------- */

t("a return is a similar fault back at the same unit, 2 to 14 days later", () => {
  const r = returnsByUnit([
    job({ scheduledDate: "2026-09-01" }),
    job({ scheduledDate: "2026-09-05" }),          // 4 days later, same fault
  ]);
  const row = r.find((x) => x.unit === "106");
  assert.equal(row.visits, 2);
  assert.equal(row.returns, 1);
});

t("a same-day or next-day second visit is the job continuing, not a return", () => {
  const sameDay = returnsByUnit([
    job({ scheduledDate: "2026-09-01" }), job({ scheduledDate: "2026-09-01" }),
  ]);
  assert.equal(sameDay[0].returns, 0, "same day is one piece of work");
  const nextDay = returnsByUnit([
    job({ scheduledDate: "2026-09-01" }), job({ scheduledDate: "2026-09-02" }),
  ]);
  assert.equal(nextDay[0].returns, 0, "next day is the job carrying on");
});

t("recurring work is never a return — or every pool ranks top", () => {
  /* Resty runs 14 pool cleans a week at the same villas. A naive table
     ranks pools first and is worthless on sight. */
  const pools = ["2026-09-01", "2026-09-04", "2026-09-07", "2026-09-10"].map((d) =>
    job({ scheduledDate: d, description: "Pool Cleaning", team: "Resty",
          property: "Palm Villa", unit: "E41" }));
  const r = returnsByUnit(pools);
  const row = r.find((x) => x.unit === "E41");
  assert.equal(row.visits, 4);
  assert.equal(row.returns, 0, "a pool coming back on its cycle is not a failure");
});

t("a unit visited once has NO return rate, not a rate of zero", () => {
  const r = returnsByUnit([job()]);
  assert.equal(r[0].visits, 1);
  assert.equal(r[0].returnPct, null, "0% would flood the flattering end of the table");
});

t("a job with no property or unit is excluded and counted", () => {
  const r = returnsByUnit([job(), job({ property: "", unit: "" })]);
  assert.equal(r.length, 1);
  assert.equal(r.excluded, undefined, "the count belongs on the report, not the rows");
  const rep = qualityReport([job(), job({ property: "", unit: "" })]);
  assert.equal(rep.excluded, 1);
});

t("a different fault at the same unit is not a return", () => {
  const r = returnsByUnit([
    job({ scheduledDate: "2026-09-01", description: "Leakage in the bathroom" }),
    job({ scheduledDate: "2026-09-05", description: "Bedroom door handle loose" }),
  ]);
  assert.equal(r[0].returns, 0);
});

/* -------------------- every figure names its sample -------------------- */

t("each tier-2 figure carries value, n and coverage", () => {
  const rep = qualityReport([
    job({ arrivedAt: "09:00", leftAt: "10:00" }),
    job({ state: "scheduled" }),
  ]);
  Object.entries(rep.tier2).forEach(([k, m]) => {
    assert.ok(m && typeof m === "object", `${k} is not a measure object`);
    assert.ok("value" in m, `${k} has no value`);
    assert.ok("n" in m, `${k} has no sample size`);
    assert.ok("coverage" in m, `${k} has no coverage`);
  });
});

t("first-time fix reports its sample size, and is null when there is none", () => {
  const none = qualityReport([job({ description: "Pool Cleaning" })]);
  assert.equal(none.tier2.firstTimeFix.n, 0);
  assert.equal(none.tier2.firstTimeFix.value, null,
    "no reactive closed-out work means no rate, not 100%");
});

t("a figure below half coverage is marked provisional", () => {
  const rep = qualityReport([
    job({ arrivedAt: "09:00", leftAt: "10:00" }),
    job({ state: "scheduled" }), job({ state: "scheduled" }),
    job({ state: "scheduled" }), job({ state: "scheduled" }),
  ]);
  assert.equal(rep.tier2.estimateAccuracy.provisional, true);
});

/* ------------- unaccounted time between jobs ------------- */

t("the gap between two jobs is measured, and split by address", () => {
  const day = [
    job({ property: "Mesk 1 Midtown", unit: "1608", arrivedAt: "09:00", leftAt: "10:00" }),
    job({ property: "Mesk 1 Midtown", unit: "1502", arrivedAt: "12:00", leftAt: "13:00" }),
    job({ property: "Gemz by Danube", unit: "801", arrivedAt: "14:00", leftAt: "15:00" }),
  ];
  const g = gapsBetweenJobs(day);
  assert.equal(g.withinBuilding, 120, "10:00 to 12:00 in the same tower is not travel");
  assert.equal(g.betweenBuildings, 60, "13:00 to 14:00 crossing buildings plausibly is");
  assert.equal(g.pairs, 2, "three jobs give two gaps");
});

/* Corrected 11 September. This test used to assert that Palm Villa E41 to
   Palm Villa O56 was time in the same building. They are different fronds
   of the Palm and Resty drives between them — the property name is shared,
   the address is not. Counting those as no-travel gave him a travel
   estimate of zero across five pool cleans. */
t("two villas in one community are a drive, not time in a building", () => {
  const g = gapsBetweenJobs([
    job({ property: "Palm Villa", unit: "E41", arrivedAt: "09:00", leftAt: "10:00" }),
    job({ property: "Palm Villa", unit: "O56", arrivedAt: "10:20", leftAt: "11:00" }),
  ]);
  assert.equal(g.withinBuilding, 0);
  assert.equal(g.betweenBuildings, 20, "E41 to O56 is a real move");
  assert.equal(g.betweenPairs, 1);
});

t("two units in one tower are still not a drive", () => {
  const g = gapsBetweenJobs([
    job({ property: "Mesk 1 Midtown", unit: "1608", arrivedAt: "09:00", leftAt: "10:00" }),
    job({ property: "Mesk 1 Midtown", unit: "1101", arrivedAt: "10:20", leftAt: "11:00" }),
  ]);
  assert.equal(g.betweenBuildings, 0, "one lift, not one drive");
  assert.equal(g.withinBuilding, 20);
});

t("the first job of the day contributes no gap — that is the commute", () => {
  const g = gapsBetweenJobs([job({ arrivedAt: "09:00", leftAt: "10:00" })]);
  assert.equal(g.pairs, 0);
  assert.equal(g.withinBuilding, 0);
  assert.equal(g.betweenBuildings, 0);
});

t("overlapping jobs are surfaced, never clamped to zero", () => {
  const g = gapsBetweenJobs([
    job({ unit: "1", arrivedAt: "09:00", leftAt: "11:00" }),
    job({ unit: "2", arrivedAt: "10:00", leftAt: "12:00" }),   // starts before the first ended
  ]);
  assert.equal(g.overlaps, 1, "clamping to zero would hide a recording error");
  assert.equal(g.withinBuilding, 0, "an overlap contributes no time");
});

t("a gap beyond the ceiling is reported apart, not summed in", () => {
  const g = gapsBetweenJobs([
    job({ unit: "1", arrivedAt: "08:00", leftAt: "09:00" }),
    job({ unit: "2", arrivedAt: "16:00", leftAt: "17:00" }),   // seven hours later
  ]);
  assert.equal(g.withinBuilding, 0, "a shift break is not time between jobs");
  assert.equal(g.overLong, 1);
});

t("a missing leftAt yields no gap and reduces the pairs available", () => {
  const g = gapsBetweenJobs([
    job({ unit: "1", arrivedAt: "09:00", leftAt: "" }),
    job({ unit: "2", arrivedAt: "11:00", leftAt: "12:00" }),
  ]);
  assert.equal(g.pairs, 0, "a gap needs leftAt on one job and arrivedAt on the next");
  assert.equal(g.pairsPossible, 1, "and it must say how many it could not measure");
});

t("jobs are ordered by arrival, not by the order they were scheduled", () => {
  /* Listed later-first. Sorting by arrival gives a 60-minute gap; taking
     the list order would give a negative one and read as an overlap. */
  const g = gapsBetweenJobs([
    job({ unit: "2", arrivedAt: "11:00", leftAt: "12:00" }),
    job({ unit: "1", arrivedAt: "09:00", leftAt: "10:00" }),
  ]);
  assert.equal(g.withinBuilding + g.betweenBuildings, 60,
    "10:00 to 11:00 — the schedule is a plan, arrival is what happened");
  assert.equal(g.overlaps, 0, "list order would have made this an overlap");
});

/* ---------------------- against the real workbook ---------------------- */

const { jobs } = parseSheetPaste(fs.readFileSync("test/harness/paste.tsv", "utf8"), null);
const dated = jobs.map((j) => ({ ...j, state: "fixed", scheduledDate: j._date }));

t("the real workbook produces a per-unit table that sums to the total", () => {
  const rows = returnsByUnit(dated);
  const rep = qualityReport(dated);
  const summed = rows.reduce((n, r) => n + r.returns, 0);
  assert.equal(summed, rep.tier1.returns.value,
    "per-unit returns must sum to the reported total");
  assert.ok(rows.length > 100, `expected many units, got ${rows.length}`);
});

t("property name variants do not split a unit in two", () => {
  /* Binghatti Tulip 305 and "Binghatti tulips 305" are one pool. Without
     the property index they are two rows with half the visits each. */
  const index = buildPropertyIndex(dated, []);
  const resolved = dated.map((j) => ({ ...j, property: index.resolve(j.property) }));
  const rows = returnsByUnit(resolved);
  const tulip305 = rows.filter((r) => /tulip/i.test(r.property) && r.unit === "305");
  assert.equal(tulip305.length, 1, `Binghatti Tulip 305 split into ${tulip305.length} rows`);
  assert.equal(tulip305[0].visits, 6, "five visits plus the misspelt one");
});

/* ---------------------------------------------------------------------- *
 * Role, derived from the work — sub-project C.
 *
 * Resty has ZERO reactive jobs in the real data: 51 of his 56 are pool
 * cleans. Judging him on first-time fix is not unfair, it is judging him on
 * an empty set — the metric returns null or, worse, 100%.
 *
 * And it is not a two-way split. Shafeeq is 37% planned and Bijaya 29% —
 * the duct-cleaning pair — while Adi and Khaled are neither, being the
 * project crew. So role is DERIVED from the mix over the period rather than
 * configured, which also means it stays right when somebody's job changes.
 * ---------------------------------------------------------------------- */

import { rolesByTech } from "../../src/lib/quality.js";

t("a man with no reactive work is not judged on first-time fix", () => {
  const pools = Array.from({ length: 10 }, (_, i) =>
    job({ team: "Resty", description: "Pool Cleaning",
          property: "Palm Villa", unit: `E${i}`, scheduledDate: "2026-09-02" }));
  const roles = rolesByTech(pools);
  const resty = roles.find((r) => r.tech === "Resty");
  assert.equal(resty.role, "planned");
  assert.equal(resty.plannedPct, 100);
  assert.equal(resty.judgeOn.includes("firstTimeFix"), false,
    "he has no reactive work to be judged on");
  assert.ok(resty.judgeOn.includes("consistency"), "a planned round is judged on consistency");
});

t("a man doing faults is judged on whether they came back", () => {
  const reactive = Array.from({ length: 10 }, (_, i) =>
    job({ team: "Jabbar", description: "Leakage in the bathroom",
          property: "Bella Rose", unit: `${100 + i}` }));
  const jabbar = rolesByTech(reactive).find((r) => r.tech === "Jabbar");
  assert.equal(jabbar.role, "reactive");
  assert.ok(jabbar.judgeOn.includes("firstTimeFix"));
  assert.ok(jabbar.judgeOn.includes("returns"));
});

t("a genuinely mixed technician is called mixed, not forced into one", () => {
  /* Shafeeq is 37% planned in the real data. Calling him one or the other
     throws away a third of what he does. */
  const mix = [
    ...Array.from({ length: 4 }, () => job({ team: "Shafeeq", description: "AC PPM" })),
    ...Array.from({ length: 6 }, () => job({ team: "Shafeeq", description: "Leakage in the bathroom" })),
  ];
  const s = rolesByTech(mix).find((r) => r.tech === "Shafeeq");
  assert.equal(s.role, "mixed");
  assert.equal(s.plannedPct, 40);
  assert.ok(s.judgeOn.includes("firstTimeFix"), "he does enough reactive work to judge");
  assert.ok(s.judgeOn.includes("consistency"), "and enough planned work to judge");
});

t("the project crew is neither, and is not judged on either", () => {
  const crew = Array.from({ length: 8 }, () =>
    job({ team: "Adi", description: "Onboarding - Approved Quotation PC-2026-08-08" }));
  const adi = rolesByTech(crew).find((r) => r.tech === "Adi");
  assert.equal(adi.role, "project");
  assert.equal(adi.judgeOn.includes("firstTimeFix"), false);
  assert.equal(adi.judgeOn.includes("consistency"), false);
});

t("a crew job counts for both men, and role is per man", () => {
  const roles = rolesByTech([
    job({ team: "Resty & Shafeeq", description: "Pool Cleaning", property: "Palm Villa", unit: "E41" }),
  ]);
  assert.equal(roles.length, 2);
  roles.forEach((r) => assert.equal(r.jobs, 1));
});

t("consistency is the spread of a planned round, not its speed", () => {
  /* Five identical pool cleans, one of them a third of the time. That is
     the signal worth having on a planned round: not slowness, variance. */
  const steady = Array.from({ length: 4 }, (_, i) =>
    job({ team: "Resty", description: "Pool Cleaning", property: "Palm Villa", unit: `E${i}`,
          arrivedAt: "09:00", leftAt: "10:00" }));
  const r1 = rolesByTech(steady).find((r) => r.tech === "Resty");
  assert.equal(r1.consistency.spreadMins, 0, "an identical round has no spread");

  const ragged = [...steady, job({ team: "Resty", description: "Pool Cleaning",
    property: "Palm Villa", unit: "E9", arrivedAt: "11:00", leftAt: "11:20" })];
  const r2 = rolesByTech(ragged).find((r) => r.tech === "Resty");
  assert.ok(r2.consistency.spreadMins >= 30, "a 20-minute clean among hours of 60 shows up");
  assert.equal(r2.consistency.n, 5);
});

t("the real workbook splits the department the way the data does", () => {
  const roles = rolesByTech(dated);
  const byName = Object.fromEntries(roles.map((r) => [r.tech, r]));
  assert.equal(byName.Resty.role, "planned", "51 of 56 jobs are pool cleans");
  ["Anthony", "Jabbar", "Bright", "Vitalis", "Abdul Riyaz", "Yousoufu"].forEach((n) =>
    assert.equal(byName[n].role, "reactive", `${n} should read reactive`));
  assert.equal(byName.Shafeeq.role, "mixed", "37% planned");
  /* Nobody is judged on a yardstick for work they do not do. */
  assert.equal(byName.Resty.judgeOn.includes("firstTimeFix"), false);
  assert.ok(byName.Jabbar.judgeOn.includes("firstTimeFix"));
});

t("too few jobs means no role at all, not a confident wrong one", () => {
  /* Live on 11 September this read "Shafeeq — project" off ONE job. The
     role was technically correct and practically misleading: one project
     job is 100% project work. A percentage needs a denominator worth
     dividing by. */
  const one = rolesByTech([job({ team: "Shafeeq", description: "Onboarding - Approved Quotation" })]);
  const s1 = one.find((r) => r.tech === "Shafeeq");
  assert.equal(s1.role, "unrated");
  assert.deepEqual(s1.judgeOn, [], "nothing can be judged from one job");
  assert.equal(s1.jobs, 1);

  const four = rolesByTech(Array.from({ length: 4 }, () =>
    job({ team: "Shafeeq", description: "AC PPM" })));
  assert.equal(four[0].role, "unrated", "four is still below the floor");
});

t("the floor is the smallest sample the 20% threshold can divide", () => {
  /* Five, because one job in five IS twenty per cent. Not a new magic
     number — it falls out of the threshold already there. */
  const five = rolesByTech(Array.from({ length: 5 }, (_, i) =>
    job({ team: "Resty", description: "Pool Cleaning", property: "Palm Villa", unit: `E${i}` })));
  assert.equal(five[0].role, "planned", "five is enough to say what he does");
  assert.ok(five[0].judgeOn.includes("consistency"));
});

t("a real roster is unaffected by the floor", () => {
  const roles = rolesByTech(dated);
  const byName = Object.fromEntries(roles.map((r) => [r.tech, r]));
  assert.equal(byName.Shafeeq.role, "mixed", "41 jobs in August, 37% planned");
  assert.equal(byName.Resty.role, "planned");
  assert.equal(byName.Jabbar.role, "reactive");
  /* Anyone genuinely below the floor must say so rather than guess. */
  roles.filter((r) => r.jobs < 5).forEach((r) =>
    assert.equal(r.role, "unrated", `${r.tech} has ${r.jobs} jobs and should be unrated`));
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
