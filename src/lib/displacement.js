/* ---------------------------------------------------------------------- *
 * Was the call right?
 *
 * Twelve of the thirteen jobs that left 10 September were displaced by an
 * arriving guest complaint or appointment. Every one of those is a
 * coordinator deciding that the new work matters more than the work already
 * scheduled — and until now the board recorded that a job moved and what
 * took its place, but never compared the two.
 *
 * Both priorities are already stored. The tombstone carries the displaced
 * job's, and `displacedBy.jobId` points at the winner. Nobody had put them
 * side by side.
 *
 * WHAT THIS IS NOT. A lower-priority job winning is not a mistake. A P3
 * with a guest standing in the unit at an agreed hour legitimately beats a
 * P1 nobody can get access to. Priority is one input to a judgement that
 * also weighs access, the guest, the building and the material. So the
 * verdicts here are "higher won", "same", "lower won" — descriptions, not
 * scores. The last of those is worth a look, and that is all it is.
 *
 * Coverage is reported with every figure, because it is poor: of 105
 * departures in the database, 37 name the winning job and 56 carry the
 * displaced job's priority. The comparable set is the intersection.
 * ---------------------------------------------------------------------- */
import { canonPriority, canonProperty, canonUnit, squash } from "./normalize.js";
import { isTombstone, latestTombstones } from "./job.js";

/* PRI-1 outranks PRI-4. Lower number, higher claim on the day. */
const rank = (p) => {
  const c = canonPriority(p);
  return c ? Number(c.slice(4)) : null;
};

export const VERDICTS = {
  higher: "higher priority won",
  same: "same priority",
  lower: "lower priority won",
};

/* A label like "Bingatti Avenue 2201, bad smell" names the winner without
   linking it. Matching it back is allowed ONLY when exactly one job on the
   day is at that address — an ambiguous match is left unresolved rather
   than guessed, because a wrong pairing here reads as a coordinator making
   a bad call he did not make. */
function findByLabel(label, jobs) {
  const text = squash(label).toLowerCase();
  if (!text) return null;
  const hits = jobs.filter((j) => {
    const unit = canonUnit(j.unit);
    const prop = canonProperty(j.property).toLowerCase();
    if (!unit || !prop) return false;
    return text.includes(unit.toLowerCase()) && text.includes(prop.split(/\s+/)[0]);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * @param {object[]} rows  one day as stored — jobs and tombstones together
 * @param {string} date
 */
export function displacementsForDay(rows, date) {
  const all = rows || [];
  const jobs = all.filter((r) => r && !isTombstone(r));
  const byId = new Map(jobs.map((j) => [j.id, j]));

  return latestTombstones(all)
    .filter((t) => t.displacedBy)
    .map((t) => {
      const link = t.displacedBy.jobId ? byId.get(t.displacedBy.jobId) : null;
      const guessed = link ? null : findByLabel(t.displacedBy.label, jobs);
      const winner = link || guessed;

      const lostPri = rank(t.snapshot && t.snapshot.priority);
      const wonPri = winner ? rank(winner.priority) : null;
      const comparable = lostPri != null && wonPri != null;

      return {
        date,
        jobId: t.jobId,
        toDate: t.toDate,
        reason: t.reason,
        by: t.by,
        lost: {
          property: squash(t.snapshot && t.snapshot.property),
          unit: squash(t.snapshot && t.snapshot.unit),
          description: squash(t.snapshot && t.snapshot.description),
          team: squash(t.snapshot && t.snapshot.team),
          priority: canonPriority(t.snapshot && t.snapshot.priority),
        },
        won: winner
          ? {
              property: squash(winner.property),
              unit: squash(winner.unit),
              description: squash(winner.description),
              priority: canonPriority(winner.priority),
            }
          : null,
        label: squash(t.displacedBy.label),
        /* How the winner was identified, so a reader can weigh it. */
        resolvedBy: link ? "link" : guessed ? "label" : null,
        comparable,
        verdict: !comparable ? null
          : wonPri < lostPri ? "higher"
          : wonPri === lostPri ? "same"
          : "lower",
      };
    });
}

/** @param {object} byDay  { "2026-09-10": rows[] } */
export function displacementReport(byDay, period) {
  const rows = [];
  Object.entries(byDay || {}).forEach(([date, day]) => {
    if (period && !inPeriod(date, period)) return;
    rows.push(...displacementsForDay(day, date));
  });

  const comparable = rows.filter((r) => r.comparable);
  const count = (v) => comparable.filter((r) => r.verdict === v).length;

  return {
    rows: rows.sort((a, b) => b.date.localeCompare(a.date)),
    displacements: rows.length,
    comparable: comparable.length,
    /* The honest denominator. Everything below runs on `comparable`, which
       is a fraction of `displacements`, and saying so is the point. */
    coverage: rows.length ? Math.round((comparable.length / rows.length) * 1000) / 10 : null,
    higher: count("higher"),
    same: count("same"),
    lower: count("lower"),
    /* Named, because these are the only ones anybody needs to read. */
    worthALook: comparable.filter((r) => r.verdict === "lower"),
  };
}

function inPeriod(date, period) {
  if (typeof period === "string") return date.startsWith(period);
  return (!period.from || date >= period.from) && (!period.to || date <= period.to);
}
