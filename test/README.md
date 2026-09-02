# The test harness

There is no unit-test runner here. Every suite drives a real Chromium
against a real build, because the two bug classes this project actually
produced — a helper used in a view without being imported, and a name
resolved from the wrong column — both pass `vite build` and both crash or
lie at runtime. **A green build means nothing. Only the browser counts.**

## Running a suite

```sh
# 1. put the mock database in place of the Supabase adapter
cp test/harness/mock-storage.js src/lib/storage.js

# 2. build and serve
npm run build && npx vite preview --port 4173 --host 127.0.0.1 &

# 3. run
cd test && SP=$PWD/harness node suites/shift.mjs

# 4. PUT THE REAL ONE BACK before committing
git checkout src/lib/storage.js
```

Step 4 is not optional. Committing `mock-storage.js` as `src/lib/storage.js`
would deploy an app that keeps the whole department's schedule in one
browser's localStorage.

## The two stand-ins

**`harness/mock-storage.js`** replaces `src/lib/storage.js`. Same contract,
including the version-guarded write, so the concurrency path is genuinely
exercised. It holds a Web Lock around its compare-and-set because
localStorage read-modify-write is not atomic across tabs while the real
`storageCompareAndSet` is a single conditional SQL `UPDATE` — without the
lock a two-tab test measures the stub's weakness rather than the app's
behaviour.

**`harness/supabase-stub.mjs`** intercepts `/auth/v1/*` and
`/rest/v1/kv_store*` at the network layer, so the real `createClient`,
`signInWithOtp` and `verifyOtp` run. Used by the auth suites. Needs a
`.env.local` carrying any syntactically valid `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` so `createClient` takes the real path rather than
the not-configured stub:

```sh
printf 'VITE_SUPABASE_URL=https://stubproject00000.supabase.co\nVITE_SUPABASE_ANON_KEY=<any JWT-shaped string>\n' > .env.local
```

`.env.local` is gitignored. Delete it before building for production.

**`harness/live-kv-stub.mjs`** does the same for a bundle downloaded from
production, so the deployed JavaScript can be driven without touching the
real database. See "Verifying the live app" in HANDOVER.md.

## Fixtures

| File | What it is |
|---|---|
| `seed-kv.json` | A whole kv_store: the real 474-row month across 15 days, the staff list, the catalogue |
| `seed-legacy-staff.json` | The same, but with the team list as it sits in the database *today* — 20 people, no email column, no Vipul. For testing migrations. |
| `pms-issues.tsv` | 15 real rows copied out of the PMS Issues screen |
| `real-workbook.json` | The 474 rows as parsed from the workbook, for testing pure functions in node |

## Writing a suite

Assert on what the user would see, not on internals, and **always capture
console and page errors** — that is what catches the missing-import class:

```js
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
// …
console.log('errors:', errs.length ? errs : 'none');
```

Selector traps this codebase has already hit: `getByRole('button', {name:'Done'})`
also matches "Not done"; a "more" button becomes "less" once expanded;
`input[type=email]` matches both the access-panel test box and all twenty
team rows — scope it with `input[name="access-test-email"]` or `table input`.
