/* ---------------------------------------------------------------------- *
 * backlog.js — the queue the schedule is built FROM, and the rule that
 * decides which day something goes on.
 *
 * Asked what they do when an issue is logged in PMS, a coordinator says
 * they assess it and schedule it for a future day, or the same day if
 * possible. That is an honest description of a decision with no stated
 * basis, and it shows: 189 maintenance issues sit in the queue, the oldest
 * reported four months ago, several with due dates that passed in early
 * August.
 *
 * The information needed to decide is already there and is not being used.
 * Every issue carries a priority, a reported date, a due date, and — the
 * one that matters most — the unit's occupancy: "Vacant", or "Occupied
 * until 2026-09-08 11:00". A unit that empties on the 8th is a three-hour
 * job's best day of the month, and nothing today points that out.
 *
 * So this module states the rule, applies it, and shows its working. It
 * does not schedule anything by itself. The coordinator can take the
 * recommended day or overrule it; what changes is that overruling is now a
 * visible choice with a reason, instead of the only thing that ever
 * happened.
 *
 *   1. WHEN CAN WE GET IN?      access window — a hard constraint
 *   2. WHEN MUST IT BE DONE BY? deadline — the other hard constraint
 *   3. DO THEY OVERLAP?         if not, escalate; do not quietly defer
 *   4. WHICH DAY INSIDE IT?     vacancy first, then earliest with room,
 *                               then the building already being visited
 * ---------------------------------------------------------------------- */

import { squash, canonKey, canonPriority, toISODate, splitTrailingUnit, parseDurationMinutes } from "./normalize.js";
import { uid, makeEvent } from "./job.js";

const DAY = 86400000;
export const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/* ------------------------------ occupancy ----------------------------- *
 * Both sources say the same thing in different words. PMS writes
 * "Occupied until 2026-09-08 11:00:00"; the workbook's Status column uses
 * the department's own shorthand — Vacant, Occupied, Occupied - GC,
 * Checkout, B2B, Check-in, WC.
 *
 * GC is a guest who has agreed a time: those tasks are titled "GC 2-4pm -
 * Clogged Sink". WC is read here as a guest who has NOT — the workbook's
 * Time of Visit column says "Not Confirmed" on 94 rows, and treating an
 * unconfirmed visit as confirmed sends a technician to a door nobody
 * opens. If WC means something else in the department, it is one line to
 * change and the rule below is unaffected.
 * -------------------------------------------------------------------- */
export const OCCUPANCY = {
  vacant:   { label: "Vacant",                    canEnter: true,  needsGuest: false },
  checkout: { label: "Guest checks out that day", canEnter: true,  needsGuest: false },
  b2b:      { label: "Back-to-back changeover",   canEnter: true,  needsGuest: false },
  checkin:  { label: "Guest arrives that day",    canEnter: true,  needsGuest: false },
  confirmed:{ label: "Occupied — time agreed",    canEnter: true,  needsGuest: false },
  occupied: { label: "Occupied — no time agreed", canEnter: false, needsGuest: true },
  unknown:  { label: "Not recorded",              canEnter: false, needsGuest: true },
};

