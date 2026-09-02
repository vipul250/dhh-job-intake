/* ---------------------------------------------------------------------- *
 * goLive.js — the date the department actually started using this system.
 *
 * The app was seeded with a real month of history (18 Aug – 1 Sep) so the
 * metrics had something to stand on from day one. That history is genuinely
 * useful — it is where the repeat-visit findings, the technician times and
 * the cost model come from — but it is NOT a backlog. Nothing in it was
 * ever closed out, because closing out did not exist yet.
 *
 * Left alone, the app treated all 443 of those rows as work still owed.
 * Opening 2 September offered to "bring all 110 forward", and the day the
 * department was meant to start clean instead began with Resty's pool
 * cleanings from four different Augusts on it.
 *
 * So there is a line. Before it, days are history: read them, chart them,
 * learn from them — but they never roll over, never nag, and never count as
 * work that disappeared. After it, every job is live and the rules apply.
 *
 * The line is a date the department sets, not a constant, because the same
 * problem arrives again the next time a batch of history is imported.
 * -------------------------------------------------------------------- */

import { storageGet, storageSet } from "./storage.js";
import { squash } from "./normalize.js";

export const GO_LIVE_KEY = "go-live";

/* The day the department agreed to start fresh. */
export const DEFAULT_GO_LIVE = "2026-09-02";

export async function readGoLive() {
  const raw = await storageGet(GO_LIVE_KEY);
  const v = squash(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : DEFAULT_GO_LIVE;
}

export async function setGoLive(date) {
  const v = squash(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("A go-live date must look like 2026-09-02.");
  await storageSet(GO_LIVE_KEY, v);
  return v;
}

/** Is this day part of the live system, or is it history? */
export const isLive = (date, goLive) => !goLive || !date || date >= goLive;

/**
 * A job that arrived on the board from before the line.
 *
 * Judged on originDate — where the job FIRST appeared — not on the day it
 * is sitting on now. A job dragged forward from 28 August is still a job
 * from 28 August, and that is exactly the one to spot.
 */
export function isPreGoLive(job, goLive) {
  if (!goLive || !job) return false;
  const origin = job.originDate || job.scheduledDate;
  return !!origin && origin < goLive;
}
