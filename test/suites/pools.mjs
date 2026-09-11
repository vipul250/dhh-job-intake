/* ---------------------------------------------------------------------- *
 * pools.mjs — delivered against contracted, for the pool round.
 *
 * The agreement he showed on 11 September:
 *
 *   Binghatti Azure 1502 · 300 x 430 cm · 2026-06-24 to 2027-06-23
 *   Pool cleaning 2-3 times weekly, chemical maintenance, monthly
 *   preventive inspections, drain/grill maintenance · AED 9,600
 *   (bigger pools +30%)
 *
 * Two things shaped this module. The cadence is the SAME on every
 * agreement, so a single default makes the report work with no data entry
 * and a per-pool override handles the exceptions. And he said plainly that
 * reports are not always reaching the office and nobody is tracking the
 * cleans — so this measures RECORDED cleans and must never be read as
 * cleans delivered. Binghatti Azure 1502 showed 3 visits in 14 days, 1.5 a
 * week against a contracted 2-3, and which of those two problems it is
 * cannot be told from here.
 *
 * Run:  node test/suites/pools.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  poolAdherence, DEFAULT_POOL_CONTRACT, STANDARD_POOL_CONTRACT, termsFor,
  SEEDED_POOL_CONTRACTS,
} from "../../src/lib/pools.js";
import { parseSheetPaste } from "../../src/lib/importSheet.js";
import { buildPropertyIndex } from "../../src/lib/propertyName.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

const clean = (over) => ({
  state: "fixed", description: "Pool Cleaning", team: "Resty",
  property: "Palm Villa", unit: "E41", ...over,
});

/* A fortnight, Monday to Sunday inclusive. */
const FORTNIGHT = { from: "2026-08-17", to: "2026-08-30" };

t("there are two tiers, and both are recorded", () => {
  /* The signed Binghatti Azure agreement, and the standard service on the
     price-comparison sheet. They differ on cadence AND on price. */
  assert.deepEqual(DEFAULT_POOL_CONTRACT.perWeek, [2, 3]);
  assert.equal(DEFAULT_POOL_CONTRACT.annualPrice, 9600);
  assert.deepEqual(STANDARD_POOL_CONTRACT.perWeek, [6, 6]);
  assert.equal(STANDARD_POOL_CONTRACT.annualPrice, 11400, "AED 950 a month");
});

t("terms resolve by pool, then by property, then the fallback", () => {
  const contracts = {
    byProperty: { "palm villa": STANDARD_POOL_CONTRACT },
    byAsset: { "palm villa::l14": { perWeek: [3, 3] } },
  };
  /* One line covers all five Palm Villa pools. */
  assert.deepEqual(termsFor("palm villa::e41", "Palm Villa", contracts).perWeek, [6, 6]);
  assert.deepEqual(termsFor("palm villa::o56", "Palm villa", contracts).perWeek, [6, 6],
    "the property key is canonical, so casing does not matter");
  /* And a single pool can still differ from its property. */
  assert.deepEqual(termsFor("palm villa::l14", "Palm Villa", contracts).perWeek, [3, 3]);
  /* Anything else falls back to the signed agreement's cadence. */
  assert.deepEqual(termsFor("gemz by danube::801", "Gemz by Danube", contracts).perWeek, [2, 3]);
});

t("expected cleans scale with the length of the period", () => {
  const r = poolAdherence([clean({ scheduledDate: "2026-08-18" })], {}, FORTNIGHT);
  const pool = r.pools[0];
  assert.equal(pool.weeks, 2);
  assert.deepEqual(pool.expected, [4, 6], "2 weeks at 2-3 a week");
});

t("a pool inside its contracted range is on contract", () => {
  const dates = ["2026-08-18", "2026-08-20", "2026-08-22", "2026-08-25", "2026-08-27"];
  const r = poolAdherence(dates.map((d) => clean({ scheduledDate: d })), {}, FORTNIGHT);
  assert.equal(r.pools[0].recorded, 5);
  assert.equal(r.pools[0].verdict, "on contract", "5 sits inside 4-6");
  assert.equal(r.pools[0].shortfall, 0);
});

t("a pool below its range reports the shortfall, not a percentage", () => {
  /* Binghatti Azure 1502's real shape: 3 in a fortnight against 4-6. */
  const dates = ["2026-08-18", "2026-08-22", "2026-08-27"];
  const r = poolAdherence(dates.map((d) => clean({ scheduledDate: d })), {}, FORTNIGHT);
  const p = r.pools[0];
  assert.equal(p.recorded, 3);
  assert.equal(p.verdict, "under");
  assert.equal(p.shortfall, 1, "one short of the minimum of four");
});

t("a pool above its range is flagged too — that is margin, not diligence", () => {
  const dates = ["18", "19", "20", "21", "22", "24", "25", "26"].map((d) => `2026-08-${d}`);
  const r = poolAdherence(dates.map((d) => clean({ scheduledDate: d })), {}, FORTNIGHT);
  assert.equal(r.pools[0].recorded, 8);
  assert.equal(r.pools[0].verdict, "over", "8 against a maximum of 6 costs us, at a fixed fee");
  assert.equal(r.pools[0].surplus, 2);
});

t("two cleans on one day count once — a pool is cleaned or it is not", () => {
  const r = poolAdherence([
    clean({ scheduledDate: "2026-08-18" }), clean({ scheduledDate: "2026-08-18" }),
  ], {}, FORTNIGHT);
  assert.equal(r.pools[0].recorded, 1, "two rows for one day is one clean");
});