/** "Occupied until 2026-09-08 11:00:00" -> { state:"occupied", until:"2026-09-08" } */
export function parseOccupancy(raw) {
  const s = squash(raw);
  if (!s) return { state: "unknown", until: null, raw: "" };
  const k = canonKey(s);

  const m = s.match(/until\s+(\d{4}-\d{2}-\d{2})/i) || s.match(/until\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  const until = m ? toISODate(m[1]) : null;

  if (/vacant|empty/.test(k)) return { state: "vacant", until: null, raw: s };
  if (/onboard/.test(k)) return { state: "vacant", until: null, raw: s };
  if (/b2b|back.?to.?back/.test(k)) return { state: "b2b", until, raw: s };
  if (/check.?out/.test(k)) return { state: "checkout", until, raw: s };
  if (/check.?in/.test(k)) return { state: "checkin", until, raw: s };
  // "Occupied - GC" is a guest who has agreed a time.
  if (/\bgc\b/.test(k) && /occupied/.test(k)) return { state: "confirmed", until, raw: s };
  if (/^wc\b|\bwc$/.test(k)) return { state: "occupied", until, raw: s };
  if (/occupied|guest/.test(k)) return { state: "occupied", until, raw: s };
  return { state: "unknown", until, raw: s };
}

/* ------------------------------- deadline ----------------------------- *
 * A due date is used when PMS carries one. Where it does not, the deadline
 * is the reported date plus the response time the priority implies. These
 * are the department's own bands, written down for the first time — every
 * one of them is a number somebody can argue with, which is the point.
 * -------------------------------------------------------------------- */
export const SLA_DAYS = { "PRI-1": 0, "PRI-2": 3, "PRI-3": 7, "PRI-4": 14 };
export const SLA_LABEL = {
  "PRI-1": "same day", "PRI-2": "within 3 days",
  "PRI-3": "within 7 days", "PRI-4": "within 14 days",
};

export function deadlineFor(item) {
  const pri = canonPriority(item.priority) || "PRI-3";
  const sla = SLA_DAYS[pri] ?? 7;
  const fromReport = item.reportedOn ? addDays(item.reportedOn, sla) : null;
  const due = item.dueDate || null;
  if (due && fromReport) return due < fromReport ? due : fromReport;
  return due || fromReport;
}

/* --------------------------- does it need the unit empty? ------------- *
 * A twenty-minute bulb change happens around a guest. Duct cleaning, a
 * repaint, or anything with the water off does not — and booking that into
 * an occupied unit is how a job burns a slot and comes back unfinished.
 * -------------------------------------------------------------------- */
/* Written with open ends on purpose: the real text says "Duct Cleaning",
   "Painting works", "Polishing work". A trailing \b after "clean" fails on
   "Cleaning", and the failure is the expensive direction — it books heavy
   work into an occupied unit. */
const NEEDS_EMPTY_RE = new RegExp(
  "\\b(" + [
    "duct clean", "deep clean", "repaint", "full paint", "paint",
    "putty", "polish", "grout", "silicon", "tiling", "tile work",
    "water tank", "shut ?off", "riser", "drill", "core cut",
    "ceiling (?:fix|open|access|paint)", "snag", "hand ?over",
    "onboard", "ppm", "full service", "major replenish",
  ].join("|") + ")", "i");

export function needsEmptyUnit(item) {
  const text = squash(`${item.description || ""} ${item.scope || ""}`);
  if (NEEDS_EMPTY_RE.test(text)) return true;
  const mins = parseDurationMinutes(item.estimatedTime);
  return mins != null && mins >= 180;
}

/* ---------------------------- the access window ----------------------- */
export function accessWindow(item, today) {
  const occ = parseOccupancy(item.occupancy || item.status);
  const heavy = needsEmptyUnit(item);

  if (occ.state === "vacant") {
    return { from: today, to: null, occ, heavy,
      note: "Unit is empty — no guest to ask and no access risk." };
  }
  if (occ.state === "checkout" || occ.state === "b2b") {
    const d = occ.until || today;
    return { from: d, to: d, occ, heavy,
      note: occ.state === "b2b"
        ? "Changeover day — the gap is hours wide, not a day."
        : "Checkout day — the unit empties and the window opens." };
  }
  if (occ.state === "confirmed") {
    return { from: today, to: null, occ, heavy,
      note: "Guest has agreed a time — keep to it." };
  }
  if (occ.state === "occupied") {
    if (occ.until && heavy) {
      return { from: occ.until, to: null, occ, heavy,
        note: `Needs the unit empty, and the guest is in until ${occ.until}. That checkout is the first clean day.` };
    }
    if (occ.until) {
      return { from: today, to: null, occ, heavy, needsAppointment: true,
        note: `Guest is in until ${occ.until}. Light enough to do around them, but only with an agreed time.` };
    }
    return { from: today, to: null, occ, heavy, needsAppointment: true,
      note: "Occupied with no end date recorded — nothing can be planned until a time is agreed." };
  }
  return { from: today, to: null, occ, heavy, unknown: true,
    note: "Occupancy not recorded, so the access risk is unknown. Check before booking." };
}

/* ------------------------------ the rule ------------------------------ *
 * Returns the day, and the working. `why` is not decoration: a coordinator
 * who cannot see why will go back to picking a day out of the air, and a
 * manager reading the board a month later needs the reason to have been
 * recorded at the time.
 * -------------------------------------------------------------------- */
export const BASIS = {
  vacancy:     "The unit is empty on that day",
  checkout:    "The guest checks out that day",
  appointment: "The guest agreed that time",
  urgent:      "P1 — goes today",
  deadline:    "Last day inside the response time",
  earliest:    "Earliest day the access window allows",
  batched:     "Already going to that building that day",
  overdueNow:  "Already past due — first day we can get in",
  conflict:    "No day satisfies both the deadline and the access window",
  blocked:     "Cannot be planned yet",
};

export function recommendDay(item, ctx = {}) {
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const horizon = ctx.horizon || 21;
  const win = accessWindow(item, today);
  const deadline = deadlineFor(item);
  const pri = canonPriority(item.priority) || "PRI-3";
  const why = [];
  const overdue = deadline && deadline < today;

  why.push(`${win.occ.raw ? `${win.occ.raw} — ` : ""}${win.note}`);
  if (deadline) {
    why.push(overdue
      ? `Due ${deadline} — that was ${daysBetween(deadline, today)} day(s) ago.`
      : `Due ${deadline} (${SLA_LABEL[pri] || "no band"}).`);
  } else {
    why.push("No due date and no reported date, so there is no deadline to work back from.");
  }

  // Nothing can be planned against a guest nobody has spoken to.
  if (win.needsAppointment && !ctx.appointmentAgreed) {
    return {
      date: null, basis: "blocked", blocked: true, overdue, deadline, window: win, priority: pri,
      why: [...why, "Ask the guest for a time first. Booking it blind is what fills the day with doors nobody opens."],
      action: "Agree a time with the guest",
    };
  }

  /* Step 3. The access window opens after the deadline has passed. This is
     the case the queue is full of — a PPM due in July in a unit whose guest
     leaves in late September — and the only wrong answer is to let it sit.
     It is surfaced as a decision with two ways out rather than a date. */
  const firstPossible = win.from > today ? win.from : today;

  /* Two different failures look alike and must not be reported alike.
     A unit we can enter today whose deadline has passed is simply late:
     the answer is today. A unit we cannot enter until after the deadline
     is a conflict with no right answer — a PPM due in July in a unit whose
     guest leaves in late September — and it is the one the queue silently
     fills up with. */
  if (deadline && firstPossible > today && firstPossible > deadline) {
    return {
      date: firstPossible, basis: "conflict", conflict: true, overdue, deadline,
      window: win, priority: pri,
      why: [...why,
        `The unit cannot be entered before ${firstPossible}, which is after the deadline. No day satisfies both.`,
        "Either agree a time with the guest inside the deadline, or accept that it slips and record why — what it must not do is keep waiting."],
      action: overdue ? "Already breached — decide now" : "Will breach — decide now",
    };
  }
  if (overdue && firstPossible <= today) {
    return {
      date: today, basis: "overdueNow", overdue, deadline, window: win, priority: pri,
      why: [...why, "Nothing is stopping this one — the unit is reachable today and it is already late."],
      action: "Book it today",
    };
  }

  const start = firstPossible;
  const days = [];
  for (let i = 0; i <= horizon; i++) {
    const d = addDays(start, i);
    if (win.to && d > win.to) break;
    days.push(d);
  }
  if (!days.length) days.push(start);

  const vacantDays = new Set(ctx.vacantDays || []);
  const buildingDays = new Set(ctx.buildingDays || []);
  const roomOn = ctx.roomOn || (() => true);

  // P1 does not wait for a tidy window.
  if (pri === "PRI-1") {
    return { date: days[0], basis: "urgent", overdue, deadline, window: win, priority: pri,
      why: [...why, "A P1 is booked for the first day access allows, whatever else is on."] };
  }

  const inDeadline = (d) => !deadline || d <= deadline || overdue;

  // A checkout or vacancy inside the window beats everything else: no guest
  // to ask, no access risk, and the unit is free for as long as it takes.
  /* A checkout the window is waiting on counts the same as one written in
     the occupancy column: the day the guest leaves is the day the unit is
     free, however the source phrased it. */
  const checkoutDay = win.occ.state === "checkout" ? win.from
    : (win.occ.until && win.from === win.occ.until ? win.occ.until : null);
  // A unit that is empty now is empty on every day in the window, which the
  // caller's calendar of known vacancies does not have to be told.
  const emptyNow = win.occ.state === "vacant";
  const clean = days.find((d) =>
    (emptyNow || vacantDays.has(d) || d === checkoutDay) && inDeadline(d) && roomOn(d));
  if (clean) {
    return { date: clean, basis: clean === checkoutDay ? "checkout" : "vacancy",
      overdue, deadline, window: win, priority: pri,
      why: [...why, clean === checkoutDay
        ? "Booked for the changeover — the unit is empty and no guest has to be asked."
        : "Booked into the empty window — the cheapest access this job will ever get."] };
  }

  const withRoom = days.find((d) => inDeadline(d) && roomOn(d));
  const chosen = withRoom || days[0];

  const batched = buildingDays.has(chosen);
  const atDeadline = deadline && chosen === deadline;

  return {
    date: chosen,
    basis: batched ? "batched" : atDeadline ? "deadline" : "earliest",
    overdue, deadline, window: win, priority: pri,
    why: [
      ...why,
      batched
        ? "The crew is already in that building that day, so this rides along."
        : withRoom
          ? "First day inside the window with room left in the shift."
          : "Nothing inside the window has room — this is the earliest day it could go, and the day is already full.",
    ],
    tight: !withRoom,
  };
}

/* ------------------------- reading the PMS queue ---------------------- *
 * Pasted straight out of the Issues screen. Column order changes between
 * views and between people, so headers are matched by name rather than
 * position, the same way the workbook importer works.
 * -------------------------------------------------------------------- */
const FIELDS = [
  ["description", ["description", "issue", "task", "title"]],
  ["priority",    ["priority"]],
  ["status",      ["status"]],
  ["dueDate",     ["due date", "due"]],
  ["department",  ["department"]],
  ["property",    ["property", "unit", "building"]],
  ["occupancy",   ["occupancy", "unit status"]],
  ["reportedBy",  ["reported by", "raised by"]],
  ["reportedOn",  ["reported on", "reported date", "created on", "created"]],
  ["pmsRef",      ["ticket", "task ref", "pms ref", "reference"]],
];

/* Exact matches are taken before prefix matches, across the whole header
   row. Prefix-first gets "Reported by" and "Reported on" the wrong way
   round — whichever field is tested first claims both — and the failure is
   silent: the queue simply reports that nothing has a reported date. */
const headerIndex = (cells) => {
  const keys = cells.map((c) => canonKey(c).replace(/[^a-z ]/g, "").trim());
  const idx = {};
  const claim = (field, i) => { if (idx[field] === undefined) idx[field] = i; };
  FIELDS.forEach(([field, names]) => {
    keys.forEach((k, i) => { if (k && names.includes(k)) claim(field, i); });
  });
  const taken = new Set(Object.values(idx));
  FIELDS.forEach(([field, names]) => {
    if (idx[field] !== undefined) return;
    keys.forEach((k, i) => {
      if (!k || taken.has(i)) return;
      if (names.some((n) => k.startsWith(n))) { claim(field, i); taken.add(i); }
    });
  });
  return idx;
};

/* "4 months ago" / "a month ago" / "3 days ago" — the Issues screen shows
   age, not dates, and the age is the part that matters here. */
export function parseRelativeDate(raw, today) {
  const s = canonKey(raw);
  if (!s) return null;
  const iso = toISODate(raw);
  if (iso) return iso;
  const m = s.match(/^(a|an|\d+)\s*(day|week|month|year)s?\s*ago$/);
  if (!m) return null;
  const n = m[1] === "a" || m[1] === "an" ? 1 : Number(m[1]);
  const per = { day: 1, week: 7, month: 30, year: 365 }[m[2]];
  return addDays(today, -n * per);
}

export function parseIssuePaste(text, today) {
  const day = today || new Date().toISOString().slice(0, 10);
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { items: [], skipped: 0, error: "Nothing pasted." };

  const split = (l) => (l.includes("\t") ? l.split("\t") : l.split(/\s*\|\s*/));
  let idx = null, start = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const cand = headerIndex(split(lines[i]));
    if (cand.description !== undefined && (cand.property !== undefined || cand.priority !== undefined)) {
      idx = cand; start = i + 1; break;
    }
  }
  if (!idx) {
    return { items: [], skipped: lines.length,
      error: "Could not find the header row. Copy the table including its headings — Description, Priority, Status, Due date, Property, Occupancy, Reported on." };
  }

  const items = [];
  let skipped = 0;
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]).map((c) => squash(c));
    const get = (f) => (idx[f] !== undefined ? cells[idx[f]] || "" : "");
    const description = get("description");
    const propertyRaw = get("property");
    if (!description && !propertyRaw) { skipped++; continue; }
    const place = splitTrailingUnit(propertyRaw, "");
    items.push({
      id: uid(),
      description,
      property: place.property,
      unit: place.unit,
      priority: canonPriority(get("priority")) || "",
      pmsStatus: get("status"),
      dueDate: toISODate(get("dueDate")) || "",
      department: get("department"),
      occupancy: get("occupancy"),
      reportedBy: get("reportedBy"),
      reportedOn: parseRelativeDate(get("reportedOn"), day) || "",
      reportedOnRaw: get("reportedOn"),
      pmsRef: get("pmsRef"),
      addedAt: Date.now(),
      scheduledFor: "",
      scheduledJobId: "",
      events: [makeEvent("queued", "import")],
    });
  }
  return { items, skipped, error: "" };
}

