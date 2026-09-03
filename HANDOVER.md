# DHH Job Intake — handover

Everything a fresh conversation needs. Read this before touching anything;
most of what looks like a quick improvement here has already been tried and
rejected for a reason recorded below.

---

## 0. WHERE THINGS STAND RIGHT NOW — read this first

**Two things are live in the code and both are waiting on him, not on us.**

### A. Sign-in has to be switched on, and he chose the built-in email sender

He reported that people he had shared the link with were changing the board.
The login is already built (email → six-digit code, `shouldCreateUser:false`
as the allowlist) and still ships **off**, behind the `auth-required` key.

He was asked and chose **Supabase's built-in email sender** rather than
configuring SMTP. That is workable for the five office addresses and it was
built for, but it has two hard edges he has been told about:

- **A couple of emails an hour, project-wide.** Survivable only because a
  session persists and refreshes itself, so a code is needed on a new
  device or a cleared browser, not daily. **The first sign-ins must be
  staggered.** It will not survive extending sign-in to the 16 technicians.
- **It may refuse addresses outside the Supabase organisation.** If so,
  `vipul@` gets codes and `haris@` does not.

Because of that second point, **the Access panel no longer unlocks on his
own address.** It now requires a code proved against one of the
*coordinators'* addresses — Haris, Kaja or Tiyana — since his own would work
whether or not theirs does. He will not have their mailbox, so the way
through is: send the test code to a coordinator, have them read the six
digits back, type them in. That is the only thing that proves the department
can get in tomorrow morning.

**What he still has to do, in order:**
1. Roster → Team → make sure the coordinators' work emails are recorded.
2. Supabase → Authentication → Users → Add user → Send invitation, for each
   of the five addresses.
3. Supabase → Authentication → Email Templates → Magic Link → must contain
   `{{ .Token }}`. The default sends a clickable link; this app asks for a
   typed code.
4. Roster → Access → send a coordinator a test code → they read it back →
   switch unlocks → turn it on. **Everyone not invited is signed out at
   once, so tell the coordinators first.**
5. A day later, run the RLS SQL in `docs/ACCESS.md`.

**The RLS SQL that was in `docs/ACCESS.md` was wrong and has been fixed.**
It granted read/write to `authenticated` and nothing to `anon` — but
`isAuthRequired()` reads that flag *before* anyone signs in. The read would
fail, `storageGet` returns null, the flag reads as "not required", and the
app would render **with no sign-in screen at all** while every other request
was denied: open and broken simultaneously. The corrected version gives
`anon` SELECT on exactly `key = 'auth-required'` and nothing else, and adds
no DELETE policy for anybody, which matches the app's own no-delete rule.

**If he needs the old link dead today**, before any of the above: rename the
Vercel project's domain. The old URL stops resolving immediately, the app
keeps working, the coordinators get the new address. It is not
authentication — anyone who kept the bundle still holds the anon key — but
it ends casual poking the same afternoon. Written up at the end of
`docs/ACCESS.md`.

### B. Job cards paste in, and the idle list is fixed

**Projects → Paste the job cards in.** The workbook's *Job Cards (Projects)*
tab is one row per project with everything except the approved amount, and
it was being ignored. Full write-up in `docs/SHEET-PASTE.md`; the short
version is that this also fixes the thing he actually complained about —
project crews showing as idle. On 1 September the board now reads
`on projects: Adi, Bijaya, Imtiaz, Khaled, Nizar, Shafeeq` with `idle:
Resty` alone, where before all seven were called idle.

**Two things in his sheet need his attention and cannot be fixed from
here:**

- **"Total Elapsed time" holds a priority on all nine rows** (`P2-High`) —
  it is a copy of the Priority column beside it. So the tab carries no
  hours at all. The parser reads that column only when it genuinely parses
  as a duration, so repairing the sheet starts feeding real hours in with
  no code change. Worth telling him: this is the single change that would
  turn the inferred project hours into measured ones.
- **Two rows store 1 September as 9 January**, because `01/09/2026` was
  typed day-first into a sheet reading it month-first. One of them is the
  Damac 4301 card. The app detects it, offers the other reading and refuses
  to import until somebody picks — it does not guess. But the sheet itself
  is still wrong, and every fresh paste will ask again until it is fixed.

**Verified in a browser, not just built** — all eight tabs render with no
console errors, the paste reads all nine real rows, and the idle line
changes as described. A `no-undef` sweep with a throwaway `npx eslint` found
the one real scope bug (`onProjectToday` referenced inside `RosterStrip`);
eslint was NOT added to `package.json`.

