# DHH Job Intake

Same app, same UI, off Claude.ai's artifact sandbox. Runs on Vercel (hosting +
the one serverless function) and Supabase (the shared data store). Anyone with
the URL can use it — no Claude account, no Google account, no login of any kind.

## What actually changed vs. the Claude artifact version

1. **Storage**: `window.storage` (only worked inside claude.ai) → a Supabase
   Postgres table called `kv_store`, accessed through `src/lib/storage.js`,
   which exposes the exact same `storageGet` / `storageSet` / `storageList`
   functions.
2. **AI parsing**: the old code called `api.anthropic.com` directly from the
   browser with no key. That is not a viable pattern outside the artifact
   sandbox — no key means no auth, and Anthropic's API doesn't serve
   browser-CORS to arbitrary origins anyway. `api/parse.js` is a Vercel
   serverless function that holds your `ANTHROPIC_API_KEY` and makes that
   call server-side; the browser now calls `/api/parse` instead.

Nothing else changed. If it worked one way in the artifact, it works the same
way here.

## The daily cycle (added: intake → post → verify → measure)

The app now follows the way the department actually works, and the
measurement falls out of it rather than being typed in separately.

1. **Build tomorrow's schedule** — *Job Board* / *Import Sheet*.
   As the coordinator builds it, three checks run live at the top of the
   board: is anybody booked past their shift, is anybody being sent to an
   occupied unit no guest has confirmed, and does every job needing
   material have an actual picking list. A warning after the fact is a
   report; a warning during is a fix.
2. **Post it** — the *Post schedule* button.
   Stamps the version. Every edit after that is recorded automatically, so
   schedule churn is computed rather than self-reported. (The workbook's
   own "Changed After 8pm Posting?" column is filled on 4% of rows.)
3. **Verify yesterday** — *Verify* tab.
   One row per job, three buttons — Done / Partial / Not done — plus
   whether it was actually found in PMS. About three minutes for a day.
   This is the only data entry the dashboard asks for that the schedule
   does not already contain, and it is what turns completion rate, PMS
   traceability and first-time fix into real numbers.
4. **Read the numbers** — *Dashboard* tab.
   Risk for a chosen day first (the part still changeable), then the
   trend, then cost.

`docs/METRICS.md` defines every metric: the field it reads, the
denominator, and who acts on it.

### Importing the existing workbook

*Import Sheet* takes a paste straight out of `DHH Daily Schedule Input
(Maintenance)`. Select the rows including the header, copy, paste. Columns
are matched by name, so order does not matter and extra columns are
ignored. It is a deterministic parser — no model call, so no per-paste
cost, no invented unit numbers, and a whole month lands in one go instead
of four jobs at a time. The *AI Import* tab is still there for schedules
that arrive as prose in WhatsApp or email.

Verified against the real workbook: 474 rows across 15 dates round-trip
exactly, and the dashboard computes the same figures as an offline run of
the metrics engine over the same file.

### Cost

Cost prices time and trips, because those are what the schedule records.
**Every rate ships as a placeholder** — edit them under *Edit rates* on the
dashboard before quoting any figure. See `docs/METRICS.md` for what each
rate should actually be.

### What was removed

The old *Trends (review)* tab. Most of what it reported was not measuring
the department: its "clean rate" was built on duplicate/carryover flags
that only ever looked at the fourteen dates cached in memory, so it read
near 100% regardless; its variance and safety-close figures averaged
timestamps that needed somebody pressing buttons in the app during the
working day, which nobody was doing. It is replaced by the Dashboard,
which computes from fields people actually fill in and states its coverage
next to every rate.

## Deploy — first time setup (~15 minutes)

### 1. Supabase (the database)

1. Go to https://supabase.com → New Project (free tier is enough for this).
2. Once created, open **SQL Editor** → New query → paste the entire contents
   of `supabase/schema.sql` → Run.
3. Go to **Project Settings → API**. Copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon public key** → this is `VITE_SUPABASE_ANON_KEY`

### 2. Push this code to GitHub

```bash
cd dhh-job-intake
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```

(Your admin doesn't need write access to your GitHub — Vercel only needs read
access to build from it. He just needs the final Vercel URL.)

### 3. Vercel (hosting)

1. Go to https://vercel.com → New Project → Import the GitHub repo you just
   pushed.
2. Framework preset: Vite (should auto-detect).
3. Before deploying, expand **Environment Variables** and add three:
   - `VITE_SUPABASE_URL` = (from step 1)
   - `VITE_SUPABASE_ANON_KEY` = (from step 1)
   - `ANTHROPIC_API_KEY` = a key from https://console.anthropic.com/settings/keys
     (this is a separate, billed-per-use API key — not your claude.ai login,
     and not free. Skip this one if you don't need the AI-import tab; the
     rest of the app works fine without it, that tab just won't parse.)
4. Deploy. You get a URL like `dhh-job-intake.vercel.app` — send that to
   anyone, including your new admin. That's it, no account needed on their end.

### Local development (optional)

```bash
cp .env.example .env   # fill in the two VITE_ vars
npm install
npm run dev
```

`ANTHROPIC_API_KEY` isn't used by `npm run dev` unless you also run
`vercel dev` — plain `vite` dev server won't execute `/api` functions.

## Security tradeoff — read this before sharing the link widely

`supabase/schema.sql` sets Row Level Security policies that make `kv_store`
**fully readable and writable by anyone holding the Supabase anon key** — and
that key is embedded in your deployed JS bundle, visible to anyone who opens
browser devtools. In practice: **anyone with the app URL can read and edit
every fault code, property, and job on the board.** There's no per-user login,
no permissions, no audit trail of who changed what.

This is a fair tradeoff for "an internal ops tool I'm sharing with a small,
trusted team via an unlisted link" — which is what you described. It is NOT
fine if this link ends up in a public Slack, a job posting, or anywhere
outside people you trust with write access to your data. If you outgrow that
model later (need per-user logins, read-only roles, an audit log), Supabase
supports real auth (`supabase.auth`) and row-level policies keyed to a user
ID — that's a follow-on piece of work, not a small tweak, so flag it early if
you think you'll need it.

## Cost

- **Vercel**: free tier covers this comfortably (low traffic, one serverless
  function).
- **Supabase**: free tier covers this comfortably (small tables, low query
  volume).
- **Anthropic API**: pay-per-token, separate from any Claude.ai subscription.
  The Import tab is the only feature that calls it. Rough order of magnitude:
  a few cents per schedule paste, not more.

## Known limitation carried over from the original

> Note: this limitation still applies to the duplicate/carryover badges on
> the Job Board, but the Dashboard no longer depends on them — its repeat
> and rework figures query the whole loaded date range directly, so they
> are not limited to the recently-viewed cache.


Duplicate-dispatch detection only checks jobs already loaded on the same day
in memory; carryover detection only checks the ~14 most recently viewed
dates, not the entire history. This was true in the Claude artifact version
too (it could only see dates it had already cached from `window.storage`) —
this migration preserves that behavior rather than silently changing it. If
you want carryover/duplicate checks to search the *entire* job history instead
of the recently-viewed cache, that's a real code change (a Supabase query
against the full `jobs` history instead of the in-memory cache) — say so and
I'll do it, but don't assume it's already fixed.
