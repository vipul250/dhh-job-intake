/* ---------------------------------------------------------------------- *
 * sheetsync.mjs — the scheduled Google Sheet sync, driven end to end with
 * the network stubbed.
 *
 * This one is worth an integration test rather than unit tests, because
 * nobody watches it. It runs at 03:00, and every way it can go wrong is a
 * way that goes wrong silently: a module that will not load in a Node
 * runtime, a window that skips everything, a moved job restored to the day
 * it was moved off, a duplicate added every night for a month.
 *
 * Nothing real is contacted. `syncValues` is driven with the rows the
 * Sheets API would have returned, and `fetch` is replaced so Supabase's
 * REST interface answers from an in-memory store. The token exchange and
 * the one GET in fetchSheetValues are deliberately not covered — they work
 * with real credentials or they do not, and docs/SHEET-SYNC.md says to
 * trigger a run by hand once to find out.
 *
 * Run:  node test/suites/sheetsync.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";

const SECRET = "test-cron-secret";
const SUPA = "https://stub.supabase.co";

process.env.CRON_SECRET = SECRET;
process.env.SUPABASE_URL = SUPA;
process.env.SUPABASE_ANON_KEY = "stub-anon-key";

let checks = 0;
const ok = (what) => { checks++; console.log("  ok  " + what); };

/* ------------------------- the fake world ---------------------------- */

const iso = (d) => d.toISOString().slice(0, 10);
const gulfToday = () => iso(new Date(Date.now() + 4 * 3600 * 1000));
const shift = (base, n) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

const TODAY = gulfToday();
const TOMORROW = shift(TODAY, 1);
const NEXT_WEEK = shift(TODAY, 9);      // outside the window
const LAST_MONTH = shift(TODAY, -30);   // outside the window

const HEADER = [
  "Date", "Shift", "Team / Technician", "Property", "Unit / Villa No.", "Status",
  "Parking No.", "Time of Visit", "Guest Confirmed", "Task Description (Scope of Work)",
  "Material Needed? (Y/N)", "Material Details (what + qty)", "Estimated Time",
  "Pending? (Y/N)", "Pending Details (what's pending)", "Priority", "Notes",
  "In PMS? (Y/N)", "PMS Ticket / Task Ref", "Changed After 8pm Posting? (Y/N)",
  "What Changed / When",
];

const row = (date, tech, prop, unit, desc, est = "1 hr") =>
  [date, "09:00-18:00", tech, prop, unit, "Vacant", "", "", "N", desc,
   "N", "", est, "N", "", "P3-Medium", "", "", "", "", ""];

/** The Sheet, as the sync will read it. */
const SHEET_ROWS = [
  HEADER,
  row(TODAY, "Resty", "Palm villa", "", "Pool Cleaning"),
  row(TODAY, "Resty", "Palm villa", "", "Pool Cleaning"),
  row(TODAY, "Resty", "Palm villa", "", "Pool Cleaning"),
  row(TODAY, "Vitalis", "La Vie", "3503", "Reset smart lock"),
  row(TODAY, "Jabbar", "Afnan 5 603", "", "AC not cooling"),
  row(TOMORROW, "Bright", "Sky Gardens", "1203", "drawer needs fixing"),
  row(NEXT_WEEK, "Anthony", "Beach Isle Tower 2", "P402", "light not working"),
  row(LAST_MONTH, "Adi", "Claren Tower 1", "1301", "bathtub polishing"),
];

/* What each day already holds in the database. */
const store = new Map();
const writes = [];

function seedStore() {
  store.clear();
  writes.length = 0;
  store.set(`schedule:${TODAY}`, [
    /* Already imported yesterday: one of Resty's pools and Vitalis's job. */
    { id: "a1", property: "Palm villa", unit: "", description: "Pool Cleaning",
      state: "scheduled", events: [], team: "Resty" },
    { id: "a2", property: "La Vie", unit: "3503", description: "Reset smart lock",
      state: "scheduled", events: [], team: "Vitalis" },
    /* And one that a coordinator MOVED to another day. The Sheet still
       lists it under today, because moving a job does not rewrite the
       Sheet. It must not come back. */
    { _tomb: true, id: "tomb-a3", jobId: "a3", toDate: TOMORROW, at: Date.now(),
      by: "Haris", reason: "guest not in",
      snapshot: { property: "Afnan 5", unit: "603", description: "AC not cooling",
                  team: "Jabbar", priority: "P3-Medium", estimatedTime: "1 hr" } },
  ]);
  store.set(`schedule:${LAST_MONTH}`, []);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);

  // Supabase REST.
  if (u.startsWith(SUPA)) {
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET") {
      const key = decodeURIComponent((u.match(/key=eq\.([^&]+)/) || [])[1] || "");
      const rows = store.get(key);
      const body = rows ? { value: JSON.stringify(rows) } : null;
      return new Response(JSON.stringify(body),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    // upsert
    const payload = JSON.parse(init.body);
    const rec = Array.isArray(payload) ? payload[0] : payload;
    writes.push({ key: rec.key, rows: JSON.parse(rec.value) });
    store.set(rec.key, JSON.parse(rec.value));
    return new Response(JSON.stringify([rec]),
      { status: 201, headers: { "content-type": "application/json" } });
  }

  throw new Error("unexpected fetch in test: " + u);
};

