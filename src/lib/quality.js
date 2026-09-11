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

import { actualDuration, RESOLVED_STATES, readClock, isOffBoard } from "./job.js";
import { isSpread } from "./load.js";
import { isOurFault } from "./faultFamily.js";
import {
  assetKey, canonProperty, canonUnit, squash, workType, daysBetween,
  parseDurationMinutes, splitCrew, canonTech,
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
    /* A row that is off the board was never a visit. Leaving them in
       inflates `visits`, which is the denominator of the headline figure,
       and so quietly flatters the units that are worst affected — the
       exact units this table exists to find. Dubai Marina Mall Hotel 2111
       read four visits on 10 September for one piece of work. */
    if (isOffBoard(j)) return;
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
  let withinPairs = 0, betweenPairs = 0;
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
    /* Same property is only "no travel" in a tower. Two villas on the Palm
       share a property name and are different addresses, so that gap is a
       drive and belongs in the measured travel average — see isSpread in
       load.js. */
    const sameProperty = canonProperty(prev.property) &&
      canonProperty(prev.property) === canonProperty(cur.property);
    const sameAddress = sameProperty &&
      (!isSpread(cur.property) || canonProperty(prev.unit) === canonProperty(cur.unit));
    if (sameAddress) { withinBuilding += gap; withinPairs++; }
    else { betweenBuildings += gap; betweenPairs++; }
  }

  return {
    withinBuilding, betweenBuildings, withinPairs, betweenPairs,
    total: withinBuilding + betweenBuildings,
    pairs, pairsPossible, overlaps, overLong,
  };
}

/* ---------------------------------------------------------------------- *
 * How long it takes to get from one building to the next.
 *
 * There is no route data and there is not going to be. What there is, once
 * technicians write arrival and departure times, is every gap between
 * leaving one building and arriving at the next — which is the same
 * quantity, measured rather than assumed.
 *
 * Until enough of those exist it returns the department's standing
 * assumption of half an hour, and says so. The caller must show which one
 * it got: a committed-hours figure built on a guess and one built on
 * ninety observed moves are not the same claim.
 * ---------------------------------------------------------------------- */
export const ASSUMED_TRAVEL_MIN = 30;

/* Below this the mean is one bad afternoon, not a travel time. */
const MIN_MOVES_FOR_TRAVEL = 8;

export function averageTravelMinutes(jobs) {
  const g = gapsBetweenJobs(jobs);
  if (g.betweenPairs < MIN_MOVES_FOR_TRAVEL) {
    return { minutes: ASSUMED_TRAVEL_MIN, measured: false, moves: g.betweenPairs };
  }
  return {
    minutes: Math.round(g.betweenBuildings / g.betweenPairs),
    measured: true,
    moves: g.betweenPairs,
  };
}

/* ---------------------------------------------------------------------- *
 * The report.
 * ---------------------------------------------------------------------- */
