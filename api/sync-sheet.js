// Vercel serverless function — pulls "Daily Input- Field Tasks" straight out
// of the live Google Sheet and adds any new rows to the app, on a schedule,
// with nobody pasting anything.
//
// Deliberately reuses the exact same pipeline the "Paste the day in" button
// already uses (parseSheetPaste -> pasteAdditions -> newJob -> mutateDay).
// That pipeline is already tested against real data and already has a fix
// for a real incident (see the comment above pasteAdditions in job.js —
// re-importing the same day used to silently drop 4 of Resty's 5 pool
// cleanings). Writing a second, separate import path here would mean that
// bug class exists twice. This just calls the same one.
//
// What this does NOT do: overwrite anything. It only ever adds rows the day
// doesn't already have (by the same content-key logic the paste button
// uses). A job closed out in the app, moved, or edited by a coordinator is
// never touched by this endpoint — the Sheet is only ever a source of new
// rows, never a source of truth for jobs the app already knows about.
//
// And it only reaches today plus the next few days. It used to feed every
// date in the tab into a write, which churned settled history every night
// and — because the Sheet lists a moved job under the date it was moved OFF
// — put moved jobs back where they came from, nightly. Both halves of that
// are fixed: the window below, and countTombstones on pasteAdditions.
//
// Auth: Google side uses a read-only Service Account (see docs/SHEET-SYNC.md
// for one-time setup). Vercel side is protected by CRON_SECRET so nobody
// else can trigger it and force a sync outside the schedule.

import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";

import { parseSheetPaste, groupByDate } from "../src/lib/importSheet.js";
import { squash } from "../src/lib/normalize.js";
import { pasteAdditions, newJob } from "../src/lib/job.js";
// NOT from jobStore.js: that pulls in storage.js -> supabase.js, which reads
// import.meta.env (a Vite build-time substitution, undefined in a Node
// function) and imports "./supabase" with no file extension, which Node ESM
// refuses. Either one throws at cold start. dayMigrate.js is the same
// migration with nothing attached — see its header.
import { migrateDay } from "../src/lib/dayMigrate.js";

const SHEET_TAB = "Daily Input- Field Tasks";
// A1:U — same range the app's manual paste already expects (header optional,
// but including it lets column order in the Sheet drift without breaking
// this, same as a manual copy-paste from the Sheet already tolerates).
//
// The whole tab is still READ, because the Sheets values API has no date
// filter and rows for a future date are not guaranteed to sit at the
// bottom. The narrowing below is applied after parsing, which is where it
// matters: reading a thousand rows once a night is free, WRITING to
// fifteen past days every night is not.
const SHEET_RANGE = `'${SHEET_TAB}'!A1:U`;

/* ---------------------------------------------------------------------- *
 * How far the sync is allowed to reach.
 *
 * It used to feed every date in the tab — the whole imported month and
 * everything since — into a write. Two reasons that is wrong:
 *
 * A past day is settled. Its outcomes are recorded, its jobs have been
 * closed out, moved or cancelled, and the Sheet is not kept in step with
 * any of that. Re-importing it every night churns history.
 *
 * And a job MOVED to another day is listed in the Sheet under the date it
 * was moved OFF. With a wide window the sync would put it back there every
 * night. The tombstone rule below is the other half of that fix; this is
 * the half that stops it being asked in the first place.
 *
 * So: today and the next few days, which is all an automatic daily sync
 * needs — the evening coordinator builds tomorrow, and a couple of days of
 * slack covers scheduling further ahead and a cron that fired late.
 * Nothing backwards by default. A row that has to be added to a past day is
 * either an out-of-hours job (the board has a button for that) or a
 * deliberate re-paste by a person.
 *
 * Both ends are env-overridable, because this runs unattended and changing
 * a constant should not need a deploy to try.
 * ---------------------------------------------------------------------- */
const DAYS_AHEAD = Number(process.env.SYNC_DAYS_AHEAD ?? 3);
const DAYS_BACK = Number(process.env.SYNC_DAYS_BACK ?? 0);

