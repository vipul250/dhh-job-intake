/* ---------------------------------------------------------------------- *
 * monthly.js — the one report: who did how much work, over a chosen span.
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
export function jobDate(job) {
  return String(job.scheduledDate || job._date || "");
}

export function jobMonth(job) {
  return jobDate(job).slice(0, 7);
}

const shiftDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* Monday. The department's week starts with the Monday shift plan, not with
   Sunday, and a week that splits the working week in half answers nothing. */
export function weekStart(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return shiftDays(d.toISOString().slice(0, 10), -((d.getUTCDay() + 6) % 7));
}

/* ---------------------------------------------------------------------- *
 * A period is either a date PREFIX or an explicit range.
 *
 * "2026-09" is a month and "2026-09-11" is a day, and both are just
 * prefixes of the job's date — no arithmetic, and the old month-only calls
 * keep working untouched. A week is the one grain that is nobody's prefix,
 * so it passes { from, to }. Null means every month on record.
 * ---------------------------------------------------------------------- */
function inPeriod(job, period) {
  if (!period) return true;
  const d = jobDate(job);
  if (!d) return false;
  if (typeof period === "string") return d.startsWith(period);
  return (!period.from || d >= period.from) && (!period.to || d <= period.to);
}

/** The period argument for a grain and the value a picker holds. */
export function periodFor(grain, value) {
  if (!value) return null;
  if (grain === "week") return { from: value, to: shiftDays(value, 6) };
  return value;
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayLabel = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return `${Number(d)} ${SHORT[Number(m)]} ${y}`;
};

export function periodLabel(grain, value) {
  if (!value) return "";
  if (grain === "month") {
    const [y, m] = value.split("-");
    return `${MONTH_NAMES[Number(m)]} ${y}`;
  }
  if (grain === "day") return dayLabel(value);
  return `${dayLabel(value)} – ${dayLabel(shiftDays(value, 6))}`;
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
export function periodsPresent(jobs, grain = "month") {
  const key = grain === "month" ? (d) => d.slice(0, 7)
    : grain === "week" ? weekStart
    : (d) => d;
  return [...new Set(
    (jobs || [])
      .filter((j) => RESOLVED_STATES.includes(j.state))
      .map(jobDate)
      .filter(Boolean)
      .map(key)
      .filter(Boolean)
  )].sort().reverse();
}

export function monthsPresent(jobs) {
  return periodsPresent(jobs, "month");
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
export function monthlyReport(jobs, period) {
  const done = (jobs || []).filter(
    (j) => RESOLVED_STATES.includes(j.state) && inPeriod(j, period),
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

  const groupBy = (list, keyFn) => {
    const m = new Map();
    list.forEach((r) => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return m;
  };

  const tradesOf = (list) => [...groupBy(list, (r) => r.family)]
    .map(([family, own]) => ({
      family,
      label: FAMILY_LABEL[family] || family,
      size: own[0].size,
      ...summarise(own),
    }))
    .sort((a, b) => b.jobs - a.jobs);

  /* Each technician carries their own trade split. "Jabbar did 28 jobs, 12
     major and 16 minor — and 20 of them were plumbing" is one question, and
     answering it from two separate tables means the reader does the join by
     eye. The rows already know their family, so the cross-tab is free. */
  const byTech = [...groupBy(rows, (r) => r.tech)]
    .map(([tech, list]) => ({ tech, ...summarise(list), trades: tradesOf(list) }))
    .sort((a, b) => b.jobs - a.jobs);

  const byTrade = tradesOf(rows);

  /* ------------------------------------------------------------------ *
   * Two counts, because they answer different questions.
   *
   * `jobs` is ASSIGNMENTS: a two-man job counts once for each man, which is
   * right for "how many did he do" — he went, and he spent the hour.
   *
   * `distinctJobs` is pieces of work. 53 of the 474 real rows carry two or
   * more technicians, so the assignment count runs 16% above the work
   * count, and a header saying "552 jobs" of a 474-job month is wrong in
   * the direction that flatters. Both are reported; the view shows the
   * difference whenever there is one.
   * ------------------------------------------------------------------ */
  const distinctJobs = new Set(done.map((j) => j.id || j)).size;

  return {
    period, month: typeof period === "string" ? period : null,
    ...summarise(rows), distinctJobs, technicians: byTech.length, byTech, byTrade,
  };
}