/* Items already on the board, so a queue that is pasted twice does not
   double up and something already scheduled drops out of the queue. */
export function dedupe(existing, incoming) {
  const seen = new Set((existing || []).map((i) =>
    `${canonKey(i.property)}|${canonKey(i.unit)}|${canonKey(i.description).slice(0, 40)}`));
  const fresh = [], dupes = [];
  (incoming || []).forEach((i) => {
    const k = `${canonKey(i.property)}|${canonKey(i.unit)}|${canonKey(i.description).slice(0, 40)}`;
    if (seen.has(k)) { dupes.push(i); return; }
    seen.add(k);
    fresh.push(i);
  });
  return { fresh, dupes };
}

/* ------------------------------- triage ------------------------------- *
 * Order the queue the way it should be worked: what has already breached
 * first, then what is closest to breaching, with anything blocked on a
 * guest surfaced rather than buried — those are the ones that quietly rot.
 * -------------------------------------------------------------------- */
export function triage(items, ctx = {}) {
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const rows = (items || [])
    .filter((i) => !i.scheduledFor)
    .map((i) => ({ item: i, rec: recommendDay(i, { ...ctx, today }) }));

  const rank = (r) => {
    if (r.rec.overdue) return 0;
    if (r.rec.priority === "PRI-1") return 1;
    if (r.rec.blocked) return 2;
    return 3;
  };
  rows.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    const ad = a.rec.deadline || "9999-99-99";
    const bd = b.rec.deadline || "9999-99-99";
    return ad.localeCompare(bd);
  });
  return rows;
}

