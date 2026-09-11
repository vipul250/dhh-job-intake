/* ---------------------------------------------------------------------- *
 * metrics.js — the measurement engine.
 *
 * Design rule, and the reason this file replaces the old Trends maths:
 * a metric is only computed from fields the coordinator or the admin
 * actually fills in, and every metric carries its own denominator. If
 * 43% of rows answered "In PMS?", the PMS number is reported over that
 * 43% and labelled as such — it is never quietly divided by the full row
 * count, which is how a dashboard ends up confidently wrong.
 *
 * Metrics are split into two tiers:
 *   Tier A — needs nothing beyond the schedule the coordinator already
 *            types. Available from day one, on 100% of rows.
 *   Tier B — needs the outcome recorded on the job. Reported with
 *            explicit coverage until that habit is established.
 *
 * Pure functions, no React, no I/O — so they can be run against a raw
 * spreadsheet dump to check the numbers before anyone trusts a chart.
 * ---------------------------------------------------------------------- */

import {
  squash, canonKey, parseDurationMinutes, parseYN, parseShiftMinutes,
  splitCrew, canonCrewLabel, canonProperty, displayProperty, canonUnit,
  assetKey, canonPriority, occupancyClass, needsGuestConfirmation,
  materialReadiness, daysBetween, workType, WORK_TYPES,
} from "./normalize.js";
import { faultFamily, FAMILY_LABEL, RETURN_REASON_LABEL, isOurFault } from "./faultFamily.js";
import {
  actualDuration, isResolved, needsFollowUp, SOURCE_LABEL, JOB_SOURCES, REACTIVE_SOURCES,
  MOVE_REASON_LABEL, moveReasonDisplaces, isCompound, splitTaskParts,
} from "./job.js";

export const DEFAULTS = {
  shiftMinutes: 540,        // 09:00-18:00, the dominant shift in the workbook
  travelMinutesPerHop: 30,  // per additional distinct property in a tech's day
  tightLoadPct: 85,         // amber
  overloadPct: 100,         // red
  repeatWindowDays: 14,     // a return inside this window is a repeat visit
  pendingStaleDays: 7,      // a pending item older than this is stale
};

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const coverage = (answered, total) => ({ answered, total, pct: pct(answered, total) });

/* ====================================================================== *
 * TIER A — computed from the schedule alone
 * ====================================================================== */

/* --------------------------- 1. Capacity ------------------------------ *
 * The single most predictive number in this dataset. Committed minutes per
 * technician per day, against the length of the shift they were rostered
 * on. A crew job costs every member of the crew their time, not one share
 * of it, so crew cells are split into individuals first.
 *
 * Travel is charged per additional distinct property in a tech's day —
 * a nine-hour shift with six buildings in it is not a nine-hour shift.
 * -------------------------------------------------------------------- */
export function computeCapacity(jobs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const byTechDay = new Map();
  let unpriced = 0;

  jobs.forEach((j) => {
    const mins = parseDurationMinutes(j.estimatedTime ?? j.estTime);
    if (mins == null) unpriced++;
    const crew = splitCrew(j.team);
    const members = crew.length ? crew : ["Unassigned"];
    members.forEach((tech) => {
      const key = `${j._date}||${tech}`;
      if (!byTechDay.has(key)) {
        byTechDay.set(key, {
          date: j._date, tech, jobs: 0, taskMinutes: 0, unpricedJobs: 0,
          properties: new Set(), shiftMinutes: null, p1: 0,
        });
      }
      const e = byTechDay.get(key);
      e.jobs++;
      if (mins == null) e.unpricedJobs++;
      else e.taskMinutes += mins;
      const p = canonProperty(j.property);
      if (p) e.properties.add(p);
      if (canonPriority(j.priority) === "PRI-1") e.p1++;
      const sm = parseShiftMinutes(j.shift);
      // A tech on two shifts in one day gets the longer window.
      if (sm && (!e.shiftMinutes || sm > e.shiftMinutes)) e.shiftMinutes = sm;
    });
  });

  const rows = Array.from(byTechDay.values()).map((e) => {
    const shiftMinutes = e.shiftMinutes || o.shiftMinutes;
    const hops = Math.max(0, e.properties.size - 1);
    const travelMinutes = hops * o.travelMinutesPerHop;
    const committed = e.taskMinutes + travelMinutes;
    return {
      date: e.date,
      tech: e.tech,
      jobs: e.jobs,
      p1: e.p1,
      unpricedJobs: e.unpricedJobs,
      properties: e.properties.size,
      taskMinutes: e.taskMinutes,
      travelMinutes,
      committedMinutes: committed,
      shiftMinutes,
      loadPct: Math.round((committed / shiftMinutes) * 100),
      // An estimate is missing on some jobs, so the true load is at least this.
      isFloor: e.unpricedJobs > 0,
    };
  }).sort((a, b) => (a.date === b.date ? b.loadPct - a.loadPct : a.date < b.date ? -1 : 1));

  const overloaded = rows.filter((r) => r.loadPct > o.overloadPct);
  const tight = rows.filter((r) => r.loadPct > o.tightLoadPct && r.loadPct <= o.overloadPct);
  const totalCommitted = rows.reduce((s, r) => s + r.committedMinutes, 0);
  const totalAvailable = rows.reduce((s, r) => s + r.shiftMinutes, 0);

  return {
    rows,
    overloaded,
    tight,
    techDayCount: rows.length,
    overloadedPct: pct(overloaded.length, rows.length),
    utilisationPct: pct(totalCommitted, totalAvailable),
    totalCommittedMinutes: totalCommitted,
    totalAvailableMinutes: totalAvailable,
    estimateCoverage: coverage(jobs.length - unpriced, jobs.length),
  };
}

/* ------------------------- 2. Access risk ----------------------------- *
 * A tech sent to an occupied unit that the guest has not confirmed is the
 * cheapest failure in the whole operation to predict and the most expensive
 * to absorb: the visit is lost, the slot is lost, and the job comes back
 * tomorrow. Occupied / Check-in / B2B all mean somebody is inside.
 * -------------------------------------------------------------------- */
export function computeAccessRisk(jobs) {
  const needing = jobs.filter((j) => needsGuestConfirmation(j.status));
  const confirmed = needing.filter((j) => parseYN(j.guestConfirmed) === true);
  const unanswered = needing.filter((j) => parseYN(j.guestConfirmed) === null);
  const refusedOrPending = needing.filter((j) => parseYN(j.guestConfirmed) === false);

  const noSlot = needing.filter((j) => {
    const t = canonKey(j.timeOfVisit);
    return !t || /not confirmed|any ?time|tbc|tbd/.test(t);
  });

  const atRisk = needing.filter(
    (j) => parseYN(j.guestConfirmed) !== true
  );

  return {
    needingConfirmation: needing.length,
    confirmed: confirmed.length,
    unconfirmed: refusedOrPending.length,
    unanswered: unanswered.length,
    confirmedPct: pct(confirmed.length, needing.length),
    noTimeSlot: noSlot.length,
    noTimeSlotPct: pct(noSlot.length, needing.length),
    atRisk,
    atRiskCount: atRisk.length,
    atRiskPct: pct(atRisk.length, needing.length),
    coverage: coverage(needing.length - unanswered.length, needing.length),
  };
}

/* ---------------------- 3. Material readiness ------------------------- *
 * Splits "material needed" into whether the van can actually be loaded.
 * "Basic materials" is counted as vague, not ready — see normalize.js.
 * -------------------------------------------------------------------- */
