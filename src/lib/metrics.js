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

  // Jobs with no recorded outcome on a day that has already passed: nobody
  // said done, not done, moved or cancelled. These are the disappearances.
  const today = opts.asOfDate || "";
  const lost = stillOpen.filter((j) => today && j.scheduledDate < today);

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
export const NOT_DONE_REASONS = [
  "No access / guest refused",
  "Guest not reachable",
  "Material not available",
  "Ran out of time",
  "Needs contractor / out of scope",
  "Other",
];

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
    techTimes: computeTechTimes(jobs, opts),
    series: computeDailySeries(jobs, opts),
    quality: computeDataQuality(jobs),
  };
}