export function backlogSummary(items, ctx = {}) {
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const open = (items || []).filter((i) => !i.scheduledFor);
  const rows = open.map((i) => recommendDay(i, { ...ctx, today }));
  const ages = open
    .map((i) => (i.reportedOn ? daysBetween(i.reportedOn, today) : null))
    .filter((n) => n != null && n >= 0)
    .sort((a, b) => a - b);
  const mid = ages.length ? ages[Math.floor(ages.length / 2)] : null;

  return {
    open: open.length,
    scheduled: (items || []).length - open.length,
    overdue: rows.filter((r) => r.overdue).length,
    blocked: rows.filter((r) => r.blocked).length,
    p1: rows.filter((r) => r.priority === "PRI-1").length,
    medianAgeDays: mid,
    oldestDays: ages.length ? ages[ages.length - 1] : null,
    withDeadline: rows.filter((r) => r.deadline).length,
    vacantNow: rows.filter((r) => r.window.occ.state === "vacant").length,
    // The opportunity nobody is taking: heavy work waiting on a guest who
    // has a checkout date already in the system.
    checkoutWindows: rows.filter((r) => r.window.heavy && r.window.occ.until).length,
  };
}

/* ---------------------------------------------------------------------- *
 * Mirroring the PMS task list.
 *
 * The department's rule from today: every task created in PMS is also in
 * here, entered by the evening coordinator. That has to cost close to
 * nothing, because the coordinator has just finished creating those tasks
 * and is not going to key them a second time.
 *
 * They do not have to. The PMS task list is already a table on screen, and
 * it already carries everything the board needs — the title, the property,
 * the assignee, the due date, the priority, the status, and the TSK
 * reference that ties the two systems together for good. One copy, one
 * paste, the whole evening's work.
 *
 * PMS's own Subcategory is deliberately not treated as the classification.
 * Seven options across every trade cannot answer "why do we keep going
 * back to Palm Villa" — but the task title can, and the app infers a finer
 * family from it at no typing cost. The coarse value is kept alongside so
 * the two systems can still be reconciled.
 * -------------------------------------------------------------------- */