export function computeMaterialReadiness(jobs) {
  const buckets = { specified: 0, vague: 0, missing: 0, unanswered: 0, "not-needed": 0 };
  const notReady = [];
  jobs.forEach((j) => {
    const r = materialReadiness(j.materialNeeded, j.materialDetails);
    buckets[r]++;
    if (r === "vague" || r === "missing") notReady.push({ ...j, _readiness: r });
  });
  const needing = buckets.specified + buckets.vague + buckets.missing;
  return {
    buckets,
    needingMaterial: needing,
    readyPct: pct(buckets.specified, needing),
    notReady,
    notReadyCount: notReady.length,
    coverage: coverage(jobs.length - buckets.unanswered, jobs.length),
  };
}

/* ------------------------ 4. Repeat visits ---------------------------- *
 * The closest thing to a quality metric available without any new data
 * entry: how often the same unit is visited again inside two weeks.
 *
 * The distinction that makes this number trustworthy: a revisit the very
 * next day is a job *continuing* — a two-day paint job, a part that
 * arrived on Tuesday. A revisit after a gap, for a scope that looks like
 * the earlier one, is a fix that did not hold. In the real workbook the
 * median repeat gap is 1 day, so lumping those together would report a
 * 43% "rework rate" that is mostly just multi-day work — precisely the
 * kind of confident wrong number this rebuild exists to remove. Rework is
 * therefore counted only on returns with a gap of 2 days or more.
 * -------------------------------------------------------------------- */
function descTokens(s) {
  return new Set(
    canonKey(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3)
  );
}
function similar(a, b) {
  const A = descTokens(a), B = descTokens(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / Math.min(A.size, B.size) >= 0.5;
}

export function computeRepeatVisits(jobs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const byAsset = new Map();
  jobs.forEach((j) => {
    const k = assetKey(j.property, j.unit);
    if (!k) return;
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k).push(j);
  });

  const repeats = [];       // each repeat *event* (the second and later visit)
  const assets = [];

  byAsset.forEach((list, k) => {
    const sorted = list.slice().sort((a, b) => (a._date < b._date ? -1 : 1));
    let assetReturns = 0, assetRework = 0, assetContinuations = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const gap = daysBetween(prev._date, cur._date);
      if (gap == null || gap > o.repeatWindowDays) continue;
      const sameScope =
        (prev.faultCode && cur.faultCode && prev.faultCode === cur.faultCode &&
          !/NEEDS-REVIEW|SCOPE-UNKNOWN/.test(cur.faultCode)) ||
        similar(prev.description, cur.description);
      // gap <= 1 day is the same piece of work carrying on, not a return.
      const kind = gap <= 1 ? "continuation" : "return";
      // Recurring work (pool cleaning, PPM) is *supposed* to come back on a
      // cycle — it is a return, but it is never rework.
      const recurring = workType(cur.description, cur.faultCode) === "ppm";
      if (kind === "continuation") assetContinuations++;
      else {
        assetReturns++;
        if (sameScope && !recurring) assetRework++;
      }
      repeats.push({ asset: k, gapDays: gap, sameScope, kind, recurring, first: prev, second: cur });
    }
    assets.push({
      asset: k,
      property: displayProperty(sorted[0].property),
      unit: canonUnit(sorted[0].unit),
      visits: sorted.length,
      continuations: assetContinuations,
      returns: assetReturns,
      rework: assetRework,
      dates: Array.from(new Set(sorted.map((j) => j._date))),
      minutes: sorted.reduce((s, j) => s + (parseDurationMinutes(j.estimatedTime) || 0), 0),
    });
  });

  const returns = repeats.filter((r) => r.kind === "return");
  const continuations = repeats.filter((r) => r.kind === "continuation");
  const rework = returns.filter((r) => r.sameScope && !r.recurring);
  const recurringReturns = returns.filter((r) => r.recurring);
  const topAssets = assets
    .filter((a) => a.visits > 1)
    .sort((a, b) => b.rework - a.rework || b.returns - a.returns || b.visits - a.visits)
    .slice(0, 15);

  return {
    totalVisits: jobs.length,
    distinctAssets: byAsset.size,
    repeatEvents: repeats.length,
    continuationEvents: continuations.length,
    returnEvents: returns.length,
    reworkEvents: rework.length,
    repeatRatePct: pct(repeats.length, jobs.length),
    returnRatePct: pct(returns.length, jobs.length),
    recurringReturns: recurringReturns.length,
    reworkEventsList: rework,
    // Denominator is reactive work only — rework is meaningless over PPM.
    reactiveVisits: jobs.filter((j) => workType(j.description, j.faultCode) === "reactive").length,
    reworkRatePct: pct(rework.length, jobs.filter((j) => workType(j.description, j.faultCode) === "reactive").length),
    medianReturnGapDays: median(returns.map((r) => r.gapDays)),
    topAssets,
    repeats,
    returns,
  };
}

function median(arr) {
  const a = arr.filter((n) => n != null).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10;
}

/* ------------------------ 5. Pending backlog -------------------------- *
 * "Pending? = Y" carried day after day is the department's real debt. Aged
 * from the first date the same asset was flagged pending in the range.
 * -------------------------------------------------------------------- */
export function computePendingBacklog(jobs, asOfDate, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const pendingJobs = jobs.filter((j) => parseYN(j.pending) === true);
  const firstSeen = new Map();
  jobs.slice().sort((a, b) => (a._date < b._date ? -1 : 1)).forEach((j) => {
    if (parseYN(j.pending) !== true) return;
    const k = assetKey(j.property, j.unit);
    if (k && !firstSeen.has(k)) firstSeen.set(k, j._date);
  });

  const items = pendingJobs.map((j) => {
    const k = assetKey(j.property, j.unit);
    const since = firstSeen.get(k) || j._date;
    const age = daysBetween(since, asOfDate || j._date);
    return {
      ...j,
      _pendingSince: since,
      _ageDays: age == null ? 0 : Math.max(0, age),
    };
  }).sort((a, b) => b._ageDays - a._ageDays);

  const answered = jobs.filter((j) => parseYN(j.pending) !== null).length;
  const stale = items.filter((i) => i._ageDays >= o.pendingStaleDays);

  return {
    count: pendingJobs.length,
    ratePct: pct(pendingJobs.length, answered),
    items,
    stale,
    staleCount: stale.length,
    oldestDays: items.length ? items[0]._ageDays : 0,
    coverage: coverage(answered, jobs.length),
  };
}

/* ------------------- 6. Movement — where jobs went -------------------- *
 * The metric the department has never had.
 *
 * Today a job that does not happen is simply absent from tomorrow's sheet,
 * and nobody can say whether it was moved, done, or lost. Now every job
 * carries its own event log, so this reads straight off the data: how many
 * jobs were pushed to another day, how many times, why, and — the number
 * that matters — how many are still being pushed around after a week.
 *
 * `lost` is the one to watch. A job that stopped appearing anywhere without
 * ever being closed out is exactly the failure that prompted this rebuild,
 * and it is now countable rather than invisible.
 * -------------------------------------------------------------------- */
