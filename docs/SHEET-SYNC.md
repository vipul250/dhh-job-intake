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

Once deployed, you can trigger it manually:

```bash
vercel crons run /api/sync-sheet
```

Or from the Vercel dashboard: **Project → Cron Jobs → sync-sheet → Run**.

Check the response — it reports rows read, rows added per date, and any
warnings (e.g. rows with no readable date). If `ok: false`, the `error`
field says exactly what failed — almost always a missing/mistyped
environment variable the first time.

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

### 2. A job MOVED to another day will be restored to its original day, nightly

This is the one to think hardest about.

When a coordinator moves a job off a day, the app leaves a **tombstone**
naming where it went. `pasteAdditions` deliberately ignores tombstones when
counting what a day already holds — for a manual paste that is right, since a
tombstone is not a job standing in the way.

For a nightly sync over the whole sheet it is not right. The Sheet still
lists that row on its original date, the tombstone does not block it, and the
job is added back to the day it was moved off — so it exists on both days.
Then again the next night.

Two ways to close it, and it is a judgement call:

- **Narrow the window.** Read only the next few days rather than `A1:U`
  (~1010 rows, fifteen-plus dates). An automatic daily sync does not need to
  re-import August every night, and history stops churning.
- **Treat a tombstone as "already dealt with"** for the sync path — the row
  left this day on purpose, so do not bring it back. This needs
  `pasteAdditions` to take a flag, because the manual paste wants the
  opposite.

Both are worth doing. Neither is done yet.

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
