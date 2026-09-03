# DHH Job Intake — handover

Everything a fresh conversation needs. Read this before touching anything;
most of what looks like a quick improvement here has already been tried and
rejected for a reason recorded below.

---

## 1. Who this is for

**Vipul Baibhav** (`vipul@deluxehomes.com`), Deluxe Holiday Homes, Dubai.
He runs the maintenance department. He is not a developer, reads carefully,
and pushes back accurately when something is wrong — take the pushback
seriously, it has been right every time.

The department: ~16 field technicians and 4 office staff, servicing ~181
buildings of short-let apartments and villas across Dubai and Fujairah.

**Live app:** https://dhh-job-intake.vercel.app
**Repo:** `vipul250/dhh-job-intake` · work on `claude/dhh-intake-metrics-dashboard-dgyrrs`, merge to `main` to deploy
**Stack:** React 18 + Vite + Tailwind → Vercel · Supabase Postgres, one table `kv_store(key, value, updated_at)`

---

## 2. The problem this app exists to solve

Read this section properly. Every design decision follows from it.

The department ran on **two systems doing one job twice**. The evening
coordinator scraped PMS from 2pm to 8pm and built tomorrow's schedule in a
Google Sheet. The next day an admin re-recorded in a separate app what had
actually happened. The outcome existed only in that second entry.

And **the schedule was a document that got overwritten.** Each morning the
coordinator replaced the night's version with a current one, so anything
dropped was simply absent from the new one — not moved, not cancelled, just
gone, with nobody able to say which. That is not a bug that can be fixed: a
list that gets overwritten cannot report what used to be on it.

So the app's core move: **a job is a durable entity with an identity, a
state, and an append-only event log.** Nothing ever leaves a day silently.

### Constraints that are fixed, not negotiable

- **No PMS API.** "our ceo wont entertain that." Do not propose it again.
- **No live Google Sheets connection.** Offered, considered, declined —
  manual paste is preferred. Do not re-propose.
- **PMS stays the system of record.** It holds reservations, the owner
  portal, guest links, task refs, and the technicians' photos and comments.
  The app is a lens on it, never a replacement.
- **Chat stays.** Google Chat is how a human escalates at 2am and how
  landlords are handled. It cannot be removed by instruction.
- **Coordinators must not be given more to do.** The measured reason data
  entry fails: of 22 workbook columns, the ones filled >95% are the ones the
  coordinator needs to do their own job; the ones under 12% are the ones
  only management needs. "Monish Comments" was asked 475 times and answered
  **zero**. Management's fields must be *derived*, never requested.

---

## 3. Hard rules the app holds itself to

Violating any of these is a regression, not a design choice.

**Nothing is ever deleted, anywhere.** No delete button exists in the UI and
no bin icon appears (including on "Cancel this job" — cancelling is not
deleting and must not look like it). Instead:

| Instead of deleting | It does |
|---|---|
| a job | cancel with a reason; stays on the day, greyed, in "Left this day" |
| a project | cancel; keeps its quotation ref, materials and hours |
| a material or labour line | **void** it — stops counting, stays visible, struck through, reversible |
| a queue item | take it off with a reason, into a list you can restore from |
| moving a job off a day | leave a **tombstone** naming where it went, who moved it and why |

