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

t("the gap between two jobs is measured, and split by building", () => {
  const day = [
    job({ property: "Palm Villa", unit: "E41", arrivedAt: "09:00", leftAt: "10:00" }),
    job({ property: "Palm Villa", unit: "O56", arrivedAt: "12:00", leftAt: "13:00" }),
    job({ property: "Gemz by Danube", unit: "801", arrivedAt: "14:00", leftAt: "15:00" }),
  ];
  const g = gapsBetweenJobs(day);
  assert.equal(g.withinBuilding, 120, "10:00 to 12:00 in the same building is not travel");
  assert.equal(g.betweenBuildings, 60, "13:00 to 14:00 crossing buildings plausibly is");
  assert.equal(g.pairs, 2, "three jobs give two gaps");
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

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