export function computeMovement(jobs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const pushed = jobs.filter((j) => (j.pushCount || 0) > 0);
  const chronic = jobs.filter((j) => (j.pushCount || 0) >= 3);

  const reasons = {};
  let moveEvents = 0;
  jobs.forEach((j) => {
    (j.events || []).forEach((e) => {
      if (e.kind !== "moved_in" && e.kind !== "moved_out") return;
      moveEvents++;
      const r = squash(e.reason) || "(no reason given)";
      reasons[r] = (reasons[r] || 0) + 1;
    });
  });

  // Age from the day a job first appeared to the day it is now sitting on.
  const ages = pushed
    .map((j) => daysBetween(j.originDate, j.scheduledDate))
    .filter((n) => n != null && n >= 0);

  const cancelled = jobs.filter((j) => j.state === "cancelled");
  const stillOpen = jobs.filter((j) => j.state === "scheduled" || j.state === "in_progress");

  /* A job marked not done is now always asked when it happens instead. The
     three answers are different outcomes and are counted separately: booked
     for a day, deliberately not rebooked, or — for rows closed out before
     the question existed — never answered at all. */
  const notDone = jobs.filter((j) => j.state === "not_done");
  const rebookAnswer = (j) => {
    const e = [...(j.events || [])].reverse().find((x) => x.rebook !== undefined);
    return e ? e.rebook : null;
  };
  const rebooked = notDone.filter((j) => { const a = rebookAnswer(j); return a && a !== "none"; });
  const droppedOnPurpose = notDone.filter((j) => rebookAnswer(j) === "none");
  const unanswered = notDone.filter((j) => rebookAnswer(j) == null);

  /* Jobs with no recorded outcome on a day that has already passed: nobody
     said done, not done, moved or cancelled. These are the disappearances.

     Days before the go-live date are excluded. Nothing in the imported
     history was ever closed out because closing out did not exist yet;
     counting it as work that vanished would put 443 permanent failures on
     a dashboard that is supposed to be about what happens from now on. */
  const today = opts.asOfDate || "";
  const since = opts.goLive || "";
  const lost = stillOpen.filter((j) => today && j.scheduledDate < today
    && (!since || j.scheduledDate >= since));

  return {
    total: jobs.length,
    pushedJobs: pushed.length,
    pushedPct: pct(pushed.length, jobs.length),
    moveEvents,
    chronic: chronic.length,
    chronicJobs: chronic.sort((a, b) => (b.pushCount || 0) - (a.pushCount || 0)).slice(0, 15),
    medianAgeDays: median(ages),
    maxAgeDays: ages.length ? Math.max(...ages) : 0,
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    cancelled: cancelled.length,
    goLive: since || null,
    notDone: notDone.length,
    rebooked: rebooked.length,
    rebookedPct: pct(rebooked.length, notDone.length),
    droppedOnPurpose: droppedOnPurpose.length,
    droppedJobs: droppedOnPurpose.slice(0, 15),
    rebookUnanswered: unanswered.length,
    lost: lost.length,
    lostJobs: lost.slice(0, 25),
    // How much of the log is actually being written — a job created before
    // the live board existed has no events to read.
    coverage: coverage(jobs.filter((j) => (j.events || []).length > 0).length, jobs.length),
  };
}

/* ====================================================================== *
 * TIER B — needs the outcome recorded on the job
 * ====================================================================== */

/* ------------------- 7. Completion & PMS verification ----------------- *
 * The gap this whole rebuild exists to close. The workbook records what was
 * *planned* and nothing about what happened; "In PMS?" is answered on 43%
 * of rows and reads "Y" on 203 of those 204 — an intention, not a check.
 *
 * Here the admin's answer is the source of truth: done / partial / not done,
 * plus whether it was actually found in PMS. Until the pass is being done
 * daily, every number below is reported over `coverage`, never over the
 * full row count.
 * -------------------------------------------------------------------- */
/* A job's outcome now lives on the job itself, as a state advanced on the
   board by whoever is looking at it. The old shape — a separate `verify`
   blob written in a separate tab the following day — is still read here so
   rows recorded under it are not lost, but nothing writes it any more. */
function outcomeOf(job) {
  if (job.state) {
    // A visit that ended counts as settled however it ended. "Made safe"
    // and "diagnosed" are NOT completions — see computeContainment.
    if (job.state === "fixed" || job.state === "done") return "done";
    if (job.state === "made_safe" || job.state === "diagnosed") return "partial";
    if (job.state === "not_done") return "not-done";
    return null;                       // scheduled / in progress / cancelled
  }
  const v = job.verify;
  if (!v) return null;
  if (v.outcome === "partial") return "not-done";
  return ["done", "not-done"].includes(v.outcome) ? v.outcome : null;
}
const reasonOf = (j) => squash(j.outcomeReason) || squash(j.verify && j.verify.reason);
const pmsOf = (j) => (j.inPms !== undefined && j.inPms !== null ? j.inPms : (j.verify ? j.verify.inPms : null));

export function computeVerification(jobs) {
  const settled = jobs.filter((j) => outcomeOf(j) !== null);
  const done = settled.filter((j) => outcomeOf(j) === "done");
  const partial = settled.filter((j) => outcomeOf(j) === "partial");
  const notDone = settled.filter((j) => outcomeOf(j) === "not-done");

  const reasons = {};
  notDone.concat(partial).forEach((j) => {
    const r = reasonOf(j) || "(no reason given)";
    reasons[r] = (reasons[r] || 0) + 1;
  });

  // Of the work confirmed to have happened, how much is traceable in PMS?
  // A job done but not in PMS is invisible to everyone downstream.
  const inPms = done.filter((j) => pmsOf(j) === true);
  const missingInPms = done.filter((j) => pmsOf(j) === false);

  // The reverse mismatch: PMS has a ticket, the field says it never happened.
  const ghostTickets = notDone.filter((j) => pmsOf(j) === true);

  return {
    total: jobs.length,
    verifiedCount: settled.length,
    coverage: coverage(settled.length, jobs.length),
    done: done.length,
    partial: partial.length,
    notDone: notDone.length,
    // Completion means FIXED. A contained fault is not a completed one, and
    // counting it as such is what made the old number flattering.
    completionRatePct: pct(done.length, settled.length),
    effectiveRatePct: pct(done.length + partial.length * 0.5, settled.length),
    notDoneReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    pmsCoveragePct: pct(inPms.length, done.length),
    missingInPms: missingInPms.length,
    ghostTickets: ghostTickets.length,
    notDoneJobs: notDone,
  };
}

/* ---------------------- 8. Estimate accuracy -------------------------- *
 * Only over jobs where the admin logged actual time. Reported as median
 * ratio (not mean — a single 8-hour outlier should not move it) plus the
 * share of jobs that ran over by more than a quarter.
 * -------------------------------------------------------------------- */
export function computeEstimateAccuracy(jobs) {
  const samples = [];
  jobs.forEach((j) => {
    const est = parseDurationMinutes(j.estimatedTime);
    const act = j.actualMinutes != null ? Number(j.actualMinutes)
      : (j.verify && j.verify.actualMinutes != null ? Number(j.verify.actualMinutes) : null);
    if (!est || !act) return;
    samples.push({ job: j, est, act, ratio: act / est });
  });
  const over = samples.filter((s) => s.ratio > 1.25);
  const under = samples.filter((s) => s.ratio < 0.75);
  return {
    sampleSize: samples.length,
    coverage: coverage(samples.length, jobs.length),
    medianRatio: median(samples.map((s) => Math.round(s.ratio * 100))) ,
    overrunPct: pct(over.length, samples.length),
    underrunPct: pct(under.length, samples.length),
    worst: samples.sort((a, b) => b.ratio - a.ratio).slice(0, 10),
  };
}