const mkRes = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const { default: handler, syncValues, syncWindow, shiftDate } =
  await import("../../api/sync-sheet.js");

/* ---------------------- 1. the window arithmetic --------------------- */
{
  const w = syncWindow();
  assert.equal(w.today, TODAY, "today is a Gulf date, not a UTC one");
  assert.equal(w.from, TODAY, "nothing backwards by default");
  assert.equal(w.to, shift(TODAY, 3), "today plus three");
  assert.equal(shiftDate("2026-02-28", 1), "2026-03-01", "month ends behave");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31", "so do year ends");
  ok("the window is today..+3 in Gulf dates");
}

/* ---------------------- 2. a full run -------------------------------- */
{
  seedStore();
  const b = await syncValues(SHEET_ROWS);

  assert.equal(b.rowsRead, SHEET_ROWS.length - 1);
  assert.deepEqual(b.window, { today: TODAY, from: TODAY, to: shift(TODAY, 3),
                               daysBack: 0, daysAhead: 3 });

  /* Only dates inside the window were touched. */
  const touched = b.byDate.map((x) => x.date).sort();
  assert.deepEqual(touched, [TODAY, TOMORROW].sort(),
    "next week and last month are left alone");
  const outside = b.datesOutsideWindow.map((x) => x.date).sort();
  assert.deepEqual(outside, [LAST_MONTH, NEXT_WEEK].sort(),
    "and are reported rather than silently dropped");
  assert.ok(!writes.some((w) => w.key === `schedule:${LAST_MONTH}`),
    "no write reached a settled past day");
  ok("only today..+3 is written, and what was skipped is reported");
}

/* ---------------------- 3. the moved job stays moved ----------------- */
{
  const day = store.get(`schedule:${TODAY}`);
  const afnan = day.filter((r) => !r._tomb && r.property === "Afnan 5");
  assert.equal(afnan.length, 0,
    "the job moved to another day was NOT restored to the day it left");
  assert.ok(day.some((r) => r._tomb && r.snapshot.property === "Afnan 5"),
    "and its tombstone is still there");
  ok("a job moved to another day is not brought back");
}

/* ---------------------- 4. the pools still top up -------------------- */
{
  const day = store.get(`schedule:${TODAY}`);
  const pools = day.filter((r) => !r._tomb && r.description === "Pool Cleaning");
  assert.equal(pools.length, 3,
    "the day had one, the Sheet has three, so two were added — not zero, not three");
  const lavie = day.filter((r) => !r._tomb && r.property === "La Vie");
  assert.equal(lavie.length, 1, "the job already there was not duplicated");
  ok("indistinguishable rows top up to the Sheet's count without duplicating");
}

/* ---------------------- 5. running it again adds nothing ------------- */
{
  writes.length = 0;
  const b2 = await syncValues(SHEET_ROWS);
  assert.equal(b2.totalAdded, 0, "a second run in the same night is a no-op");
  assert.equal(writes.length, 0, "and does not even write");
  ok("a second run adds nothing and writes nothing");
}

/* ---------------------- 6. the unit is split on the way in ----------- */
{
  seedStore();
  store.set(`schedule:${TODAY}`, []);
  await syncValues(SHEET_ROWS);
  const day = store.get(`schedule:${TODAY}`);
  const afnan = day.find((r) => /Afnan/.test(r.property));
  assert.equal(afnan.property, "Afnan 5");
  assert.equal(afnan.unit, "603", "the unit is split off the building name");
  assert.equal(day.length, 5, "all five of today's rows land on an empty day");
  ok("rows arrive through the same normalisation as a manual paste");
}

/* ---------------------- 7. the endpoint fails closed ------------------ */
{
  const cases = [
    [{}, "no authorization header"],
    [{ authorization: "Bearer wrong" }, "the wrong secret"],
    [{ authorization: SECRET }, "the secret without the Bearer prefix"],
  ];
  for (const [headers, what] of cases) {
    const res = mkRes();
    await handler({ headers }, res);
    assert.equal(res.code, 401, `must refuse ${what}`);
  }
  /* And with no CRON_SECRET configured it must refuse everything rather
     than falling open — the endpoint rewrites the schedule. */
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const res = mkRes();
  await handler({ headers: { authorization: "Bearer anything" } }, res);
  assert.equal(res.code, 401, "with no secret set it must refuse, not allow");
  process.env.CRON_SECRET = saved;
  ok("the endpoint refuses anything without the exact secret, and fails closed");
}