t("a per-pool override beats the default", () => {
  const dates = ["2026-08-18", "2026-08-25"];
  const contracts = { byAsset: { "palm villa::e41": { perWeek: [1, 1], annualPrice: 4800 } } };
  const r = poolAdherence(dates.map((d) => clean({ scheduledDate: d })), contracts, FORTNIGHT);
  const p = r.pools[0];
  assert.deepEqual(p.expected, [2, 2]);
  assert.equal(p.verdict, "on contract", "one a week, delivered twice in two weeks");
  assert.equal(p.annualPrice, 4800);
});

t("a pool outside its contract dates is not judged", () => {
  const contracts = { byAsset: { "palm villa::e41": { start: "2026-09-01", end: "2027-08-31" } } };
  const r = poolAdherence([clean({ scheduledDate: "2026-08-18" })], contracts, FORTNIGHT);
  assert.equal(r.pools[0].verdict, "not under contract",
    "the agreement had not started — no shortfall can be claimed");
  assert.equal(r.pools[0].shortfall, 0);
});

t("only pool work counts, not everything at a villa with a pool", () => {
  const r = poolAdherence([
    clean({ scheduledDate: "2026-08-18" }),
    clean({ scheduledDate: "2026-08-19", description: "AC is not cooling" }),
  ], {}, FORTNIGHT);
  assert.equal(r.pools[0].recorded, 1, "an AC fault is not a pool clean");
});

t("what it measures is RECORDED cleans, and it says so", () => {
  const r = poolAdherence([clean({ scheduledDate: "2026-08-18" })], {}, FORTNIGHT);
  assert.equal(r.measures, "recorded",
    "he said reports do not always reach the office; this cannot claim delivery");
});

/* ------------------------ against the real data ------------------------ */

const { jobs } = parseSheetPaste(fs.readFileSync("test/harness/paste.tsv", "utf8"), null);
const index = buildPropertyIndex(jobs, []);
const real = jobs.map((j) => ({ ...j, state: "fixed", scheduledDate: j._date,
                                property: index.resolve(j.property) }));

t("the real fortnight finds twelve pools, not sixteen", () => {
  const r = poolAdherence(real, {}, { from: "2026-08-18", to: "2026-08-31" });
  assert.equal(r.pools.length, 12, `got ${r.pools.length}: ${r.pools.map((p) => p.label).join(", ")}`);
});

t("Binghatti Azure 1502 reads short even on the gentler tier", () => {
  const r = poolAdherence(real, {}, { from: "2026-08-18", to: "2026-08-31" });
  const azure = r.pools.find((p) => /azure/i.test(p.label));
  assert.ok(azure, "Binghatti Azure should be among the pools");
  assert.equal(azure.recorded, 3);
  assert.equal(azure.verdict, "under", "3 in a fortnight against 4-6");
});

t("Palm Villa on six a week reads far shorter than on two", () => {
  /* He confirmed Palm Villa is the six-a-week tier. Twelve expected in a
     fortnight against the six or seven actually recorded. */
  const contracts = { byProperty: { "palm villa": STANDARD_POOL_CONTRACT } };
  const r = poolAdherence(real, contracts, { from: "2026-08-18", to: "2026-08-31" });
  const palm = r.pools.filter((p) => /palm villa/i.test(p.label));
  assert.ok(palm.length >= 5, `expected the five Palm Villa pools, got ${palm.length}`);
  palm.forEach((p) => {
    assert.deepEqual(p.expected, [12, 12], "6 a week over two weeks");
    assert.equal(p.verdict, "under", `${p.label} recorded ${p.recorded} of 12`);
    assert.ok(p.shortfall > 0);
  });
});

t("the summary counts each verdict and the money at stake", () => {
  const r = poolAdherence(real, {}, { from: "2026-08-18", to: "2026-08-31" });
  assert.equal(r.summary.under + r.summary.over + r.summary.onContract + r.summary.notUnderContract,
    r.pools.length, "every pool falls in exactly one bucket");
  assert.ok(r.summary.annualValue > 0, "twelve pools at the default price is real revenue");
});

t("the seeded tiers put Palm Villa and Jumeirah Golf on six a week", () => {
  /* Confirmed 11 September: those two are the big pools, the rest small. */
  const r = poolAdherence(real, SEEDED_POOL_CONTRACTS, { from: "2026-08-18", to: "2026-08-31" });
  const big = r.pools.filter((p) => /palm villa|jumeirah golf/i.test(p.label));
  assert.equal(big.length, 6, "five Palm Villa pools and Jumeirah Golf Estates W019");
  big.forEach((p) => assert.deepEqual(p.expected, [12, 12], `${p.label} should expect 12`));

  /* Jumeirah Golf read "over" on the small-pool fallback. On its real tier
     it is five short, which is the opposite conclusion from the same data. */
  const golf = r.pools.find((p) => /jumeirah golf/i.test(p.label));
  assert.equal(golf.recorded, 7);
  assert.equal(golf.verdict, "under");
  assert.equal(golf.shortfall, 5);

  const small = r.pools.find((p) => /azure/i.test(p.label));
  assert.deepEqual(small.expected, [4, 6], "a small pool stays on 2-3 a week");
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);
