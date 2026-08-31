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

const isoToday = () => new Date().toISOString().slice(0, 10);

/**
 * What editing this day means right now.
 * @returns {{locked:boolean, kind:"open"|"posted"|"past", label:string, why:string}}
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
  "Other",
];