### C. Still unconfirmed from the previous session: was 3 September cleared?

This was the previous handover's headline and **he never confirmed it
either way**, and it was not revisited this session. The route is still:
hard-refresh → Live Board → 3 September → red banner → *Clear 2026-09-03
and start again* → type the date → paste the sheet into "Paste the day in".

**If he says it still does not work, ask what he sees when he presses it.**
That distinction is the whole diagnosis and cannot be reproduced from here:

- *"Could not archive the day, so nothing was cleared"* → the Supabase write
  is being rejected. Look at RLS on `kv_store` for the `archive:` prefix, or
  the row size (~119 jobs of JSON).
- *nothing happens at all* → he is still on an old bundle, or the button is
  not rendering. Check `wasMisread` in `LiveBoard.jsx`.
- *it clears and the rows come back* → the day watcher or a second tab is
  writing the old array back.

### Reaching his infrastructure from here

**The network cannot reach his app or his database.** The egress proxy
returns 403 for both `dhh-job-intake.vercel.app` and
`otbgwnbzhemuqqsvdsql.supabase.co`, so his data can only be changed through
the app itself. The deployed bundle can be *read* via the Vercel MCP tool
`web_fetch_vercel_url`. Deploy status: `mcp__Vercel__list_deployments` with
`projectId: "dhh-job-intake"`, `teamId: "team_Qj0Mhh8W7ln8erTreArrvADa"`.

**The Supabase MCP server is pointed at the WRONG project.**
`~/Downloads/Dependencies/.mcp.json` carries
`project_ref=zxwxdiifvuigaefzlenw`, which is his housekeeping /
inspections / payouts database — not job-intake
(`otbgwnbzhemuqqsvdsql`). So SQL cannot be applied to the board's database
from here, and the RLS and the user invitations remain his to do in the
dashboard. **Changing that project_ref would let a future session apply the
RLS, check the invited users and read the auth logs directly** — worth
offering him, since it removes the slowest part of this whole thread.

**Working copy:** the two local clones in `~/Downloads/dhh-job-intake` and
`~/Documents/GitHub/dhh-job-intake` were both stale single-commit trees.
Work happens in `~/Documents/GitHub/dhh-job-intake` on a branch tracking
`origin/claude/dhh-intake-metrics-dashboard-dgyrrs`. `npm install` is needed
there; `node_modules` was absent.

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

**Reading the sheet as it actually arrives** (`sheetText.js`). The live
sheet is shared as a **locked PDF**, so the clipboard gets the *rendered*
table — single spaces where tabs should be, rows wrapped over two or three
lines. `importSheet.js` only understood tab-separated cells and refused it,
which is *why* it ended up in the quick-add box. There are no delimiters to
rely on, so each row is parsed from both ends inwards on the columns that
identify themselves by shape (ISO date, shift window, roster name, status
word, parking bay, duration, `P#-` priority, PMS link) and whatever is left
in the middle is the scope of work — the one column that cannot be
recognised by shape and must never be guessed. Wrapped lines are rejoined
first. Graded on all 493 rows of the real sheet:

| Field | Read | |
|---|---|---|
| Scope of work | 492/492 | 100% |
| Building | 487/492 | 99% |
| Unit status | 483/492 | 98% |
| Technician | 484/492 | 98% |
| Unit | 475/492 | 97% |
| Estimated time | 470/492 | 96% |
| Priority · parking · PMS ref | — | **100% of the rows that have one** |

Those last three look low and are not: the cells are blank in the sheet.
A field it cannot read is left empty, because a blank field is visible and a
wrong one is not. **A tab-separated paste still goes to `importSheet.js`** —
an exact read beats one inferred from shape (`looksLikeSheetText` returns
false when the text contains a tab).

**Quick-add refuses a schedule.** `looksLikeSheetText` catches it before a
single line is parsed, says why, and hands the same paste to the reader that
understands it. Nobody copies twice.

**Real arrival and departure at close-out.** Two fields plus a *Now* button,
showing the span and its gap against the estimate as you type
(`1h 15m on site — estimated 30m, over by 45m`). This is the number he
actually asked for: *"the coordinator filling in the est time doesn't even
know how much time it will really take, but after a month I can compare
based on historic data."* A clock pair beats a typed total beats the
Start/Done click trail, and the dashboard reports the three apart so he can
see how much of the month is genuinely measured.