/* --------- 8b. What these jobs ACTUALLY take -------------------------- *
 * The estimate on a job is a guess, and everybody involved knows it. The
 * coordinator filling it in has never done the work and is picking between
 * 30 minutes and an hour under time pressure; the catalogue's own defaults
 * were seeded from the median of those same guesses, so the whole thing was
 * estimates all the way down.
 *
 * The only honest source is the technician's own arrival and departure
 * time, which he already writes into PMS on every job. Grouped by the kind
 * of work, that turns into a duration library — and after a month of it the
 * estimate stops being a guess and starts being what the work took last
 * time.
 *
 * Nothing is learned from a single observation. A task needs MIN_CONFIDENT
 * measured jobs before the library will offer a number, because one
 * 20-minute pool clean where the tech was already on site would otherwise
 * rewrite the estimate for every pool in the portfolio.
 * -------------------------------------------------------------------- */
export const MIN_CONFIDENT = 5;

export function computeDurationLibrary(jobs, opts = {}) {
  const min = opts.minConfident || MIN_CONFIDENT;
  const groups = new Map();

  jobs.forEach((j) => {
    /* Grouped by the standard task where the line snapped to one, and by
       trade family otherwise — the finest grouping the data can actually
       support without splitting into samples of one. */
    const key = squash(j.catalogueId) || `fam:${faultFamily(j.description, j.faultCode)}`;
    const label = squash(j.catalogueId)
      ? squash(j.description)   // a snapped line carries the canonical wording
      : (FAMILY_LABEL[faultFamily(j.description, j.faultCode)] || "Not classified");
    if (!groups.has(key)) {
      groups.set(key, { key, label, measured: [], estimates: [], jobs: 0, crewed: 0 });
    }
    const g = groups.get(key);
    g.jobs++;
    const est = parseDurationMinutes(j.estimatedTime);
    if (est != null) g.estimates.push(est);
    const act = actualDuration(j);
    if (act.minutes != null) {
      g.measured.push(act.minutes);
      if (splitCrew(j.team).length > 1) g.crewed++;
    }
  });

  const rows = Array.from(groups.values()).map((g) => {
    const measuredMedian = g.measured.length ? median(g.measured) : null;
    const estimateMedian = g.estimates.length ? median(g.estimates) : null;
    const confident = g.measured.length >= min;
    const ratio = measuredMedian != null && estimateMedian
      ? Math.round((measuredMedian / estimateMedian) * 100) : null;
    return {
      ...g,
      n: g.measured.length,
      measuredMedian,
      measuredMin: g.measured.length ? Math.min(...g.measured) : null,
      measuredMax: g.measured.length ? Math.max(...g.measured) : null,
      estimateMedian,
      ratio,
      confident,
      /* How much the department is out on this kind of work over a month:
         the per-job error multiplied by how often it comes up. Sorting by
         this puts the estimate worth fixing first, rather than the most
         wrong estimate on a task that happens twice. */
      impact: confident && ratio != null
        ? Math.abs(measuredMedian - estimateMedian) * g.jobs : 0,
    };
  });

  const measuredJobs = rows.reduce((s, r) => s + r.n, 0);
  return {
    rows: rows.sort((a, b) => b.impact - a.impact || b.n - a.n),
    confident: rows.filter((r) => r.confident),
    measuredJobs,
    coverage: coverage(measuredJobs, jobs.length),
    minConfident: min,
    /* Ready to replace the guess. Until a kind of work reaches this, the
       app keeps quoting the seeded default and says so. */
    readyToLearn: rows.filter((r) => r.confident && r.ratio != null && (r.ratio > 125 || r.ratio < 75)).length,
  };
}

/** What the library says this kind of work takes, or null if it cannot say yet. */
export function learnedMinutes(library, key) {
  if (!library || !key) return null;
  const row = library.rows.find((r) => r.key === key);
  return row && row.confident ? row.measuredMedian : null;
}

/* --------- 8c. Tasks done, and how much of it we can time ------------- *
 * The two numbers the department is actually trying to produce. Both are
 * reported over their own denominator: a completion count is meaningless
 * without saying how many jobs had any outcome recorded at all, and an
 * average duration is worse than meaningless if it is averaging the third
 * of jobs somebody happened to time.
 * -------------------------------------------------------------------- */
export function computeThroughput(jobs) {
  const closed = jobs.filter((j) => isResolved(j.state) || j.state === "not_done" || j.state === "cancelled");
  const done = jobs.filter((j) => isResolved(j.state));
  const timed = done.filter((j) => actualDuration(j).minutes != null);
  const minutes = timed.map((j) => actualDuration(j).minutes);
  const crewMinutes = timed.reduce((s, j) => {
    const crew = Math.max(1, splitCrew(j.team).length);
    return s + actualDuration(j).minutes * crew;
  }, 0);

  const byDate = {};
  done.forEach((j) => { const d = j._date || j.scheduledDate; if (d) byDate[d] = (byDate[d] || 0) + 1; });
  const perDay = Object.values(byDate);

  /* Where each measurement came from. These are not equally good: a clock
     pair is what was observed, a typed total is a recollection at the end
     of the day, and the Start/Done trail is whenever somebody pressed the
     button. Reporting them apart is the only way to know whether the month
     is built on real times or on button-pressing. */
  const bySource = { clock: 0, entered: 0, measured: 0 };
  timed.forEach((j) => { const src = actualDuration(j).source; if (src in bySource) bySource[src]++; });

  return {
    total: jobs.length,
    closedOut: closed.length,
    closedPct: pct(closed.length, jobs.length),
    done: done.length,
    donePct: pct(done.length, jobs.length),
    timed: timed.length,
    timedPct: pct(timed.length, done.length),
    medianMinutes: minutes.length ? median(minutes) : null,
    totalMinutes: minutes.reduce((s, n) => s + n, 0),
    totalCrewMinutes: crewMinutes,
    daysCounted: Object.keys(byDate).length,
    medianPerDay: perDay.length ? median(perDay) : null,
    coverage: coverage(timed.length, done.length),
    bySource,
    realTimes: bySource.clock,
    realTimesPct: pct(bySource.clock, done.length),
  };
}

/* ------------------- 9. First-time fix (Tier A + B) ------------------- *
 * Of the jobs the admin confirmed done, how many had no return visit to the
 * same unit for a similar scope inside the repeat window? This is the one
 * number that says whether the work is actually holding.
 * -------------------------------------------------------------------- */
export function computeFirstTimeFix(jobs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  // Only reactive work can meaningfully be "fixed first time".
  const done = jobs.filter((j) =>
    outcomeOf(j) === "done" && workType(j.description, j.faultCode) === "reactive"
  );
  let returned = 0;
  done.forEach((j) => {
    const k = assetKey(j.property, j.unit);
    const back = jobs.some((other) => {
      if (other === j) return false;
      if (assetKey(other.property, other.unit) !== k) return false;
      const gap = daysBetween(j._date, other._date);
      // Same-day and next-day visits are the job continuing, not a failed fix.
      if (gap == null || gap < 2 || gap > o.repeatWindowDays) return false;
      return similar(j.description, other.description) ||
        (j.faultCode && j.faultCode === other.faultCode);
    });
    if (back) returned++;
  });
  return {
    sampleSize: done.length,
    coverage: coverage(done.length, jobs.length),
    returned,
    firstTimeFixPct: pct(done.length - returned, done.length),
  };
}

/* ------------------- 10. Why we keep going back ---------------------- *
 * The rework count says how often a unit is revisited. It does not say
 * why, and the why is what decides whether anything can be done about it.
 * A fix that did not hold is our cost to eliminate; a guest breaking the
 * same thing twice is not. Averaging those together produces a number
 * nobody can act on.
 *
 * Two cuts, from two different sources:
 *   - the FAMILY of work (AC, plumbing, electrical), inferred from the
 *     task text, so a building's pattern is legible
 *   - the RETURN REASON, which the coordinator supplies when the board
 *     spots a repeat, because it cannot be inferred
 * -------------------------------------------------------------------- */