/* The Sheet's dates are Gulf dates, and this runs on UTC. At 03:00 UTC it
   is 07:00 in Dubai and the date agrees — but Hobby crons fire within an
   approximate window, and a run that slipped to 21:00 UTC would be reading
   "today" as the wrong day. UTC+4, no daylight saving. */
const GULF_OFFSET_MS = 4 * 60 * 60 * 1000;

const gulfToday = () => new Date(Date.now() + GULF_OFFSET_MS).toISOString().slice(0, 10);

export function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* Exported for test/suites/sheetsync.mjs. Vercel only ever calls the
   default export; extra named exports cost nothing. */
export function syncWindow() {
  const today = gulfToday();
  return { today, from: shiftDate(today, -DAYS_BACK), to: shiftDate(today, DAYS_AHEAD) };
}

function supabaseServer() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set.");
  return createClient(url, key);
}

async function readDayServer(supabase, date) {
  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("key", `schedule:${date}`)
    .maybeSingle();
  if (error) throw new Error(`readDay(${date}) failed: ${error.message}`);
  try {
    const v = data ? JSON.parse(data.value) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function writeDayServer(supabase, date, rows) {
  const { error } = await supabase
    .from("kv_store")
    .upsert(
      { key: `schedule:${date}`, value: JSON.stringify(rows), updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(`writeDay(${date}) failed: ${error.message}`);
}

async function fetchSheetValues() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !rawKey || !sheetId) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_SHEET_ID env vars."
    );
  }
  // Vercel env vars are single-line; the private key's newlines are stored
  // as literal "\n" and must be un-escaped before use.
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/` +
    `${encodeURIComponent(SHEET_RANGE)}?valueRenderOption=FORMATTED_VALUE`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Sheets API ${resp.status}: ${body.slice(0, 300)}`);
  }
  const json = await resp.json();
  return json.values || [];
}

// Rebuild the same tab-separated text the paste box expects, so this feeds
// through parseSheetPaste unchanged — one parser, one set of rules, for
// both the human path and this one.
function valuesToTsv(values) {
  return values.map((row) => row.map((c) => String(c ?? "")).join("\t")).join("\n");
}

/* ---------------------------------------------------------------------- *
 * Everything after the Sheet has been read, split out from the reading.
 *
 * Partly because fetching and deciding are different jobs, and partly for
 * a practical reason: this is the half worth testing. Nobody watches a
 * 03:00 cron, so every way it can go wrong is silent — a window that skips
 * everything, a moved job restored to the day it left, a duplicate added
 * every night for a month. All of that lives here and is driven directly
 * by test/suites/sheetsync.mjs. What is left in fetchSheetValues is a
 * signed token exchange and one GET, which no local test can meaningfully
 * validate anyway: it works with real credentials or it does not, and
 * docs/SHEET-SYNC.md says to trigger a run by hand once to find out.
 * ---------------------------------------------------------------------- */
export async function syncValues(values, opts = {}) {
  const dryRun = !!opts.dryRun;
  const text = valuesToTsv(values);
    const { jobs, skipped, warnings } = parseSheetPaste(text, null);
    const byDate = groupByDate(jobs);

    const win = syncWindow();
    const inWindow = (d) => d >= win.from && d <= win.to;

    const supabase = supabaseServer();
    const results = [];
    const skippedDates = [];
    let totalAdded = 0, totalDupes = 0;

    for (const [date, rows] of byDate) {
      if (!date || date === "(no date)") continue;
      if (!inWindow(date)) { skippedDates.push({ date, rows: rows.length }); continue; }

      const existingRaw = await readDayServer(supabase, date);
      const existing = migrateDay(existingRaw, date);

      /* countTombstones: a job that already left this day has been dealt
         with. The Sheet still lists it under the date it was moved OFF,
         because moving a job in the app does not rewrite the Sheet — so
         without this the sync would put it back every night. A person
         pasting by hand gets the opposite default; see pasteAdditions. */
      const plan = pasteAdditions(existing, rows, { countTombstones: true });
      const created = plan.add.map((r) => newJob(r, date, "Google Sheet sync"));

      if (created.length && !dryRun) {
        await writeDayServer(supabase, date, [...existing, ...created]);
      }

      totalAdded += created.length;
      totalDupes += plan.dupes;
      results.push({
        date,
        added: created.length,
        alreadyHad: plan.dupes,
        /* On a dry run the counts alone are not much of a report — what
           somebody wants to know is WHICH rows would land. Capped, because
           this goes into a log line as well as the response. */
        rows: plan.add.slice(0, 8).map((r) =>
          [squash(r.property), squash(r.unit), squash(r.description).slice(0, 40)]
            .filter(Boolean).join(" · ")),
      });
    }

  return {
      dryRun,
      ...(dryRun ? { message: "Dry run — nothing was written. `added` is what WOULD be added." } : {}),
      rowsRead: values.length - 1,
      rowsSkipped: skipped,
      warnings,
      /* Said out loud, because a sync that quietly ignores most of the tab
         is otherwise indistinguishable from one that is broken. */
      window: { today: win.today, from: win.from, to: win.to,
                daysBack: DAYS_BACK, daysAhead: DAYS_AHEAD },
      datesOutsideWindow: skippedDates,
      totalAdded,
      totalDupes,
      byDate: results,
  };
}

