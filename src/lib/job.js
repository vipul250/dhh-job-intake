/* ---------------------------------------------------------------------- *
 * job.js — a job is a THING WITH A LIFE, not a row on a day's list.
 *
 * This is the change everything else in the live board rests on.
 *
 * Today a schedule is a document. The evening coordinator writes it, the
 * morning coordinator replaces it, and whatever was on the old version is
 * simply gone — not moved, not cancelled, just absent, with nobody able to
 * say which. There is no bug to fix there: a list that gets overwritten
 * cannot tell you what used to be on it.
 *
 * So a job here has an id, a state, a date it is currently on, the date it
 * FIRST appeared on, and an append-only event log. Nothing is ever removed
 * silently:
 *
 *   - Moving a job to another day writes a TOMBSTONE on the day it left,
 *     naming where it went, who moved it and why. The day it left can
 *     therefore still show it.
 *   - Cancelling keeps the job on the day with a reason attached.
 *   - Both are events on the job's own log, so "this job has been pushed
 *     four times since the 18th" is a fact you can read off the card.
 *
 * That is the whole answer to "no one knows where the older job
 * disappeared". It is not a report you run afterwards; it is a property of
 * the data structure.
 * ---------------------------------------------------------------------- */

import {
  squash, canonKey, canonProperty, canonUnit, canonTech, splitCrew,
  parseDurationMinutes, canonPriority, occupancyClass, TECH_ALIASES,
  assetKey, daysBetween,
} from "./normalize.js";
import { faultFamily } from "./faultFamily.js";

/* ---------------------------------------------------------------------- *
 * Outcomes.
 *
 * "Done" was hiding three different things, and the difference is the
 * whole problem. A technician sent to a P1 water leak closes the valve,
 * writes what he needs to finish it properly — a water heater, paint for
 * the ceiling — and leaves. The leak has stopped. Nothing is fixed. Today
 * that lands in PMS comments and survives only if a coordinator happens to
 * read them, which is exactly how the follow-up disappears.
 *
 * So a visit ends in one of four ways, and two of them are not endings:
 *
 *   fixed      — nothing left to do
 *   made_safe  — contained, but it WILL come back without a return visit
 *   diagnosed  — looked at, needs a quote, a part, or a contractor
 *   not_done   — did not happen at all
 *
 * `made_safe` and `diagnosed` cannot be closed without naming what is
 * still needed and when. The app creates the follow-up itself and links
 * the two, so the chain from "valve closed" to "water heater replaced" is
 * a property of the data rather than a thing somebody has to remember.
 * -------------------------------------------------------------------- */
export const JOB_STATES = [
  "scheduled", "in_progress", "fixed", "made_safe", "diagnosed", "not_done", "cancelled",
];

/* A visit that happened, whatever came of it. Used everywhere a duration
   or a completion is counted. "done" is the pre-outcome spelling of
   "fixed" and is still read so older rows keep working. */
export const RESOLVED_STATES = ["fixed", "made_safe", "diagnosed", "done"];

/* Ended, but the work is not finished — these owe a follow-up. */
export const OPEN_OUTCOME_STATES = ["made_safe", "diagnosed"];

export const STATE_META = {
  scheduled:   { label: "Scheduled",    short: "Scheduled",  tone: "slate" },
  in_progress: { label: "In progress",  short: "Started",    tone: "blue" },
  fixed:       { label: "Fixed",        short: "Fixed",      tone: "emerald" },
  done:        { label: "Fixed",        short: "Fixed",      tone: "emerald" },
  made_safe:   { label: "Made safe",    short: "Made safe",  tone: "amber" },
  diagnosed:   { label: "Diagnosed",    short: "Diagnosed",  tone: "amber" },
  not_done:    { label: "Not done",     short: "Not done",   tone: "red" },
  cancelled:   { label: "Cancelled",    short: "Cancelled",  tone: "slate" },
};