export function computeReturnReasons(jobs, repeats) {
  const returns = (repeats && repeats.returns) || [];

  const byReason = {};
  const byFamily = {};
  let answered = 0, ourFault = 0;

  returns.forEach((r) => {
    const job = r.second;
    const fam = faultFamily(job.description, job.faultCode);
    if (!byFamily[fam]) byFamily[fam] = { family: fam, label: FAMILY_LABEL[fam], returns: 0, ourFault: 0 };
    byFamily[fam].returns++;

    const reason = squash(job.returnReason);
    if (!reason) return;
    answered++;
    if (!byReason[reason]) byReason[reason] = { id: reason, label: RETURN_REASON_LABEL[reason] || reason, count: 0, ours: isOurFault(reason) };
    byReason[reason].count++;
    if (isOurFault(reason)) { ourFault++; byFamily[fam].ourFault++; }
  });

  // Which buildings keep pulling the team back, and for what.
  const byProperty = {};
  returns.forEach((r) => {
    const key = canonProperty(r.second.property);
    if (!key) return;
    if (!byProperty[key]) {
      byProperty[key] = { key, label: displayProperty(r.second.property), returns: 0, families: {}, ourFault: 0 };
    }
    const e = byProperty[key];
    e.returns++;
    const fam = faultFamily(r.second.description, r.second.faultCode);
    e.families[fam] = (e.families[fam] || 0) + 1;
    if (isOurFault(squash(r.second.returnReason))) e.ourFault++;
  });

  return {
    totalReturns: returns.length,
    answered,
    coverage: coverage(answered, returns.length),
    ourFault,
    ourFaultPct: pct(ourFault, answered),
    byReason: Object.values(byReason).sort((a, b) => b.count - a.count),
    byFamily: Object.values(byFamily).sort((a, b) => b.returns - a.returns),
    byProperty: Object.values(byProperty)
      .map((e) => ({
        ...e,
        topFamily: Object.entries(e.families).sort((a, b) => b[1] - a[1])[0],
      }))
      .sort((a, b) => b.returns - a.returns)
      .slice(0, 12),
  };
}

/* ------------------- 11. How long jobs actually take ------------------ *
 * Per technician and per kind of work, from the time the board measured
 * between Start and Done. Median rather than mean: one job left open over
 * lunch should not move a technician's figure.
 *
 * Everything is reported against the number of jobs it was measured from,
 * because "Vitalis averages 40 minutes on AC" over three jobs and over
 * ninety are different claims.
 * -------------------------------------------------------------------- */
export function computeTechTimes(jobs, opts = {}) {
  const minSample = opts.minSample || 3;
  const rows = [];

  jobs.forEach((j) => {
    const act = actualDuration(j);
    if (act.minutes == null) return;
    const est = parseDurationMinutes(j.estimatedTime);
    const fam = faultFamily(j.description, j.faultCode);
    splitCrew(j.team).forEach((tech) => {
      rows.push({ tech, family: fam, actual: act.minutes, est, source: act.source, job: j });
    });
  });

  const group = (keyFn) => {
    const m = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return m;
  };

  const summarise = (list) => {
    const acts = list.map((r) => r.actual);
    const withEst = list.filter((r) => r.est != null);
    const ratios = withEst.map((r) => r.actual / r.est);
    return {
      jobs: list.length,
      medianMinutes: median(acts),
      minMinutes: Math.min(...acts),
      maxMinutes: Math.max(...acts),
      medianEstimate: withEst.length ? median(withEst.map((r) => r.est)) : null,
      // Above 100 means the work takes longer than the schedule allows for.
      estimateRatioPct: ratios.length ? median(ratios.map((r) => Math.round(r * 100))) : null,
      estimateSample: withEst.length,
    };
  };

  const byTech = Array.from(group((r) => r.tech))
    .map(([tech, list]) => ({ tech, ...summarise(list) }))
    .sort((a, b) => b.jobs - a.jobs);

  const byFamily = Array.from(group((r) => r.family))
    .map(([family, list]) => ({ family, label: FAMILY_LABEL[family], ...summarise(list) }))
    .sort((a, b) => b.jobs - a.jobs);

  const byTechFamily = Array.from(group((r) => `${r.tech}||${r.family}`))
    .map(([k, list]) => {
      const [tech, family] = k.split("||");
      return { tech, family, label: FAMILY_LABEL[family], ...summarise(list) };
    })
    .filter((r) => r.jobs >= minSample)
    .sort((a, b) => b.jobs - a.jobs);

  return {
    measuredJobs: new Set(rows.map((r) => r.job.id)).size,
    coverage: coverage(new Set(rows.map((r) => r.job.id)).size, jobs.length),
    byTech, byFamily, byTechFamily,
    minSample,
  };
}

/* ------------- 12. Containment — stopped, not finished ---------------- *
 * The failure this exists to surface: a technician closes a valve on a P1
 * leak, writes what he needs to finish it, and the task is marked Done in
 * PMS. The leak has stopped. The unit still has a broken water heater and
 * a stained ceiling, and whether anybody comes back depends on somebody
 * reading a comment thread.
 *
 * `openContainments` is the number to watch. Every one of them is a unit
 * running on a temporary measure with nothing booked to finish it.
 * -------------------------------------------------------------------- */
export function computeContainment(jobs, opts = {}) {
  const asOf = opts.asOfDate || "";
  const resolved = jobs.filter((j) => isResolved(j.state));
  const contained = jobs.filter((j) => needsFollowUp(j.state));
  const fixed = jobs.filter((j) => j.state === "fixed" || j.state === "done");

  const withFollowUp = contained.filter((j) => j.followUpJobId);
  const open = contained.filter((j) => !j.followUpJobId);

  // How long the return actually took to happen, where we can see both ends.
  const gaps = [];
  const byId = new Map(jobs.map((j) => [j.id, j]));
  contained.forEach((j) => {
    if (!j.followUpJobId) return;
    const child = byId.get(j.followUpJobId);
    if (!child) return;
    const g = daysBetween(j.scheduledDate, child.scheduledDate);
    if (g != null && g >= 0) gaps.push(g);
  });

  const p1Open = open.filter((j) => canonPriority(j.priority) === "PRI-1");
  const aged = open.map((j) => ({
    ...j,
    _ageDays: asOf ? Math.max(0, daysBetween(j.scheduledDate, asOf) ?? 0) : 0,
  })).sort((a, b) => b._ageDays - a._ageDays);

  return {
    resolvedCount: resolved.length,
    fixed: fixed.length,
    contained: contained.length,
    // Of the visits that ended, how many actually finished the work.
    firstVisitFixPct: pct(fixed.length, resolved.length),
    containedPct: pct(contained.length, resolved.length),
    withFollowUp: withFollowUp.length,
    followUpBookedPct: pct(withFollowUp.length, contained.length),
    openContainments: open.length,
    openP1: p1Open.length,
    medianReturnGapDays: median(gaps),
    oldestOpenDays: aged.length ? aged[0]._ageDays : 0,
    openList: aged.slice(0, 20),
  };
}

/* ------------------- 13. Where the work comes from -------------------- *
 * Nobody can judge what the field team is being asked to do while every
 * job looks the same on arrival. Splitting demand by its route answers
 * questions the department has never been able to ask: how much of the day
 * is guest complaints versus things our own people spotted, how much
 * arrives after the schedule is posted, and how much of a technician's
 * booked time is an inspection filling an idle slot.
 * -------------------------------------------------------------------- */