export function qualityReport(jobs, period, opts = {}) {
  /* Off the board is off every denominator here. `all` is the base of the
     coverage figures, so leaving duplicates in would make coverage read
     lower than it is and the department look worse at closing out than it
     actually is. */
  const all = (jobs || []).filter((j) => j && !j._tomb && !isOffBoard(j) && inPeriod(j, period));
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

/* ---------------------------------------------------------------------- *
 * Role, derived from the work rather than configured — sub-project C.
 *
 * Resty has ZERO reactive jobs: 51 of his 56 are pool cleans. Judging him
 * on first-time fix is not unfair, it is judging him on an empty set, and
 * the metric answers null or — worse, if written carelessly — 100%.
 *
 * Measured across the real fortnight:
 *
 *     Anthony      67 jobs    0 ppm   49 reactive     0% planned
 *     Jabbar       59          0      43              0%
 *     Resty        56         51       0             91%
 *     Shafeeq      41         15      13             37%
 *     Bijaya       34         10      11             29%
 *     Adi/Khaled   11 each     0       0              — project crew
 *
 * So it is not a two-way split, and a hard-coded "Resty is the pool man"
 * rule would also be wrong: Acacia A G01's pool is cleaned by Anthony.
 * Role comes from the mix over the period, which keeps it right when
 * somebody's job changes and needs nobody to maintain a list.
 *
 * What each role is judged on:
 *
 *   reactive   did the fault come back — returns, first-time fix
 *   planned    was the round delivered evenly — consistency, coverage
 *   mixed      both, because throwing away a third of what Shafeeq does to
 *              fit him in one box is worse than reporting two figures
 *   project    neither. A job card runs for days and is measured on the
 *              Projects tab against its quoted amount, not here.
 * ---------------------------------------------------------------------- */

/* Enough of a kind of work to be judged on it. Below this the sample is too
   small to mean anything, which is the same argument the tier split makes. */
const ROLE_FLOOR_PCT = 20;

/* And enough work to have a role at all.
 *
 * Live on 11 September this read "Shafeeq — project" off a single job: one
 * project job is 100% project work, so the role was technically correct and
 * practically misleading. In August the same man was 41 jobs and genuinely
 * mixed.
 *
 * Five, because one job in five IS twenty per cent — the floor is the
 * smallest sample the threshold above can divide, rather than a second
 * number chosen by feel. Below it the honest answer is that we cannot say.
 */
const MIN_JOBS_FOR_ROLE = Math.ceil(100 / ROLE_FLOOR_PCT);

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export function rolesByTech(jobs, period) {
  const byTech = new Map();
  (jobs || []).forEach((j) => {
    if (!j || j._tomb) return;
    /* A duplicate is not a job this man did, and counting it shifts both
       his work mix and the five-job floor that decides whether he gets a
       role at all. */
    if (isOffBoard(j)) return;
    if (!inPeriod(j, period)) return;
    const crew = splitCrew(j.team);
    (crew.length ? crew : ["Unassigned"]).forEach((raw) => {
      const tech = canonTech(raw);
      if (!tech) return;
      if (!byTech.has(tech)) byTech.set(tech, []);
      byTech.get(tech).push(j);
    });
  });

  const rows = [];
  byTech.forEach((list, tech) => {
    const kinds = list.map((j) => workType(j.description, j.faultCode));
    const planned = kinds.filter((k) => k === "ppm").length;
    const reactive = kinds.filter((k) => k === "reactive").length;
    const project = kinds.filter((k) => k === "project").length;
    const n = list.length;
    const pct = (x) => Math.round((x / n) * 100);

    const plannedPct = pct(planned);
    const reactivePct = pct(reactive);

    /* Project first: a job card runs for days and is measured against its
       quoted amount on the Projects tab, not by returns or by consistency. */
    let role;
    if (n < MIN_JOBS_FOR_ROLE) role = "unrated";
    else if (project > planned && project > reactive) role = "project";
    else if (plannedPct >= ROLE_FLOOR_PCT && reactivePct >= ROLE_FLOOR_PCT) role = "mixed";
    else if (plannedPct > reactivePct) role = "planned";
    else if (reactivePct >= ROLE_FLOOR_PCT) role = "reactive";
    else role = "other";

    const judgeOn = [];
    if (role === "reactive" || role === "mixed") judgeOn.push("returns", "firstTimeFix");
    if (role === "planned" || role === "mixed") judgeOn.push("consistency", "coverage");

    /* Consistency is the SPREAD of a planned round, not its speed. A round
       of hour-long cleans with one twenty-minute outlier is the signal
       worth having; a uniformly slower round is a different conversation. */
    const durations = list
      .filter((j) => workType(j.description, j.faultCode) === "ppm")
      .map((j) => actualDuration(j).minutes)
      .filter((m) => m != null);
    const mid = median(durations);
    const spreadMins = durations.length
      ? Math.max(...durations.map((d) => Math.abs(d - mid)))
      : null;

    rows.push({
      tech, jobs: n,
      planned, reactive, project,
      plannedPct, reactivePct,
      role, judgeOn,
      consistency: { median: mid, spreadMins, n: durations.length },
      /* Days worked and the busiest, for a planned round where the
         question is whether the cycle was delivered at all. */
      days: [...new Set(list.map(jobDate).filter(Boolean))].length,
      perDay: (() => {
        const byDate = new Map();
        list.forEach((j) => {
          const d = jobDate(j);
          byDate.set(d, (byDate.get(d) || 0) + 1);
        });
        const counts = [...byDate.values()];
        return { median: median(counts), max: counts.length ? Math.max(...counts) : 0 };
      })(),
    });
  });

  return rows.sort((a, b) => b.jobs - a.jobs);
}

/* ---------------------------------------------------------------------- *
 * Productive time.
 *
 * The rule the department set on 11 September: a job counts toward
 * productive time ONLY if the technician wrote his arrival and departure
 * time, and a visit that produced nothing does not count even when he
 * reached the property.
 *
 * That is the only definition of the day that cannot be inflated by a
 * coordinator's recollection — and it is expensive. Measured across all
 * 1,593 rows to 12 September: 2 carried both times; 194 carried a typed
 * total instead. So this runs on two jobs today and stays near zero until
 * the field team logs arrival and departure. It is reported with its
 * coverage attached for exactly that reason. A productive-time figure
 * quoted without its coverage is the failure this whole file exists to
 * prevent.
 * ---------------------------------------------------------------------- */
const clockMinutes = (j) => {
  const d = actualDuration(j);
  return d.source === "clock" && d.minutes > 0 ? d.minutes : null;
};

export function timeByTech(jobs, period) {
  const rows = new Map();
  const touch = (tech) => {
    if (!rows.has(tech)) {
      rows.set(tech, {
        tech, productiveMin: 0, attendedMin: 0,
        productive: 0, attended: 0, unmeasured: 0, jobs: 0,
      });
    }
    return rows.get(tech);
  };

  (jobs || []).forEach((j) => {
    if (!j || j._tomb) return;
    if (!inPeriod(j, period)) return;
    const crew = splitCrew(j.team).map(canonTech).filter(Boolean);
    if (!crew.length) return;

    const mins = clockMinutes(j);
    /* An off-board row is not a visit at all, so it is not even unmeasured
       — it does not belong to anybody's day. A row that WAS attended and
       then cancelled is the one case where minutes exist and produce
       nothing, and that is what `attended` is for. */
    const counted = RESOLVED_STATES.includes(j.state);
    const attendedOnly = !counted && mins != null;

    crew.forEach((tech) => {
      const r = touch(tech);
      if (isOffBoard(j) && mins == null) return;     // never happened, for anyone
      r.jobs++;
      if (mins == null) { r.unmeasured++; return; }
      /* Shared jobs: the minutes are the visit's, not each man's. Split so
         two names on one job do not double the department's day. */
      const share = Math.round(mins / crew.length);
      if (counted) { r.productiveMin += share; r.productive++; }
      else if (attendedOnly) { r.attendedMin += share; r.attended++; }
    });
  });

  return [...rows.values()]
    .map((r) => ({
      ...r,
      measured: r.productive + r.attended,
      /* Null, never zero: a technician with no measured visit has no
         productive hours figure, and 0h would read as idleness. */
      productiveHours: r.productive ? Math.round((r.productiveMin / 60) * 10) / 10 : null,
      attendedHours: r.attended ? Math.round((r.attendedMin / 60) * 10) / 10 : null,
      coverage: measure(null, r.productive + r.attended, r.jobs),
    }))
    .sort((a, b) => b.productiveMin - a.productiveMin || b.jobs - a.jobs);
}