export const OUTCOME_OPTIONS = [
  { id: "fixed",     label: "Fixed",      hint: "Nothing left to do on this one", needsFollowUp: false },
  { id: "made_safe", label: "Made safe",  hint: "Contained — valve closed, power isolated. It comes back without a return visit", needsFollowUp: true },
  { id: "diagnosed", label: "Diagnosed",  hint: "Looked at only — needs a part, a quote, or a contractor", needsFollowUp: true },
  { id: "not_done",  label: "Not done",   hint: "The visit did not happen", needsFollowUp: false },
];

export const needsFollowUp = (state) => OPEN_OUTCOME_STATES.includes(state);
export const isResolved = (state) => RESOLVED_STATES.includes(state);

/* ---------------------------------------------------------------------- *
 * Where the work came from.
 *
 * Nobody can judge what the field team is being asked to do while every
 * job looks the same on arrival. These are the routes described by the
 * department, plus the two the schedule has always contained without
 * admitting it: out-of-hours emergencies, and inspections used to fill an
 * idle technician's afternoon.
 * -------------------------------------------------------------------- */
export const JOB_SOURCES = [
  { id: "guest",     label: "Guest / support team",     hint: "Complaint raised by the guest or support, usually with an appointment" },
  { id: "hk",        label: "Housekeeping",             hint: "Found by HK while cleaning" },
  { id: "gro",       label: "GRO / field employee",     hint: "Spotted by our own people on site" },
  { id: "planned",   label: "Planned / PPM",            hint: "Scheduled maintenance, on a cycle" },
  { id: "followup",  label: "Follow-up",                hint: "Finishing work an earlier visit could not" },
  { id: "emergency", label: "Out-of-hours emergency",   hint: "Came in after the schedule was posted" },
  { id: "filler",    label: "Inspection — filling time", hint: "Used to fill an idle slot or hold a technician on standby" },
  { id: "project",   label: "Project / quoted work",    hint: "Part of an approved quotation" },
];

export const SOURCE_LABEL = Object.fromEntries(JOB_SOURCES.map((s) => [s.id, s.label]));

/* Work that arrived rather than being planned — the demand the department
   does not control. */
export const REACTIVE_SOURCES = ["guest", "hk", "gro", "emergency"];

export const HOW_REPORTED = [
  "Google Chat — maintenance group",
  "PMS task",
  "Phone call",
  "In person",
  "Email",
  "Other",
];

/* A state that means the job still needs somebody to do something about it.
   These are what roll over — and what the next coordinator must clear. */
export const OPEN_STATES = ["scheduled", "in_progress"];

export const NOT_DONE_REASONS = [
  "No access / guest refused",
  "Guest not reachable",
  "Material not available",
  "Ran out of time",
  "Needs contractor / out of scope",
  "Other",
];

/* `displaces: true` means something else took this job's place. Those are
   the coordinator's judgement calls — a decision to prefer one piece of
   work over another — and until now the app recorded only that the job
   moved, never what beat it. Without the other half you cannot ask whether
   the call was right, and "was the call right" is the whole point of
   watching a coordinator's decisions over time. */
export const MOVE_REASONS = [
  { id: "guest-complaint", label: "New guest complaint took the slot", displaces: true },
  { id: "new-appointment", label: "New appointment took the slot", displaces: true },
  { id: "emergency", label: "An emergency took the slot", displaces: true },
  { id: "project", label: "Project work took the slot", displaces: true },
  { id: "guest-resched", label: "Guest rescheduled", displaces: false },
  { id: "no-access", label: "No access today", displaces: false },
  { id: "material", label: "Material not ready", displaces: false },
  { id: "tech-unavailable", label: "Technician unavailable", displaces: false },
  { id: "out-of-time", label: "Ran out of time", displaces: false },
  { id: "other", label: "Other", displaces: false },
];

export const MOVE_REASON_LABEL = Object.fromEntries(MOVE_REASONS.map((r) => [r.id, r.label]));
export const moveReasonDisplaces = (id) =>
  !!(MOVE_REASONS.find((r) => r.id === id) || {}).displaces;

/* Legacy rows stored the label rather than the id. */
export function normaliseMoveReason(reason) {
  const r = squash(reason);
  if (!r) return "";
  const byId = MOVE_REASONS.find((x) => x.id === r);
  if (byId) return byId.id;
  const byLabel = MOVE_REASONS.find((x) => canonKey(x.label) === canonKey(r));
  return byLabel ? byLabel.id : r;
}