export function computeDemand(jobs) {
  const bySource = {};
  JOB_SOURCES.forEach((s) => { bySource[s.id] = { id: s.id, label: s.label, jobs: 0, minutes: 0 }; });
  let unattributed = 0, unplanned = 0, unplannedMinutes = 0, fillerMinutes = 0;

  jobs.forEach((j) => {
    const mins = parseDurationMinutes(j.estimatedTime) || 0;
    const src = squash(j.source);
    if (!src || !bySource[src]) { unattributed++; }
    else { bySource[src].jobs++; bySource[src].minutes += mins; }
    if (j.unplanned) { unplanned++; unplannedMinutes += mins; }
    if (src === "filler") fillerMinutes += mins;
  });

  const attributed = jobs.length - unattributed;
  const reactive = REACTIVE_SOURCES.reduce((n, id) => n + (bySource[id] ? bySource[id].jobs : 0), 0);

  return {
    total: jobs.length,
    bySource: Object.values(bySource).filter((s) => s.jobs > 0).sort((a, b) => b.jobs - a.jobs),
    unattributed,
    coverage: coverage(attributed, jobs.length),
    reactive,
    reactivePct: pct(reactive, attributed),
    unplanned,
    unplannedPct: pct(unplanned, jobs.length),
    unplannedHours: Math.round((unplannedMinutes / 60) * 10) / 10,
    // Inspections used to fill idle time are real hours that look like
    // demand on every capacity chart until they are named.
    fillerHours: Math.round((fillerMinutes / 60) * 10) / 10,
    fillerJobs: bySource.filler ? bySource.filler.jobs : 0,
  };
}

/* ------------ 14. Displacement — the coordinator's calls -------------- *
 * When one job is moved so another can have its slot, somebody made a
 * judgement: this work matters more than that work, today. Those calls are
 * the substance of what a coordinator does, and until both halves were
 * recorded the app could only see that a job moved — never what beat it,
 * so never whether the call was sound.
 *
 * Three things are worth knowing, and all of them need time to mean
 * anything:
 *
 *   - how often each coordinator displaces work, and for what
 *   - whether they displace higher-priority work for lower-priority work
 *   - what happens to the job that lost: does it get done, or pushed again
 *
 * The third is the real test. Bumping a P3 for an emergency is correct;
 * bumping the same P3 four times running is a decision nobody is making.
 * -------------------------------------------------------------------- */
export function computeDisplacement(jobs, opts = {}) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const events = [];

  jobs.forEach((j) => {
    if (!j.displacedBy) return;
    const winner = j.displacedBy.jobId ? byId.get(j.displacedBy.jobId) : null;
    const loserPri = canonPriority(j.priority);
    const winnerPri = winner ? canonPriority(winner.priority) : "";
    // PRI-1 sorts before PRI-4 as a string, so a smaller string is more urgent.
    const questionable = !!(loserPri && winnerPri && loserPri < winnerPri);
    events.push({
      loser: j,
      winner,
      winnerLabel: squash(j.displacedBy.label),
      by: squash(j.displacedBy.by) || "unknown",
      at: j.displacedBy.at,
      date: j.displacedBy.date,
      loserPri, winnerPri, questionable,
      // Did the displaced job actually get done afterwards?
      settled: isResolved(j.state),
      pushCount: j.pushCount || 0,
    });
  });

  const byCoordinator = {};
  events.forEach((e) => {
    if (!byCoordinator[e.by]) {
      byCoordinator[e.by] = { by: e.by, calls: 0, questionable: 0, loserDone: 0, loserPushedAgain: 0 };
    }
    const c = byCoordinator[e.by];
    c.calls++;
    if (e.questionable) c.questionable++;
    if (e.settled) c.loserDone++;
    if (e.pushCount > 1) c.loserPushedAgain++;
  });

  const reasons = {};
  jobs.forEach((j) => {
    (j.events || []).forEach((ev) => {
      if (ev.kind !== "moved_in" || !moveReasonDisplaces(ev.reason)) return;
      const label = MOVE_REASON_LABEL[ev.reason] || ev.reason;
      reasons[label] = (reasons[label] || 0) + 1;
    });
  });

  // A job bumped more than once is the one to look at: each individual
  // call may have been fine and the cumulative effect still wrong.
  const repeatedlyBumped = jobs
    .filter((j) => j.displacedBy && (j.pushCount || 0) >= 2)
    .sort((a, b) => (b.pushCount || 0) - (a.pushCount || 0))
    .slice(0, 12);

  return {
    total: events.length,
    linkedToAJob: events.filter((e) => e.winner).length,
    questionable: events.filter((e) => e.questionable).length,
    questionablePct: pct(events.filter((e) => e.questionable).length, events.length),
    loserSettled: events.filter((e) => e.settled).length,
    loserSettledPct: pct(events.filter((e) => e.settled).length, events.length),
    byCoordinator: Object.values(byCoordinator).sort((a, b) => b.calls - a.calls),
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    repeatedlyBumped,
    events: events.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 25),
    coverage: coverage(events.length, jobs.filter((j) => (j.pushCount || 0) > 0).length),
  };
}

/* --------------- 15. Churn against the posted schedule ---------------- *
 * A change before the schedule is published is drafting. A change after it
 * is churn: the field team has already planned around the version they
 * were given, and guests have been told times.
 * -------------------------------------------------------------------- */
/* Different kinds of change carry their reason in different places: an
   edit is asked for one outright, a move already has a move-reason id, and
   an addition or a cancellation is self-describing. Reading them into one
   vocabulary is what makes the breakdown countable. */
function churnReason(e) {
  if (e.kind === "added_late") return "Job added after posting";
  if (e.kind === "cancelled") return `Cancelled${e.reason ? ` — ${squash(e.reason)}` : ""}`;
  if (e.kind === "moved_in" || e.kind === "moved_out") {
    const label = MOVE_REASON_LABEL[e.reason] || squash(e.reason) || "no reason given";
    return `Moved to another day — ${label}`;
  }
  return squash(e.reason) || "(no reason given)";
}

export function computeChurn(jobs) {
  let changesAfterPost = 0, jobsChanged = 0;
  const reasons = {};
  const byPerson = {};

  jobs.forEach((j) => {
    // "started" is a day that locked when the date turned rather than
    // because somebody pressed Post. A change to it is the same event to
    // the field team, so it counts the same.
    const after = (j.events || []).filter(
      (e) => e.lock === "posted" || e.lock === "past" || e.lock === "started");
    if (!after.length) return;
    jobsChanged++;
    after.forEach((e) => {
      changesAfterPost++;
      const r = churnReason(e);
      reasons[r] = (reasons[r] || 0) + 1;
      const who = squash(e.by) || "unknown";
      if (!byPerson[who]) byPerson[who] = { by: who, changes: 0 };
      byPerson[who].changes++;
    });
  });

  return {
    jobsChanged,
    changesAfterPost,
    churnRatePct: pct(jobsChanged, jobs.length),
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    byPerson: Object.values(byPerson).sort((a, b) => b.changes - a.changes),
  };
}

/* ------------- 15b. What the notes keep saying ------------------------ *
 * A free-text box is usually where analysis goes to die. It does not have
 * to: read across a few hundred jobs the same obstacles come up again and
 * again, and they are obstacles no field asks about — a guest who will not
 * open the door before eleven, a building that wants a permit, a part on
 * order, an owner disputing the bill.
 *
 * Nothing here guesses at meaning. It counts jobs whose note mentions a
 * known obstacle, reports the coverage honestly, and shows the notes
 * themselves so a person can read them. The themes are a starting point for
 * a conversation, not a classification.
 * -------------------------------------------------------------------- */