**The estimate stops being a guess** (`learned.js`). Once a kind of work has
`MIN_CONFIDENT` (5) measured jobs, its measured median replaces the seeded
catalogue default on the quick-add line, and says so: *"time from what it
actually took — 1h 15m across 5 jobs, not the 30m usually estimated"*. Below
five it keeps quoting the default and keeps quiet. Recomputed from the days
themselves and cached for 6h, so a corrected close-out corrects the library.

**Copy for the technician.** The printed sheet has **167 of 492 rows with no
parking bay**, and no gridlines — so the columns close up and the
Guest-Confirmed `Y`/`N` slides under the "Parking No." heading. That is
Google Sheets' PDF export and cannot be fixed from here, so the tech should
not read it. This emits his whole day in working order with every value
named and `Parking: not given` said out loud.

**Start this day again.** See §0 and §3.

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

### Projects — pasted in, and read back out of the schedule

**Paste the job cards in** takes the workbook's *Job Cards (Projects)* tab —
one row per project, everything but the approved amount. It handles the
multi-line quotation cells, all four written forms of a reference, and the
locale-damaged dates (offered, never guessed). Re-pasting updates: the sheet
owns status, dates, crew and scope; it never touches the approved amount,
the priced materials or the quotation link, and a blank cell never erases a
recorded value. Daily jobs carrying the same quotation number are linked
automatically, which is what stops a day being counted twice.