export const CANCEL_REASONS = [
  "Duplicate of another job",
  "Resolved without a visit",
  "Cancelled by owner / PM",
  "Raised in error",
  "Other",
];

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ------------------------------- events ------------------------------- */

export function makeEvent(kind, by, extra = {}) {
  return { at: Date.now(), kind, by: squash(by) || "unknown", ...extra };
}

export const EVENT_LABEL = {
  created: "Created",
  edited: "Edited",
  moved_out: "Moved to another day",
  moved_in: "Moved onto this day",
  started: "Started",
  done: "Marked done",
  not_done: "Marked not done",
  cancelled: "Cancelled",
  reopened: "Reopened",
  pms: "PMS record",
  assigned: "Reassigned",
  added_late: "Added after the day was posted",
};

/* ------------------------------ the job ------------------------------- */

export function newJob(fields, date, by) {
  const now = Date.now();
  return {
    id: uid(),
    state: "scheduled",
    scheduledDate: date,
    originDate: date,        // never changes — where the job first landed
    createdAt: now,
    createdBy: squash(by) || "unknown",
    pushCount: 0,            // how many times it has been moved to a later day

    property: "", unit: "", parking: "", status: "",
    description: "", team: "", shift: "",
    estimatedTime: "", timeOfVisit: "", guestConfirmed: "",
    materialNeeded: "", materialDetails: "", materialCost: "",
    priority: "", notes: "", faultCode: "",
    pending: "", pendingDetails: "",

    // Set by whoever confirms the job exists in PMS. One toggle, on the
    // same card as everything else — not a separate pass in another tool.
    inPms: null,
    pmsRef: "",

    outcomeReason: "",
    actualMinutes: null,

    // Set when the board spots this unit was visited recently for similar
    // work. The reason is asked for, never guessed — see faultFamily.js.
    returnOf: null,
    returnReason: "",

    // Links this job to a project, so its labour rolls into that project's
    // self-cost. Empty for ordinary daily work.
    projectId: "",

    // Where the work came from, and how it reached us. Without this every
    // job looks identical on arrival and the demand mix is unknowable.
    source: "",
    reportedBy: "",
    howReported: "",

    // Set when a visit ended without finishing the work: what the
    // technician says is still needed, and the job created to do it.
    stillNeeded: "",
    followUpJobId: "",
    followUpOf: null,      // { jobId, date } on the job that finishes the work

    // What took this job's slot when it was moved for something else, and
    // what this job displaced when it took somebody else's.
    displacedBy: null,     // { jobId, label, date, by, at }
    displaced: [],         // ids of jobs this one pushed out

    // True for anything added after the day was posted — an emergency, a
    // new complaint, a job squeezed in. Planned volume and arriving volume
    // are different things and were previously indistinguishable.
    unplanned: false,

    events: [makeEvent("created", by)],
    ...fields,
  };
}

/* A tombstone is what a day keeps when a job leaves it. It is deliberately
   a snapshot, not a reference: the day should still be able to show what
   left it even if the job is later cancelled or moved on again. */
/* "posted" and "past" are the two states in which a day is no longer the
   coordinator's to rewrite freely. Carrying the kind onto the event is what
   later lets the dashboard separate a schedule that was rewritten after it
   was published from one that simply ran. */
const lockKind = (l) => (l === "posted" || l === "past" ? l : undefined);

export function makeTombstone(job, toDate, by, reason, displacedBy, lock) {
  return {
    _tomb: true,
    id: `tomb-${job.id}-${Date.now()}`,
    jobId: job.id,
    toDate,
    at: Date.now(),
    by: squash(by) || "unknown",
    reason: squash(reason),
    lock: lockKind(lock),
    displacedBy: displacedBy || null,
    snapshot: {
      property: job.property, unit: job.unit, description: job.description,
      team: job.team, priority: job.priority, estimatedTime: job.estimatedTime,
    },
  };
}

export const isTombstone = (r) => !!(r && r._tomb);
export const liveJobs = (rows) => (rows || []).filter((r) => !isTombstone(r));
export const tombstones = (rows) => (rows || []).filter(isTombstone);

