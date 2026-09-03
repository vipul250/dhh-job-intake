/* ---------------------------------------------------------------------- *
 * dayLock.js — posting a day, and what changing it afterwards costs.
 *
 * The evening coordinator posts the schedule and goes home. From that
 * moment the day belongs to the field team: they have read it, planned
 * around it, and told guests when to expect somebody. A change after that
 * is a real event with a cost, not a correction.
 *
 * Two separate locks, because they mean different things:
 *
 *   POSTED   — the day has been published. Changes are allowed, and each
 *              one has to say why. This is the churn the department has
 *              never been able to measure.
 *   PAST     — the day has already happened. Editing it is rewriting the
 *              record of what took place, which is a different and more
 *              serious act. It was previously possible to silently edit
 *              30 August and nothing said a word.
 *
 * Neither is a hard block. Somebody genuinely needs to correct a wrong
 * unit number on yesterday's job, and refusing outright teaches people to
 * work around the system. What is not negotiable is that the change is
 * recorded, attributed and reasoned.
 * ---------------------------------------------------------------------- */

import { storageGet, storageSet } from "./storage.js";
import { squash } from "./normalize.js";

const key = (date) => `posted:${date}`;

export async function readPost(date) {
  const raw = await storageGet(key(date));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function postDay(date, by, jobCount) {
  const rec = { date, at: Date.now(), by: squash(by) || "unknown", jobCount: jobCount || 0 };
  await storageSet(key(date), JSON.stringify(rec));
  return rec;
}

/**
 * Undo a posting, so a day cleared back to empty is not still locked
 * against the paste that is about to rebuild it.
 *
 * Only ever called alongside clearing the day itself. On its own it would
 * be a way to quietly unlock a published schedule, which is the opposite of
 * what the lock is for.
 */
export async function clearPost(date) {
  await storageSet(key(date), "");
}

const isoToday = () => new Date().toISOString().slice(0, 10);

/**
 * What editing this day means right now.
 *
 * Three locked states, not two. The department's own rule is that the
 * schedule closes when the date changes — the evening coordinator builds
 * tomorrow, and at midnight tomorrow becomes the field team's day whether
 * or not anybody remembered to press Post. Waiting for the button meant a
 * day nobody posted could be rewritten all morning with no trace.
 *
 * Recording what HAPPENED is never locked. Marking a job fixed, made safe
 * or not done is the day running its course, and the morning coordinator
 * doing the end-of-day review must never be asked to justify it. The lock
 * is on changing the PLAN: adding, moving, cancelling, editing.
 *
 * @returns {{locked:boolean, kind:"open"|"posted"|"started"|"past", label:string, why:string}}
 */
export function lockState(date, post) {
  const today = isoToday();
  if (date < today) {
    return {
      locked: true,
      kind: "past",
      label: "This day has already happened",
      why: "Changing it rewrites the record of what took place. Say why, and it goes in the job's history with your name on it.",
    };
  }
  if (post) {
    return {
      locked: true,
      kind: "posted",
      label: `Posted ${new Date(post.at).toLocaleString()} by ${post.by}`,
      why: "The field team has this schedule. Every change from here is logged with a reason — that is how schedule churn gets measured.",
    };
  }
  if (date === today) {
    return {
      locked: true,
      kind: "started",
      label: "Today — the schedule closed when the date changed",
      why: "Nobody posted this one, but the day has begun and the field team is working to it. Changes are still allowed and still logged.",
    };
  }
  return { locked: false, kind: "open", label: "Not posted yet", why: "" };
}

/* Why a posted or past day is being changed. Deliberately short: a long
   list gets scrolled past, and these five cover what actually happens. */
export const CHANGE_REASONS = [
  "New guest complaint",
  "New appointment or confirmed time",
  "Emergency took priority",
  "Technician unavailable",
  "Correcting a mistake in the entry",
  "Material or access problem",
  "Project work took priority",
  "Asked for by the landlord or owner",
];