A card carries its **crew** and its **dates**, and that is what fixed the
idle list — `projectCrewOn(projects, date)` feeds
`checkAgainstSchedule(roster, jobs, alsoOnProject)`, whose `projectTeam`
exclusion already existed but had nothing behind it except a person
remembering to tick names each morning. Project labour is a third,
explicitly weaker tier: days inside the card's dates when the board had a
schedule and nothing else for that person. See `docs/SHEET-PASTE.md` for why
it is that and not the whole span (the whole span read half the
department's monthly capacity).

### Projects — read back out of the schedule
The tab was empty because it only listed projects somebody typed in. The
projects were in the task text all along, keyed by quotation number
(`PC-2026-08-23`). Discovery finds **9 projects across 15 job rows**, six
spanning multiple days. Parses the real mess: `Approevd`, `Quotation -PC-`,
`REV 01`, `Contin`. Found, not created — the schedule holds the work and the
hours but not the approved amount, so each is *offered* and adopting one
opens the form on the one field only a person has.

### Dashboard — 14 sections
Fix-before-this-day-runs · Stopped, not finished · Where work comes from ·
**Who did what** · **The coordinator's calls** (displacement) · Where jobs
went · Why we keep going back · How long jobs actually take · Trend · Cost ·
**Why each job is on the day it is on** · What the numbers stand on ·
**Tasks done and time on site** (real-times coverage reported apart from
typed totals and Start/Done clicks) · **What the work really takes** (per
standard task, measured vs estimated, sorted by what the gap costs over a
month rather than by how wrong it looks).

### Roster & Team
Shift message pasted rather than re-keyed. Team master with trade, base,
licence (three-valued), **work email**, note, admin flag. **Add someone**.
Access panel with the sign-in switch and its pre-flight check.

**Who is on a project today.** Originally read from a `Project team` heading
inside the shift message — wrong in practice, because that message arrives
from somebody else on WhatsApp, so using the heading meant hand-editing it
every morning, and there was no visible place to do it either. It is now a
tick-chip panel using the names the roster already knows. A project crew has
no daily job naming them, so without this the board calls them idle and the
day looks half empty. Naming the project is optional and rolls their hours
into that project's own cost — the roster→Projects link he asked for. Ticks
save immediately (an unsaved tick is a tick that did nothing) and a re-paste
of the shift message keeps them. The heading still works for anyone who
writes it.

**Absences are read both ways round.** The message writes
`Week off - Imtiaz` *and* `Tiyana - Week Off`; only the first was understood,
so the second became a coordinator's *name*. "Coordinators on" read 3 on a
day two people worked, while the hours beside it correctly read 18h. The
count now includes only coordinators with hours, the off one is named on the
tile, and **which section the absence was written under matters** — a
coordinator's week off must not appear in the technicians' "Not available"
tile.

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

**The switch will not unlock on his own address.** It requires a code
proved against a *coordinator's* address — see §0.A. He chose Supabase's
built-in email sender over SMTP, and that sender may only deliver to
addresses on the Supabase account, so proving it with the administrator's
address proves the wrong thing.

### Still outstanding — only he can do it, in Supabase
1. Invite the five addresses (Authentication → Users → Add user → Send invitation)
2. Put `{{ .Token }}` in the Magic Link template. The default sends a clickable link; this app asks for a typed code, because the email is read on a phone while the app is open on the office desktop.
3. Then Roster → Access → send a **coordinator** a test code → they read the six digits back → switch unlocks.
4. **SMTP is not configured, by his choice.** Stagger the first sign-ins; do not extend sign-in to the technicians without it.

`docs/ACCESS.md` has all of it plus the lockout SQL:
`update kv_store set value = 'false' where key = 'auth-required';`

**Row-level security is written but NOT applied** (SQL in `docs/ACCESS.md`).
Run it only after sign-in has worked for the whole department for a day —
doing it first breaks the app for everyone at once. **The SQL that used to
be in that file was wrong**: it gave `anon` nothing, and the app reads
`auth-required` before anybody signs in, so it would have rendered with no
sign-in screen while every other request was denied. The corrected policy
gives `anon` SELECT on that one key only. Until RLS is applied, the login
gate stops people using the *board* but not the *anon key in the bundle*.

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
  projectSheet.js       460  reads the workbook's Job Cards (Projects) tab.
                             Tokenises quoted multi-line cells, offers the
                             other reading of a day/month-damaged date and
                             refuses to import until somebody picks
  sheetText.js          440  reads the daily sheet as it is ACTUALLY pasted:
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
  dayLock.js            112  open / posted / started / past, and clearPost
  faultFamily.js         75  trade families and return reasons
  supabase.js            62  client, or a failure-safe stub if unconfigured
docs/  WORKFLOW.md 895 · METRICS.md 345 · ACCESS.md 170 · SHEET-PASTE.md 125
test/  README.md, harness/, suites/  (39 browser suites)
       suites/projcards.mjs is the exception: plain `node`, no browser,
       because what it checks is arithmetic and refusal, not rendering.
       `node test/suites/projcards.mjs` — 10 checks, ~1s.
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

### Three things that will waste your time if you do not know them

1. **The two stand-ins are mutually exclusive.** `mock-storage.js` replaces
   the storage module; `supabase-stub.mjs` intercepts the network
   *underneath* it. The four suites that call `installStubs` —
   `authgate`, `authready`, `authtest`, `emails` — need the **real**
   `src/lib/storage.js` in place, or they fail in a way that looks exactly
   like an app bug and is not. Run them separately after
   `git checkout src/lib/storage.js` and a rebuild.
2. **`.env.local` is needed for the tests and must be deleted before a
   production build.** Without it `createClient` takes the not-configured
   path and several suites record a console error. With it committed you
   would ship a stub URL. It is gitignored; the recipe is in
   `test/README.md`.
3. **Watch which date input you fill.** The app header has one, and the
   Dashboard and Roster tabs each add their own. `input[type=date]`
   `.first()` is the *header* — filling that leaves the tab loading a
   different day and rendering nothing. This has produced two false
   failures; use `.nth(1)` (and `.nth(2)`) instead.

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

**FIRST: has he turned sign-in on, and did a coordinator get a code?**
See §0.A. That is the thread he opened this session and everything about
access waits on it. The second question to ask is whether he wants the
Supabase MCP repointed at the job-intake project, which would let a session
apply the RLS itself instead of writing it out for him.

**Two defects in HIS sheet, reported and not yet fixed by him.** Neither can
be fixed from here and both keep costing something every paste:
*Total Elapsed time* holds a priority on all nine rows, so the Job Cards tab
carries no hours at all — repairing that one column is what would turn the
inferred project hours into measured ones. And two rows store 1 September as
9 January from a day-first / month-first collision; the app offers the other
reading and refuses to guess, but it will ask again on every fresh paste
until the sheet is corrected.

**Project hours over-count somebody on leave.** A day counts toward a
project when the board has a schedule for it and no job for that person —
but the roster is not read in the Projects view, so annual leave mid-project
looks the same as a project day. Marked with a `ponytail:` note in
`project.js` naming the upgrade path (load `roster:<date>` across the span
and drop anyone in `unavailable`). Left alone because it needs a read per
day in the span and the error is small next to the one it replaced.

**3 September: still unconfirmed.** See §0.C. Not revisited this session.

**The mis-read detector only finds the obvious damage, by design.** A unit
equal to the year of its own day is conclusive; the torn date, the shift
window or a PMS link inside the scope need a second sign. Deliberately
narrow, because a false positive would cancel a real job. The cost is that
the subtler wreckage is invisible, which is exactly why "Start this day
again" had to exist. **Do not widen it into guesswork** — if a day is
questionable, clearing and re-pasting is the honest answer.

**A residual leading "N" in some scopes.** Rows written
`… Occupied CLG-232 Not Confirmed N Pending Work*: …` have two
guest-confirmed tokens; the phrase is consumed and the bare `N` is left at
the head of the description. Cosmetic, one row in the sample, not chased.

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
- **He asks for a merge to `main` when he wants it deployed.** The branch
  rules say not to push elsewhere without permission; he has given it each
  time, but ask rather than assume — `main` is the live board his
  coordinators use that evening.
- **A green `vite build` proves nothing and he has been told so.** Both real
  bug classes this project produced pass the build: a helper used in a view
  without being imported, and a name resolved from the wrong column. Drive
  the browser, capture console and page errors, and quote the actual output
  when reporting. Do not claim something works because it compiled.
- **When a fix does not land, find out why before shipping another one.**
  The 3 September clear was shipped twice on reasoning that turned out to be
  wrong about *his* situation. The third time started by reproducing his
  exact sequence — press "Close them off" on three mangled rows — which
  showed immediately that it cancels one of three and then hides the banner.
  Reproduce first.

---

## 12. Sessions, in order — so nothing gets re-litigated

### This session (3 September)

1. **"Can we secure this system?"** People he had shared the link with were
   changing the board. The answer was mostly *the login is already built,
   here is the sequence* — plus three real changes: the Access panel now
   demands a coordinator's proof rather than his own, the RLS SQL in
   `docs/ACCESS.md` was **wrong** and is fixed (it would have opened the app
   rather than closing it), and the domain-rename stopgap is written down.
   He chose the **built-in email sender** over SMTP after being told the
   limits; that decision is his and has been made, do not re-argue it —
   but do hold the line on staggering the first sign-ins and on not
   extending sign-in to the technicians without SMTP.
2. **"The best way to update the projects."** Built the Job Cards paste,
   with re-paste as an update rather than a duplicate. The design question
   he was asked was how project labour should count, and he chose
   **inferred from the span, labelled as inferred**.
3. **The span turned out to be too crude and was narrowed.** Span × crew ×
   shift read AED 42,125 across nine cards — half the department's monthly
   capacity, on cards mostly carrying one man, the worst being 405 hours for
   a snag card that was merely *open* for 45 days. Narrowed to days the
   board has a schedule for and has nothing else for that person: 837h, and
   the top contributors became the two five-person onboardings at about
   seven hours per person per day. **This is a change to what he chose, in
   the direction he would have chosen** — the label he asked for is intact
   and the number is now defensible — but he has not seen the reasoning yet,
   so lead with it.
4. **Two bugs the build passed and the browser caught**, both of the exact
   classes §9 warns about: `CARD_OWNED` omitted `property` and `unit`, so
   every imported card had a blank address and looked plausible; and
   `onProjectToday` was referenced inside `RosterStrip` where it is not in
   scope, blanking the Live Board. Both now have regression cover — the
   first in `projcards.mjs`, the second by the browser pass.

### The previous session


1. **Real times over guessed estimates.** His stated priority: *"measure the
   number of tasks done and how much time it realistically took by their
   real arrival and departure time … after a month I can compare based on
   historic data."* Built: clock fields at close-out, `learned.js`, two
   dashboard sections. He had already **rejected** a property-level
   open-issue count as *"too much of details"* — do not re-propose it.
2. **The 3 September duplicates.** Diagnosed to the quick-add box, fixed
   with `sheetText.js`, quick-add guarded, mis-read banner added.
3. **The printable PDF mismatching status and parking.** Confirmed real —
   167 of 492 rows have no bay and the columns collapse. Answered with
   "Copy for the technician", since the export itself cannot be fixed.
4. **Coordinator count said 3 with Tiyana on week off.** Name-first
   absences were not understood.
5. **Nowhere to paste the project team.** The heading-in-the-message design
   was wrong; replaced with a panel.
6. **"Just clear everything for the 3rd."** Built "Start this day again" —
   archive-then-clear, typed-date confirmation, the single exception to the
   no-delete rule.
7. **"It still shows all the old ones."** The dead end in §0. Fixed; **not
   yet confirmed working by him.**

Two claims of mine that turned out to be wrong, and were corrected to him:

- I said the re-paste dedupe might be broken. **It is not** — pasting all of
  3 September twice adds 32 rows then zero. What duplicated was old mangled
  rows keying differently from the same rows parsed correctly, which no
  dedupe could catch.
- My clear action's comment claimed nothing would be emptied if the archive
  write failed. **It did not check** — `storageSet` swallows errors and
  returns null rather than throwing. Fixed; it now aborts and says so.
