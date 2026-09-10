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
import { squash, parseDurationMinutes, splitCrew } from "./normalize.js";
import { faultFamily, FAMILY_LABEL } from "./faultFamily.js";
import { actualDuration } from "./job.js";
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

/* ---------------------------------------------------------------------- *
 * The duration library itself, moved here from metrics.js when that file
 * was deleted. learned.js was its only consumer, so it now lives with the
 * code that reads it.
 *
 * Grouping: the standard catalogue task where a line snapped to one, and
 * the trade family otherwise — the finest split the data supports without
 * producing samples of one.
 * ---------------------------------------------------------------------- */

function median(arr) {
  const a = arr.filter((n) => n != null).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10;
}
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const coverage = (answered, total) => ({ answered, total, pct: pct(answered, total) });

export const MIN_CONFIDENT = 5;

export function computeDurationLibrary(jobs, opts = {}) {
  const min = opts.minConfident || MIN_CONFIDENT;
  const groups = new Map();

  jobs.forEach((j) => {
    /* Grouped by the standard task where the line snapped to one, and by
       trade family otherwise — the finest grouping the data can actually
       support without splitting into samples of one. */
    const key = squash(j.catalogueId) || `fam:${faultFamily(j.description, j.faultCode)}`;
    const label = squash(j.catalogueId)
      ? squash(j.description)   // a snapped line carries the canonical wording
      : (FAMILY_LABEL[faultFamily(j.description, j.faultCode)] || "Not classified");
    if (!groups.has(key)) {
      groups.set(key, { key, label, measured: [], estimates: [], jobs: 0, crewed: 0 });
    }
    const g = groups.get(key);
    g.jobs++;
    const est = parseDurationMinutes(j.estimatedTime);
    if (est != null) g.estimates.push(est);
    const act = actualDuration(j);
    if (act.minutes != null) {
      g.measured.push(act.minutes);
      if (splitCrew(j.team).length > 1) g.crewed++;
    }
  });

  const rows = Array.from(groups.values()).map((g) => {
    const measuredMedian = g.measured.length ? median(g.measured) : null;
    const estimateMedian = g.estimates.length ? median(g.estimates) : null;
    const confident = g.measured.length >= min;
    const ratio = measuredMedian != null && estimateMedian
      ? Math.round((measuredMedian / estimateMedian) * 100) : null;
    return {
      ...g,
      n: g.measured.length,
      measuredMedian,
      measuredMin: g.measured.length ? Math.min(...g.measured) : null,
      measuredMax: g.measured.length ? Math.max(...g.measured) : null,
      estimateMedian,
      ratio,
      confident,
      /* How much the department is out on this kind of work over a month:
         the per-job error multiplied by how often it comes up. Sorting by
         this puts the estimate worth fixing first, rather than the most
         wrong estimate on a task that happens twice. */
      impact: confident && ratio != null
        ? Math.abs(measuredMedian - estimateMedian) * g.jobs : 0,
    };
  });

  const measuredJobs = rows.reduce((s, r) => s + r.n, 0);
  return {
    rows: rows.sort((a, b) => b.impact - a.impact || b.n - a.n),
    confident: rows.filter((r) => r.confident),
    measuredJobs,
    coverage: coverage(measuredJobs, jobs.length),
    minConfident: min,
    /* Ready to replace the guess. Until a kind of work reaches this, the
       app keeps quoting the seeded default and says so. */
    readyToLearn: rows.filter((r) => r.confident && r.ratio != null && (r.ratio > 125 || r.ratio < 75)).length,
  };
}

/** What the library says this kind of work takes, or null if it cannot say yet. */
export function learnedMinutes(library, key) {
  if (!library || !key) return null;
  const row = library.rows.find((r) => r.key === key);
  return row && row.confident ? row.measuredMedian : null;
}
