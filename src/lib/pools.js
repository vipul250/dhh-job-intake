/* ---------------------------------------------------------------------- *
 * pools.js — delivered against contracted, for the pool round.
 *
 * The agreement, as shown on 11 September:
 *
 *   Binghatti Azure 1502 · 300 x 430 cm · 2026-06-24 to 2027-06-23
 *   Pool cleaning 2-3 times weekly, chemical maintenance, monthly
 *   preventive inspections, drain/grill maintenance · AED 9,600
 *   Bigger pools +30%.
 *
 * TWO THINGS SHAPED THIS, and both came from him rather than from the code.
 *
 * The cadence is the same on every agreement, so a single default makes the
 * report work with NO data entry at all and a per-pool override handles the
 * exceptions. The register does not have to list the pools; the job data
 * already says which units have a pool, and the register only carries what
 * differs. That was the difference between a report he gets today and a
 * twelve-row table somebody has to type first.
 *
 * And he said plainly that reports are not always reaching the office and
 * that nobody is tracking how often these pools are cleaned. So this
 * measures RECORDED cleans. It must never be read as cleans delivered.
 * Binghatti Azure 1502 shows 3 visits in a fortnight against a contracted
 * 2-3 a week, and whether that is a pool being under-served or a clean that
 * never reached the sheet cannot be told from here. The field is called
 * `measures` and it says "recorded" for exactly that reason.
 *
 * Over-delivery is flagged as well as under. At a fixed annual fee an extra
 * clean a week is margin leaving the building, not diligence.
 * ---------------------------------------------------------------------- */

import { RESOLVED_STATES, isOffBoard } from "./job.js";
import {
  assetKey, canonUnit, canonProperty, squash, displayProperty, daysBetween,
} from "./normalize.js";

/* ---------------------------------------------------------------------- *
 * There are TWO tiers, not one default — corrected 11 September.
 *
 * The signed Binghatti Azure 1502 agreement:
 *     2-3 cleans weekly · AED 9,600 a year (AED 800 a month)
 *     monthly preventive inspections
 *
 * The standard service on the price-comparison sheet:
 *     6 cleans weekly · AED 950 a month (AED 11,400 a year)
 *     4 preventive inspections a year, weekends and public holidays
 *     included, on-demand cleaning for guest complaints
 *
 * Palm Villa's pools are on the six-a-week tier. That is five units —
 * E41, O56, O103, F30, L14 — so terms resolve by PROPERTY as well as by
 * unit, and one line covers all five instead of five lines covering one
 * pool each.
 *
 * Resolution order: the pool's own terms, then its property's, then the
 * fallback. The fallback is the signed agreement's cadence because that is
 * the one we have in writing, and a pool with no terms recorded is flagged
 * as such rather than quietly assumed to be on it.
 * ---------------------------------------------------------------------- */
export const DEFAULT_POOL_CONTRACT = {
  perWeek: [2, 3],
  annualPrice: 9600,
  /* A bigger pool is +30% on the same cadence — the price changes, the
     obligation does not. */
  largeUplift: 0.3,
};

/* The standard offering, for a property or pool that is on it. */
export const STANDARD_POOL_CONTRACT = {
  perWeek: [6, 6],
  annualPrice: 950 * 12,
  inspectionsPerYear: 4,
};

/* ---------------------------------------------------------------------- *
 * Which pools are on which tier, as he confirmed on 11 September:
 * Palm Villa and Jumeirah Golf Estates are the big pools on six a week;
 * everything else is a small pool on the signed agreement's 2-3.
 *
 * Seeded in code rather than stored, because it is two lines and a stored
 * register that nobody has written yet would report every pool as having
 * no terms. When the contracts are collected properly this becomes the
 * starting value for that register rather than the answer.
 * ---------------------------------------------------------------------- */
const BIG = { perWeek: [6, 6], annualPrice: 950 * 12, inspectionsPerYear: 4 };
const SMALL = { perWeek: [2, 3], annualPrice: 9600, inspectionsPerYear: 12 };

export const SEEDED_POOL_CONTRACTS = {
  byProperty: {
    /* Big pools, six cleans a week — confirmed 11 September. */
    "palm villa": BIG,
    "jumeirah golf estates": BIG,

    /* And the small pools, recorded EXPLICITLY rather than left to fall
       through to the default.
       
       The cadence is the same either way, so this changes no verdict. What
       it changes is that the report stops saying "terms not recorded" about
       six pools whose terms he has actually given — and, more usefully,
       keeps that warning meaningful for a pool at a property nobody has
       tiered yet. Recorded by PROPERTY, so a second pool at Binghatti
       Tulip inherits the tier instead of arriving unknown. */
    "binghatti tulip": SMALL,
    "binghatti azure": SMALL,
    "gemz by danube": SMALL,
    "acacia a": SMALL,

    /* Both spellings, on purpose. "Bingatti" is the misspelling and it is
       currently the CANONICAL name, because propertyName.js picks the
       most-used spelling and the typo is used twice to the correct name's
       once. The day somebody adds Binghatti Royale to the property master
       the canonical form flips, and a single-spelling key here would
       silently stop matching and the pool would fall back to unknown
       terms. Two lines is cheaper than that failure. */
    "binghatti royale": SMALL,
    "bingatti royale": SMALL,
  },
  byAsset: {},
};

