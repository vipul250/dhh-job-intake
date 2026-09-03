# Automatic Google Sheet sync

`api/sync-sheet.js` reads the live "Daily Input- Field Tasks" tab and adds
any new rows to the app automatically, once a day, with nobody pasting
anything. It reuses the app's existing paste pipeline (`parseSheetPaste`,
`pasteAdditions`, `newJob`), so it has the exact same dedup guarantees as
the manual "Paste the day in" button — running it twice on the same day
adds nothing extra.

It only ever ADDS rows. It never edits or removes a job the app already
has, so a coordinator's edits, close-outs, or moves inside the app are
never touched or overwritten by a sync run.

## One-time setup (~15 minutes)

### 1. Create a Google Cloud project (free, no billing required)

1. Go to https://console.cloud.google.com → create a new project (any name,
   e.g. "dhh-sheet-sync").
2. In the search bar, search **"Google Sheets API"** → click **Enable**.

### 2. Create a Service Account (the "robot" that reads the Sheet)

1. Left menu → **IAM & Admin → Service Accounts** → **Create Service Account**.
2. Name it anything (e.g. `sheet-reader`). Skip the optional role/access
   steps — this account only needs Sheet access, granted in step 4, not
   project-level permissions.
3. Click into the created service account → **Keys** tab → **Add Key** →
   **Create new key** → **JSON**. This downloads a `.json` file —
   **treat this like a password, it grants read access to whatever you
   share with it.**

### 3. Read two values out of that JSON file

Open the downloaded file in a text editor. You need:

- `"client_email"` — looks like `sheet-reader@your-project.iam.gserviceaccount.com`
- `"private_key"` — a long value starting `-----BEGIN PRIVATE KEY-----`

### 4. Share the Google Sheet with that email

In your live Daily Input Google Sheet → **Share** → paste the
`client_email` value from step 3 → set permission to **Viewer** → Send.
(It won't actually receive an email since it's a robot account — that's
expected.)

**This is the only access the sync has.** It can read the Sheet. It
cannot edit it, and it has no access to anything else in your Google
account.

### 5. Get your Sheet's ID

From the Sheet's URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART_IS_THE_ID`**`/edit`

### 6. Add environment variables in Vercel