/* --------------------------- state changes ---------------------------- *
 * Every one of these returns a NEW job with an event appended. None of
 * them ever drops information.
 * -------------------------------------------------------------------- */

export function withEvent(job, kind, by, extra = {}) {
  return { ...job, events: [...(job.events || []), makeEvent(kind, by, extra)] };
}

export function setState(job, state, by, extra = {}) {
  const patch = { ...job, state };
  if (state === "fixed") patch.outcomeReason = "";
  if (["not_done", "cancelled", "made_safe", "diagnosed"].includes(state) && extra.reason) {
    patch.outcomeReason = extra.reason;
  }
  if (extra.stillNeeded !== undefined) patch.stillNeeded = squash(extra.stillNeeded);

  /* Every outcome that means the technician was on site and finished emits
     a "done" event, whatever came of the visit. Duration is measured from
     started -> done, and a job that was made safe still took an hour of
     somebody's day. */
  const kind =
    state === "in_progress" ? "started" :
    isResolved(state) ? "done" :
    state === "not_done" ? "not_done" :
    state === "cancelled" ? "cancelled" : "edited";
  return withEvent(patch, kind, by, { ...extra, outcome: state });
}

/* Moving is the operation the whole design exists for. It returns both
   halves: the job as it should appear on the destination day, and the
   tombstone the source day keeps. */
/**
 * @param {object} displacedBy  optional { jobId, label } — what took the slot
 */
export function moveJob(job, toDate, by, reason, displacedBy, lock) {
  const reasonId = normaliseMoveReason(reason);
  const link = displacedBy && (displacedBy.jobId || squash(displacedBy.label))
    ? {
        jobId: displacedBy.jobId || "",
        label: squash(displacedBy.label),
        date: job.scheduledDate,
        by: squash(by) || "unknown",
        at: Date.now(),
      }
    : null;

  const moved = withEvent(
    {
      ...job,
      scheduledDate: toDate,
      state: "scheduled",
      pushCount: (job.pushCount || 0) + 1,
      displacedBy: link || job.displacedBy || null,
    },
    "moved_in",
    by,
    { from: job.scheduledDate, to: toDate, reason: reasonId, displacedBy: link, lock: lockKind(lock) }
  );
  return { moved, tomb: makeTombstone(job, toDate, by, reasonId, link, lock) };
}

/* Which fields, when changed, are worth a line in the history. Changing a
   typo in the notes is not a schedule change; moving a job to a different
   technician is. */
const TRACKED_FIELDS = [
  ["team", "Technician"], ["shift", "Shift"], ["property", "Property"],
  ["unit", "Unit"], ["description", "Task"], ["estimatedTime", "Estimate"],
  ["priority", "Priority"], ["timeOfVisit", "Time"], ["status", "Occupancy"],
];

export function applyEdit(job, patch, by) {
  const changes = TRACKED_FIELDS
    .filter(([f]) => f in patch && squash(job[f]) !== squash(patch[f]))
    .map(([f, label]) => ({ field: f, label, from: squash(job[f]), to: squash(patch[f]) }));
  const next = { ...job, ...patch };
  if (!changes.length) return next;
  const kind = changes.length === 1 && changes[0].field === "team" ? "assigned" : "edited";
  return withEvent(next, kind, by, { changes });
}

/* ----------------------- how long it actually took --------------------- *
 * Nobody is going to type a duration for thirty jobs a day, and a field
 * that only gets filled sometimes produces an average of the jobs somebody
 * felt like recording — which is worse than no number.
 *
 * But the board already has Start and Done as buttons, and both are
 * timestamped events. So the real duration is free: it is the gap between
 * them. A manually entered value still wins when there is one, because
 * somebody typing it is making a correction.
 *
 * The 12-hour ceiling exists because the common failure is a technician
 * who starts a job and marks it done the next morning. That is a missing
 * Done click, not an eleven-hour job, and averaging it in would quietly
 * wreck every estimate the app produces.
 * -------------------------------------------------------------------- */
export const MAX_PLAUSIBLE_JOB_MINUTES = 12 * 60;

