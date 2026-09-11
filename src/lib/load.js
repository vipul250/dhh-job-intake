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
import { canonProperty, canonKey, splitCrew } from "./normalize.js";

export const DEFAULT_SHIFT_MIN = 540;

/* ---------------------------------------------------------------------- *
 * Where a "building" is not a building.
 *
 * Travel was counted per distinct property, which is right for a tower:
 * three units in Mesk 1 Midtown is one trip and three lifts. It is wrong
 * for a villa community. Palm Villa L14 and Palm Villa O56 are different
 * fronds of the Palm; Resty drives between them. Counting his five pool
 * cleans as one building gave him a travel estimate of zero.
 *
 * Named, not guessed. The unit format cannot carry this: "B 419" and
 * "B419" are one Belgravia Square apartment, "C2315" is a tower unit with
 * its tower letter, and "P407" is on a podium. A heuristic on unit shape
 * would have moved a dozen towers into this category to catch two real
 * communities.
 *
 * Rule and exceptions, the same pattern propertyName.js uses: a short list
 * that somebody can read and correct, rather than a clever test that is
 * wrong in ways nobody can see.
 * ---------------------------------------------------------------------- */
const SPREAD_PROPERTIES = [
  "palm villa",
  "jumeirah golf estates",
];

/* Frond to frond is not Dubai Marina to Mudon. Half the between-community
   assumption, and measured the same way once arrival times exist. */
export const INTRA_COMMUNITY_MIN = 15;

export const isSpread = (property) =>
  SPREAD_PROPERTIES.includes(canonKey(property));

/* One entry per place somebody actually has to drive to, and how far the
   hop to it is. Within a villa community the hop is short; between
   properties it is the full estimate. */
export function travelStops(jobs) {
  const stops = new Map();
  (jobs || []).forEach((j) => {
    const p = canonProperty(j.property);
    if (!p) return;
    const spread = isSpread(j.property);
    const key = spread ? `${canonKey(p)}|${canonKey(j.unit)}` : canonKey(p);
    if (!stops.has(key)) stops.set(key, { community: canonKey(p), spread });
  });
  return [...stops.values()];
}

/* Moves, split by how far they are. Ordering is unknown — the board is not
   a route — so the cheap assumption is that every hop inside a community
   is an intra-community hop and each new community costs a full one. */
export function travelEstimate(jobs, betweenMin, intraMin = INTRA_COMMUNITY_MIN) {
  const stops = travelStops(jobs);
  if (stops.length < 2) return { minutes: 0, moves: 0, stops: stops.length, intra: 0, between: 0 };
  const communities = new Set(stops.map((s) => s.community));
  const between = communities.size - 1;
  const intra = stops.length - communities.size;
  return {
    minutes: between * betweenMin + intra * intraMin,
    moves: between + intra,
    stops: stops.length,
    intra,
    between,
  };
}

/**
 * @param {object[]} list      every row on this technician's card
 * @param {number} travelMin   minutes per move between buildings
 * @param {number} shiftMin
 */
export function groupLoad(list, travelMin, shiftMin = DEFAULT_SHIFT_MIN) {
  const rows = (list || []).filter(Boolean);
  const work = rows.filter((j) => !isOffBoard(j));

  const planMin = work.reduce((s, j) => s + (jobMinutes(j) || 0), 0);
  const est = travelEstimate(work, travelMin);
  const buildings = new Set(work.map((j) => canonProperty(j.property)).filter(Boolean));
  const travel = est.minutes;
  const moves = est.moves;
  const committed = planMin + travel;

  const withTime = work.filter((j) => actualDuration(j).minutes != null);
  const onClock = withTime.filter((j) => actualDuration(j).source === "clock");
  const workedMin = withTime.reduce((s, j) => s + (actualDuration(j).minutes || 0), 0);

  return {
    jobs: work.length,
    offBoard: rows.length - work.length,
    buildings: buildings.size,
    /* Places he has to drive to. In a villa community that is more than
       the number of properties — see travelStops. */
    stops: est.stops,
    moves,
    intraMoves: est.intra,
    betweenMoves: est.between,
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
