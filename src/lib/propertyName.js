/* ---------------------------------------------------------------------- *
 * propertyName.js — one property, one name.
 *
 * canonProperty already folds casing, spacing and a few word forms, and it
 * collapses ten of the 188 property spellings in the real workbook. Four
 * genuine duplicates survive it:
 *
 *   Binghatti Tulip 305         5 visits  |  Binghatti tulips 305        1
 *   Binghatti Tulip 1105        2         |  Binghatti tulips 1105       1
 *   Jumeirah Golf Estates W019  6         |  Jumeirah golf estate W019   1
 *   Binghatti Royale 605        1         |  Bingatti Royale 605         2
 *
 * So sixteen "distinct pools" are twelve, a pool cleaned six times reads as
 * 5 + 1, and its delivered frequency reads 2.5 a week against a contract
 * specifying 2-3. Every figure grouped by property carries the same fault
 * today: repeat visits, the per-property cost table, any per-unit view.
 *
 * WHY EDIT DISTANCE IS THE WRONG TOOL, which is the whole design.
 *
 * Six pairs of canonical keys sit within two edits of each other, and only
 * two of the six are the same property:
 *
 *   jumeirah golf estates <> jumeirah golf estate   1   same
 *   palmera 2 villa 28 (  <> palmera 2 villa 28     2   same
 *   azizi riviera 10      <> azizi riviera 1        1   DIFFERENT BUILDINGS
 *   azizi riviera 13      <> azizi riviera 1        1   DIFFERENT
 *   azizi riviera 31      <> azizi riviera 1        1   DIFFERENT
 *   elite residence 4     <> elite residence        2   DIFFERENT (confirmed)
 *
 * In a portfolio of numbered buildings a one-character difference is
 * usually a different building. Any similarity threshold merges Azizi
 * Riviera 1 with 10, 13 and 31, and then bills one owner for three towers.
 *
 * So the rule refuses on a CATEGORY rather than a threshold: the numbers
 * must match exactly. That is not a tuned parameter, it is a flat refusal,
 * and it is what makes merging automatically safe here — the rule declines
 * the ambiguous cases instead of deciding them.
 * ---------------------------------------------------------------------- */

import { canonProperty, squash } from "./normalize.js";

/* One typo across a whole name. Two typos is a different property: at that
   point the evidence for "same building, badly typed" is weaker than the
   evidence for "two buildings". */
const EDIT_BUDGET = 1;

/* ---------------------------------------------------------------------- *
 * What counts as an IDENTIFIER rather than a word.
 *
 * Numbers were the obvious case. Running the rule over the real workbook
 * found two more that matter just as much, and both would have merged two
 * real buildings:
 *
 *   Celestia A                  <> Celestia B                  one edit
 *   Damac Towers by Paramount A <> Damac Towers by Paramount D  one edit
 *
 * A single letter is a building designator, not a spelling. "Tower A" and
 * "Tower B" differ by one character and are different towers, exactly as
 * Azizi Riviera 1 and 10 are. So anything that identifies rather than
 * names has to match exactly:
 *
 *   all digits        1, 28, 305
 *   a single char     A, B, D
 *   letters + digits  B2, T1, G01
 *
 * Everything else is a word, and words tolerate a plural or one typo.
 * ---------------------------------------------------------------------- */
const isIdentifier = (w) => /^\d+$/.test(w) || w.length === 1 || /\d/.test(w);

const tokens = (name) => {
  const c = canonProperty(name).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!c) return null;
  const all = c.split(" ");
  return {
    /* Ordered, so "Tower 1 Block 2" and "Tower 2 Block 1" stay apart. */
    ids: all.filter(isIdentifier).join(","),
    words: all.filter((w) => !isIdentifier(w)),
  };
};

/* Plural is free. "estates"/"estate", "tulips"/"tulip". */
const stem = (w) => w.replace(/(?:es|s)$/, "");

function distance(a, b, cap) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 1; i <= b.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const next = b[i - 1] === a[j - 1]
        ? diag
        : 1 + Math.min(diag, prev[j], prev[j - 1]);
      diag = prev[j];
      prev[j] = next;
    }
  }
  return prev[a.length];
}

