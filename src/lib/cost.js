/* ---------------------------------------------------------------------- *
 * cost.js — what the schedule costs, and which part of it is waste.
 *
 * The honest framing first: this model prices TIME and TRIPS, because
 * those are the two things the schedule actually records. Time comes from
 * the estimate the coordinator types (or the actual, once the admin logs
 * it); trips come from the number of distinct buildings in a technician's
 * day. Material cost is only included where somebody enters a figure —
 * the sheet records "Paint" and "Basic materials", never a number, so
 * material spend is reported as a coverage gap rather than guessed at.
 *
 * Every rate below is a DEFAULT AND A PLACEHOLDER. They are stored in the
 * app and editable in the Dashboard's cost settings. Replace them with
 * DHH's real figures before quoting any of these numbers to anyone —
 * the structure is right, the inputs are yours.
 *
 * The useful output is not the total. It is the split between cost that
 * bought something and cost that did not:
 *
 *   - overtime      — hours committed past the shift, at a premium
 *   - idle capacity — rostered hours the schedule never filled
 *   - wasted visits — a technician travelled and the job did not happen
 *   - rework        — the same fault paid for twice
 *
 * Those four are the optimisable budget. The rest is the work.
 * ---------------------------------------------------------------------- */

import {
  parseDurationMinutes, splitCrew, canonProperty, parseShiftMinutes,
  workType, assetKey, daysBetween, squash,
} from "./normalize.js";
import { DEFAULTS } from "./metrics.js";

/* Defaults are AED and deliberately conservative. Sources of the shape,
   not the values: a fully-loaded technician cost is salary + accommodation
   + visa + insurance divided by productive hours, which is always well
   above the bare salary rate; UAE labour law prices overtime at basic
   +25% (+50% for hours between 22:00 and 04:00), hence the 1.25 default. */
export const DEFAULT_RATES = {
  currency: "AED",
  techCostPerHour: 25,        // fully-loaded: salary + accommodation + visa + insurance / productive hours
  overtimeMultiplier: 1.25,   // UAE labour law: basic +25%
  vehicleCostPerTrip: 12,     // fuel + Salik + wear, per additional building in a day
  callOutFixedCost: 0,        // any per-visit admin/dispatch cost you want to carry
  contractorCostPerHour: 120, // third-party trades, used for jobs flagged as contractor work
  perTech: {},                // optional overrides: { "Vitalis": 30 }
  // Planning assumption used for the exposure figure only — see below.
  wastedVisitProbability: 0.35,
};

const round = (n) => Math.round(n * 100) / 100;
const money = (n) => Math.round(n);

function techRate(tech, rates) {
  const override = rates.perTech && rates.perTech[tech];
  return Number.isFinite(Number(override)) && Number(override) > 0
    ? Number(override)
    : rates.techCostPerHour;
}

/* Per-job cost of the labour committed to it. A crew job costs every
   member's time — that is the whole point of splitting crews. */
export function jobLabourCost(job, rates) {
  const mins = parseDurationMinutes(job.estimatedTime);
  if (mins == null) return null;
  const crew = splitCrew(job.team);
  const members = crew.length ? crew : ["Unassigned"];
  const isContractor = workType(job.description, job.faultCode) === "project" &&
    /contractor|3rd party|third party/i.test(squash(job.description) + squash(job.notes));
  return members.reduce((sum, t) => {
    const rate = isContractor ? rates.contractorCostPerHour : techRate(t, rates);
    return sum + (mins / 60) * rate;
  }, 0);
}

