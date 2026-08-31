/* ---------------------------------------------------------------------- *
 * jobStore.js — reads and writes a day, safely, with two people on it.
 *
 * The old code did `setJobsByDate(...)` from a React closure and then wrote
 * the whole array. With one person on one screen that is fine. With the
 * evening coordinator, the morning coordinator and the admin all touching
 * the same day — which is the entire point of moving off Sheets — it is a
 * lost-update bug waiting to happen: whoever saves last silently erases
 * what the other two just did. That is the same class of failure as the
 * morning coordinator overwriting the night's schedule, and it would be
 * embarrassing to rebuild it in the replacement.
 *
 * So every write is read-modify-write against the STORED array, merged by
 * job id, never against whatever React happened to be holding. Two people
 * editing different jobs on the same day both land. Two people editing the
 * same job is genuinely ambiguous, and there the later write wins — but
 * the loser's change is still in that job's event log, so it is
 * recoverable rather than gone.
 * ---------------------------------------------------------------------- */

import {
  storageGet, storageSet, storageList, storageGetVersioned, storageCompareAndSet,
} from "./storage.js";
import { isTombstone } from "./job.js";

const key = (date) => `schedule:${date}`;

export function parseDay(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function readDay(date) {
  return parseDay(await storageGet(key(date)));
}

export async function readDays(dates) {
  const out = {};
  const BATCH = 6;
  for (let i = 0; i < dates.length; i += BATCH) {
    const slice = dates.slice(i, i + BATCH);
    const vals = await Promise.all(slice.map((d) => storageGet(key(d))));
    vals.forEach((v, k) => { out[slice[k]] = parseDay(v); });
  }
  return out;
}

/**
 * Apply a change to a day.
 *
 * Read-modify-write on its own is not enough. Two people acting within the
 * same second — the coordinator adding a job while the admin closes
 * another one — both read the same array, and the second write erases the
 * first. That was reproduced with two tabs before this was written, and it
 * is the same silent loss the app exists to stop, so the write is guarded.
 *
 * The mutator may run more than once. It is handed the rows as they
 * actually are on each attempt, so it must derive its result from that
 * argument rather than from anything captured beforehand — which is why
 * every caller in LiveBoard.jsx takes `cur` and builds from it.
 *
 * @param {string} date
 * @param {(rows: Array) => Array} mutator  receives the freshly-read rows
 * @returns {Promise<Array>} the rows as written
 */
export async function mutateDay(date, mutator, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const { value, version, failed } = await storageGetVersioned(key(date));
    if (failed) throw new Error("Could not read the schedule — check the database connection.");
    const next = mutator(parseDay(value)) || [];
    const res = await storageCompareAndSet(key(date), JSON.stringify(next), version);
    if (res.ok) return next;
    if (!res.conflict) throw new Error(res.error || "Could not save — the database rejected the write.");
    // Somebody else wrote first. Back off briefly, then re-read and
    // re-apply on top of what they wrote.
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 120 * (i + 1)));
  }
  throw new Error("Could not save — too many people editing this day at once. Try again.");
}

/** Replace one job in place, or append it if the day has not seen it. */
export function upsert(rows, job) {
  const i = rows.findIndex((r) => !isTombstone(r) && r.id === job.id);
  if (i < 0) return [...rows, job];
  const copy = rows.slice();
  copy[i] = job;
  return copy;
}

/** Take a job off a day (used by a move — always paired with a tombstone). */
export function removeJob(rows, jobId) {
  return rows.filter((r) => isTombstone(r) || r.id !== jobId);
}

export async function listScheduleDates() {
  const keys = await storageList("schedule:");
  return keys.map((k) => k.replace("schedule:", "")).sort();
}

/* ---------------------------------------------------------------------- *
 * Live refresh.
 *
 * Supabase realtime would be nicer, but this store is a key/value blob
 * behind an anon key with no per-row subscriptions set up, and polling one
 * short row every few seconds costs nothing at this volume. What matters
 * is the behaviour, not the transport: a poll must never clobber something
 * the person at this keyboard just did, so a poll that lands within
 * `quietMs` of a local write is skipped.
 * ---------------------------------------------------------------------- */
export function createDayWatcher({ intervalMs = 10000, quietMs = 4000 } = {}) {
  let timer = null;
  let lastLocalWrite = 0;
  let currentDate = null;
  let onChange = () => {};
  let lastSerialised = "";

  async function tick() {
    if (!currentDate) return;
    if (Date.now() - lastLocalWrite < quietMs) return;
    try {
      const raw = await storageGet(key(currentDate));
      const s = raw || "[]";
      if (s !== lastSerialised) {
        lastSerialised = s;
        onChange(parseDay(raw));
      }
    } catch {
      /* a failed poll is not worth surfacing — the next one will catch up */
    }
  }

  return {
    watch(date, cb, seedRows) {
      currentDate = date;
      onChange = cb;
      lastSerialised = seedRows ? JSON.stringify(seedRows) : "";
      clearInterval(timer);
      timer = setInterval(tick, intervalMs);
    },
    /** Call right after a local write so the next poll does not fight it. */
    noteLocalWrite(rows) {
      lastLocalWrite = Date.now();
      if (rows) lastSerialised = JSON.stringify(rows);
    },
    stop() { clearInterval(timer); timer = null; currentDate = null; },
  };
}

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
  if (row.state && row.events) return row;

  // The previous build recorded outcomes under `verify`; carry them across
  // rather than dropping work the admin already did.
  let state = "scheduled";
  let outcomeReason = "";
  const v = row.verify;
  if (v && v.outcome === "done") state = "fixed";
  else if (v && v.outcome === "not-done") { state = "not_done"; outcomeReason = v.reason || ""; }
  else if (v && v.outcome === "partial") { state = "not_done"; outcomeReason = v.reason || "Partially completed"; }

  const events = [];
  if (row.createdAt) events.push({ at: row.createdAt, kind: "created", by: row.importedAt ? "import" : "unknown" });
  if (v && v.verifiedAt) {
    events.push({ at: v.verifiedAt, kind: state === "done" ? "done" : "not_done", by: v.verifiedBy || "admin", reason: outcomeReason });
  }
  if (!events.length) events.push({ at: Date.now(), kind: "created", by: "unknown" });

  return {
    ...row,
    state,
    outcomeReason,
    scheduledDate: row.scheduledDate || date,
    originDate: row.originDate || date,
    pushCount: row.pushCount || 0,
    inPms: row.inPms !== undefined ? row.inPms : (v ? v.inPms : (row.sheetInPms ?? null)),
    pmsRef: row.pmsRef || (v ? v.pmsRef : "") || row.sheetPmsRef || "",
    actualMinutes: row.actualMinutes ?? (v ? v.actualMinutes : null) ?? null,
    createdBy: row.createdBy || "unknown",
    events,
  };
}

export function migrateDay(rows, date) {
  return (rows || []).map((r) => migrateRow(r, date));
}

/* Does this day need writing back after migration? Only if something
   actually changed, so opening an already-migrated day is a pure read. */
export function needsMigration(rows) {
  return (rows || []).some((r) => !isTombstone(r) && (!r.state || !r.events));
}
