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
// Auth: Google side uses a read-only Service Account (see docs/SHEET-SYNC.md
// for one-time setup). Vercel side is protected by CRON_SECRET so nobody
// else can trigger it and force a sync outside the schedule.

import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";

import { parseSheetPaste, groupByDate } from "../src/lib/importSheet.js";
import { pasteAdditions, newJob } from "../src/lib/job.js";
// NOT from jobStore.js: that pulls in storage.js -> supabase.js, which reads
// import.meta.env (a Vite build-time substitution, undefined in a Node
// function) and imports "./supabase" with no file extension, which Node ESM
// refuses. Either one throws at cold start. dayMigrate.js is the same
// migration with nothing attached — see its header.
import { migrateDay } from "../src/lib/dayMigrate.js";

const SHEET_TAB = "Daily Input- Field Tasks";
// A2:U — same range the app's manual paste already expects (header optional,
// but including it lets column order in the Sheet drift without breaking
// this, same as a manual copy-paste from the Sheet already tolerates).
const SHEET_RANGE = `'${SHEET_TAB}'!A1:U`;

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

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const startedAt = new Date().toISOString();
  try {
    const values = await fetchSheetValues();
    if (!values.length) {
      res.status(200).json({ ok: true, message: "Sheet range was empty.", startedAt });
      return;
    }

    const text = valuesToTsv(values);
    const { jobs, skipped, warnings } = parseSheetPaste(text, null);
    const byDate = groupByDate(jobs);

    const supabase = supabaseServer();
    const results = [];
    let totalAdded = 0, totalDupes = 0;

    for (const [date, rows] of byDate) {
      if (!date || date === "(no date)") continue;
      const existingRaw = await readDayServer(supabase, date);
      const existing = migrateDay(existingRaw, date);

      const plan = pasteAdditions(existing, rows);
      const created = plan.add.map((r) => newJob(r, date, "Google Sheet sync"));

      if (created.length) {
        await writeDayServer(supabase, date, [...existing, ...created]);
      }

      totalAdded += created.length;
      totalDupes += plan.dupes;
      results.push({ date, added: created.length, alreadyHad: plan.dupes });
    }

    res.status(200).json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      rowsRead: values.length - 1,
      rowsSkipped: skipped,
      warnings,
      totalAdded,
      totalDupes,
      byDate: results,
    });
  } catch (err) {
    res.status(500).json({ ok: false, startedAt, error: err.message || String(err) });
  }
}