/* Entered material cost, when somebody entered one. Never inferred. */
export function jobMaterialCost(job) {
  const v = Number(job.materialCost);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The main roll-up.
 * @param {Array}  jobs   jobs with a `_date`
 * @param {Object} rates  merged over DEFAULT_RATES
 * @param {Object} capacity  the object returned by computeCapacity
 * @param {Object} repeats   the object returned by computeRepeatVisits
 */
export function computeCost(jobs, rates, capacity, repeats, opts = {}) {
  const r = { ...DEFAULT_RATES, ...(rates || {}) };
  const o = { ...DEFAULTS, ...opts };

  /* ---------------- straight cost of the plan ---------------- */
  let labour = 0, labourPricedJobs = 0, unpricedJobs = 0;
  let material = 0, materialPricedJobs = 0;
  const byProperty = new Map();
  const byTech = new Map();
  const byWorkType = {};

  jobs.forEach((j) => {
    const lc = jobLabourCost(j, r);
    if (lc == null) { unpricedJobs++; } else { labour += lc; labourPricedJobs++; }
    const mc = jobMaterialCost(j);
    if (mc != null) { material += mc; materialPricedJobs++; }

    const cost = (lc || 0) + (mc || 0);
    const wt = workType(j.description, j.faultCode);
    byWorkType[wt] = (byWorkType[wt] || 0) + cost;

    const pk = canonProperty(j.property);
    if (pk) {
      if (!byProperty.has(pk)) byProperty.set(pk, { label: squash(j.property), cost: 0, jobs: 0 });
      const e = byProperty.get(pk);
      e.cost += cost; e.jobs++;
    }
    const crew = splitCrew(j.team);
    (crew.length ? crew : ["Unassigned"]).forEach((t) => {
      if (!byTech.has(t)) byTech.set(t, { tech: t, cost: 0, jobs: 0, minutes: 0 });
      const e = byTech.get(t);
      const mins = parseDurationMinutes(j.estimatedTime) || 0;
      e.cost += (mins / 60) * techRate(t, r);
      e.minutes += mins;
      e.jobs++;
    });
  });

  /* ---------------- travel ---------------- */
  // One trip charge per additional building in a technician's day. The
  // first building of the day is the commute, which is not a job cost.
  const travelHops = capacity.rows.reduce((s, row) => s + Math.max(0, row.properties - 1), 0);
  const travel = travelHops * r.vehicleCostPerTrip;
  const callOut = jobs.length * r.callOutFixedCost;

  /* ---------------- waste bucket 1: overtime ---------------- *
   * Minutes committed past the rostered shift. Whether it is paid as
   * overtime or absorbed by the job not happening, it is scheduled work
   * with no paid-for hours behind it. */
  let overtimeMinutes = 0, overtimeCost = 0;
  capacity.rows.forEach((row) => {
    const over = row.committedMinutes - row.shiftMinutes;
    if (over <= 0) return;
    overtimeMinutes += over;
    overtimeCost += (over / 60) * techRate(row.tech, r) * r.overtimeMultiplier;
  });

  /* ---------------- waste bucket 2: idle capacity ---------------- *
   * Rostered hours the schedule never filled. Real money — the technician
   * is paid for the shift either way — and the counterpart of overtime:
   * both usually appear on the same day, in different people. */
  let idleMinutes = 0, idleCost = 0;
  capacity.rows.forEach((row) => {
    const idle = row.shiftMinutes - row.committedMinutes;
    if (idle <= 0) return;
    idleMinutes += idle;
    idleCost += (idle / 60) * techRate(row.tech, r);
  });

  /* ---------------- waste bucket 3: wasted visits ---------------- *
   * Confirmed by the admin: the technician went and the job did not
   * happen for a reason that a phone call would have caught. Labour plus
   * one trip, bought and thrown away. */
  const ACCESS_REASONS = /no access|guest refused|not reachable|cancelled/i;
  const wastedVisits = jobs.filter(
    (j) => j.verify && j.verify.outcome === "not-done" && ACCESS_REASONS.test(squash(j.verify.reason))
  );
  const materialFailures = jobs.filter(
    (j) => j.verify && j.verify.outcome !== "done" && /material not available/i.test(squash(j.verify.reason))
  );
  const wastedVisitCost = wastedVisits.reduce(
    (s, j) => s + (jobLabourCost(j, r) || 0) + r.vehicleCostPerTrip + r.callOutFixedCost, 0
  );
  const materialFailureCost = materialFailures.reduce(
    (s, j) => s + (jobLabourCost(j, r) || 0) + r.vehicleCostPerTrip, 0
  );

  /* ---------------- waste bucket 4: rework ---------------- *
   * The return visit for a fault already attended. The first visit was
   * legitimate spend; the second is the same fault paid for twice. */
  const reworkCost = (repeats.reworkEventsList || []).reduce(
    (s, ev) => s + (jobLabourCost(ev.second, r) || 0) + r.vehicleCostPerTrip, 0
  );

  const totalPlanned = labour + travel + material + callOut;
  const waste = overtimeCost + wastedVisitCost + materialFailureCost + reworkCost;

  /* ---------------- exposure (forward-looking, Tier A) ---------------- *
   * Before any verification exists, the schedule still shows money at
   * risk: labour + a trip committed to occupied units nobody confirmed,
   * discounted by how often such a visit actually fails. The probability
   * is an ASSUMPTION and is stated as one wherever it is displayed —
   * it becomes a measured rate as soon as jobs have been closed out for a
   * couple of weeks. */
  const unconfirmed = jobs.filter((j) => {
    const needsConfirm = ["Occupied", "Occupied - GC", "Check-in", "B2B"].some(
      (s) => squash(j.status).toLowerCase() === s.toLowerCase()
    ) || /^occupied|check-?in|b2b/i.test(squash(j.status));
    if (!needsConfirm) return false;
    const gc = squash(j.guestConfirmed).toLowerCase();
    return !/^y/.test(gc);
  });
  const exposureFull = unconfirmed.reduce(
    (s, j) => s + (jobLabourCost(j, r) || 0) + r.vehicleCostPerTrip, 0
  );

  /* ---------------- optimisation levers ---------------- *
   * Each is the cost of a specific failure, and each names the change
   * that removes it. Deliberately not summed into one "savings" number:
   * they overlap (a job that fails for access AND has no material list
   * appears in two), and a single headline would overstate the prize. */
  const levers = [
    {
      id: "confirm-access",
      title: "Confirm the guest before the van is loaded",
      measured: wastedVisits.length > 0,
      value: wastedVisits.length > 0 ? wastedVisitCost : exposureFull * r.wastedVisitProbability,
      basis: wastedVisits.length > 0
        ? `${wastedVisits.length} visit(s) the admin confirmed failed on access`
        : `${unconfirmed.length} occupied visit(s) with no confirmation, at an assumed ${Math.round(r.wastedVisitProbability * 100)}% failure rate`,
      action: "A confirmation call the evening before turns this into either a kept slot or a slot given to another job.",
    },
    {
      id: "level-load",
      title: "Move work off the overloaded technicians",
      measured: true,
      value: overtimeCost,
      basis: `${Math.round(overtimeMinutes / 60)}h committed past shift end across ${capacity.overloaded.length} tech-day(s)`,
      action: `On the same days, ${Math.round(idleMinutes / 60)}h of rostered time sat unfilled. This is mostly a distribution problem, not a headcount one.`,
    },
    {
      id: "fill-capacity",
      title: "Fill the rostered hours that are going unused",
      measured: true,
      value: idleCost,
      basis: `${Math.round(idleMinutes / 60)}h of paid shift time with nothing scheduled against it`,
      action: "Pull planned/PPM work forward into the gaps — it is the cheapest work to move and it reduces future breakdowns.",
    },
    {
      id: "specify-material",
      title: "Replace \"basic materials\" with an actual picking list",
      measured: materialFailures.length > 0,
      value: materialFailures.length > 0 ? materialFailureCost : null,
      basis: materialFailures.length > 0
        ? `${materialFailures.length} job(s) failed or ran partial for want of the right part`
        : "No confirmed material failures yet — this becomes a measured number once jobs are being closed out on the board",
      action: "A specific list also makes warehouse pickup plannable instead of a morning scramble.",
    },
    {
      id: "first-time-fix",
      title: "Get the fault right the first time",
      measured: (repeats.reworkEventsList || []).length > 0,
      value: reworkCost,
      basis: `${repeats.reworkEvents} return visit(s) for a fault already attended, over ${repeats.reactiveVisits} reactive visits`,
      action: "Each one is a second trip, a second hour, and a guest who has now waited twice.",
    },
    {
      id: "batch-buildings",
      title: "Batch jobs by building",
      measured: true,
      value: travel,
      basis: `${travelHops} building-to-building hop(s) across the range`,
      action: `Every hop also costs ${o.travelMinutesPerHop} minutes of paid time, which is already counted in the load figures. Two jobs in one tower cost one trip.`,
    },
  ];

  return {
    currency: r.currency,
    rates: r,

    labour: money(labour),
    travel: money(travel),
    material: money(material),
    callOut: money(callOut),
    totalPlanned: money(totalPlanned),
    costPerJob: jobs.length ? round(totalPlanned / jobs.length) : null,

    labourCoverage: { answered: labourPricedJobs, total: jobs.length, unpriced: unpricedJobs },
    materialCoverage: { answered: materialPricedJobs, total: jobs.length },

    overtimeMinutes, overtimeCost: money(overtimeCost),
    idleMinutes, idleCost: money(idleCost),
    wastedVisits: wastedVisits.length, wastedVisitCost: money(wastedVisitCost),
    materialFailures: materialFailures.length, materialFailureCost: money(materialFailureCost),
    reworkEvents: repeats.reworkEvents, reworkCost: money(reworkCost),
    totalWaste: money(waste),
    wasteSharePct: totalPlanned > 0 ? Math.round((waste / totalPlanned) * 1000) / 10 : null,

    unconfirmedVisits: unconfirmed.length,
    exposureFull: money(exposureFull),
    exposureExpected: money(exposureFull * r.wastedVisitProbability),

    travelHops,
    byWorkType,
    byProperty: Array.from(byProperty.values()).sort((a, b) => b.cost - a.cost).slice(0, 15).map((e) => ({ ...e, cost: money(e.cost) })),
    byTech: Array.from(byTech.values()).sort((a, b) => b.cost - a.cost).map((e) => ({ ...e, cost: money(e.cost) })),

    levers: levers.sort((a, b) => (b.value || 0) - (a.value || 0)),
  };
}

/* Cost per day, for the trend chart. */
export function computeCostSeries(jobs, rates, opts = {}) {
  const r = { ...DEFAULT_RATES, ...(rates || {}) };
  const byDate = new Map();
  jobs.forEach((j) => {
    if (!byDate.has(j._date)) byDate.set(j._date, []);
    byDate.get(j._date).push(j);
  });
  return Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, list]) => {
    let labour = 0;
    const hops = new Map();
    list.forEach((j) => {
      labour += jobLabourCost(j, r) || 0;
      splitCrew(j.team).forEach((t) => {
        if (!hops.has(t)) hops.set(t, new Set());
        const p = canonProperty(j.property);
        if (p) hops.get(t).add(p);
      });
    });
    let hopCount = 0;
    hops.forEach((set) => { hopCount += Math.max(0, set.size - 1); });
    const travel = hopCount * r.vehicleCostPerTrip;
    return {
      date,
      jobs: list.length,
      labourCost: money(labour),
      travelCost: money(travel),
      totalCost: money(labour + travel),
      costPerJob: list.length ? Math.round((labour + travel) / list.length) : 0,
    };
  });
}
