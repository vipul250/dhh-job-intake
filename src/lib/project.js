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

import { squash, canonKey, parseDurationMinutes, splitCrew } from "./normalize.js";
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
  ["handover", "Pre-handover works"],
  ["landlord", "Landlord-requested works"],
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

    /* ---- carried across from the workbook's Job Cards tab ----------- *
     * A project crew works a card that runs for days, so no daily job
     * names them and the board counted them idle. Recording the crew on
     * the project itself is what lets a day say "these four are on Damac
     * 4301" without anybody ticking a box every morning.
     *
     * `scope` and `materialsWanted` are the quotation as written. They are
     * deliberately NOT priced material lines: the tab's Materials List
     * says things like "Materials arranged by ADI", and pricing that at
     * zero would put a fictional margin on the card. The priced lines
     * stay something a person enters as the money is spent.
     * ----------------------------------------------------------------- */
    crew: [],
    scope: "",
    materialsWanted: "",
    /* Total crew-hours if the sheet ever carries a real one. Null on every
       real row today, because that column holds a priority. */
    sheetMinutes: null,

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
/* ---------------------------------------------------------------------- *
 * Labour on a project that has no daily job rows.
 *
 * This is the gap that made a crew look idle. A project runs for days off
 * one job card; the daily board only knows about it on the days somebody
 * also wrote a task row for it. On 3 September the board listed Khaled,
 * Nizar and Shafeeq as idle while all three were on Damac 4301 — a card
 * that was in progress, with them named on it, and due on the 4th.
 *
 * So the days between a project's start and its end are read as days its
 * crew was on it. That is an INFERENCE, not a measurement, and every
 * number built on it says so on the card and on the dashboard. It is
 * offered because the alternative measured nothing at all: a project crew
 * would finish the month with close to zero recorded hours.
 *
 * Two things keep it from being nonsense:
 *
 *   It never counts a day the board already accounted for. A day with a
 *   linked daily job on it contributes its measured or estimated time
 *   through the normal path; inferring a second nine hours on top of that
 *   would double-count the one day that was actually recorded properly.
 *
 *   It only runs on projects that have genuinely started. A card sitting
 *   at "approved" with a start date next week has no hours yet, and a
 *   cancelled one stops rather than accruing to today.
 * ---------------------------------------------------------------------- */

const iso = (d) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());