/**
 * Are these two property names the same building?
 *
 * Identifiers — numbers, single letters, letter/digit codes — must match
 * exactly and in order, because they identify the building. Words are then
 * compared positionally, tolerating a plural or a single typo across the
 * whole name.
 */
export function sameProperty(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A || !B) return false;
  if (A.ids !== B.ids) return false;                   // the safety mechanism
  if (A.words.length !== B.words.length) return false;

  let budget = EDIT_BUDGET;
  for (let i = 0; i < A.words.length; i++) {
    const x = A.words[i], y = B.words[i];
    if (x === y) continue;
    if (stem(x) === stem(y)) continue;
    const d = distance(x, y, budget);
    if (d > budget) return false;
    budget -= d;
  }
  return true;
}

const pairKey = (a, b) => [canonProperty(a), canonProperty(b)].sort().join("||");

/* ---------------------------------------------------------------------- *
 * The index.
 *
 * Built from the job set rather than stored, because the merges come from a
 * deterministic rule and there is nothing about them worth persisting. Only
 * the EXCEPTIONS are stored — see `keepApart` — so the default is correct
 * and a stored list cannot rot as the portfolio grows.
 *
 * Resolution happens at read time and never rewrites a job. Adding an
 * exception re-groups everything on the next read, with nothing to
 * un-migrate; a rewrite would bake a wrong merge into the record, which is
 * the one mistake this exists to prevent.
 * ---------------------------------------------------------------------- */
export function buildPropertyIndex(jobs, propertyMaster, opts = {}) {
  const keepApart = new Set((opts.keepApart || []).map(([a, b]) => pairKey(a, b)));
  const master = new Map();
  (propertyMaster || []).forEach((p) => {
    const k = canonProperty(p && p.name);
    if (k) master.set(k, squash(p.name));
  });

  /* Every spelling seen, with how often and how it was written. */
  const seen = new Map();
  (jobs || []).forEach((j) => {
    const raw = squash(j && j.property);
    if (!raw) return;
    const k = canonProperty(raw);
    if (!k) return;
    if (!seen.has(k)) seen.set(k, { key: k, raw, count: 0 });
    const e = seen.get(k);
    e.count += 1;
    /* Keep the longest spelling of a given canonical key as its
       representative — the most complete rendering of the same string. */
    if (raw.length > e.raw.length) e.raw = raw;
  });

  /* Cluster the canonical keys under the rule. Most-used first, so the
     cluster forms around the spelling the department actually uses. */
  const entries = [...seen.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const clusters = [];
  entries.forEach((e) => {
    const host = clusters.find((c) =>
      c.members.some((m) => sameProperty(m.key, e.key) && !keepApart.has(pairKey(m.key, e.key))));
    if (host) host.members.push(e);
    else clusters.push({ members: [e] });
  });

  const canonicalFor = new Map();
  const merges = [];
  clusters.forEach((c) => {
    /* The master list is authoritative; otherwise the most-used spelling,
       and a tie goes to the longest as the most complete. */
    const fromMaster = c.members.map((m) => master.get(m.key)).find(Boolean);
    const best = fromMaster || c.members
      .slice()
      .sort((a, b) => b.count - a.count || b.raw.length - a.raw.length)[0].raw;

    c.members.forEach((m) => {
      canonicalFor.set(m.key, best);
      if (canonProperty(m.raw) !== canonProperty(best)) {
        merges.push({ from: m.raw, to: best, jobs: m.count });
      }
    });
  });

  merges.sort((a, b) => b.jobs - a.jobs || a.from.localeCompare(b.from));

  return {
    /** The canonical name for any spelling; the name itself when unknown. */
    resolve(name) {
      const raw = squash(name);
      if (!raw) return "";
      return canonicalFor.get(canonProperty(raw)) || raw;
    },
    /** What to report: [{ from, to, jobs }]. Nothing else. */
    merges,
    /** Distinct properties after resolution. */
    count: clusters.length,
  };
}
