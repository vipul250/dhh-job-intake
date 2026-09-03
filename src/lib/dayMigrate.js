/* ---------------------------------------------------------------------- *
 * dayMigrate.js — lazily upgrading a stored day, with nothing else attached.
 *
 * This used to live in jobStore.js, and it moved for one reason: the
 * scheduled Google Sheet sync needs it, and jobStore.js cannot be loaded
 * outside the browser.
 *
 * jobStore imports storage.js, which imports supabase.js, which reads
 * `import.meta.env.VITE_SUPABASE_URL` — a Vite build-time substitution that
 * simply does not exist in a Vercel Node function, where `import.meta.env`
 * is undefined. storage.js also writes `from "./supabase"` with no file
 * extension, which Vite resolves and Node ESM refuses outright. So
 * `import { migrateDay } from "./jobStore.js"` inside api/ throws at cold
 * start, every night, as a 500 nobody would think to look at.
 *
 * Migration itself has no business touching storage: it takes rows and
 * gives back rows. Its only dependencies are isTombstone and
 * splitTrailingUnit, both of which load fine anywhere. So it lives here,
 * and jobStore.js re-exports it so that every existing importer — six
 * views and learned.js — is unaffected.
 *
 * WHY THE SYNC NEEDS IT AT ALL, rather than reading the raw stored array:
 * migration is what splits a unit off the end of a building name, and a
 * quarter of the stored month is written that way. Skipping it would leave
 * a stored `{property: "Afnan 5 603", unit: ""}` keyed differently from an
 * incoming `{property: "Afnan 5", unit: "603"}`, so the dedupe would not
 * match them and the sync would add the same job again every night.
 * ---------------------------------------------------------------------- */

import { isTombstone } from "./job.js";
import { splitTrailingUnit } from "./normalize.js";

/* ---------------------------------------------------------------------- *
 * Migration.
 *
 * Everything already stored — including the 474 rows imported from the
 * workbook — predates job identity. Those rows have an id but no state, no
 * origin date and no event log. Rather than a one-shot migration script
 * that has to be run at the right moment, a day is upgraded lazily the
 * first time it is opened. Old data keeps working, and the first edit to
 * any job gives it a proper history from that point on.
 * -------------------------------------------------------------------- */
export function migrateRow(row, date) {
  if (isTombstone(row)) return row;

  /* Runs on every row, migrated or not: a quarter of the stored month has
     the unit written on the end of the building with the unit column empty,
     and until it is split those rows each count as a building of their own. */
  const fixed = splitUnitIfStuck(row);
  if (fixed.state && fixed.events) return fixed;
  const row_ = fixed;

  // The previous build recorded outcomes under `verify`; carry them across
  // rather than dropping work the admin already did.
  let state = "scheduled";
  let outcomeReason = "";
  const v = row_.verify;
  if (v && v.outcome === "done") state = "fixed";
  else if (v && v.outcome === "not-done") { state = "not_done"; outcomeReason = v.reason || ""; }
  else if (v && v.outcome === "partial") { state = "not_done"; outcomeReason = v.reason || "Partially completed"; }

  const events = [];
  if (row_.createdAt) events.push({ at: row_.createdAt, kind: "created", by: row_.importedAt ? "import" : "unknown" });
  if (v && v.verifiedAt) {
    events.push({ at: v.verifiedAt, kind: state === "done" ? "done" : "not_done", by: v.verifiedBy || "admin", reason: outcomeReason });
  }
  if (!events.length) events.push({ at: Date.now(), kind: "created", by: "unknown" });

  return {
    ...row_,
    state,
    outcomeReason,
    scheduledDate: row_.scheduledDate || date,
    originDate: row_.originDate || date,
    pushCount: row_.pushCount || 0,
    inPms: row_.inPms !== undefined ? row_.inPms : (v ? v.inPms : (row_.sheetInPms ?? null)),
    pmsRef: row_.pmsRef || (v ? v.pmsRef : "") || row_.sheetPmsRef || "",
    actualMinutes: row_.actualMinutes ?? (v ? v.actualMinutes : null) ?? null,
    createdBy: row_.createdBy || "unknown",
    events,
  };
}

/* Only ever writes back a property that lost its trailing unit, and only
   when the unit column was empty. See splitTrailingUnit for why that is the
   one shape safe to move. */
function splitUnitIfStuck(row) {
  const s = splitTrailingUnit(row.property, row.unit);
  return s.split ? { ...row, property: s.property, unit: s.unit } : row;
}

export function migrateDay(rows, date) {
  return (rows || []).map((r) => migrateRow(r, date));
}

/* Does this day need writing back after migration? Only if something
   actually changed, so opening an already-migrated day is a pure read. */
export function needsMigration(rows) {
  return (rows || []).some((r) => !isTombstone(r) &&
    (!r.state || !r.events || splitTrailingUnit(r.property, r.unit).split));
}
