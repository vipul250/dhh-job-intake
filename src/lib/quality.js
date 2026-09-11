/* ---------------------------------------------------------------------- *
 * quality.js — did the work hold, and how much of that can we actually say.
 *
 * The finding this module exists to encode, measured on the live database
 * for 11 August to 9 September:
 *
 *     857 jobs   253 closed out (29.5%)   158 timed (18%)
 *     reactive AND confirmed done: 74 (8.6%)
 *
 * Two quality measures already on the Dashboard therefore disagree by forty
 * points — returns at 37.3% of 306 reactive visits, first-time fix at 98.6%
 * of 74 confirmed ones. Neither is wrong. They are incommensurable, and the
 * flattering one is the one that gets quoted.
 *
 * So metrics are split by WHAT THEY DEPEND ON:
 *
 *   tier 1  scheduling history. Complete for every job today. Nobody has to
 *           close anything out for these to be true.
 *   tier 2  outcomes. Every figure carries its own denominator and is marked
 *           provisional below half coverage — the threshold Monthly already
 *           uses for its timed-minutes caveat.
 *
 * Deliberately standalone, like monthly.js: it imports job.js,
 * faultFamily.js and normalize.js and nothing else. In particular it does
 * NOT import metrics.js, which is 1,412 lines and was deleted outright on
 * 10 September before being restored. Anything living in there dies with it
 * next time.
 * ---------------------------------------------------------------------- */

import { actualDuration, RESOLVED_STATES, readClock } from "./job.js";
import { isOurFault } from "./faultFamily.js";
import {
  assetKey, canonProperty, canonUnit, squash, workType, daysBetween,
  parseDurationMinutes,
} from "./normalize.js";

/* A return inside this window is the same fault coming back. Beyond it, it
   is new work on an old asset. Same window metrics.js uses. */
const RETURN_WINDOW_DAYS = 14;

/* Below this, a figure is a sample rather than a rate. Monthly already
   draws the line here for timed minutes; one threshold, not two. */
const PROVISIONAL_BELOW = 50;

/* A gap longer than this is a shift break or a day that went wrong, not
   time between two jobs. Reported apart rather than summed, the same
   treatment actualDuration gives a twelve-hour job. */
const GAP_CEILING_MIN = 180;

const jobDate = (j) => String(j.scheduledDate || j._date || "");

/* Words that carry meaning, for deciding whether two faults are the same.
   Lifted from metrics.js's `similar` rather than reinvented — one rule for
   "is this the same fault", wherever it is asked. */
const STOP = new Set(["the", "a", "and", "to", "for", "of", "in", "on", "is",
  "are", "be", "it", "not", "with", "from", "at", "need", "needs", "please",
  "check", "this", "that", "has", "have"]);

const descTokens = (s) => new Set(
  squash(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
);

function sameFault(a, b) {
  if (a.faultCode && b.faultCode && a.faultCode === b.faultCode &&
      !/NEEDS-REVIEW|SCOPE-UNKNOWN/.test(b.faultCode)) return true;
  const A = descTokens(a.description), B = descTokens(b.description);
  if (!A.size || !B.size) return false;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit++; });
  return hit / Math.min(A.size, B.size) >= 0.5;
}

/* Recurring work is SUPPOSED to come back. Resty runs fourteen pool cleans
   a week at the same villas; counting those as returns ranks every pool at
   the top of the table and makes it worthless on sight. */
const isRecurring = (j) => workType(j.description, j.faultCode) === "ppm";

const measure = (value, n, possible) => {
  const coverage = possible > 0 ? Math.round((n / possible) * 1000) / 10 : null;
  return {
    value, n, possible, coverage,
    provisional: coverage == null ? true : coverage < PROVISIONAL_BELOW,
  };
};

const inPeriod = (j, period) => {
  if (!period) return true;
  const d = jobDate(j);
  if (!d) return false;
  if (typeof period === "string") return d.startsWith(period);
  return (!period.from || d >= period.from) && (!period.to || d <= period.to);
};

/* ---------------------------------------------------------------------- *
 * Returns per unit — the headline.
 *
 * Chosen over time-waiting because it is concrete, per-asset, needs no
 * close-out, and is already the figure used to justify charging an owner
 * for excessive visits.
 * ---------------------------------------------------------------------- */