export function actualDuration(job) {
  const entered = job.actualMinutes != null ? Number(job.actualMinutes) : null;
  if (Number.isFinite(entered) && entered > 0) {
    return { minutes: Math.round(entered), source: "entered" };
  }
  const events = job.events || [];
  const started = [...events].reverse().find((e) => e.kind === "started");
  const finished = [...events].reverse().find((e) => e.kind === "done");
  if (!started || !finished || finished.at <= started.at) return { minutes: null, source: null };
  const mins = Math.round((finished.at - started.at) / 60000);
  if (mins > MAX_PLAUSIBLE_JOB_MINUTES) {
    return { minutes: null, source: null, discarded: mins, reason: "over 12h — almost certainly a missed Done click" };
  }
  if (mins < 1) return { minutes: null, source: null };
  return { minutes: mins, source: "measured" };
}

export function jobFamily(job) {
  return faultFamily(job.description, job.faultCode);
}

/* ---------------------- finishing what was started -------------------- *
 * Builds the job that completes work an earlier visit only contained. The
 * technician's own note about what is missing becomes the new job's scope,
 * and its material line, so nothing has to be retyped off a PMS comment.
 * -------------------------------------------------------------------- */
export function makeFollowUp(parent, date, by, opts = {}) {
  const scope = squash(opts.scope) || squash(parent.stillNeeded) ||
    `Finish: ${squash(parent.description)}`;
  const child = newJob({
    property: parent.property,
    unit: parent.unit,
    parking: parent.parking,
    status: parent.status,
    shift: parent.shift,
    team: opts.team !== undefined ? opts.team : parent.team,
    description: scope,
    materialNeeded: squash(opts.materials) ? "Y" : parent.materialNeeded,
    materialDetails: squash(opts.materials) || parent.materialDetails,
    estimatedTime: opts.estimatedTime || parent.estimatedTime,
    // A contained P1 stays a P1 until it is actually finished.
    priority: parent.priority,
    faultCode: parent.faultCode,
    projectId: parent.projectId,
    source: "followup",
    followUpOf: { jobId: parent.id, date: parent.scheduledDate, outcome: parent.state },
    notes: `Follows ${parent.scheduledDate}: ${squash(parent.outcomeReason) || STATE_META[parent.state]?.label || ""}`.trim(),
  }, date, by);
  return child;
}

/* ------------------------ spotting a return --------------------------- *
 * A unit visited again soon after a similar job. Used to ask the
 * coordinator why it is back — the one thing that cannot be inferred.
 * -------------------------------------------------------------------- */
function tokens(s) {
  return new Set(canonKey(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
}
function looksSimilar(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return false;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit++; });
  return hit / Math.min(A.size, B.size) >= 0.4;
}

/**
 * @param {object} job          the newly added job
 * @param {Array<{date:string, rows:Array}>} history  earlier days, newest first
 * @returns {{prior:object, date:string, gapDays:number, sameFamily:boolean}|null}
 */
export function findReturn(job, history) {
  const key = assetKey(job.property, job.unit);
  if (!key) return null;
  const fam = jobFamily(job);
  for (const { date, rows } of history) {
    for (const prior of rows) {
      if (!prior || prior._tomb || prior.id === job.id) continue;
      if (assetKey(prior.property, prior.unit) !== key) continue;
      const sameFamily = jobFamily(prior) === fam;
      if (!sameFamily && !looksSimilar(prior.description, job.description)) continue;
      const gap = daysBetween(date, job.scheduledDate);
      if (gap == null || gap < 0) continue;
      return { prior, date, gapDays: gap, sameFamily };
    }
  }
  return null;
}

/* ------------------------- derived properties ------------------------- */

export function jobMinutes(job) {
  return parseDurationMinutes(job.estimatedTime);
}

export function isOpen(job) {
  return OPEN_STATES.includes(job.state);
}

/* A job that has been pushed repeatedly is the thing that used to vanish.
   Surfacing the count is most of the fix. */
export function pushSeverity(job) {
  const n = job.pushCount || 0;
  if (n >= 3) return "bad";
  if (n >= 1) return "warn";
  return "ok";
}

