/* ---------------------------------------------------------------------- *
 * activity.js — who built this day, and who changed it since.
 *
 * Three coordinators rotate through the same desk. Nobody could say who
 * built a given schedule, and nobody could say who changed it at eleven in
 * the morning — so a pattern that belongs to one person's judgement looked
 * like a property of the department.
 *
 * Every event already carries a name and a timestamp; they were written
 * onto individual jobs and never read back together. This assembles them
 * into the two views a manager actually wants: what happened to this day in
 * order, and who did it.
 *
 * The events are the record. Nothing here computes or infers anything the
 * log does not already say — if a name is missing it stays missing and is
 * reported as unknown, because a confidently wrong attribution is worse
 * than an admitted gap when the whole point is accountability.
 * ---------------------------------------------------------------------- */

import { squash } from "./normalize.js";
import { EVENT_LABEL, isTombstone, MOVE_REASON_LABEL } from "./job.js";

/* Building the schedule versus changing it afterwards. The split is the
   lock state the event carries: an event stamped with a lock happened
   after the day closed, everything else is drafting. */
const isChange = (e) => !!e.lock;

const PLANNING = new Set(["created", "added_late", "edited", "moved_in", "moved_out", "assigned", "cancelled"]);
const DOING = new Set(["started", "done", "not_done", "fixed", "made_safe", "diagnosed", "reopened", "pms"]);

export function eventKindLabel(e) {
  if (e.kind === "moved_out" && e.reason) {
    return `${EVENT_LABEL.moved_out} — ${MOVE_REASON_LABEL[e.reason] || squash(e.reason)}`;
  }
  return EVENT_LABEL[e.kind] || e.kind;
}

/**
 * Everything that happened to a day, in order.
 * @param rows the day's rows, tombstones included — a job that left is
 *        part of the day's history and dropping it would hide the
 *        very changes this exists to show.
 */
export function dayActivity(rows, post) {
  const timeline = [];

  (rows || []).forEach((r) => {
    if (isTombstone(r)) {
      timeline.push({
        at: r.at, by: squash(r.by) || "unknown", kind: "moved_out",
        label: `Moved to ${r.toDate}${r.reason ? ` — ${MOVE_REASON_LABEL[r.reason] || r.reason}` : ""}`,
        job: `${squash(r.snapshot?.property)} ${squash(r.snapshot?.unit)}`.trim(),
        change: !!r.lock, group: "planning",
      });
      return;
    }
    (r.events || []).forEach((e) => {
      if (!e || !e.at) return;
      timeline.push({
        at: e.at, by: squash(e.by) || "unknown", kind: e.kind,
        label: eventKindLabel(e),
        reason: squash(e.reason),
        job: `${squash(r.property)} ${squash(r.unit)}`.trim(),
        jobId: r.id,
        change: isChange(e),
        group: PLANNING.has(e.kind) ? "planning" : DOING.has(e.kind) ? "doing" : "other",
      });
    });
  });

  timeline.sort((a, b) => a.at - b.at);

  /* Who built it: whoever created the jobs, ranked. A day is often started
     by one coordinator and finished by the next when a shift turns over
     mid-evening, so this is a list rather than a single name. */
  const built = {};
  const changed = {};
  const recorded = {};
  timeline.forEach((t) => {
    if (t.kind === "created" && !t.change) built[t.by] = (built[t.by] || 0) + 1;
    else if (t.change) changed[t.by] = (changed[t.by] || 0) + 1;
    if (t.group === "doing") recorded[t.by] = (recorded[t.by] || 0) + 1;
  });

  const rank = (m) => Object.entries(m).map(([by, n]) => ({ by, n })).sort((a, b) => b.n - a.n);

  return {
    timeline,
    builtBy: rank(built),
    changedBy: rank(changed),
    recordedBy: rank(recorded),
    changes: timeline.filter((t) => t.change).length,
    posted: post ? { by: squash(post.by) || "unknown", at: post.at } : null,
    first: timeline.length ? timeline[0].at : null,
    last: timeline.length ? timeline[timeline.length - 1].at : null,
  };
}

/** One line naming who is responsible for the state of this day. */
export function attributionLine(act) {
  const parts = [];
  if (act.builtBy.length) {
    parts.push(act.builtBy.length === 1
      ? `Built by ${act.builtBy[0].by} (${act.builtBy[0].n} jobs)`
      : `Built by ${act.builtBy.map((b) => `${b.by} (${b.n})`).join(", ")}`);
  }
  if (act.posted) parts.push(`posted by ${act.posted.by}`);
  if (act.changedBy.length) {
    parts.push(`${act.changes} change${act.changes === 1 ? "" : "s"} since, by ${act.changedBy.map((c) => `${c.by} (${c.n})`).join(", ")}`);
  } else if (act.posted || act.builtBy.length) {
    parts.push("no changes since");
  }
  return parts.join(" · ");
}

/**
 * Who did what across a range, for the dashboard.
 *
 * Shifts rotate, so the interesting comparison is not who is busiest but
 * whose days need the most changing after they close — that is a signal
 * about how a schedule was built, and it is invisible one day at a time.
 */
export function peopleActivity(daysWithRows) {
  const people = {};
  const touch = (by) => {
    const k = squash(by) || "unknown";
    if (!people[k]) people[k] = { by: k, built: 0, changed: 0, recorded: 0, daysBuilt: new Set(), posted: 0 };
    return people[k];
  };

  (daysWithRows || []).forEach(({ date, rows, post }) => {
    const act = dayActivity(rows, post);
    act.builtBy.forEach((b) => { const p = touch(b.by); p.built += b.n; p.daysBuilt.add(date); });
    act.changedBy.forEach((c) => { touch(c.by).changed += c.n; });
    act.recordedBy.forEach((r) => { touch(r.by).recorded += r.n; });
    if (act.posted) touch(act.posted.by).posted += 1;
  });

  return Object.values(people)
    .map((p) => ({
      ...p,
      daysBuilt: p.daysBuilt.size,
      // Changes per job built — how much a person's schedule moves once the
      // day starts. Only meaningful once somebody has built a few days.
      churnPerJob: p.built ? Math.round((p.changed / p.built) * 100) / 100 : null,
    }))
    .sort((a, b) => b.built - a.built || b.changed - a.changed);
}