Project → **Settings → Environment Variables** → add these four:

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` from step 3 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the `private_key` from step 3, pasted exactly as-is (keep the `\n` characters — do not manually add real line breaks) |
| `GOOGLE_SHEET_ID` | the Sheet ID from step 5 |
| `CRON_SECRET` | any random string you make up (e.g. generate one at https://generate-secret.vercel.app/32) — this stops anyone else from triggering a sync by guessing the URL |

### 7. Deploy

Push this code, or redeploy. Vercel reads `vercel.json` automatically and
registers the cron job — nothing else to configure.

## Testing it before waiting for the schedule

**Do a dry run first.** It reads the Sheet and reports exactly what it would
add, writing nothing:

```
GET /api/sync-sheet?dryRun=1
```

Also accepts `?dryRun=true`, and the secret is still required. The response
carries `"dryRun": true`, a `message` saying nothing was written, and per
date the rows that *would* land — named, not just counted:

```json
"byDate": [
  { "date": "2026-09-03", "added": 2, "alreadyHad": 3,
    "rows": ["Palm villa · Pool Cleaning", "Palm villa · Pool Cleaning"] }
]
```

Then for real:

```bash
vercel crons run /api/sync-sheet
```

Or from the Vercel dashboard: **Project → Cron Jobs → sync-sheet → Run**.

If `ok: false`, the `error` field says what failed — almost always a
missing or mistyped environment variable the first time.

## Where to look when nobody was watching

The whole outcome goes into the **runtime log** as well as the response, on
one line, because a nightly job has to say what it did somewhere that is
still there in the morning:

```
[sync-sheet] {"ok":true,"totalAdded":4,"window":{...},"byDate":[...]}
[sync-sheet] FAILED {"ok":false,"error":"..."}   <- console.error, error level
[sync-sheet] 401 unauthorized — CRON_SECRET is not set on this project
```

This exists because the first real run came back **500 and the reason was
unrecoverable**: the message went into the HTTP response, which the trigger
received and nothing kept. Vercel's log recorded `GET /api/sync-sheet 500`
and no more, and its error tracker saw nothing at all, because the handler
catches the error rather than throwing it.

That last line matters for diagnosis: a `401` is either somebody probing the
URL or `CRON_SECRET` not being set on the project, and the log now says
which.

**Private keys are stripped from anything logged.** A malformed
service-account key is the likeliest failure here, and error text from an
auth library can carry the material it was handed — a runtime log is
readable by anyone with project access and it persists. PEM blocks and long
tokens are replaced before the line is written.

Read the logs from the dashboard, or with the Vercel MCP
`get_runtime_logs` filtered to `level: error`.

## Testing without waiting, and without touching production

`node test/suites/sheetsync.mjs` drives the whole thing with Supabase
stubbed and no network: the window arithmetic, that only in-window dates are
written, that a moved job is not brought back, that indistinguishable rows
top up to the Sheet's count rather than duplicating or collapsing, that a
second run in the same night writes nothing, and that the endpoint refuses
anything without the exact secret.

What it deliberately does not cover is `fetchSheetValues` — a signed token
exchange and one GET. That works with real credentials or it does not, which
is what the manual trigger above is for.

## Changing the schedule

Currently set to `0 3 * * *` — 3:00 AM UTC, which is 7:00 AM Gulf time
(UTC+4), a few hours after the evening schedule is posted and before the
day's work starts. Edit the `schedule` value in `vercel.json` to change
this — https://crontab.guru is useful for writing the expression.

## If the Sheet's column layout changes

This reads columns by the same names the manual paste already recognizes
(`parseSheetPaste`'s header matching) — so adding a column, or reordering
existing ones, does not break this as long as the header row is still row
1 and still has recognizable column names. If a column is renamed to
something unrecognizable, that field comes through blank for new rows
until the header text is fixed — nothing crashes, but check the
`warnings` field in the response after any Sheet restructuring.

---

## Known limits — read before setting the env vars

The endpoint is **inert until all four environment variables exist**: with
`CRON_SECRET` unset it answers `401` to everything, including Vercel's own
cron. So it can be deployed safely and switched on deliberately. Four things
to settle first.

### 1. It cannot import from `jobStore.js` (already worked around)

`migrateDay` used to live in `jobStore.js`, which imports `storage.js` →
`supabase.js`. That file reads `import.meta.env.VITE_SUPABASE_URL`, a Vite
build-time substitution that is **undefined in a Node function**, and
`storage.js` writes `from "./supabase"` with no file extension, which Vite
resolves and Node ESM refuses. Either one throws at cold start — a nightly
500 in a log nobody reads.

Migration takes rows and returns rows; it has no business touching storage.
It now lives in `src/lib/dayMigrate.js`, and `jobStore.js` re-exports it so
the six views that import it are unchanged. The sync imports the new module.

The sync genuinely needs it, rather than reading the raw stored array:
migration is what splits a unit off the end of a building name, and a
quarter of the stored month is written that way. Without it a stored
`{property: "Afnan 5 603", unit: ""}` keys differently from an incoming
`{property: "Afnan 5", unit: "603"}`, the dedupe misses, and the same job is
added again every night.

### 2. How far it reaches, and moved jobs — both closed

**It reaches today and the next three days.** It used to feed every date in
the tab into a write — the whole imported month and everything since. Two
reasons that was wrong: a past day is settled (its outcomes recorded, its
jobs closed out or moved) and the Sheet is not kept in step with any of
that, so re-importing churned history; and a job moved to another day is
listed in the Sheet under the date it was moved *off*.

The window is today `..` today+3, in **Gulf dates** — the Sheet's dates are
Gulf dates and this runs on UTC, and while 03:00 UTC is 07:00 in Dubai on the
same day, Hobby crons fire within an approximate window and a run that
slipped to 21:00 UTC would otherwise read "today" as the wrong day.

Nothing backwards by default. A row that has to reach a past day is either an
out-of-hours job (the board has a button) or a deliberate re-paste by a
person. Both ends are env-overridable so this can be changed without a
deploy:

| Variable | Default | |
|---|---|---|
| `SYNC_DAYS_AHEAD` | `3` | how far forward to import |
| `SYNC_DAYS_BACK` | `0` | how far back — raise to 1 if a run is ever missed |

The response reports the window it used and every date it skipped, because a
sync that quietly ignores most of the tab is otherwise indistinguishable from
one that is broken.

**And a moved job stays moved.** When a coordinator moves a job off a day,
the app leaves a tombstone naming where it went. `pasteAdditions` ignores
tombstones by default — right for a person pasting by hand, who is looking at
the day and can see what left it. The sync passes `countTombstones: true`
instead: nobody is watching, the Sheet still lists the row under the date it
was moved off, and without it the job would be put back there every night and
sit on both days.

A tombstone only ever accounts for its own row — one tombstone offsets one
Sheet row, and a tombstone for different work blocks nothing. Covered by
`test/suites/pastedupe.mjs` and `test/suites/sheetsync.mjs`.

### 3. The Supabase write uses the anon key and no version check

Two separate things:

- **The anon key stops working the day row-level security is applied.** The
  policy in `docs/ACCESS.md` lets `anon` read exactly `auth-required` and
  nothing else, so the sync's reads and writes will both fail. It needs the
  **service role** key (`SUPABASE_SERVICE_ROLE_KEY`) by then — that key
  bypasses RLS, must only ever live in Vercel's env vars, and must never
  reach the browser bundle.
- **`writeDayServer` is a blind upsert**, where the rest of the app uses
  `storageCompareAndSet` on `updated_at` with a retry. If a person is editing
  the same day at the moment the cron writes, their change is lost. At 03:00
  UTC — 07:00 Gulf — the practical risk is small but not zero, since that is
  around when the morning shift starts.

### 4. This project is on Vercel's **Hobby** plan

Cron jobs work, but Hobby allows **two** of them and **once-daily**
invocation, fired within an approximate window rather than at the exact
minute. `0 3 * * *` is fine. Anything hourly would need Pro.

### And a decision that is not technical

The sync **adds** rows without a person involved, so "who built the day"
reads *Google Sheet sync* rather than a name. That is honest, but it changes
what the churn metric measures — decide whether the sync replaces the manual
paste or runs alongside it. If both write the same day they will not conflict
(the dedupe handles that), but two sources make "what changed after posting"
harder to read.