**The single exception, added at his explicit request: "Start this day
again".** 3 September could not be repaired job by job. A sheet read through
the quick-add box produced wreckage of two kinds — the obvious sort with the
year as the unit number, which `isMisread` finds, and a subtler sort that
looks entirely legitimate, where the parking bay landed in the unit ("La Vie
B-257", whose unit is 3503) and the description snapped to a standard task so
it reads cleanly. Separating those from real jobs means guessing, and guessing
is what caused it.

So one action takes rows off a day, and even it is not a delete: the whole day
is written to `archive:schedule:<date>:<ts>` **before** anything is emptied, so
it is recoverable, and the confirmation asks for the date to be typed. Do not
add a second way to remove anything. If he asks for one, this is the shape it
takes: archive first, confirm by typing, one day at a time, and say plainly in
the dialog that it is archived rather than deleted.

**No "Other" on any dropdown.** It costs one second to click and makes the
row permanently uncountable; over a month it becomes the biggest bucket on
every chart. Lists were widened with the answers that were hiding under it.
Where a list genuinely cannot be exhaustive, the last option is
**"None of these — say what happened"** (`SAY_WHAT_HAPPENED` in `job.js`)
and the save button stays **disabled until words are typed**. What gets
stored is the sentence.

Computed fallbacks are different and are labelled honestly: *"not classified
from the task text"* is a coverage statement, not a choice anybody made.

**Every metric carries its own denominator.** If 43% of rows answered a
question, the rate is reported over that 43% and says so. A dashboard that
quietly divides by the full row count is how it ends up confidently wrong.
This is why the previous dashboard was scrapped — "clean rate" read ~100%
regardless of reality.

**Never guess where a wrong answer is worse than none.** Licence is
three-valued (unknown ≠ no). The unit splitter declines five of 88 cases.
The paste box refuses rather than importing thirty rows into the wrong
shape. Say "I could not read this" instead.

---

## 4. The daily operating rule (his decision, from 1 September)

Two touchpoints a day, each by somebody already at a desk.

**Evening coordinator** builds tomorrow. Opens the app — it already shows
tomorrow — and pastes either the daily Google Sheet or the PMS task list
into **Paste the day in**. Presses Post. Goes home.

**At midnight the day locks itself**, whether or not anyone pressed Post.
From then on a change to the *plan* (add, move, cancel, edit) is logged with
a reason and a name. **Recording what happened is never locked** — asking
the morning coordinator to justify marking a job fixed would punish the one
person doing the review.

**Morning coordinator** works today and, before leaving, opens
**End-of-day review**: one list, one line per job, clean fix is one click,
anything else opens the full close-out. Because the board opens on
*tomorrow*, a banner on any other day says *"Today (…) still has N jobs with
no outcome"* with a jump button — the second touchpoint must not depend on
somebody remembering it exists.

Three coordinators rotate the same desk (Haris, Kaja, Tiyana), which is why
the typed name **expires after nine hours** — one shift. A name remembered
indefinitely filed Kaja's afternoon changes under Haris.

---

## 5. What is built

Tabs: **Live Board · Queue · Roster · Dashboard · Projects · Insights (today) ·
Fault Codes · Properties**. Import Sheet, Print/Export and AI Import were
removed at his request; ~900 lines of dead code went with them.

### Live Board — the day
Quick-add (one line, one Enter) that snaps to a catalogue of 36 standard
tasks seeded from the real month; **Paste the day in** (sheet or PMS task
list, auto-detected); out-of-hours job log; close-out with four outcomes
(fixed / made safe / diagnosed / not done) parsed from a pasted technician
report; move-with-displacement capture; post lock and change-reason dialog;
end-of-day review; the day's activity log; crew-size and roster warnings;
technician suggestion by trade, licence, location and load.

### Queue — the decision that was invisible
The PMS Issues list pasted in, with a **stated rule** answering *which day,
and why*:

1. **When can we get in?** Occupancy is the hard constraint nobody was
   using. Vacant → any day. *Occupied until D* → that checkout is the first
   clean day for anything needing the unit empty (>3h, painting, duct
   cleaning, water off). Occupied with no end date → cannot be planned until
   a guest agrees a time.
2. **When must it be done by?** PMS due date, else reported date + SLA
   (P1 same day, P2 3 days, P3 7, P4 14). Written down so they can be argued with.
3. **Do those overlap?** If not it is a *conflict* with no right answer —
   escalate, do not let it sit.
4. **Which day inside the window?** A checkout or vacancy wins; else
   earliest with room; ties to the building already being visited.

On 15 real issues: 15 past due, **three vacant units with work 29–53 days
overdue and nothing stopping them**, six waiting on a checkout already in
PMS, five blocked on a guest, two genuine conflicts.

### Projects — read back out of the schedule
The tab was empty because it only listed projects somebody typed in. The
projects were in the task text all along, keyed by quotation number
(`PC-2026-08-23`). Discovery finds **9 projects across 15 job rows**, six
spanning multiple days. Parses the real mess: `Approevd`, `Quotation -PC-`,
`REV 01`, `Contin`. Found, not created — the schedule holds the work and the
hours but not the approved amount, so each is *offered* and adopting one
opens the form on the one field only a person has.

### Dashboard — 12 sections
Fix-before-this-day-runs · Stopped, not finished · Where work comes from ·
**Who did what** · **The coordinator's calls** (displacement) · Where jobs
went · Why we keep going back · How long jobs actually take · Trend · Cost ·
**Why each job is on the day it is on** · What the numbers stand on.

### Roster & Team
Shift message pasted rather than re-keyed. Team master with trade, base,
licence (three-valued), **work email**, note, admin flag. **Add someone**.
Access panel with the sign-in switch and its pre-flight check.

---

## 6. Sign-in — built, tested, deliberately OFF

Email + six-digit code over Supabase Auth, `shouldCreateUser: false` as the
allowlist. Gated behind the `auth-required` key in `kv_store`.

**It ships off and the switch will not enable until a real code has been
received in the app.** Turning a login on before email delivery is proven
locks the whole department out of the tool they run their day on, and the
only way back is SQL. Do not weaken this gate.

Emails already on the team list: Haris `haris@`, Kaja `kajamohideen@`,
Tiyana `tiyana@`, Monish `monishraj@`, **Vipul `vipul@` (admin)** — all
`@deluxehomes.com`. `backfillStaff()` writes these onto the list already in
the database (the seed alone reaches nobody, because it only runs when no
list exists), without overwriting anything typed by hand.

**Admin is one control, not a permission system.** Turning sign-in *on* is
open to anybody; turning it *off* requires an admin. Nothing else is gated
by role, deliberately.

### Still outstanding — only he can do it, in Supabase
1. Invite the five addresses (Authentication → Users → Add user → Send invitation)
2. **Configure SMTP** (Project Settings → Authentication → SMTP). Not optional — the built-in sender allows a handful of emails an hour, so the morning shift would silently stop receiving codes.
3. Put `{{ .Token }}` in the Magic Link template. The default sends a clickable link; this app asks for a typed code, because the email is read on a phone while the app is open on the office desktop.
4. Then Roster → Access → send himself a code → switch unlocks.

`docs/ACCESS.md` has all of it plus the lockout SQL:
`update kv_store set value = 'false' where key = 'auth-required';`

**Row-level security is written but NOT applied** (SQL in `docs/ACCESS.md`).
Run it only after sign-in has worked for the whole department for a day —
doing it first breaks the app for everyone at once.

---

## 7. Facts from the real data that decisions rest on

Do not re-derive these; they came from the actual 474-row month (18 Aug – 1 Sep).

- **117 of 474 rows** (a quarter) left the unit column empty and wrote the
  unit on the end of the building: `Afnan 5 603`, `Palm Villa E41`. Each was
  counted as its own building. The month read as 233 buildings; it is
  **181**. And **33 units that were revisited never showed as repeat visits**
  — Harbour Gate Tower 1 unit 3403 was visited four times and read as four
  unrelated jobs. `splitTrailingUnit()` fixes it: only when the unit column
  is empty, only on a tail that cannot be a building number (3+ digits, or a
  letter then digits). Splits 83 of 88 cases, declines five. Applied on read
  *and* on import, so stored days are repaired as they are opened.
- The task-title prefix encodes occupancy and appointment: `GC 2-4pm` =
  guest confirmed 14:00–16:00, `vacant`, `B2B`, `checkin`, `WC` (read as
  occupied, no time agreed — the workbook says "Not Confirmed" on 94 rows).
- Occupancy values: Occupied 166, Vacant 120, Occupied-GC 68, Checkout 45,
  B2B 20, Check-in 17, WC 11, Onboarding 7.
- 59% of jobs fall into recurring shapes → the 36-task catalogue.
- Pool cleaning appears 57 times in four spellings; Palm Villa's 14 returns
  are the PPM cycle working, not rework — which is why **rework is only ever
  counted on reactive work**.
- "In PMS?" answered on 42.9% of rows and reads "Y" on 203 of 204 — an
  intention, not a check. Do not treat it as an outcome.
- 8 quotation refs across 15 project rows; `PC-2026-08-23` ran three days.
- The Job Cards sheet shows **5 of 8 projects late or overdue**.

---

## 8. Code map

```
src/App.jsx            1219  shell, nav, date state, fault/property masters
src/views/
  LiveBoard.jsx        2843  the day. Quick-add, close-out, move, post lock,
                             day log, end-of-day review, paste dialog
  Dashboard.jsx        1596  12 metric sections over a date range
  Projects.jsx          799  quoted work, discovery, margin, price book
  Roster.jsx            720  shift paste, team master, access panel
  Backlog.jsx           446  the queue and the scheduling rule, applied
  SignIn.jsx            109  email → code screen
src/lib/
  metrics.js           1135  ~18 metric computations, all coverage-first
  job.js                721  the job entity, states, reasons, quick-add parse
  backlog.js            721  occupancy, SLA, the day rule, PMS/sheet parsing
  sheetText.js          330  reads the daily sheet as it is ACTUALLY pasted:
                             copied off the locked PDF, spaces not tabs, rows
                             wrapped. Also isMisread, which finds the rows a
                             quick-add paste already mangled
  schedule.js           490  ordering WITHIN a day: appointment → P1 → batch
  project.js            490  projects, discovery, cost roll-up, price book
  normalize.js          370  canonicalisation. splitTrailingUnit lives here
  cost.js               331  labour + travel + material, optimisation levers
  roster.js             286  shift-message parsing
  staff.js              268  team master, trades, licence, backfillStaff
  jobStore.js           237  readDay/mutateDay with compare-and-set + retry
  importSheet.js        225  workbook/paste column mapping
  catalogue.js          207  36 standard tasks
  learned.js            110  the measured median replaces the seeded estimate
                             once a kind of work has 5 real timings
  crewing.js            204  how many people a job needs
  workReport.js         183  parse a technician's PMS comment
  storage.js            152  Supabase kv_store adapter (SWAP FOR TESTS)
  activity.js           148  who built the day, who changed it
  auth.js               146  OTP, identity, the auth-required flag
  dayLock.js            100  open / posted / started / past
  faultFamily.js         75  trade families and return reasons
  supabase.js            62  client, or a failure-safe stub if unconfigured
docs/  WORKFLOW.md 895 · METRICS.md 345 · ACCESS.md 170 · SHEET-PASTE.md 125
test/  README.md, harness/, suites/  (33 browser suites)
```

### Concurrency — do not break this
Two people edit the same day. `jobStore.mutateDay(date, mutator)` reads a
version, applies the mutator **to what it just read**, and writes with
compare-and-set on `updated_at`, retrying with backoff on conflict. **The
mutator must derive everything from its `cur` argument** — a mutator that
closes over stale state is the exact bug that erased an admin's outcome, and
it recurred once in the day-migration path. Verified: 12 concurrent adds
from two tabs, all landed.

---

## 9. Testing — read `test/README.md`

**A green `vite build` means nothing.** The two bug classes this project
actually produced both pass the build:
- a helper used in a view without being imported → runtime crash
  (`squash` in Roster.jsx, caught only in the browser)
- a value resolved from the wrong column → silently wrong data
  (header matching claimed "Reported by" for the reported-on column, so the
  queue reported that nothing had ever been reported)

So: always run a browser suite, and always capture `pageerror` and
`console` errors. There is now a missing-import scanner in the commit for
`3dc3583` worth keeping to hand.

**Restore `src/lib/storage.js` before committing.** Committing the mock
would deploy an app storing the department's schedule in one browser.

### Verifying the live app
This sandbox's proxy blocks `vercel.app` and `supabase.co` for a browser.
The way round it, which genuinely tests the deployed artifact:
1. `mcp__Vercel__web_fetch_vercel_url` the live `index.html`, then the JS bundle (it saves to a file; the payload is a JSON wrapper — extract `.text`)
2. serve it locally with `python3 -m http.server`
3. stub `/rest/v1/kv_store*` with `test/harness/live-kv-stub.mjs`

That runs the exact bytes users load **without touching production data** —
which matters, because the deployed bundle carries the real Supabase URL and
anon key. Never write test rows into his live database.

---

## 10. Open threads

**Cost rates are still my assumptions.** AED 25/tech/hour, 30 min travel per
building hop, 9-hour shift. Every cost figure is an illustration until he
supplies real numbers. He has been asked twice; ask again when cost comes up.

**Intra-day capture is reconstructed at 6pm.** With the review at end of
shift, outcomes are accurate but *what took a slot* is recalled rather than
recorded live. Flagged to him. If displacement data comes back thin after a
fortnight, that is the signal to move that one capture to the moment it
happens.

**Landlord issues as a payer.** Google Chat's LANDLORD SUPPORT space carries
owner-billable work with costs and owner-portal quotes (e.g. AED 1,470).
Right now every dirham looks like our cost. One field —
*our cost / owner-billed / guest claim* — would materially change the
self-cost number. Proposed, not built.

**Paste-anything intake for the two chat formats.** The HubSpot block in GS
(Maintenance) carries ISS number, property, reservation and description; the
landlord messages carry a PMS link and a cost. Both are structured text
nobody has to retype. Proposed, not built.

**Cross-source dedupe and the leak metric.** The same fault arrives as a PMS
issue, a chat message, sometimes a landlord ping. Matching them would give
the number he actually wants: *of issues raised in chat, what share ever
reached PMS?* — quantifying the night-gap leak. Proposed, not built.

**Imported history has no author.** The attribution line reads "Built by
unknown (31 jobs)" for the workbook month. Correct and expected; anything
created from now on carries a real name.

**PDF import — CLOSED, and it had already gone wrong.** This thread said
copying from the PDF "gives mangled text" and recommended the *Daily Input*
tab. The coordinators do not have that tab — the sheet is shared as a locked
PDF — so they copied the PDF, the sheet reader refused it (tabs only), and
they pasted it into the quick-add box instead. That read one line as one
typed job: the year out of the date column became the unit number on every
row, the building was lost, and each wrapped line became its own job. It is
where "Palm Villa 2026" and the 3 September duplicates came from.

`sheetText.js` now reads that form directly — 100% of scopes and 99% of
buildings across all 493 rows of the real sheet — the quick-add box refuses
a schedule and hands it to the reader, and `isMisread` finds the rows the
old path already damaged so they can be closed off with a reason. Full
write-up in `docs/SHEET-PASTE.md`.

**The printed sheet still mismatches status and parking, and always will.**
167 of 492 rows have no parking bay, and the printed table has no
gridlines, so the columns close up and the Guest-Confirmed Y/N sits under
the "Parking No." heading. That is Google Sheets' PDF export and cannot be
fixed from here. The answer is that the technician should not read it:
**"Copy for the technician"** emits his day in working order with every
value named and `Parking: not given` said out loud. Worth confirming with
him that the techs actually switch to it.

---

## 11. How he likes to work

- Ships to production continuously: commit → merge to `main` → Vercel
  deploys → verify → report. He expects the URL to be live at the end of a turn.
- Wants the *reasoning*, not just the result. Explain what was wrong, what it
  cost in his real data, and what the fix assumes.
- Tell him plainly when something cannot be done or when he is proposing
  something that will fail. He asked directly whether coordinators would
  really update three systems; the useful answer was **"no, and here is why
  that changes the design"**, not reassurance.
- He corrects factual errors precisely (coordinators use dropdowns, not
  typing; the sheet is locked; PMS categories are too generic). Accept the
  correction, say what it changes, move on.
- Commit messages here are long and explain the *why*. Keep that.