const TASK_FIELDS = [
  ["pmsRef",      ["number", "task", "task no", "task ref", "id"]],
  ["title",       ["title", "task summary", "summary", "description", "name"]],
  ["property",    ["property", "unit", "building", "location"]],
  ["subcategory", ["subcategory", "sub category", "sub-category"]],
  ["category",    ["category"]],
  ["priority",    ["priority"]],
  ["pmsStatus",   ["status"]],
  ["assignee",    ["assignees", "assignee", "assigned to", "technician", "team"]],
  ["dueDate",     ["due date", "due on", "due"]],
  ["duration",    ["duration", "estimated time", "est time"]],
  ["reservation", ["reservation", "res"]],
  ["occupancy",   ["occupancy", "unit status"]],
];

const taskHeaderIndex = (cells) => {
  const keys = cells.map((c) => canonKey(c).replace(/[^a-z ]/g, "").trim());
  const idx = {};
  const claim = (f, i) => { if (idx[f] === undefined) idx[f] = i; };
  TASK_FIELDS.forEach(([f, names]) => {
    keys.forEach((k, i) => { if (k && names.includes(k)) claim(f, i); });
  });
  const taken = new Set(Object.values(idx));
  TASK_FIELDS.forEach(([f, names]) => {
    if (idx[f] !== undefined) return;
    keys.forEach((k, i) => {
      if (!k || taken.has(i)) return;
      if (names.some((n) => k.startsWith(n))) { claim(f, i); taken.add(i); }
    });
  });
  return idx;
};