/** The terms that apply to one pool: its own, then its property's, then the fallback. */
export function termsFor(asset, property, contracts) {
  const c = contracts || {};
  return {
    ...DEFAULT_POOL_CONTRACT,
    ...((c.byProperty || {})[canonProperty(property)] || {}),
    ...((c.byAsset || {})[asset] || {}),
  };
}

function hasOwnTerms(asset, property, contracts) {
  const c = contracts || {};
  return !!((c.byAsset || {})[asset] || (c.byProperty || {})[canonProperty(property)]);
}

const POOL_RE = /\bpool\b/i;

const jobDate = (j) => String(j.scheduledDate || j._date || "");

/**
 * Delivered against contracted, per pool, for one period.
 *
 * @param jobs      job records carrying a date
 * @param contracts { byAsset: { [assetKey]: terms }, byProperty: { [canonProperty]: terms } }
 *                  terms: { perWeek: [min,max], annualPrice, start, end, sizeCm }
 * @param period    { from, to } — a week, a fortnight, a month
 */
export function poolAdherence(jobs, contracts, period) {
  const from = period && period.from;
  const to = period && period.to;
  /* Inclusive of both ends: Monday to Sunday is seven days, not six. */
  const days = from && to ? (daysBetween(from, to) || 0) + 1 : 0;
  const weeks = days > 0 ? days / 7 : 0;

  const byPool = new Map();
  (jobs || []).forEach((j) => {
    if (!j || j._tomb) return;
    /* A cancelled clean was not a clean. Counting it would show Resty
       meeting a contract he did not meet. */
    if (isOffBoard(j)) return;
    if (!POOL_RE.test(squash(j.description))) return;      // pool work only
    const d = jobDate(j);
    if (!d) return;
    if (from && d < from) return;
    if (to && d > to) return;
    const k = assetKey(j.property, j.unit);
    if (!k) return;
    if (!byPool.has(k)) {
      byPool.set(k, {
        asset: k,
        label: `${displayProperty(j.property)} ${canonUnit(j.unit)}`.trim(),
        property: squash(j.property),
        unit: canonUnit(j.unit),
        dates: new Set(),
        techs: new Set(),
      });
    }
    const e = byPool.get(k);
    /* A pool is cleaned on a day or it is not. Two rows for one day — a
       crew job written twice, or a re-paste — is one clean. */
    e.dates.add(d);
    squash(j.team).split(/\s*(?:,|&|\+|\/|\band\b)\s*/i)
      .filter(Boolean).forEach((t) => e.techs.add(t));
  });

  const pools = [];
  byPool.forEach((e) => {
    const c = termsFor(e.asset, e.property, contracts);
    const recorded = e.dates.size;

    /* Outside its own contract dates nothing can be claimed either way. */
    const started = !c.start || (to ? to >= c.start : true);
    const ended = c.end && from && from > c.end;
    const live = started && !ended;

    const expected = weeks > 0
      ? [Math.round(c.perWeek[0] * weeks), Math.round(c.perWeek[1] * weeks)]
      : [0, 0];

    let verdict = "on contract", shortfall = 0, surplus = 0;
    if (!live) verdict = "not under contract";
    else if (recorded < expected[0]) { verdict = "under"; shortfall = expected[0] - recorded; }
    else if (recorded > expected[1]) { verdict = "over"; surplus = recorded - expected[1]; }

    const annualPrice = c.sizeCm && isLarge(c.sizeCm)
      ? Math.round(c.annualPrice * (1 + (c.largeUplift || 0)))
      : c.annualPrice;

    pools.push({
      ...e,
      dates: [...e.dates].sort(),
      techs: [...e.techs],
      weeks: Math.round(weeks * 10) / 10,
      perWeek: c.perWeek,
      expected,
      recorded,
      perWeekActual: weeks > 0 ? Math.round((recorded / weeks) * 10) / 10 : null,
      verdict, shortfall, surplus,
      annualPrice,
      hasContract: hasOwnTerms(e.asset, e.property, contracts),
      start: c.start || null,
      end: c.end || null,
    });
  });

  /* Worst first: a shortfall is an owner's complaint waiting to happen, a
     surplus is only money. */
  pools.sort((a, b) =>
    b.shortfall - a.shortfall || b.surplus - a.surplus || b.recorded - a.recorded);

  const summary = {
    pools: pools.length,
    under: pools.filter((p) => p.verdict === "under").length,
    over: pools.filter((p) => p.verdict === "over").length,
    onContract: pools.filter((p) => p.verdict === "on contract").length,
    notUnderContract: pools.filter((p) => p.verdict === "not under contract").length,
    withoutContractRecord: pools.filter((p) => !p.hasContract).length,
    totalRecorded: pools.reduce((n, p) => n + p.recorded, 0),
    totalShortfall: pools.reduce((n, p) => n + p.shortfall, 0),
    annualValue: pools.reduce((n, p) => n + (p.annualPrice || 0), 0),
  };

  return {
    period,
    weeks: Math.round(weeks * 10) / 10,
    /* Said in the data, not only in a comment. What is counted is what
       reached the board, which is not the same as what was done. */
    measures: "recorded",
    pools,
    summary,
  };
}

/* The agreement prices a 300 x 430 cm pool at the base rate and bigger
   pools 30% above it. Area is the only dimension given, so that is what
   decides; the threshold is the sample agreement's own size. */
const BASE_AREA_CM2 = 300 * 430;
function isLarge(sizeCm) {
  const m = String(sizeCm).match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!m) return false;
  return Number(m[1]) * Number(m[2]) > BASE_AREA_CM2;
}
