/* ---------------------------------------------------------------------- *
 * learned.js — the estimate stops being a guess.
 *
 * Every duration in this app started as a coordinator's estimate, and the
 * coordinator filling it in does not know how long the work will take.
 * That was never a criticism: it is not knowable in advance, the first
 * time. The seeded catalogue defaults are no better — they are the median
 * of those same estimates across the imported month, so they are estimates
 * all the way down.
 *
 * What IS knowable is what the work took last time. Once a kind of work
 * has been measured MIN_CONFIDENT times from real arrival and departure
 * times, its measured median replaces the seeded default on the quick-add
 * box, and the board says it is doing so. Below that threshold the app
 * keeps quoting the default and keeps quiet, because one short visit where
 * the technician was already in the building must not rewrite the estimate
 * for the whole portfolio.
 *
 * The library is recomputed from the days themselves — never accumulated
 * incrementally — so a corrected close-out corrects the library too, and
 * there is no counter that can drift away from the jobs it counts. The
 * cached copy exists only so the board does not read sixty days on every
 * keystroke; if it is missing or stale the board simply uses the defaults
 * until the refresh lands.
 * ---------------------------------------------------------------------- */

import { storageGet, storageSet } from "./storage.js";
import { readDays, migrateDay, listScheduleDates } from "./jobStore.js";
import { liveJobs } from "./job.js";
import { computeDurationLibrary, MIN_CONFIDENT } from "./metrics.js";
import { readGoLive, isLive } from "./goLive.js";

export const LEARNED_KEY = "learned-durations";

/** How long a cached library is good for. A day's worth of close-outs is
 *  not going to move a median built from a month of them. */
export const LEARNED_TTL_MS = 6 * 60 * 60 * 1000;

/** How far back to learn from. Long enough for a median to mean something,
 *  short enough that last winter's practice is not still setting today's
 *  estimates. */
export const LEARNED_WINDOW_DAYS = 120;

export async function readLearned() {
  try {
    const raw = await storageGet(LEARNED_KEY);
    if (!raw) return null;
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && Array.isArray(v.rows) ? v : null;
  } catch { return null; }
}

export const isStale = (learned, now = Date.now()) =>
  !learned || !learned.at || now - learned.at > LEARNED_TTL_MS;

/**
 * Recompute the library from the stored days and cache it.
 *
 * Only ever learns from days on or after the go-live cutover. The imported
 * history has no close-outs at all, so it would contribute nothing but a
 * pile of estimates masquerading as measurements.
 */
export async function refreshLearned(opts = {}) {
  const cut = opts.goLive !== undefined ? opts.goLive : await readGoLive();
  const all = opts.dates || (await listScheduleDates());
  const dates = all.filter((d) => isLive(d, cut)).slice(-LEARNED_WINDOW_DAYS);
  if (!dates.length) return { at: Date.now(), from: null, to: null, days: 0, rows: [] };

  const byDate = await readDays(dates);
  const jobs = [];
  dates.forEach((d) => {
    liveJobs(migrateDay(byDate[d] || [], d)).forEach((j) => jobs.push({ ...j, _date: d }));
  });

  const lib = computeDurationLibrary(jobs, { minConfident: opts.minConfident });
  const learned = {
    at: Date.now(),
    from: dates[0],
    to: dates[dates.length - 1],
    days: dates.length,
    minConfident: lib.minConfident,
    /* Only the rows the app is willing to act on are cached. A row it is
       not confident about would be read back as a number and used, which is
       exactly what the threshold exists to prevent. */
    rows: lib.confident.map((r) => ({
      key: r.key, label: r.label, n: r.n,
      minutes: r.measuredMedian, estimate: r.estimateMedian, ratio: r.ratio,
    })),
  };
  try { await storageSet(LEARNED_KEY, JSON.stringify(learned)); } catch { /* cache only */ }
  return learned;
}

/** What the library says a standard task takes, or null if it cannot say. */
export function learnedFor(learned, catalogueId) {
  if (!learned || !catalogueId) return null;
  const row = learned.rows.find((r) => r.key === catalogueId);
  return row ? row : null;
}

export { MIN_CONFIDENT };