function addDay(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** The day a project's work stops accruing, or "" when it cannot be said. */
export function projectEndDate(project, today) {
  if (!project || !project.startDate) return "";
  const now = today || todayISO();
  if (project.status === "cancelled") return project.actualCompletionDate || "";
  if (project.actualCompletionDate) return project.actualCompletionDate;
  const target = project.startDate && project.targetDate ? project.targetDate : "";
  /* Still running: it has accrued up to today, and an overrun is real work
     rather than something to clip back to the target date. */
  if (project.status === "in_progress") return !target || target < now ? now : target;
  if (project.status === "completed") return target && target < now ? target : now;
  return "";
}

/** Was this project live on this day? Used to keep its crew off the idle list. */
export function projectActiveOn(project, date, today) {
  if (!project || !date || !project.startDate) return false;
  if (project.status === "cancelled" || project.status === "quoted") return false;
  if (date < project.startDate) return false;
  const end = projectEndDate(project, today);
  return !!end && date <= end;
}

/**
 * Who is on a project on this day, with which project.
 *
 * The roster already keeps the ticked project crew off the idle list — see
 * checkAgainstSchedule in roster.js. This feeds the same list from the job
 * cards themselves, so the answer stops depending on somebody remembering
 * to tick four names every morning. The ticks stay, for anything the sheet
 * does not say.
 */
export function projectCrewOn(projects, date, today) {
  const out = [];
  const seen = new Set();
  (projects || []).forEach((p) => {
    if (!projectActiveOn(p, date, today)) return;
    (p.crew || []).forEach((name) => {
      const k = canonKey(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({
        name,
        projectId: p.id,
        title: [squash(p.property), squash(p.unit), squash(p.title)].filter(Boolean).join(" "),
      });
    });
  });
  return out;
}

/** Every day a project was live, capped so a bad date cannot run away. */
export function projectSpanDates(project, today) {
  if (!project || !project.startDate) return [];
  if (project.status !== "completed" && project.status !== "in_progress") return [];
  const now = today || todayISO();
  let end = projectEndDate(project, now);
  /* Hours do not accrue for days that have not happened yet. The board
     opens on TOMORROW, so a card due on the 4th is legitimately active on
     the 4th for planning — projectActiveOn says so, and that is what keeps
     its crew off tomorrow's idle list. It has not yet worked that day, so
     the labour roll-up stops at today. Two different questions, two
     different ends; conflating them was quietly billing the future. */
  if (!project.actualCompletionDate && end > now) end = now;
  if (!end || end < project.startDate) return [];
  const out = [];
  for (let d = project.startDate; d <= end && out.length < 120; d = addDay(d, 1)) out.push(d);
  return out;
}

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

  /* Voided lines stay on the record and stop counting. Nothing in this app
     is deleted, so "wrong entry" is a state rather than an erasure. */
  const extraHours = (project.extraLabour || [])
    .filter((l) => !l.void)
    .reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const boardHours = (measuredMinutes + estimatedMinutes) / 60;

  /* The third and weakest tier: days the project was live that the board
     has no job row for. Reported apart from measured and estimated hours
     everywhere it is used, because a margin resting on it is an
     illustration and not a result. A total the sheet itself carries wins
     over inference — which is the upgrade path for the tab's broken
     "Total Elapsed time" column. */
  const projectCrewSize = Math.max(1, (project.crew || []).length);
  const shiftHours = Number(r.shiftHours) || 9;
  const covered = new Set((linkedJobs || [])
    .map((j) => j._date || j.scheduledDate).filter(Boolean));
  const spanDates = projectSpanDates(project, r.today);

  /* -------------------------------------------------------------------- *
   * A day a card was OPEN is not a day it was worked.
   *
   * Counting the whole span as labour read AED 42,125 across nine cards —
   * about half the department's entire monthly capacity, on cards mostly
   * carrying one technician. The worst of it was a snag card open from 8
   * July to 21 August: 45 days, one man, 405 hours. It was open for 45
   * days. Nobody worked it for 45 days.
   *
   * So a day only counts when the board itself has nothing else for that
   * person — which is the actual question being asked. "Khaled looked idle
   * on the 3rd but was on Damac 4301" is a claim about a day with no other
   * job on it, and that is exactly the day this counts. Two conditions,
   * both from data already loaded:
   *
   *   The board must have a schedule for that day at all. No schedule
   *   means no evidence anybody was idle, not evidence that they were —
   *   which is what turned an empty July into 24 invented days.
   *
   *   The person must not appear on any job that day, anywhere on the
   *   board. Not merely no job linked to THIS project: a technician on
   *   another building that morning was not on this card.
   *
   * `busyByDate` is a Map of date -> Set of canonical names, supplied by
   * the Projects view. Without it this falls back to the whole span, which
   * is the cruder reading and is only right when nothing is known about
   * the days.
   *
   * ponytail: "no job that day" still counts somebody who was on annual
   * leave, since the roster is not read here — the day's roster lives at
   * `roster:<date>` and this view only loads schedules. It over-counts by
   * whatever leave a project crew took mid-project. If that starts
   * mattering, load the rosters for the span and drop anyone the roster
   * puts in `unavailable`; the check already exists as rosterSummary().
   * -------------------------------------------------------------------- */
  const busy = r.busyByDate instanceof Map ? r.busyByDate : null;
  const crew = (project.crew || []);
  const inferredDates = [];
  let inferredPersonDays = 0;

  spanDates.forEach((d) => {
    if (covered.has(d)) return;                 // this card's own job row
    if (busy) {
      if (!busy.has(d)) return;                 // no schedule: no evidence
      const onDuty = busy.get(d);
      const free = crew.filter((n) => !onDuty.has(canonKey(n)));
      if (!free.length) return;                 // all of them were elsewhere
      inferredDates.push(d);
      inferredPersonDays += free.length;
      return;
    }
    inferredDates.push(d);
    inferredPersonDays += projectCrewSize;
  });

  const sheetHours = project.sheetMinutes != null ? project.sheetMinutes / 60 : null;
  const inferredHours = sheetHours != null
    ? Math.max(0, sheetHours - boardHours - extraHours)
    : inferredPersonDays * shiftHours;

  const labourHours = boardHours + extraHours + inferredHours;
  const labourCost = labourHours * hourly;

  const materialCost = (project.materials || [])
    .filter((m) => !m.void)
    .reduce((s, m) => s + (Number(m.total) || 0), 0);
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
    /* Hours nobody measured or estimated — read off the project's own span.
       Named separately so no caller can add it in by accident. */
    inferredHours: Math.round(inferredHours * 10) / 10,
    inferredDays: sheetHours != null ? 0 : inferredDates.length,
    inferredPersonDays: sheetHours != null ? 0 : inferredPersonDays,
    inferredFrom: sheetHours != null ? "sheet"
      : !inferredDates.length ? ""
      : busy ? "unbooked" : "span",
    crewSize: projectCrewSize, shiftHours, spanDays: spanDates.length,
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
    /* True when most of the labour on this card was never recorded at all.
       The card and the dashboard both have to say so out loud. */
    labourIsInferred: inferredHours > (boardHours + extraHours),
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

/* ---------------------------------------------------------------------- *
 * Finding the projects that were already there.
 *
 * The Projects tab only ever showed projects somebody typed into it, so it
 * was empty — while the projects themselves sat in the schedule all along,
 * written into the task description with the quotation number:
 *
 *   "ONB - Approved - Quotation - REV 01 - PC-2026-08-17 - Duct Cleaning"
 *   "Contin  Approved - Quotation - PC-2026-08-23 - Maintenance work"
 *
 * That reference is the project's identity, and the department has been
 * writing it faithfully for a month: over the real workbook it picks out
 * eight quotations across fifteen job rows, including one that ran three
 * separate days on the same unit. Asking a coordinator to re-enter what
 * they have already typed is how the double-entry problem started, so the
 * app reads it instead.
 *
 * Spelling is not assumed to be careful. "Approevd" is in the real data,
 * "Quotation -PC-" runs the words together, and one reference is written
 * "REV 01 - PC-…". A parser that only handled the tidy form would silently
 * drop those, which is worse than not parsing at all — a missing project
 * looks the same as a project that never existed.
 * ---------------------------------------------------------------------- */

/* Written loosely on purpose: optional space or dash between PC and the
   date, and the date's own separators may be dashes or spaces. */
const REF_RE = /\bP\s?C\s*[-–—\s]\s*(20\d\d)\s*[-–—\s]\s*(\d{1,2})\s*[-–—\s]\s*(\d{1,2})\b/i;

export function readQuotationRef(text) {
  const m = squash(text).match(REF_RE);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `PC-${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const REV_RE = /\bREV\.?\s*0*(\d+)\b/i;

/** "REV 01 - PC-2026-08-09" and "REV01 - PC-2026-08-07" are both revision 1. */
export function readRevision(text) {
  const m = squash(text).match(REV_RE);
  return m ? Number(m[1]) : null;
}
/* "Approevd" is not a typo worth correcting in the source data — it is one
   worth tolerating here. */
const APPROVED_RE = /\bappro(?:ved|evd|ved|ced|ved)\b|\bapproevd\b|\bapprvoed\b/i;
const ONB_RE = /\bONB\b|\bon\s?boarding\b/i;
const CONTIN_RE = /\bcontin(?:ue|ued|uation|uing)?\b/i;
const QUOTE_WORD_RE = /\bquotations?\b/i;
const SNAG_RE = /\bsnag\b/i;

/** Does this daily job look like part of a quoted or onboarding project? */
export function projectMarkers(job) {
  const text = squash(`${job.description || ""} ${job.notes || ""} ${job.materialDetails || ""}`);
  const ref = readQuotationRef(text) || squash(job.quotationRef).toUpperCase();
  const rev = (text.match(REV_RE) || [])[1];
  return {
    ref,
    revision: rev ? Number(rev) : null,
    onboarding: ONB_RE.test(text),
    approved: APPROVED_RE.test(text),
    quoted: QUOTE_WORD_RE.test(text),
    snag: SNAG_RE.test(text),
    continuation: CONTIN_RE.test(text),
    // A reference is proof. Without one, the words have to carry it, and
    // "approved" alone is too common in ordinary tasks to count.
    isProject: !!ref || ONB_RE.test(text) ||
      (QUOTE_WORD_RE.test(text) && APPROVED_RE.test(text)),
  };
}

/* Strip the bookkeeping and leave the work. "Contin Approved - Quotation -
   PC-2026-08-23 - Maintenance work" is a project called "Maintenance
   work"; everything before it is filing. */
export function projectTitleFrom(description) {
  let s = squash(description)
    .replace(REF_RE, " ")
    .replace(REV_RE, " ")
    .replace(CONTIN_RE, " ")
    .replace(APPROVED_RE, " ")
    .replace(QUOTE_WORD_RE, " ")
    .replace(/\bONB\b/gi, " ")
    .replace(/[-–—]+/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .trim();
  // What is left of "Approved - Quotation - PC-… " is nothing at all.
  if (!s || s.length < 3) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const projectType = (m) => (m.onboarding ? "onboarding" : m.snag ? "snag" : "quoted-existing");

/**
 * Group every project-looking job in the range into the projects they
 * belong to.
 *
 * Grouped by quotation reference where there is one, because that is what
 * the department uses as the identity — the same reference on three
 * different days is one project that ran for three days, which is exactly
 * the thing that could not be seen before. Jobs with no reference fall
 * back to property + unit, which is right for onboarding work: a unit is
 * onboarded once.
 *
 * `jobs` are daily jobs carrying a `_date`.
 */
export function discoverProjects(jobs) {
  const groups = new Map();

  (jobs || []).forEach((j) => {
    if (!j || j._tomb) return;
    const m = projectMarkers(j);
    if (!m.isProject) return;

    const key = m.ref || `unit:${canonKey(j.property)}|${canonKey(j.unit)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ref: m.ref,
        revision: m.revision,
        type: projectType(m),
        property: j.property,
        unit: j.unit,
        title: "",
        jobs: [],
        units: new Set(),
        crew: new Set(),
        dates: new Set(),
        approved: false,
        continued: false,
      });
    }
    const g = groups.get(key);
    g.jobs.push(j);
    g.dates.add(j._date || j.scheduledDate);
    g.units.add(`${squash(j.property)} ${squash(j.unit)}`.trim());
    splitCrew(j.team).forEach((p) => g.crew.add(p));
    g.approved = g.approved || m.approved;
    g.continued = g.continued || m.continuation;
    if (m.revision != null) g.revision = Math.max(g.revision || 0, m.revision);
    if (!g.title) g.title = projectTitleFrom(j.description);
    if (m.onboarding && g.type !== "snag") g.type = "onboarding";
  });

  /* A unit's first project row often predates the quotation being written
     up — "Onboarding project" on the 20th, then "ONB - Approved -
     Quotation - REV 01 - PC-2026-08-17 - Duct Cleaning" on the 23rd, both
     Azizi Riviera 10 701. Left alone those read as two projects on one
     unit, which is the same fragmentation this is meant to end. A
     reference-less group is folded into the referenced project for the
     same unit, nearest in time when there is more than one. */
  const unitKey = (g) => `${canonKey(g.property)}|${canonKey(g.unit)}`;
  const referenced = Array.from(groups.values()).filter((g) => g.ref);
  Array.from(groups.values()).forEach((g) => {
    if (g.ref) return;
    const mine = referenced.filter((r) => unitKey(r) === unitKey(g));
    if (!mine.length) return;
    const at = Array.from(g.dates).sort()[0] || "";
    const gap = (r) => Math.min(...Array.from(r.dates).map(
      (d) => Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${at}T00:00:00Z`))));
    const host = mine.slice().sort((a, b) => gap(a) - gap(b))[0];
    g.jobs.forEach((j) => host.jobs.push(j));
    g.dates.forEach((d) => host.dates.add(d));
    g.units.forEach((u) => host.units.add(u));
    g.crew.forEach((c) => host.crew.add(c));
    if (host.type !== "snag" && g.type === "onboarding") host.type = "onboarding";
    host.absorbed = (host.absorbed || 0) + g.jobs.length;
    groups.delete(g.key);
  });

  return Array.from(groups.values())
    .map((g) => {
      const dates = Array.from(g.dates).filter(Boolean).sort();
      const firstDate = dates[0] || "";
      const lastDate = dates[dates.length - 1] || "";
      return {
        ...g,
        units: Array.from(g.units),
        crew: Array.from(g.crew),
        dates,
        firstDate,
        lastDate,
        days: dates.length,
        spanDays: firstDate && lastDate
          ? Math.round((Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86400000) + 1
          : dates.length,
        title: g.title || (g.type === "onboarding" ? "Onboarding" : "Quoted work"),
        jobIds: g.jobs.map((j) => j.id),
      };
    })
    .sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
}

/**
 * Work marked approved with no quotation reference and no onboarding word.
 *
 * "Approved - Water heater replacement - Collect from shop" is either a
 * quoted job whose reference nobody wrote down, or a guest approving an
 * ordinary repair. Nothing in the text decides it, so nothing here guesses:
 * they are listed separately as candidates rather than counted as projects.
 * Quietly promoting them would put unquoted work into a margin calculation;
 * quietly dropping them would recreate the disappearance this whole exercise
 * is about.
 */
export function candidateProjects(jobs, found) {
  const taken = new Set((found || []).flatMap((f) => f.jobIds || []));
  return (jobs || [])
    .filter((j) => j && !j._tomb && !taken.has(j.id))
    .filter((j) => {
      const t = squash(`${j.description || ""} ${j.notes || ""}`);
      return APPROVED_RE.test(t) && !readQuotationRef(t) && !ONB_RE.test(t);
    })
    .map((j) => ({
      id: j.id,
      date: j._date || j.scheduledDate,
      property: j.property,
      unit: j.unit,
      description: j.description,
      team: j.team,
      estimatedTime: j.estimatedTime,
    }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/* ---------------------------------------------------------------------- *
 * Bringing a job card in, and bringing it in again.
 *
 * The Job Cards tab is a living sheet: a card goes in as "In Progress"
 * with an estimated completion, and days later somebody sets the status to
 * Completed and fills the actual date. Pasting it a second time has to
 * carry that forward, or the answer to "which of these is still open" goes
 * stale and the tab stops being worth opening.
 *
 * So a re-paste UPDATES, with two rules that make it safe:
 *
 *   The sheet owns the schedule — status, dates, crew, scope, the
 *   quotation reference. It does not own the money. The approved amount,
 *   the priced material lines, the quotation link and anything typed into
 *   the app are never touched by a paste, because those are the fields
 *   only a person can supply and re-typing them is what this app exists
 *   to stop.
 *
 *   A blank cell never erases a recorded value. An empty Actual Completion
 *   column means "not filled in", not "it never completed", and the
 *   difference has already cost this department a month of history.
 *
 * What changed is written to the project's own event log, so a figure that
 * moves can be traced to the paste that moved it.
 * ---------------------------------------------------------------------- */

/* Fields the sheet is allowed to set. Money is deliberately absent. */
export const CARD_OWNED = [
  "property", "unit",
  "title", "type", "status", "quotationRef", "revision",
  "startDate", "targetDate", "actualCompletionDate",
  "crew", "scope", "materialsWanted", "sheetMinutes",
];

const blankish = (v) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** A project as the card describes it. Used for a row that is new. */
export function projectFromCard(draft, by) {
  const fields = {};
  CARD_OWNED.forEach((f) => { if (!blankish(draft[f])) fields[f] = draft[f]; });
  return newProject({
    ...fields,
    notes: squash(draft.notes),
    events: [makeEvent("created", by, { from: "job-cards tab" })],
  }, by);
}

/**
 * Merge a card over a project that is already here.
 * Returns the project and the list of fields the paste actually moved, so
 * the dialog can say "3 will be updated" rather than claiming all of them.
 */
export function updateFromCard(project, draft, by) {
  const changed = [];
  const next = { ...project };

  CARD_OWNED.forEach((f) => {
    const now = draft[f];
    if (blankish(now)) return;               // a blank cell never erases
    const was = project[f];
    const same = Array.isArray(now)
      ? JSON.stringify(was || []) === JSON.stringify(now)
      : String(was == null ? "" : was) === String(now);
    if (same) return;
    changed.push(f);
    next[f] = now;
  });

  if (!changed.length) return { project, changed: [] };
  next.events = [...(project.events || []),
                 makeEvent("edited", by, { from: "job-cards tab", fields: changed })];
  return { project: next, changed };
}

/** Turn a discovered project into a real one, keeping everything found. */
export function adoptProject(found, by) {
  return newProject({
    status: found.lastDate && found.lastDate < new Date().toISOString().slice(0, 10)
      ? "completed" : "in_progress",
    type: found.type,
    property: found.property,
    unit: found.unit,
    title: found.title,
    quotationRef: found.ref || "",
    startDate: found.firstDate || "",
    actualCompletionDate: "",
    linkedJobIds: found.jobIds || [],
    notes: found.ref
      ? `Found in the schedule: ${found.days} day(s) of work booked against ${found.ref}.`
      : `Found in the schedule: ${found.days} day(s) of onboarding work.`,
  }, by);
}
