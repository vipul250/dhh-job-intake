/* ---------------------------------------------------------------------- *
 * monthly.js — the one report: who did how much work last month.
 *
 * Three numbers per technician, and nothing else:
 *
 *   jobs done        — how many visits they actually completed
 *   major / minor    — decided by trade (see faultFamily.js jobSize)
 *   typical minutes  — the median of their real arrive-to-leave times
 *
 * Deliberately standalone: it reads job records and the two classifiers and
 * nothing else. metrics.js and its 28 other measures have since been
 * deleted, and this survived that untouched.
 *
 * Median, not mean: one job left open over a lunch break drags a mean and
 * leaves a median alone.
 * ---------------------------------------------------------------------- */

import { actualDuration, RESOLVED_STATES } from "./job.js";
import { jobSize, faultFamily, FAMILY_LABEL } from "./faultFamily.js";
import { splitCrew } from "./normalize.js";

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/* "2026-09" for a job, from the day it was actually worked.
   `_date` is what the day-loaders stamp on a job as they read it out of
   storage; `scheduledDate` is what lives on the record itself. Read both,
   so the report works on either. */
export function jobMonth(job) {
  return String(job.scheduledDate || job._date || "").slice(0, 7);
}

/* ---------------------------------------------------------------------- *
 * Which months this report can actually show.
 *
 * Only months with COMPLETED work, because that is the only thing
 * monthlyReport counts. Listing every month that merely has jobs on it put
 * the view in a dead end on its first real day: 11 September, two jobs
 * scheduled ahead into October, so the newest month present was October,
 * the default landed there, and the page read "No completed jobs on record
 * for October 2026" — with the month picker inside the empty branch and
 * therefore not rendered at all. Nothing to click, no way back.
 *
 * The picker and the report now agree on what a month is.
 * ---------------------------------------------------------------------- */
export function monthsPresent(jobs) {
  return [...new Set(
    (jobs || [])
      .filter((j) => RESOLVED_STATES.includes(j.state))
      .map(jobMonth)
      .filter(Boolean)
  )].sort().reverse();
}

/* ---------------------------------------------------------------------- *
 * One row per technician, plus a per-trade breakdown.
 *
 * Two different denominators, on purpose:
 *
 *   counts    — every completed job. This is "how many did he do".
 *   durations — only jobs with a real arrive/leave time on them. A job
 *               nobody timed cannot contribute a duration, and padding the
 *               average with the coordinator's estimate would make the
 *               number a measure of the estimate instead of the work.
 *
 * `timedPct` says how much of the average you can trust. Low number means
 * technicians are not entering arrive/leave at close-out — that is an
 * operational fix, not a reporting one.
 * -------------------------------------------------------------------- */
export function monthlyReport(jobs, month) {
  const done = jobs.filter(
    (j) => RESOLVED_STATES.includes(j.state) && (!month || jobMonth(j) === month),
  );

  /* A two-man job counts for both men: splitCrew turns "Rajesh + Naresh"
     into two rows so neither loses the job. */
  const rows = [];
  done.forEach((j) => {
    const size = jobSize(j.description, j.faultCode);
    const family = faultFamily(j.description, j.faultCode);
    const minutes = actualDuration(j).minutes;
    const crew = splitCrew(j.team);
    (crew.length ? crew : ["Unassigned"]).forEach((tech) => {
      rows.push({ tech, size, family, minutes });
    });
  });

  const summarise = (list) => {
    const major = list.filter((r) => r.size === "major");
    const minor = list.filter((r) => r.size === "minor");
    const timed = list.filter((r) => r.minutes != null);
    const mins = (l) => median(l.filter((r) => r.minutes != null).map((r) => r.minutes));
    return {
      jobs: list.length,
      major: major.length,
      minor: minor.length,
      majorMinutes: mins(major),
      minorMinutes: mins(minor),
      allMinutes: median(timed.map((r) => r.minutes)),
      timed: timed.length,
      timedPct: list.length ? Math.round((timed.length / list.length) * 100) : 0,
    };
  };

  const groupBy = (keyFn) => {
    const m = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return m;
  };

  const byTech = [...groupBy((r) => r.tech)]
    .map(([tech, list]) => ({ tech, ...summarise(list) }))
    .sort((a, b) => b.jobs - a.jobs);

  const byTrade = [...groupBy((r) => r.family)]
    .map(([family, list]) => ({
      family,
      label: FAMILY_LABEL[family] || family,
      size: list[0].size,
      ...summarise(list),
    }))
    .sort((a, b) => b.jobs - a.jobs);

  return { month, ...summarise(rows), technicians: byTech.length, byTech, byTrade };
}