/* "2w 3d 4h 56m" is PMS's own duration format. */
export function parsePmsDuration(raw) {
  const s = canonKey(raw);
  if (!s) return "";
  const m = s.match(/(?:(\d+)\s*w)?\s*(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/);
  if (!m) return squash(raw);
  const mins = (+(m[1] || 0)) * 7 * 24 * 60 + (+(m[2] || 0)) * 24 * 60 +
               (+(m[3] || 0)) * 60 + (+(m[4] || 0));
  if (!mins) return squash(raw);
  if (mins < 60) return `${mins} mins`;
  const hrs = Math.floor(mins / 60), rem = mins % 60;
  return rem ? `${hrs} hr ${rem} mins` : `${hrs} hr`;
}

export function parseTaskPaste(text, forDate) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { jobs: [], skipped: 0, error: "Nothing pasted." };

  const split = (l) => (l.includes("\t") ? l.split("\t") : l.split(/\s*\|\s*/));
  let idx = null, start = 0;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const cand = taskHeaderIndex(split(lines[i]));
    if (cand.title !== undefined && (cand.property !== undefined || cand.pmsRef !== undefined)) {
      idx = cand; start = i + 1; break;
    }
  }
  if (!idx) {
    return { jobs: [], skipped: lines.length,
      error: "Could not find the header row. Copy the PMS task table including its headings — at minimum Title and Property." };
  }

  const jobs = [];
  let skipped = 0;
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]).map((c) => squash(c));
    const get = (f) => (idx[f] !== undefined ? cells[idx[f]] || "" : "");
    const title = get("title");
    const propRaw = get("property");
    if (!title && !propRaw) { skipped++; continue; }
    const place = splitTrailingUnit(propRaw, "");
    const pre = readTitlePrefix(title);
    jobs.push({
      _date: forDate,
      property: place.property,
      unit: place.unit,
      description: pre.rest,
      titleRaw: title,
      timeOfVisit: pre.timeOfVisit || "",
      guestConfirmed: pre.guestConfirmed || "",
      team: get("assignee"),
      priority: canonPriority(get("priority")) || "",
      estimatedTime: parsePmsDuration(get("duration")),
      status: get("occupancy") || pre.occupancy || "",
      pmsRef: get("pmsRef"),
      pmsStatus: get("pmsStatus"),
      pmsSubcategory: get("subcategory"),
      pmsCategory: get("category"),
      reservation: get("reservation"),
      dueDate: toISODate(get("dueDate")) || "",
      inPms: true,
      source: "pms-task",
    });
  }
  return { jobs, skipped, error: "" };
}