/* ---------------------- 8. a dry run writes nothing ------------------ */
{
  seedStore();
  const before = JSON.stringify(store.get(`schedule:${TODAY}`));
  const b = await syncValues(SHEET_ROWS, { dryRun: true });

  assert.equal(b.dryRun, true);
  assert.match(b.message, /nothing was written/i);
  assert.equal(writes.length, 0, "not one write left the process");
  assert.equal(JSON.stringify(store.get(`schedule:${TODAY}`)), before,
    "and the day is byte-for-byte what it was");

  /* But it still reports what it WOULD do, or it is not a report. */
  assert.equal(b.totalAdded, 3, "two pools plus tomorrow's job");
  const today = b.byDate.find((x) => x.date === TODAY);
  assert.equal(today.added, 2, "two of the three pools");
  /* Three already accounted for: one pool, La Vie, and the moved job's
     tombstone — which is the whole point of countTombstones. */
  assert.equal(today.alreadyHad, 3);
  assert.ok(today.rows.some((r) => /Pool Cleaning/.test(r)),
    "and names the rows rather than only counting them");
  assert.ok(!today.rows.some((r) => /Afnan/.test(r)),
    "the moved job is still excluded on a dry run");

  /* A real run straight after must still write — the flag is per-call. */
  const real = await syncValues(SHEET_ROWS);
  assert.equal(real.dryRun, false);
  assert.ok(writes.length > 0, "the next real run writes");
  ok("a dry run reports what it would add and writes nothing");
}

/* ---------------------- 9. failures reach the log, scrubbed ---------- */
{
  const lines = [];
  const realErr = console.error, realWarn = console.warn, realLog = console.log;
  console.error = (...a) => lines.push(["error", a.join(" ")]);
  console.warn = (...a) => lines.push(["warn", a.join(" ")]);
  console.log = (...a) => lines.push(["log", a.join(" ")]);
  try {
    /* A 401 must say WHICH kind it is — a probe, or CRON_SECRET missing. */
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    await handler({ headers: {} }, mkRes());
    process.env.CRON_SECRET = saved;
    assert.ok(lines.some(([lvl, m]) => lvl === "warn" && /CRON_SECRET is not set/.test(m)),
      "an unset secret is distinguishable from somebody probing the URL");

    /* And a real failure logs at error level, with no key in it. */
    lines.length = 0;
    const KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----";
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "x@y.iam.gserviceaccount.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = KEY;
    process.env.GOOGLE_SHEET_ID = "sheet";
    const res = mkRes();
    await handler({ headers: { authorization: `Bearer ${SECRET}` } }, res);
    assert.equal(res.code, 500, "a broken key is a 500");
    const errLine = lines.find(([lvl]) => lvl === "error");
    assert.ok(errLine, "the failure is logged at error level, not swallowed");
    assert.match(errLine[1], /\[sync-sheet\] FAILED/);
    assert.ok(!/BEGIN PRIVATE KEY/.test(errLine[1]),
      "and the private key is not in the log line");
    assert.ok(!/MIIEvQIBADANBg/.test(errLine[1]), "nor any of its body");
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_SHEET_ID;
  } finally {
    console.error = realErr; console.warn = realWarn; console.log = realLog;
  }
  ok("a failure lands in the log at error level with the key scrubbed");
}

/* ---------------- 10. the handler reads ?dryRun off the URL ---------- */
{
  /* syncValues is driven directly above, so this checks the one thing
     that is only exercised through the handler: the query parsing that
     he will actually type. A broken key makes it fail, and the flag has
     to survive into the error body — which is what proves it parsed. */
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "x@y.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----";
  process.env.GOOGLE_SHEET_ID = "sheet";
  const realErr = console.error, realWarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  try {
    const ask = async (url, query) => {
      const res = mkRes();
      await handler({ headers: { authorization: `Bearer ${SECRET}` }, url, query }, res);
      return res.body.dryRun;
    };
    assert.equal(await ask("/api/sync-sheet?dryRun=1"), true, "?dryRun=1");
    assert.equal(await ask("/api/sync-sheet?dryRun=true"), true, "?dryRun=true");
    assert.equal(await ask("/api/sync-sheet?DRYRUN=1"), true, "case does not matter");
    assert.equal(await ask("/api/sync-sheet?foo=1&dryRun=1"), true, "second parameter");
    assert.equal(await ask("/api/sync-sheet"), false, "absent means a real run");
    assert.equal(await ask("/api/sync-sheet?dryRun=0"), false, "=0 means a real run");
    assert.equal(await ask("/api/sync-sheet", { dryRun: "1" }), true,
      "and req.query works where the platform provides it");
  } finally {
    console.error = realErr; console.warn = realWarn;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_SHEET_ID;
  }
  ok("the handler reads ?dryRun from the URL, and defaults to a real run");
}

globalThis.fetch = realFetch;
console.log(`\n${checks} checks passed.`);
