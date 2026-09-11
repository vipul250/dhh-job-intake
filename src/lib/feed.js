/* ---------------------------------------------------------------------- *
 * How well a day was fed.
 *
 * Every metric in this application is downstream of one thing: whether the
 * day was written down properly. Until now that was invisible, so a month
 * of half-filled days and a month of careful ones produced figures that
 * looked identical and were not.
 *
 * 10 September is the benchmark, and it is the coordinator's own — he
 * filled it himself and vouches for it. Measured against all 63 days in
 * the database it is one of only three where every row has an answer, and
 * it explains what displaced 12 of its 13 moves. That is the standard.
 *
 * It also shows the gap honestly: ONE of its 38 visits carries an arrival
 * and a departure time. The best-fed day in the department still cannot
 * say how long the work took. That is not a reporting problem and this
 * file will not hide it.
 *
 * Three questions, because three things have to be true before a figure
 * downstream means anything:
 *
 *   answered  — every row ended in something. Without it the day's counts
 *               are a floor, not a total.
 *   explained — every move says what took the slot. Without it a
 *               coordinator's judgement cannot be reviewed at all.
 *   timed     — every visit has arrival and departure. Without it there is
 *               no productive time, only recollection.
 * ---------------------------------------------------------------------- */
import { RESOLVED_STATES, isOffBoard } from "./job.js";
import { squash } from "./normalize.js";

/* The day the department agreed to measure itself against. Its scores are
   computed from the data like any other day's — this only names it. */
export const BENCHMARK_DATE = "2026-09-10";

const has = (s) => !!squash(s);
const answered = (j) =>
  RESOLVED_STATES.includes(j.state) || j.state === "not_done" || isOffBoard(j);
const timed = (j) => has(j.arrivedAt) && has(j.leftAt);
const explained = (t) => !!(t.displacedBy && (t.displacedBy.jobId || squash(t.displacedBy.label)));

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/**
 * @param {object} byDay  { "2026-09-10": rows[] } — rows as stored, tombstones included
 * @returns rows newest first, each { date, jobs, moves, answeredPct, explainedPct, timedPct }
 */
export function feedQuality(byDay, period) {
  const rows = [];
  Object.entries(byDay || {}).forEach(([date, all]) => {
    if (!Array.isArray(all) || !all.length) return;
    if (period && !inPeriod(date, period)) return;
    const jobs = all.filter((r) => r && !r._tomb);
    const moves = all.filter((r) => r && r._tomb);
    if (!jobs.length) return;

    /* Off-board rows are answered by definition and were never visits, so
       they count for `answered` and are out of the timing denominator.
       Otherwise taking duplicates off the board would make a day look
       worse at timing than it is. */
    const visits = jobs.filter((j) => !isOffBoard(j));

    rows.push({
      date,
      jobs: jobs.length,
      visits: visits.length,
      moves: moves.length,
      answeredPct: pct(jobs.filter(answered).length, jobs.length),
      explainedPct: moves.length ? pct(moves.filter(explained).length, moves.length) : null,
      timedPct: visits.length ? pct(visits.filter(timed).length, visits.length) : null,
    });
  });
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

function inPeriod(date, period) {
  if (typeof period === "string") return date.startsWith(period);
  return (!period.from || date >= period.from) && (!period.to || date <= period.to);
}

/* What the period looks like against the benchmark. `meets` counts days
   that match it on BOTH the things 10 September actually did well —
   timing is reported apart, because no day meets it and a standard nobody
   has ever hit would make the figure meaningless. */
export function againstBenchmark(rows, benchmark) {
  const b = benchmark || { answeredPct: 100, explainedPct: 92.3 };
  const scored = (rows || []).filter((r) => r.jobs > 0);
  if (!scored.length) return null;
  const meets = scored.filter(
    (r) => r.answeredPct >= b.answeredPct &&
           (r.explainedPct == null || r.explainedPct >= b.explainedPct)
  );
  const anyTimed = scored.filter((r) => r.timedPct > 0);
  return {
    days: scored.length,
    meets: meets.length,
    meetsPct: pct(meets.length, scored.length),
    fullyAnswered: scored.filter((r) => r.answeredPct === 100).length,
    daysWithAnyTiming: anyTimed.length,
    benchmark: b,
  };
}