export function returnsByUnit(jobs, period) {
  const byAsset = new Map();
  (jobs || []).forEach((j) => {
    if (!j || j._tomb) return;
    if (!inPeriod(j, period)) return;
    const k = assetKey(j.property, j.unit);
    if (!k) return;                                  // counted by qualityReport
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k).push(j);
  });

  const rows = [];
  byAsset.forEach((list, k) => {
    const sorted = list.slice().sort((a, b) => jobDate(a).localeCompare(jobDate(b)));
    let returns = 0;
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      if (isRecurring(cur)) continue;
      /* Against every earlier visit, not only the one immediately before:
         a fault that comes back on the third visit is still a return. */
      const back = sorted.slice(0, i).some((prev) => {
        const gap = daysBetween(jobDate(prev), jobDate(cur));
        if (gap == null || gap < 2 || gap > RETURN_WINDOW_DAYS) return false;
        return sameFault(prev, cur);
      });
      if (back) returns++;
    }
    const visits = sorted.length;
    rows.push({
      asset: k,
      property: squash(sorted[0].property),
      unit: canonUnit(sorted[0].unit),
      visits,
      returns,
      /* Null, never zero. A unit seen once has no rate, and 0% would flood
         the flattering end of the table with single-visit units. */
      returnPct: visits >= 2 ? Math.round((returns / visits) * 1000) / 10 : null,
      recurring: sorted.filter(isRecurring).length,
      oldestWaitDays: Math.max(...sorted.map((j) => waitDays(j))),
      dates: [...new Set(sorted.map(jobDate))],
    });
  });

  return rows.sort((a, b) => b.returns - a.returns || b.visits - a.visits);
}

/** Days from where the job first landed to where it ended up, or to today. */
function waitDays(j, today) {
  const from = squash(j.originDate) || jobDate(j);
  const open = !RESOLVED_STATES.includes(j.state) && j.state !== "cancelled";
  const to = open ? (today || new Date().toISOString().slice(0, 10)) : jobDate(j);
  const d = daysBetween(from, to);
  return d == null || d < 0 ? 0 : d;
}

/* ---------------------------------------------------------------------- *
 * Unaccounted time between jobs.
 *
 * Today the cost of a day's movement is an ASSUMPTION —
 * travelMinutesPerHop: 30 in cost.js, flagged there as a placeholder.
 * Jumeirah Golf Estates to Binghatti Tulip is not thirty minutes in Dubai
 * traffic. It can be measured from arrive and leave times instead.
 *
 * IT IS NOT CALLED TRAVEL, and that is the design. The gap contains
 * travel. It also contains lunch, a warehouse collection, waiting at a
 * door, writing up the last job, and refuelling — the 1.5-hour gap after
 * Base Tower raised in the coordinator meeting on 8 September. The data
 * cannot tell those apart, so the measure does not claim to.
 *
 * The one causal split the data DOES support: a gap between two jobs in the
 * same building cannot be travel. Between buildings, it plausibly is.
 * ---------------------------------------------------------------------- */
export function gapsBetweenJobs(jobs) {
  /* Ordered by ARRIVAL, not by the schedule. The schedule is a plan; the
     arrival times are what happened. */
  const timed = (jobs || [])
    .filter((j) => j && !j._tomb && squash(j.arrivedAt))
    .sort((a, b) => readClock(a.arrivedAt) - readClock(b.arrivedAt));

  let withinBuilding = 0, betweenBuildings = 0;
  let pairs = 0, pairsPossible = 0, overlaps = 0, overLong = 0;

  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1], cur = timed[i];
    pairsPossible++;
    const left = readClock(prev.leftAt);
    const arrived = readClock(cur.arrivedAt);
    if (left == null || arrived == null) continue;    // needs both to be a gap

    const gap = arrived - left;
    if (gap < 0) { overlaps++; continue; }            // surfaced, never clamped
    if (gap > GAP_CEILING_MIN) { overLong++; continue; }

    pairs++;
    const same = canonProperty(prev.property) &&
      canonProperty(prev.property) === canonProperty(cur.property);
    if (same) withinBuilding += gap; else betweenBuildings += gap;
  }

  return {
    withinBuilding, betweenBuildings,
    total: withinBuilding + betweenBuildings,
    pairs, pairsPossible, overlaps, overLong,
  };
}

/* ---------------------------------------------------------------------- *
 * The report.
 * ---------------------------------------------------------------------- */