export function needsGuestConfirm(job) {
  return occupancyClass(job.status) === "occupied";
}

/* -------------------------- PMS hand-off ------------------------------ *
 * The CEO will not entertain a PMS API, so the coordinator types the job
 * into PMS as well. That double entry is not going away — but it can stop
 * being double TYPING. The app formats the task and puts it on the
 * clipboard; PMS gets a paste instead of a retype.
 * -------------------------------------------------------------------- */
export function pmsText(job) {
  const L = [];
  const where = [squash(job.property), squash(job.unit)].filter(Boolean).join(" ");
  if (where) L.push(where);
  if (squash(job.description)) L.push(squash(job.description));
  const bits = [];
  if (squash(job.team)) bits.push(`Assigned: ${squash(job.team)}`);
  if (job.scheduledDate) bits.push(`Date: ${job.scheduledDate}`);
  if (squash(job.shift)) bits.push(`Shift: ${squash(job.shift)}`);
  if (squash(job.timeOfVisit)) bits.push(`Visit: ${squash(job.timeOfVisit)}`);
  if (squash(job.estimatedTime)) bits.push(`Est: ${squash(job.estimatedTime)}`);
  if (canonPriority(job.priority)) bits.push(`Priority: ${squash(job.priority)}`);
  if (squash(job.status)) bits.push(`Unit: ${squash(job.status)}`);
  if (canonKey(job.materialNeeded).startsWith("y")) {
    bits.push(`Material: ${squash(job.materialDetails) || "see notes"}`);
  }
  if (squash(job.parking)) bits.push(`Parking: ${squash(job.parking)}`);
  if (bits.length) L.push(bits.join(" · "));
  if (squash(job.notes)) L.push(`Notes: ${squash(job.notes)}`);
  return L.join("\n");
}

/* ====================================================================== *
 * Quick add — the reason a coordinator would ever choose this over Sheets
 *
 * Thirty jobs a night, read off PMS, already being typed once into PMS.
 * A form with eighteen fields loses to a spreadsheet every time, and it
 * should. So capture is one line, parsed deterministically — no model
 * call, no latency, no cost, nothing invented — with a preview of what was
 * understood and every piece correctable by clicking it.
 *
 * Tokens are recognised in any order, because people do not type in a
 * fixed order:
 *   "Palm Villa E41 AC not cooling 1h Vitalis occupied p2 3-4pm"
 * ====================================================================== */

const DUR_RE   = /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i;
const PRIO_RE  = /\b(p[1-4])\b/i;
const TIME_RE  = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b/i;

const STATUS_WORDS = [
  [/\bocc(?:upied)?\s*-?\s*gc\b/i, "Occupied - GC"],
  [/\bocc(?:upied)?\b/i, "Occupied"],
  [/\bvac(?:ant)?\b/i, "Vacant"],
  [/\bcheck\s*-?\s*in\b/i, "Check-in"],
  [/\bcheck\s*-?\s*out\b/i, "Checkout"],
  [/\bb2b\b/i, "B2B"],
  [/\bonboard(?:ing)?\b/i, "Onboarding"],
  [/\bwc\b/i, "WC"],
];

const PRIO_MAP = { p1: "P1-Urgent", p2: "P2-High", p3: "P3-Medium", p4: "P4-Routine" };

/**
 * Parse one line into job fields.
 * @param {string} line
 * @param {{properties?: string[], techs?: string[]}} known
 * @returns {{fields: object, matched: object, leftover: string}}
 */