export const NOTE_THEMES = [
  ["access",     "Access / guest will not open", /\b(no access|not open|refus\w*|not reachable|no response|didn'?t answer|locked out|key|access card)\b/i],
  ["permit",     "Building permit or approval",  /\b(permit|noc\b|approval|security|management office|building rules|service lift|work at height)\b/i],
  ["material",   "Part on order or unavailable", /\b(on order|out of stock|not available|awaiting|waiting for|to be ordered|lead time|supplier)\b/i],
  ["contractor", "Needs a contractor",           /\b(contractor|third party|3rd party|specialist|外|external|pcae|apex)\b/i],
  ["owner",      "Owner or landlord involved",   /\b(owner|landlord|ll\b|disput\w*|approval from owner|owners? portal|quotation)\b/i],
  ["guest",      "Guest behaviour or timing",    /\b(guest works|night shift|late check|only after|prefers|complain\w*|angry|upset)\b/i],
  ["recurring",  "Says it has happened before",  /\b(again|repeat\w*|same issue|third time|second time|keeps|recurring)\b/i],
];

export function computeNotes(jobs) {
  const withNote = jobs.filter((j) => squash(j.notes).length >= 8);
  const themes = {};
  NOTE_THEMES.forEach(([k]) => { themes[k] = 0; });
  let themed = 0;

  withNote.forEach((j) => {
    const t = squash(j.notes);
    let hit = false;
    NOTE_THEMES.forEach(([k, , re]) => {
      if (re.test(t)) { themes[k]++; hit = true; }
    });
    if (hit) themed++;
  });

  return {
    total: jobs.length,
    withNote: withNote.length,
    coverage: coverage(withNote.length, jobs.length),
    themed,
    unthemed: withNote.length - themed,
    themes: NOTE_THEMES
      .map(([k, label]) => ({ id: k, label, n: themes[k] }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n),
    // The notes themselves, newest first — the point is that somebody reads them.
    recent: withNote
      .slice()
      .sort((a, b) => String(b._date || "").localeCompare(String(a._date || "")))
      .slice(0, 20)
      .map((j) => ({ date: j._date, property: j.property, unit: j.unit, note: squash(j.notes) })),
  };
}

/* ------------- 15c. Several jobs written as one -------------------------- *
 * A coordinator bundles what a guest reported into one row, because raising
 * three tasks costs three times the typing on the busiest hour of a shift.
 * That is a reasonable trade and it is not going to change — but it has a
 * price, and the price was invisible: a bundled row can only be closed as
 * one thing, so "some of it is done" became either a false "fixed" or a
 * false "not done".
 *
 * Counting them says whether bundling is costing anything. A compound job
 * that comes back is the case that matters.
 * -------------------------------------------------------------------- */
/* Jobs the coordinator marked IMP, and jobs raised off a bad rating. Both
   are written into the title because PMS has nowhere else to put them, and
   both were invisible. Escalation is not priority: a P3 somebody upstairs
   is watching is a different animal from a P3 nobody has mentioned, and
   lumping them together is why "we fixed all the P1s" never answered the
   question being asked. */
export function computeEscalations(jobs) {
  const imp = jobs.filter((j) => j.escalated);
  const review = jobs.filter((j) => j.source === "review");
  const both = jobs.filter((j) => j.escalated && j.source === "review");
  const impResolved = imp.filter((j) => isResolved(j.state));
  const impLate = imp.filter((j) => (j.pushCount || 0) > 0);

  const byPriority = {};
  imp.forEach((j) => {
    const k = canonPriority(j.priority) || "not set";
    byPriority[k] = (byPriority[k] || 0) + 1;
  });

  return {
    total: jobs.length,
    imp: imp.length,
    impPct: pct(imp.length, jobs.length),
    review: review.length,
    both: both.length,
    impResolved: impResolved.length,
    impResolvedPct: pct(impResolved.length, imp.length),
    impPushed: impLate.length,
    impPushedPct: pct(impLate.length, imp.length),
    byPriority: Object.entries(byPriority).sort((a, b) => b[1] - a[1]),
    properties: Array.from(new Set([...imp, ...review].map((j) => squash(j.property)).filter(Boolean))).slice(0, 12),
  };
}

export function computeCompound(jobs) {
  const compound = jobs.filter((j) => isCompound(j.description));
  const parts = compound.reduce((s, j) => s + splitTaskParts(j.description).length, 0);
  const resolved = compound.filter((j) => isResolved(j.state));
  const partial = compound.filter((j) => j.state === "made_safe" || j.state === "diagnosed");
  const returned = compound.filter((j) => (j.pushCount || 0) > 0 || j.followUpJobId);

  return {
    total: jobs.length,
    compound: compound.length,
    compoundPct: pct(compound.length, jobs.length),
    partsHidden: parts - compound.length,   // jobs the board never showed as jobs
    resolved: resolved.length,
    partial: partial.length,
    partialPct: pct(partial.length, resolved.length),
    returned: returned.length,
    returnedPct: pct(returned.length, compound.length),
    examples: compound.slice(0, 8).map((j) => ({
      property: j.property, unit: j.unit,
      parts: splitTaskParts(j.description),
    })),
  };
}

/* --------------- 16. Was there a reason for the day? ------------------ *
 * The department could not answer "why is this job on this day". Now every
 * job booked through the queue carries the basis it was chosen on, and the
 * coordinator overruling the rule is itself recorded.
 *
 * The number to watch is not agreement — a coordinator who never overrules
 * a rule is not exercising judgement, they are following a script, and the
 * rule is not good enough to deserve that. The number to watch is coverage:
 * how much of the board was placed for a reason anybody can name.
 * -------------------------------------------------------------------- */
export function computeSchedulingBasis(jobs) {
  const placed = jobs.filter((j) => squash(j.scheduledBasis));
  const byBasis = {};
  placed.forEach((j) => {
    const b = squash(j.scheduledBasis);
    byBasis[b] = (byBasis[b] || 0) + 1;
  });
  const overruled = placed.filter((j) => j.scheduledBasis === "overruled").length;
  const fromQueue = jobs.filter((j) => j.source === "pms-queue").length;

  /* Access is the constraint the rule exists to respect, so respecting it
     is the thing worth counting: work booked into an empty unit or a
     changeover needs no guest and cannot be turned away at the door. */
  const cleanAccess = placed.filter((j) =>
    j.scheduledBasis === "vacancy" || j.scheduledBasis === "checkout").length;

  return {
    total: jobs.length,
    placed: placed.length,
    fromQueue,
    coverage: coverage(placed.length, jobs.length),
    overruled,
    overruledPct: pct(overruled, placed.length),
    followed: placed.length - overruled,
    cleanAccess,
    cleanAccessPct: pct(cleanAccess, placed.length),
    conflicts: byBasis.conflict || 0,
    overdueAtBooking: byBasis.overdueNow || 0,
    byBasis: Object.entries(byBasis).sort((a, b) => b[1] - a[1]),
  };
}

/* ====================================================================== *
 * Mix, concentration, and the daily series behind the charts
 * ====================================================================== */

export function computeMix(jobs) {
  const priority = { "PRI-1": 0, "PRI-2": 0, "PRI-3": 0, "PRI-4": 0 };
  const work = {};
  WORK_TYPES.forEach((t) => { work[t] = 0; });
  let priorityBlank = 0;
  const occupancy = {};
  const crews = {};
  const properties = {};

  jobs.forEach((j) => {
    const p = canonPriority(j.priority);
    if (p) priority[p]++; else priorityBlank++;
    work[workType(j.description, j.faultCode)]++;
    const oc = occupancyClass(j.status);
    occupancy[oc] = (occupancy[oc] || 0) + 1;
    const crew = canonCrewLabel(j.team);
    if (!crews[crew]) crews[crew] = { jobs: 0, minutes: 0 };
    crews[crew].jobs++;
    crews[crew].minutes += parseDurationMinutes(j.estimatedTime) || 0;
    const key = canonProperty(j.property);
    if (key) {
      if (!properties[key]) properties[key] = { label: displayProperty(j.property), jobs: 0, minutes: 0, units: new Set() };
      properties[key].jobs++;
      properties[key].minutes += parseDurationMinutes(j.estimatedTime) || 0;
      const u = canonUnit(j.unit);
      if (u) properties[key].units.add(u);
    }
  });

  const answered = jobs.length - priorityBlank;
  // The standard maintenance ratio: how much of the work was planned
  // rather than a reaction to something breaking.
  const plannedCount = work.ppm + work.project + work.inspection;
  return {
    workTypes: work,
    plannedSharePct: pct(plannedCount, jobs.length),
    reactiveSharePct: pct(work.reactive, jobs.length),
    priority,
    priorityBlank,
    priorityCoverage: coverage(answered, jobs.length),
    p1SharePct: pct(priority["PRI-1"], answered),
    occupancy,
    crews: Object.entries(crews).map(([k, v]) => ({ crew: k, ...v })).sort((a, b) => b.jobs - a.jobs),
    topProperties: Object.entries(properties)
      .map(([k, v]) => ({ key: k, label: v.label, jobs: v.jobs, minutes: v.minutes, units: v.units.size }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 15),
    distinctProperties: Object.keys(properties).length,
  };
}

export function computeDailySeries(jobs, opts = {}) {
  const byDate = new Map();
  jobs.forEach((j) => {
    if (!byDate.has(j._date)) byDate.set(j._date, []);
    byDate.get(j._date).push(j);
  });
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, list]) => {
      const cap = computeCapacity(list, opts);
      const access = computeAccessRisk(list);
      const ver = computeVerification(list);
      const minutes = list.reduce((s, j) => s + (parseDurationMinutes(j.estimatedTime) || 0), 0);
      const techs = new Set();
      list.forEach((j) => splitCrew(j.team).forEach((t) => techs.add(t)));
      // Committed and available come straight off the capacity rows so the
      // daily chart and the range headline are the same number. Reading
      // task minutes here while the headline included travel made the chart
      // quietly disagree with the tile above it.
      const committedMinutes = cap.totalCommittedMinutes;
      const availableMinutes = cap.totalAvailableMinutes;
      return {
        date,
        jobs: list.length,
        minutes,
        hours: Math.round((minutes / 60) * 10) / 10,
        committedMinutes,
        availableMinutes,
        committedHours: Math.round((committedMinutes / 60) * 10) / 10,
        capacityHours: Math.round((availableMinutes / 60) * 10) / 10,
        techs: techs.size,
        overloadedTechs: cap.overloaded.length,
        utilisationPct: cap.utilisationPct,
        p1: list.filter((j) => canonPriority(j.priority) === "PRI-1").length,
        accessAtRisk: access.atRiskCount,
        verified: ver.verifiedCount,
        done: ver.done,
        notDone: ver.notDone,
        completionRatePct: ver.completionRatePct,
      };
    });
}

/* ------------------------ Data quality panel -------------------------- *
 * Shown on the dashboard on purpose. Every rate above is only as good as
 * the field it is built on, so the fill rates are put on screen next to
 * the numbers rather than buried.
 * -------------------------------------------------------------------- */
export const QUALITY_FIELDS = [
  { key: "estimatedTime", label: "Estimated time", why: "Capacity & overload", tier: "A" },
  { key: "priority", label: "Priority", why: "P1 response, work mix", tier: "A" },
  { key: "guestConfirmed", label: "Guest confirmed", why: "Access risk", tier: "A" },
  { key: "timeOfVisit", label: "Time of visit", why: "Access risk, routing", tier: "A" },
  { key: "materialNeeded", label: "Material needed", why: "Van readiness", tier: "A" },
  { key: "pending", label: "Pending flag", why: "Backlog & ageing", tier: "A" },
  { key: "unit", label: "Unit number", why: "Repeat visits, rework", tier: "A" },
  { key: "source", label: "Where it came from", why: "Demand mix, unplanned volume", tier: "A" },
];

export function computeDataQuality(jobs) {
  const rows = QUALITY_FIELDS.map((f) => {
    let answered = 0;
    jobs.forEach((j) => {
      const v = j[f.key];
      if (f.key === "estimatedTime") { if (parseDurationMinutes(v) != null) answered++; return; }
      if (f.key === "priority") { if (canonPriority(v)) answered++; return; }
      if (f.key === "guestConfirmed" || f.key === "materialNeeded" || f.key === "pending") {
        if (parseYN(v) !== null) answered++; return;
      }
      if (f.key === "source") { if (squash(v)) answered++; return; }
      if (f.key === "timeOfVisit") {
        const t = canonKey(v);
        if (t && !/not confirmed|tbc|tbd/.test(t)) answered++; return;
      }
      if (squash(v)) answered++;
    });
    return { ...f, answered, total: jobs.length, pct: pct(answered, jobs.length) };
  });

  const settled = jobs.filter((j) => outcomeOf(j) !== null).length;
  rows.push({
    key: "verify", label: "Outcome recorded", why: "Completion, PMS, first-time fix",
    tier: "B", answered: settled, total: jobs.length, pct: pct(settled, jobs.length),
  });
  return rows;
}

/* ------------------------------ Roll-up ------------------------------- */
export function computeAll(jobs, opts = {}) {
  const asOf = opts.asOfDate || (jobs.length ? jobs.map((j) => j._date).sort().slice(-1)[0] : "");
  return {
    jobCount: jobs.length,
    dateCount: new Set(jobs.map((j) => j._date)).size,
    capacity: computeCapacity(jobs, opts),
    access: computeAccessRisk(jobs),
    material: computeMaterialReadiness(jobs),
    repeats: computeRepeatVisits(jobs, opts),
    pending: computePendingBacklog(jobs, asOf, opts),
    movement: computeMovement(jobs, { ...opts, asOfDate: asOf }),
    verification: computeVerification(jobs),
    estimates: computeEstimateAccuracy(jobs),
    firstTimeFix: computeFirstTimeFix(jobs, opts),
    mix: computeMix(jobs),
    returnReasons: computeReturnReasons(jobs, computeRepeatVisits(jobs, opts)),
    containment: computeContainment(jobs, { ...opts, asOfDate: asOf }),
    demand: computeDemand(jobs),
    displacement: computeDisplacement(jobs, opts),
    schedulingBasis: computeSchedulingBasis(jobs),
    notes: computeNotes(jobs),
    compound: computeCompound(jobs),
    escalations: computeEscalations(jobs),
    durations: computeDurationLibrary(jobs, opts),
    throughput: computeThroughput(jobs),
    churn: computeChurn(jobs),
    techTimes: computeTechTimes(jobs, opts),
    series: computeDailySeries(jobs, opts),
    quality: computeDataQuality(jobs),
  };
}
