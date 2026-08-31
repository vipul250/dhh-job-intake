/* ---------------------------------------------------------------------- *
 * project.js — quoted work, and whether it made money.
 *
 * Daily field tasks and projects are different animals and the metrics
 * have so far only measured the first. A project has a quotation, a
 * duration in days rather than hours, materials bought against it, and a
 * price the client agreed to — none of which the daily board models.
 *
 * The number this exists to produce:
 *
 *     margin = quoted amount − (labour hours × rate + material cost)
 *
 * Labour comes from the daily jobs linked to the project, so it does not
 * have to be typed twice: the technician's hours are already being
 * recorded by Start and Done on the board. Material is entered as it is
 * bought, and every entry teaches the price book — so the tenth time
 * somebody logs "Honeywell thermostat" the cost is already filled in.
 * That is the memory that eventually makes this automatic.
 * ---------------------------------------------------------------------- */

import { squash, canonKey, parseDurationMinutes } from "./normalize.js";
import { actualDuration, uid, makeEvent } from "./job.js";

export const PROJECT_STATUS = ["quoted", "approved", "in_progress", "completed", "cancelled"];

export const PROJECT_STATUS_LABEL = {
  quoted: "Quoted — awaiting approval",
  approved: "Approved — not started",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PROJECT_TYPES = [
  ["onboarding", "Onboarding — approved quotation"],
  ["quoted-existing", "Approved quotation — existing unit"],
  ["snag", "Snag / rectification"],
  ["other", "Other"],
];

export function newProject(fields = {}, by = "unknown") {
  return {
    id: uid(),
    createdAt: Date.now(),
    createdBy: squash(by) || "unknown",
    status: "approved",
    type: "quoted-existing",

    property: "", unit: "", title: "",
    quotationRef: "",
    quotedAmount: null,      // what the client agreed to pay
    quotationLink: "",       // URL to the approved quotation (Drive, PMS, email)
    quotationNote: "",

    startDate: "", targetDate: "", actualCompletionDate: "",

    materials: [],           // { id, item, qty, unitCost, total, date, by, note }
    extraLabour: [],         // { id, hours, note, date, by } — hours not on the board
    linkedJobIds: [],        // daily jobs whose time rolls into this project

    notes: "",
    events: [makeEvent("created", by)],
    ...fields,
  };
}

export function materialLine(item, qty, unitCost, by, note = "") {
  const q = Number(qty) || 0;
  const c = Number(unitCost) || 0;
  return {
    id: uid(),
    item: squash(item),
    qty: q,
    unitCost: c,
    total: Math.round(q * c * 100) / 100,
    date: new Date().toISOString().slice(0, 10),
    by: squash(by) || "unknown",
    note: squash(note),
  };
}

/* ---------------------------------------------------------------------- *
 * The price book — the "memory" that makes this less typing over time.
 *
 * Built from every material line ever entered, keyed on a normalised item
 * name. Reports the most recent price and the median, because the median
 * is what you want for estimating and the latest is what you want for
 * checking whether a supplier has moved. Once an item has a few
 * observations the app can fill the cost in and let the coordinator
 * correct it, rather than asking every time.
 * ---------------------------------------------------------------------- */
export function buildPriceBook(projects) {
  const book = new Map();
  (projects || []).forEach((p) => {
    (p.materials || []).forEach((m) => {
      const key = canonKey(m.item);
      if (!key || !m.unitCost) return;
      if (!book.has(key)) book.set(key, { item: m.item, observations: [] });
      book.get(key).observations.push({ unitCost: m.unitCost, date: m.date, project: p.id });
    });
  });
  const out = {};
  book.forEach((v, key) => {
    const costs = v.observations.map((o) => o.unitCost).sort((a, b) => a - b);
    const mid = Math.floor(costs.length / 2);
    const median = costs.length % 2 ? costs[mid] : (costs[mid - 1] + costs[mid]) / 2;
    const latest = v.observations.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    out[key] = {
      item: v.item,
      count: costs.length,
      median: Math.round(median * 100) / 100,
      latest: latest.unitCost,
      latestDate: latest.date,
      min: costs[0],
      max: costs[costs.length - 1],
      // Enough observations to fill in automatically without being annoying.
      confident: costs.length >= 3,
    };
  });
  return out;
}

export function lookupPrice(priceBook, item) {
  const k = canonKey(item);
  if (!k) return null;
  if (priceBook[k]) return priceBook[k];

  /* Match on tokens, not substrings. People do not retype an item the same
     way twice — "Honeywell Ac thermostat 220v" has to find "honeywell
     thermostat", and neither string contains the other. A book entry
     matches when all of its words appear in what was typed; the entry with
     the most words wins, so a specific item beats a generic one. */
  const words = new Set(k.split(/\s+/).filter(Boolean));
  let best = null, bestScore = 0;
  Object.keys(priceBook).forEach((key) => {
    const kw = key.split(/\s+/).filter((w) => w.length > 2);
    if (!kw.length) return;
    if (!kw.every((w) => words.has(w))) return;
    if (kw.length > bestScore) { bestScore = kw.length; best = key; }
  });
  return best ? priceBook[best] : null;
}

/* ---------------------------------------------------------------------- *
 * Cost roll-up.
 *
 * Labour is taken from the linked daily jobs: measured time where the
 * board has it, the estimate where it does not. Which of the two was used
 * is reported, because a margin built mostly on estimates is a forecast,
 * not a result, and the difference should be visible on the card rather
 * than assumed.
 * ---------------------------------------------------------------------- */
export function projectCost(project, linkedJobs, rates) {
  const r = rates || {};
  const hourly = Number(r.techCostPerHour) || 25;
  const currency = r.currency || "AED";

  let measuredMinutes = 0, estimatedMinutes = 0;
  let measuredJobs = 0, estimatedJobs = 0, unpricedJobs = 0;
  const crewSize = (j) => Math.max(1, (squash(j.team).split(/\s*(?:,|&|\+|\/|\band\b)\s*/i).filter(Boolean)).length);

  (linkedJobs || []).forEach((j) => {
    const crew = crewSize(j);
    const act = actualDuration(j);
    if (act.minutes != null) { measuredMinutes += act.minutes * crew; measuredJobs++; return; }
    const est = parseDurationMinutes(j.estimatedTime);
    if (est != null) { estimatedMinutes += est * crew; estimatedJobs++; return; }
    unpricedJobs++;
  });

  const extraHours = (project.extraLabour || []).reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const boardHours = (measuredMinutes + estimatedMinutes) / 60;
  const labourHours = boardHours + extraHours;
  const labourCost = labourHours * hourly;

  const materialCost = (project.materials || []).reduce((s, m) => s + (Number(m.total) || 0), 0);
  const selfCost = labourCost + materialCost;

  const quoted = Number(project.quotedAmount);
  const hasQuote = Number.isFinite(quoted) && quoted > 0;
  const margin = hasQuote ? quoted - selfCost : null;
  const marginPct = hasQuote && quoted > 0 ? Math.round((margin / quoted) * 1000) / 10 : null;

  return {
    currency,
    hourly,
    labourHours: Math.round(labourHours * 10) / 10,
    measuredHours: Math.round((measuredMinutes / 60) * 10) / 10,
    estimatedHours: Math.round((estimatedMinutes / 60) * 10) / 10,
    extraHours: Math.round(extraHours * 10) / 10,
    labourCost: Math.round(labourCost),
    materialCost: Math.round(materialCost * 100) / 100,
    selfCost: Math.round(selfCost),
    quoted: hasQuote ? quoted : null,
    margin: margin == null ? null : Math.round(margin),
    marginPct,
    linkedJobCount: (linkedJobs || []).length,
    measuredJobs, estimatedJobs, unpricedJobs,
    // A margin resting mostly on estimates is a forecast, not a result.
    labourIsMeasured: measuredJobs > 0 && measuredJobs >= estimatedJobs,
    coveragePct: (linkedJobs || []).length
      ? Math.round((measuredJobs / linkedJobs.length) * 100)
      : null,
  };
}

/* Elapsed calendar days, which is what "how long did the project take"
   actually means to anyone asking. */
export function projectDuration(project) {
  const start = project.startDate;
  const end = project.actualCompletionDate || project.targetDate;
  if (!start || !end) return null;
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const days = Math.round((b - a) / 86400000);
  return {
    days,
    overdue: !!(!project.actualCompletionDate && project.targetDate &&
      project.targetDate < new Date().toISOString().slice(0, 10)),
    late: !!(project.actualCompletionDate && project.targetDate &&
      project.actualCompletionDate > project.targetDate),
  };
}

/* Quotation refs appear inside daily task descriptions ("Approved -
   PC-2026-08-28 - arrange material"), so linking can be offered rather
   than hunted for. */
export function findJobsForProject(project, allJobs) {
  const ref = canonKey(project.quotationRef).replace(/[^a-z0-9-]/g, "");
  const prop = canonKey(project.property);
  const unit = canonKey(project.unit);
  return (allJobs || []).filter((j) => {
    if (!j || j._tomb) return false;
    if ((project.linkedJobIds || []).includes(j.id)) return false;
    const text = canonKey(`${j.description} ${j.notes} ${j.quotationRef || ""}`).replace(/\s+/g, " ");
    if (ref && ref.length > 6 && text.replace(/[^a-z0-9-]/g, "").includes(ref)) return true;
    if (prop && unit && canonKey(j.property).includes(prop) && canonKey(j.unit) === unit) return true;
    return false;
  });
}

export function extractQuotationRef(text) {
  const m = squash(text).match(/\b(?:REV\s*\d+\s*-\s*)?(PC-20\d\d-\d\d-\d\d)\b/i);
  return m ? m[1].toUpperCase() : "";
}