export function parseQuickAdd(line, known = {}) {
  let rest = squash(line);
  const matched = {};
  const fields = {};

  const take = (re, fn) => {
    const m = rest.match(re);
    if (!m) return;
    fn(m);
    rest = squash(rest.replace(m[0], " "));
  };

  // duration
  take(DUR_RE, (m) => {
    fields.estimatedTime = squash(m[0]);
    matched.estimatedTime = squash(m[0]);
  });

  // priority
  take(PRIO_RE, (m) => {
    const p = PRIO_MAP[m[1].toLowerCase()];
    fields.priority = p;
    matched.priority = p;
  });

  // guest confirmation, before the time window so "confirmed 3-4pm" works
  take(/\b(confirmed|guest ok|gc\+)\b/i, () => {
    fields.guestConfirmed = "Y";
    matched.guestConfirmed = "Y";
  });

  // visit window
  take(TIME_RE, (m) => {
    fields.timeOfVisit = squash(m[0]);
    matched.timeOfVisit = squash(m[0]);
  });

  // occupancy
  for (const [re, val] of STATUS_WORDS) {
    if (re.test(rest)) {
      fields.status = val;
      matched.status = val;
      rest = squash(rest.replace(re, " "));
      break;
    }
  }

  // technician — match known names and the alias table, longest first so
  // "Abdul Riyaz" wins over "Abdul"
  const techNames = Array.from(new Set([
    ...(known.techs || []),
    ...Object.values(TECH_ALIASES),
  ])).sort((a, b) => b.length - a.length);
  const foundTechs = [];
  techNames.forEach((t) => {
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(rest)) {
      foundTechs.push(t);
      rest = squash(rest.replace(re, " "));
    }
  });
  if (foundTechs.length) {
    fields.team = foundTechs.join(" & ");
    matched.team = fields.team;
  }

  // property — longest known property name appearing at the start
  const props = (known.properties || []).slice().sort((a, b) => b.length - a.length);
  let propHit = "";
  for (const p of props) {
    const cp = canonProperty(p);
    if (!cp) continue;
    const re = new RegExp(`\\b${cp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(canonProperty(rest))) { propHit = p; break; }
  }
  if (propHit) {
    // remove it from the raw text by matching word-for-word, case-insensitive
    const words = squash(propHit).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(words.join("\\s+"), "i");
    fields.property = propHit;
    matched.property = propHit;
    rest = squash(rest.replace(re, " "));
  }

  /* Building names contain numbers — "Marina Gate 2", "Town Square Safi
     1A", "Al Dhafrah 2". Taking the FIRST number-ish token as the unit
     turned "Marina Gate 2 3705" into building "Marina Gate 3705", unit
     "2". The unit is the last such token, and a 3-5 digit one outranks a
     stray single digit that belongs to the building's name. */
  const unitRe = /\b([A-Za-z]?\d{1,5}[A-Za-z]?|[A-Z]-?\d{1,3})\b/g;
  const candidates = [];
  let um;
  while ((um = unitRe.exec(rest)) !== null) candidates.push({ text: um[1], index: um.index });
  if (candidates.length) {
    const scored = candidates.map((c) => {
      const digits = (c.text.match(/\d/g) || []).length;
      // Later in the line and longer number = more likely the unit.
      return { ...c, score: c.index + (digits >= 3 ? 1000 : 0) };
    });
    const best = scored.sort((a, b) => b.score - a.score)[0];
    fields.unit = best.text.toUpperCase();
    matched.unit = fields.unit;
    rest = squash(rest.slice(0, best.index) + " " + rest.slice(best.index + best.text.length));
  }

  // whatever survives is the task
  fields.description = squash(rest).replace(/^[-–·,\s]+|[-–·,\s]+$/g, "");
  if (!fields.property && fields.description) {
    // No known property matched — take the leading capitalised run as one,
    // so a new building still lands somewhere sensible rather than in the
    // task text. Trailing digits belong to the name ("Marina Gate 2").
    /* Buildings starting with a number are real — "5242 Tower 1" is one of
       theirs — so the leading run may begin with a digit as well as a
       capital. It must still contain a word, or a bare unit number would
       be mistaken for a building. */
    const lead = fields.description.match(/^((?:[A-Z0-9][\w'-]*)(?:\s+[A-Z0-9][\w'-]*){0,3})\s+(.*)$/);
    if (lead && /[A-Za-z]{2}/.test(lead[1])) {
      fields.property = lead[1];
      matched.propertyGuess = lead[1];
      fields.description = lead[2];
    }
  }

  return { fields, matched, leftover: fields.description };
}

/* Split a paste into lines, ignoring blanks and obvious headers. */
export function splitQuickAddLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => squash(l))
    .filter((l) => l && !/^(date|shift|property|team)\b/i.test(l));
}
