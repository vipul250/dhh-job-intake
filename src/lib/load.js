/* ---------------------------------------------------------------------- *
 * What a technician's day adds up to.
 *
 * Three figures that must never share a number:
 *
 *   planned  — the coordinator's estimates plus travel between buildings.
 *              A forecast, made before the day happened.
 *   actual   — time INSIDE THE UNITS, and on whose word:
 *                measured  arrival and departure — observed
 *                reported  his own total — what exists today
 *   travel   — an estimate, always. There is no route data and there is
 *              not going to be.
 *
 * Travel is deliberately NOT folded into the actual figure. It was, and it
 * flattered: Jabbar's 4h 15m inside units became 6h 15m against a nine-hour
 * shift on the strength of two hours nobody observed. The bar now answers
 * the question the department actually asks — how much of the shift was
 * spent in a unit doing work — and the travel estimate sits beside it where
 * it can be argued with.
 *
 * And one rule that had to be written down because getting it wrong put
 * work on a man's record that he never did:
 *
 *   A row accounted for is not his job. A duplicate of another row, or work
 *   handed to housekeeping, is neither a job he did nor an hour he owed.
 *   It stays visible on his card — hiding it is how work used to disappear —
 *   but it is out of his count, his hours, and his travel.
 *
 * 10 September, Jabbar, is the case that produced this file. The board read
 * 109% planned across 7 jobs and 5 buildings. One of those rows was Sobha
 * Hartland Waves 3411, assigned to housekeeping; he never went. It was
 * adding thirty minutes of work and a fifth building — another thirty
 * minutes of travel — to a visit that did not happen. His six real jobs
 * came to 4h 15m against 8h 48m planned.
 * ---------------------------------------------------------------------- */
import { jobMinutes, actualDuration, isOffBoard } from "./job.js";
import { canonProperty, splitCrew } from "./normalize.js";

export const DEFAULT_SHIFT_MIN = 540;

/**
 * @param {object[]} list      every row on this technician's card
 * @param {number} travelMin   minutes per move between buildings
 * @param {number} shiftMin
 */
export function groupLoad(list, travelMin, shiftMin = DEFAULT_SHIFT_MIN) {
  const rows = (list || []).filter(Boolean);
  const work = rows.filter((j) => !isOffBoard(j));

  const planMin = work.reduce((s, j) => s + (jobMinutes(j) || 0), 0);
  const buildings = new Set(work.map((j) => canonProperty(j.property)).filter(Boolean));
  const moves = Math.max(0, buildings.size - 1);
  const travel = moves * travelMin;
  const committed = planMin + travel;

  const withTime = work.filter((j) => actualDuration(j).minutes != null);
  const onClock = withTime.filter((j) => actualDuration(j).source === "clock");
  const workedMin = withTime.reduce((s, j) => s + (actualDuration(j).minutes || 0), 0);

  return {
    jobs: work.length,
    offBoard: rows.length - work.length,
    buildings: buildings.size,
    moves,
    travel,
    committed,
    loadPct: Math.round((committed / shiftMin) * 100),
    noEstimate: work.filter((j) => jobMinutes(j) == null).length,
    sharedJobs: work.filter((j) => splitCrew(j.team).length > 1).length,

    attended: withTime.length,
    measured: onClock.length,
    /* Inside the units only. `travel` is reported separately, above. */
    actualMin: workedMin,
    /* Null, never zero: a day with nothing recorded has no actual figure,
       and 0% would read as a man who did nothing. */
    actualPct: workedMin ? Math.round((workedMin / shiftMin) * 100) : null,
    /* Work plus the travel estimate, for the one place that wants the whole
       day in a single number. Named so nobody mistakes it for observed. */
    actualPlusTravelMin: workedMin ? workedMin + travel : 0,
    actualBasis: !withTime.length ? null
      : onClock.length === withTime.length ? "measured" : "reported",
  };
}