export function qualityReport(jobs, period, opts = {}) {
  const all = (jobs || []).filter((j) => j && !j._tomb && inPeriod(j, period));
  const today = opts.today;

  const withAsset = all.filter((j) => assetKey(j.property, j.unit));
  const excluded = all.length - withAsset.length;

  const units = returnsByUnit(withAsset, null);
  const totalReturns = units.reduce((n, r) => n + r.returns, 0);

  const reactive = all.filter((j) => workType(j.description, j.faultCode) === "reactive");
  const done = all.filter((j) => RESOLVED_STATES.includes(j.state));
  const reactiveDone = reactive.filter((j) => RESOLVED_STATES.includes(j.state));

  /* First-time fix, with the sample size co-equal. It reads 98.6% on the
     real data from 74 of 857 jobs; the number is not the problem, quoting
     it without the 74 is. */
  const ftfReturned = reactiveDone.filter((j) => {
    const k = assetKey(j.property, j.unit);
    if (!k) return false;
    return all.some((o) => {
      if (o === j || assetKey(o.property, o.unit) !== k) return false;
      const gap = daysBetween(jobDate(j), jobDate(o));
      if (gap == null || gap < 2 || gap > RETURN_WINDOW_DAYS) return false;
      return sameFault(j, o);
    });
  }).length;

  const withReason = all.filter((j) => squash(j.returnReason));
  const ourFault = withReason.filter((j) => isOurFault(squash(j.returnReason)));
  const guestDamage = withReason.filter((j) => squash(j.returnReason) === "guest-damage");

  const noAccess = done.filter((j) => /no access|refus|not reachable/i.test(squash(j.outcomeReason)));
  const timed = all.filter((j) => actualDuration(j).minutes != null);
  const estimated = timed.filter((j) => parseDurationMinutes(j.estimatedTime) != null);
  const accurate = estimated.filter((j) => {
    const act = actualDuration(j).minutes;
    const est = parseDurationMinutes(j.estimatedTime);
    return est > 0 && Math.abs(act - est) / est <= 0.25;
  });

  const waits = all.map((j) => waitDays(j, today)).sort((a, b) => a - b);
  const median = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);
  const pushed = all.filter((j) => (j.pushCount || 0) >= 3);
  const occupied = all.filter((j) => /^occupied|check-?in|b2b/i.test(squash(j.status)));
  const unconfirmed = occupied.filter((j) => !/^y/i.test(squash(j.guestConfirmed)));

  /* One day at a time per technician, or a gap spans two people's rounds. */
  const byTechDay = new Map();
  all.forEach((j) => {
    const k = `${jobDate(j)}|${squash(j.team)}`;
    if (!byTechDay.has(k)) byTechDay.set(k, []);
    byTechDay.get(k).push(j);
  });
  const gaps = { withinBuilding: 0, betweenBuildings: 0, total: 0,
                 pairs: 0, pairsPossible: 0, overlaps: 0, overLong: 0 };
  byTechDay.forEach((list) => {
    const g = gapsBetweenJobs(list);
    Object.keys(gaps).forEach((k) => { gaps[k] += g[k]; });
  });

  return {
    period,
    jobs: all.length,
    excluded,

    /* Complete today. Nobody has to close anything out for these. */
    tier1: {
      returns: measure(totalReturns, withAsset.length, withAsset.length),
      unitsWithReturns: measure(units.filter((u) => u.returns > 0).length, units.length, units.length),
      medianWaitDays: measure(median(waits), all.length, all.length),
      pushedThreeOrMore: measure(pushed.length, all.length, all.length),
      accessExposure: measure(unconfirmed.length, occupied.length, occupied.length),
    },

    /* Outcome-dependent. Every one carries its denominator. */
    tier2: {
      guestWait: measure(median(done.map((j) => waitDays(j, today)).sort((a, b) => a - b)),
                         done.length, all.length),
      firstTimeFix: measure(
        reactiveDone.length ? Math.round(((reactiveDone.length - ftfReturned) / reactiveDone.length) * 1000) / 10 : null,
        reactiveDone.length, reactive.length),
      causeOfReturn: measure(
        withReason.length ? Math.round((ourFault.length / withReason.length) * 1000) / 10 : null,
        withReason.length, totalReturns),
      accessFailure: measure(
        done.length ? Math.round((noAccess.length / done.length) * 1000) / 10 : null,
        done.length, all.length),
      chargeableRecovery: measure(guestDamage.length, withReason.length, totalReturns),
      estimateAccuracy: measure(
        estimated.length ? Math.round((accurate.length / estimated.length) * 1000) / 10 : null,
        estimated.length, all.length),
      unaccountedBetweenJobs: measure(gaps.betweenBuildings, gaps.pairs, gaps.pairsPossible),
    },

    gaps,
    byUnit: units,
  };
}