/* ---------------------------------------------------------------------- *
 * Never let a private key reach a log line.
 *
 * The error from a malformed service-account key is the single most likely
 * failure here, and error text from a crypto or auth library can carry the
 * material it was handed. A runtime log is readable by anyone with access
 * to the Vercel project and it persists, so PEM blocks are stripped before
 * anything is written. Cheap, and the alternative is unrecoverable.
 * ---------------------------------------------------------------------- */
function scrub(text) {
  return String(text == null ? "" : text)
    .replace(/-----BEGIN[\s\S]*?END[^-]*-----/g, "[private key redacted]")
    .replace(/\b[A-Za-z0-9_-]{100,}\b/g, "[long token redacted]");
}

/* ---------------------------------------------------------------------- *
 * Why this logs at all.
 *
 * The first real run came back 500 and the reason was unrecoverable: the
 * handler put the message in the HTTP RESPONSE, which the cron trigger
 * received and nothing kept. Vercel's runtime log recorded
 * "GET /api/sync-sheet 500" and no more, and its error tracker saw nothing
 * at all because the error was caught rather than thrown. A nightly job
 * nobody watches has to say what it did in the one place that is still
 * there in the morning.
 * ---------------------------------------------------------------------- */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    /* Logged as a warning: a 401 is either somebody probing the URL or —
       far more likely, and worth being able to tell apart — CRON_SECRET not
       being set on the project at all. */
    console.warn("[sync-sheet] 401 unauthorized" +
      (cronSecret ? "" : " — CRON_SECRET is not set on this project"));
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  /* ?dryRun=1 reads the Sheet and reports exactly what it would add,
     writing nothing. Still behind the secret. */
  const dryRun = /[?&]dryrun=(1|true)\b/i.test(String(req.url || "")) ||
    ["1", "true"].includes(String(req.query?.dryRun ?? "").toLowerCase());

  const startedAt = new Date().toISOString();
  try {
    const values = await fetchSheetValues();
    if (!values.length) {
      const empty = { ok: true, message: "Sheet range was empty.", startedAt };
      console.log("[sync-sheet]", JSON.stringify(empty));
      res.status(200).json(empty);
      return;
    }
    const summary = await syncValues(values, { dryRun });
    const body = {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...summary,
    };
    /* One line, the whole outcome, in the runtime log. */
    console.log("[sync-sheet]", JSON.stringify(body));
    res.status(200).json(body);
  } catch (err) {
    const body = {
      ok: false,
      startedAt,
      dryRun,
      error: scrub(err && err.message ? err.message : err),
    };
    /* console.error so it lands at error level and get_runtime_logs can be
       filtered to it. The stack is worth having — the message alone does
       not say whether the Sheet read or the database write failed. */
    console.error("[sync-sheet] FAILED", JSON.stringify(body),
      scrub(err && err.stack ? err.stack : ""));
    res.status(500).json(body);
  }
}