/* ---------------------------------------------------------------------- *
 * The prefix on a PMS task title.
 *
 * The department already encodes the two things the planner needs most in
 * the first few characters of the title, and nobody was reading them:
 *
 *   "GC 2-4pm - Clogged Sink GR B"        guest confirmed, 2pm to 4pm
 *   "GC 12.30 Pm - (Below unit tenant)"   guest confirmed, 12:30
 *   "vacant - Laundry room door is broken" unit empty
 *   "B2B- Paint touch up (P1-16)"         changeover day
 *   "checkin - None of the sockets are"   guest arrives that day
 *   "WC - Water leak from our unit"       occupied, no time agreed
 *
 * A confirmed appointment is the first thing the day is built around, and
 * it was sitting in plain text. Reading it here means the coordinator does
 * not type it a third time, and the plan honours times that were already
 * promised to guests.
 * -------------------------------------------------------------------- */
const PREFIX_TIME = /\b(\d{1,2}(?:[.:]\d{2})?\s*(?:-|to|–)\s*\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?|\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm))/i;

const PREFIX_CODE = /^(gc|wc|vacant|b2b|check.?in|check.?out|onb|contin|approved|approevd)\b/i;

export function readTitlePrefix(title) {
  const s = squash(title);
  if (!PREFIX_CODE.test(s)) return { rest: s };

  /* "GC 6 - 7 Pm - Cabinet hinges" contains two separators and the prefix
     is everything up to the second. Take the LAST split that still leaves a
     prefix short enough to be a code and a time, rather than the first. */
  let cut = -1;
  const re = /\s*[-–—]\s+|\s*[-–—]$/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > 22) break;
    cut = m.index;
  }
  if (cut < 0) return { rest: s };
  const head = s.slice(0, cut).trim();
  const rest = s.slice(cut).replace(/^\s*[-–—]\s*/, "").trim() || s;
  const k = canonKey(head);
  if (!k) return { rest: s };

  const time = (head.match(PREFIX_TIME) || [])[0];
  const out = { rest, prefix: head };

  if (/^gc\b/.test(k)) {
    out.occupancy = "Occupied - GC";
    out.guestConfirmed = "Y";
    if (time) out.timeOfVisit = squash(time);
    return out;
  }
  if (/^wc\b/.test(k)) { out.occupancy = "WC"; out.guestConfirmed = "N"; return out; }
  if (/^vacant\b/.test(k)) { out.occupancy = "Vacant"; return out; }
  if (/^b2b\b/.test(k)) { out.occupancy = "B2B"; return out; }
  if (/^check.?in\b/.test(k)) { out.occupancy = "Check-in"; return out; }
  if (/^check.?out\b/.test(k)) { out.occupancy = "Checkout"; return out; }
  if (/^onb\b|^contin\b|^approved|^approevd/.test(k)) { out.project = true; return out; }
  // An unrecognised prefix is left inside the description rather than lost.
  return { rest: s };
}
