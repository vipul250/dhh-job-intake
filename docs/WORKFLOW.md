# One board, two roles, no second pass

## What was wrong

The department ran two systems and did one job twice.

The evening coordinator read PMS from 2pm, built a schedule in Sheets, and
typed each job into PMS as a task. The next day the admin opened a
different app and re-recorded what had happened. Two people, two tools, one
set of facts entered twice — and the second entry was the only place an
outcome existed at all.

Worse, the schedule was a **document**. The morning coordinator replaced
the night's version with a current one. Whatever was on the old version was
simply absent from the new one — not moved, not cancelled, not deferred,
just gone, and nobody could say which. That is not a bug anyone could fix,
because a list that gets overwritten cannot tell you what used to be on it.

## The change

**A job is now a thing with a life, not a row on a day's list.**

Every job has an id, a state, the day it is on, the day it *first*
appeared, and an append-only history. Nothing leaves a day silently:

| Action | What is kept |
|---|---|
| Move to another day | The day it left keeps a **tombstone** naming where it went, who moved it, when, and why. The job arrives on the new day carrying its whole history and shows "pushed 2× · since 18 Aug". |
| Cancel | The job stays on the day, greyed, with the reason attached. |
| Done / Not done | A state on the job, with a reason when it did not happen. |
| Any edit after it was scheduled | A line in the job's history: which field, from what, to what, by whom. |

The board shows a **"Left this day"** section listing everything that was
on the day and is not any more, with a link to where it went. That section
is the answer to "where did the older job disappear to" — not a report you
run afterwards, but a property of how the data is stored.

## The daily cycle now

**Evening coordinator** works the Live Board instead of Sheets. Capture is
one line:

```
Palm Villa E41 AC not cooling 1h Vitalis occupied p2 3-4pm
```

Everything is picked out of that — building, unit, task, technician,
estimate, occupancy, priority, visit window — in any order, and shown back
as chips before anything is saved. Paste several lines to add several jobs.
Anything the parser missed is editable in place on the card afterwards.

As the schedule builds, each technician's row shows a live load bar against
their shift. Over 100% is visible while it can still be changed.

**PMS still gets its record.** The API route is closed, so that double
entry does not disappear — but it stops being double *typing*. Every job
and every technician's whole list has a **Copy for PMS** button that
formats the task; PMS gets a paste.

**Next morning**, whoever is on shift opens the board and is met with a
banner: *"N jobs from before today were never closed out."* Those are the
ones that used to vanish. They can be brought forward in one action with a
reason, or the earlier day can be opened and each closed out properly.
Nothing rolls over on its own, and nothing disappears if it isn't dealt
with — it keeps being counted until somebody decides.

**During the day**, changes are made on the same board by whoever is
there. New complaint takes a slot? Move the displaced job — the reason is
required, and the day it left keeps the record.

**The admin's pass is gone as a separate step.** Done / Not done / PMS ✓ are
buttons on the same card the coordinator built. There is no second tool and
no re-entry. Choosing "checking what happened" at sign-in only changes which
buttons sit in front; everyone can do everything.

## Two people at once

The board polls for changes and shows *"Updated by someone else"* when
another person's edit lands.

Writes are **version-guarded**. A plain read-modify-write loses data when
two people act within the same second — measured, before this was added:
the coordinator adding a job while the admin closed another one, and the
admin's outcome silently disappeared. That is the same failure the
department is escaping, so it was not acceptable inside the replacement.
Now a write only lands if the stored row still carries the version the
writer read; otherwise it re-reads, re-applies and retries. Tested with ten
simultaneous writers — five adding jobs, five recording outcomes — all
twenty changes landed.

Two people editing *the same field of the same job* is genuinely ambiguous;
there the later write wins, but the earlier one is still in that job's
history.

## Who did what

Sign-in is a name and a role, stored on the device. It is **attribution,
not authentication**: it puts a name on every change so the board can answer
"who moved this job", which is the question nobody can answer today. It does
not restrict anything, and it is not a security boundary. Real per-user
logins are a separate piece of work.

## What this measures that nothing did before

The Dashboard gains a **"Where jobs went"** section:

- how many jobs were pushed at least once, and why
- jobs pushed **three or more times** — chronic deferrals nobody is deciding on
- the oldest job still being moved, aged from the day it first appeared
- jobs cancelled with a reason — visible rather than vanished
- **jobs still open on a day that has already passed** — the disappearances,
  now counted instead of invisible

## Moving off Sheets gradually

Nothing forces a switch. *Import Sheet* still takes a paste of the workbook,
and imported rows are upgraded to full job records the first time their day
is opened on the board. A sensible order:

1. Keep Sheets, use the board for one shift, compare.
2. Coordinator captures on the board, still copying into PMS with the button.
3. Stop maintaining the sheet; keep the export for anyone who wants a printout.

## The scheduling method

Previously each coordinator built the day their own way, so two people given
the same jobs produced different days and neither could say why. The agreed
precedence is now written down and applied:

> **1. confirmed appointment  →  2. P1  →  3. batch by building**

Those three do different kinds of work, and the planner treats them
accordingly:

- **A confirmed appointment is fixed, not first.** A guest who agreed to
  3–4pm is not served by a technician arriving at 9am. Appointments are
  anchors that pin the timeline; everything else fills around them.
- **P1 is a true priority** — it takes the earliest time still free.
- **Batching orders everything left** so the day stays in one building
  while there is work in it, then moves to whichever building has the most
  outstanding, because that is the trip worth taking.

A fourth consideration sits *below* all three and is not part of the rule:
a job with a stated time whose guest has **not** confirmed. Ignoring it
would schedule a job at 09:00 that somebody asked to have at 16:00, so it
is honoured where a gap allows — after P1, never over an appointment — and
is labelled differently everywhere it appears so it is never mistaken for a
real commitment.

**Order of work** on each technician's row shows the resulting timeline
with a reason on every line, so a coordinator can see why the order is what
it is and overrule it knowingly.

### When it does not fit

The panel lists what will not fit **in the order the rule says to shed it**
— batched work first, then requested times, then P1 last. Within a tier, a
job that has already been pushed is placed at the *bottom*: pushing it again
is how jobs used to disappear, so the plan does not casually nominate it.
One button moves the overflow to tomorrow, and every day they leave keeps
its record.

### Conflicts it will tell you about

- Two confirmed appointments that collide.
- An appointment promised for a time outside the technician's shift — for
  example a guest confirmed for 8am on a 9am–6pm shift. Either the guest or
  the roster has to give, and previously nobody found out until the morning.

### Suggesting a technician

The same precedence applied at the moment of assignment rather than
ordering. Unassigned jobs offer a ranked suggestion — who is already going
to that building today, who has room left in the shift, whose shift covers
the requested time — each with its reason shown, because a suggestion a
coordinator cannot interrogate is one they will ignore.

Reading the clock is its own small problem: the workbook contains 97
distinct spellings of a visit time (`3-4pm`, `4 - 5 Pm`, `12.30pm`,
`16:00:00`, `Sharp 12.00`, `1.30-2.30pm`, `Before 2.00 Pm`, `after 2pm`,
`Not Confirmed`, `Onb`). All of them parse. Where an hour is written
without am/pm and lands outside the shift, it is nudged by twelve hours if
that puts it inside, and the line says the assumption was made.

### What it was checked against

Run over all 123 technician-days in the real workbook: every job is either
placed or listed as overflow (none silently lost), no two placed jobs
overlap, nothing unanchored is scheduled past the end of a shift, and no P1
is shed while there is room in the shift to hold it.

---

## Out-of-hours work, and jobs that stop without finishing

### "Done" was hiding three different things

The evening coordinator leaves at 11pm. A complaint arrives at midnight. A
support agent raises a PMS task, posts it to the maintenance group on
Google Chat, and a night technician goes. The intake system never hears
about any of it.

And when a technician does attend, the visit ends in one of several ways
that PMS records identically. A real task from the system:

> **TSK401531** — *"WC- Pending work - The existing 28 mm copper pipe is
> pinched/damaged and needs to be replaced."*
> Material required: 28 mm copper pipe – 2 meters, 28 mm copper union – 2
> pieces. Technician's report: *"the pipe had been repaired multiple times
> previously, but several leakage points were found along the line."*
> **Status: Done.**

Nothing was fixed. So a visit now ends in one of four ways:

| Outcome | Meaning | Follow-up |
|---|---|---|
| **Fixed** | Nothing left to do | — |
| **Made safe** | Contained — valve closed, power isolated. It comes back without a return visit | **required** |
| **Diagnosed** | Looked at only — needs a part, a quote, or a contractor | **required** |
| **Not done** | The visit did not happen | reason required |

**Made safe and diagnosed cannot be closed without booking the return.**
The dialog will not let you through without naming what is still needed
and a date. The follow-up job is created on the spot, carries the parent's
priority (a contained P1 stays a P1 until it is actually done), and links
both ways — so the chain from "closed the valve" to "water heater
replaced" is a property of the data, not something a coordinator has to
notice in a comment thread.

### Reading the technician's report instead of retyping it

Technicians already file a structured report. Paste it into the close-out
dialog and the app reads it:

```
Arrived @ 11:20pm
Finished @ 11:55pm
- closed the valve to stop the leak for now.
- water heater is damaged and needs replacement, ceiling needs paint after.
```

→ 35 minutes on site, outcome suggested as **Made safe** ("the report
describes a temporary measure"), and *"water heater is damaged and needs
replacement, ceiling needs paint after"* pre-filled as what the follow-up
must do. Both real PMS formats parse — `Arrived @ 7:58pm` and
`- Arrival Time: 10:40 AM` — as does a `Material Required:` block.

The app **suggests**; the person closing the job decides. It also
distinguishes what was *found* from what is still *needed*: "guest reported
a water leak" is the complaint, not the return visit.

### Out-of-hours log

One button on the board. Log the job against **the night it happened**,
with who attended, who reported it, whether it came through Google Chat or
PMS, and the task ref. It is marked `unplanned`, so arriving volume stops
being invisible.

### Where the work came from

Every job carries a source: guest/support, housekeeping, GRO/field
employee, planned/PPM, follow-up, out-of-hours emergency, project — and
**inspection filling an idle slot**, which the schedule has always
contained without admitting it. Filler hours look exactly like demand on
every capacity chart until they are named.

### What this makes measurable

- **Open containments** — units running on a temporary measure with nobody
  booked to finish. The one to watch; P1s among them are flagged.
- First-visit fix rate — of visits that ended, how many actually finished
- Follow-up booked rate, and median days to come back
- Demand by source, reactive share, unplanned volume and hours
- Inspection-as-filler hours, separated from real demand

---

## Roster — who is actually available

The schedule was always built against an assumed team. Nothing knew that
Riyaz was on his week off, that Faizal was in Fujairah, or that Anthony was
the only person reachable between 11pm and 2am. A job could be assigned to
somebody on annual leave and nothing said a word.

Somebody already writes the roster every day as a message, so it is
**pasted, not re-entered** — the same reasoning as the technician's work
report. Paste it exactly as written:

```
*Shift Timings for 01/09/2026*

Week off - Riyaz
PH -   Imtiaz
Fujairah -  Faizal
Annual Leave - Kofi

9.00am - 6.00pm
Resty
Adi, Khaled, Nizar, Shafiq & Bijaya
...
Stand-by Emergency Tech 11.00pm - 2.00am
Anthony +971 50 260 6632

*Coordinators Shift*
Haris - 8.00 am - 5.00 pm
```

Read from that: three shift blocks with their hours, crews expanded into
the individuals they contain, four categories of absence, the stand-by
technician with the hours and the phone number, and the coordinators'
shifts. `Anthony (First Day)` keeps its note.

**Fujairah is not an absence.** Somebody posted off-site is working — they
are just not available for Dubai jobs. Counting them as away would
understate the headcount the department is paying for, so they are counted
as available and shown separately.

### Live vs total headcount

- **Available today** — on shift, off-site, or on stand-by
- **Total on the roster** — everyone, including week offs and leave

The gap between the two is what a fully-booked board is really running on.
Rostered hours are computed from the shifts themselves rather than assumed.

### The check it exists for

The saved roster is compared against the day's schedule, on the Roster tab
and as a strip across the top of the Live Board:

- **Work assigned to somebody who is not available** — named, with the
  reason, e.g. *"Abdul Riyaz (Week off) — Ocean Heights 1204"*
- **Technicians with jobs who are not on the roster** — either the message
  missed them, or the name is spelled differently on the board
- **Technicians on shift with nothing scheduled** — paid capacity with no
  work against it, worth filling with planned work before it becomes an
  inspection to pass the time

### Crews

`Adi, Khaled, Nizar, Shafiq & Bijaya` is five people who travel together,
and every metric has always split them into five individuals — five rows in
the load heatmap, five entries in cost-by-technician. The board now says
"5 people" on the group header, because a single row with one load bar read
as one person. The load bar is elapsed time on site: they are all there for
it, so three hours of work is three hours of everyone's day.

---

## The team, and how many people a job needs

### These people are not interchangeable

Khaled is a painter. Kofi is a carpenter and cannot drive. Faizal cleans
pools and is based in Fujairah. Bijaya is a helper. The board treated them
all as "a technician".

Two attributes carry most of the weight:

- **Trade** — a pool wants the pool cleaner's equipment; a full repaint
  wants the painter. A multi technician covers general work.
- **Driving licence** — a crew of three people none of whom can drive
  cannot get to the property. This is a hard dispatch constraint and
  nothing in the app knew about it.

Licence is three-valued. **Unknown is not the same as no**, and guessing
would produce exactly the confident wrong answer this project keeps
removing. The team list flags whose licence has not been recorded.

The team list is seeded from the details supplied and is editable in place.
Annotated lines can be pasted to update it —
`Khaled- Painter dubai without licence` — and only what a line actually
says is changed.

### Two people, not one

The complaint from the field: a water heater takes two people, one gets
assigned, and when they call it in a nearby technician is pulled off his
own work. Two jobs disrupted for one bad assignment.

It is measurable in the real workbook, not a hunch:

| Work | Jobs | Crewed with one person |
|---|---|---|
| Water heater | 7 | **2** |
| Glass door / mirror | 11 | **8** |
| Duct cleaning | 3 | 0 |

Technicians were writing the requirement into the task text because there
was nowhere else to put it — *"Door is touching on the floor need to assign
two"*, *"Pending work (Need two person)"*.

The requirement is now read from three places, in the order they deserve
trust:

1. **What a coordinator set on the job** — an explicit override
2. **What the task text says** — "need two person" is parsed
3. **A rule for the kind of work** — water heater lift, duct cleaning,
   glass and mirrors, moving furniture, work at height, full repaint

Every rule states its reason on the card, so it can be overruled by
somebody who knows better rather than argued with.

**Over the real month this finds 17 short-crewed jobs.** The board says so
the evening before, when it costs nothing to fix.

### Keeping the warnings worth reading

The first version flagged 94 trade mismatches and 56 crews with no driver —
noise that would train people to ignore the panel. Both were wrong:

- A multi technician handles a paint touch-up perfectly well. Only **pool
  work and a full repaint** are strict; the rest is a preference the
  suggester uses and the checker stays quiet about. That took 94 down to
  **11 real ones** — pool jobs given to people who are not the pool cleaner.
- All 56 driver warnings came from **one unrecorded licence**. An unknown
  licence is a gap in the team list, not a dispatch problem, so it is
  surfaced once on the team list instead of on every job.

### Suggestions now know who people are

Asking for a suggestion on an unassigned job considers **everyone rostered
today**, not only those who already have work — the painter was previously
invisible for a painting job precisely because his diary was empty.

Real output for a full repaint: **Khaled — "is the painter · cannot drive ·
9h still free"**. For a pool: **Resty — "is the pool · already at Gemz by
Danube today"**, then Faizal — *"is the pool · based in Fujairah"*.

Every factor is named, including the awkward ones.

---

## Why the board sometimes came up empty

Reported as "it fails to show the jobs for the day sometimes, and they are
still not there after refreshing". Reproduced, and it was four defects in
one function:

1. **A failed read looked exactly like an empty day.** `storageGet` returns
   `null` both when a key is missing and when the request fails, so a
   network blink rendered *"Nothing scheduled for 2026-08-22"* — silently.
   On an app whose whole job is showing what is scheduled, that is the
   worst available failure: it looks like the data was lost.
2. **`setLoading(false)` was not in a `finally`.** Anything that threw — a
   write conflict while migrating an old day, a dropped request — left the
   board on "Loading…" permanently, through refreshes.
3. **Nothing cancelled a superseded load.** A slow response for an earlier
   date could land after a newer one and paint the wrong day.
4. **The migration write ignored the rows it was handed**, taking a
   snapshot from before the re-read — the exact mistake `mutateDay`'s
   contract warns about, made in the one place that runs every time a day
   is opened.

Now: reads distinguish failure from emptiness and say so, with a Try
again button and an explicit "nothing has been lost"; every path releases
the spinner; superseded loads are discarded; and the migration derives from
what it was given. The rollover prompt was also moved off the critical path
— it reads five more days, and a failure there used to take the board down
with it.

## Nothing can be deleted

Hard delete is gone from the app. A job that has been logged is a record of
what the department planned or did; removing it takes the answer to "where
did that go" with it, which is the failure this system exists to end.

- **Before the visit** — a job can be *cancelled*, with a reason. It stays
  on the day, greyed, in "Left this day".
- **After it is closed out** — the Cancel option disappears. The visit
  happened; that is a fact about the day. The card says so, and points at
  the history if it was recorded by mistake.
- **Moved** — leaves a tombstone naming where it went.

## Filling tomorrow's schedule — fast, and the same every time

Free text is quick to type and impossible to compare. In the real month
"pool cleaning" appeared 57 times in four spellings, and shower door hinges
were written three different ways. Every metric downstream then has to
guess whether those are the same work, and each coordinator invents their
own wording.

So capture is still **one line**, but the line **snaps to a standard task**:

```
palm villa e41 shower door hinges need to replaced vitalis occupied
```

becomes **"Shower door hinge replacement and alignment"** — with **2 hr**,
**2 people** and **shower door hinges** as the material, all filled in
automatically. No extra clicks: it works on the words the coordinator was
going to type anyway, and the snap is always shown before it is applied.

That single example fixes three problems at once: consistent wording,
consistent duration, and the crew size that was being missed.

The catalogue holds 36 standard tasks seeded from the real month — 59% of
jobs fall into recurring shapes, so most of a day is covered. Durations are
the medians actually scheduled; crew sizes come from the crewing rules.
There is also a searchable picker (*pick from standard tasks*) that keeps
whatever building and unit is already typed, and anything typed that
matches nothing can be saved as a new standard task from the board, so the
list grows with the department.

Matching is deliberately conservative — two thirds of the standard wording
has to be present. Silently rewriting a coordinator's words into the wrong
task is worse than not matching at all: they would stop trusting the box,
and a wrong canonical label corrupts every metric built on it.

## Posting the day, and what happens to it afterwards

The evening coordinator finishes scraping PMS and presses **Post**. Until
then the day is a draft and can be changed freely — that is what drafting
is. From the moment it is posted, three things become true.

**The day is locked, and changes are logged.** Editing anything on a posted
day asks why first. The answer is stored on the job, with a name and a
timestamp, and every one of them is counted on the dashboard under *changed
after posting*. Nothing is forbidden — a maintenance department cannot work
under a schedule it is not allowed to change — but a change is now a
decision somebody made rather than an edit nobody sees.

That covers all four ways a posted schedule actually moves: an edit, a job
moved to another day, a job cancelled, and a job added after the fact. All
four are the same thing from the field's point of view — the plan they were
given is not the plan any more — so all four are counted the same way.

**A day that has already happened is locked for the same reason and says
so.** Before this, yesterday's schedule could be quietly rewritten, which
made every measurement of yesterday unreliable. Editing a past day is still
possible, because corrections are real, but it now announces what it is and
asks for a reason.

**A move asks what took the slot.** This is the change that matters most.
When a job is moved because something else came in — a new guest complaint,
a confirmed appointment, an emergency, project work — the app asks which
job took its place and records the link on both ends. The job that moved
knows what beat it; the job that stayed knows what it displaced.

That link is what makes a coordinator's judgement readable. One P3 moved
for a P1 water leak is the right call. The same P3 moved four days running,
each time for something plausible, is a decision nobody is making. Only the
second one was invisible before, and only because nothing recorded the pair.

The dashboard reads it back under **the coordinator's calls**: how many
slots were given away, how often higher-priority work was moved for lower,
whether the displaced job ever got done afterwards, and the same figures per
coordinator. It is deliberately unimpressive after a week. Read it after a
month.

## A job that was not done is not finished with

Marking a job *not done* used to end there: a reason, and a job sitting on a
day that had already passed with nobody booked to go back. That is the same
disappearance the whole system exists to stop, arriving by a different door.

So the close-out now asks one more question — **when does it happen
instead?** — and will not save until it is answered. Three answers:

- **Book it for tomorrow**, or **for another day** — creates the linked job
  on that day, carrying the property, unit, priority and materials across,
  with the original marked as what it is following up on.
- **Not rebooking it** — a legitimate answer, and now a recorded one. It
  shows on the dashboard as work that was dropped on purpose rather than
  work that quietly stopped existing.

The dashboard tile *not done, booked again* is the coverage: of the jobs
that were missed, how many have a date. A department where that number sits
low is not losing jobs to bad luck; it is losing them at close-out.

## The projects were never missing

The Projects tab was empty, and the reason it was empty is worth stating
plainly: it only ever listed projects somebody had typed into it. The
projects themselves were in the schedule the whole time, written into the
task the way the department has always written them —

```
ONB - Approved - Quotation - REV 01 - PC-2026-08-17 - Duct Cleaning
Contin  Approved - Quotation - PC-2026-08-23 - Maintenance work
Approevd - PC-2026-08-13 - Curtain fixing along with Fly mesh Repair
```

— with the quotation number as the identity. Asking a coordinator to
re-enter that is how the double-entry problem started, so the app reads it
instead. Over the real month it finds **nine projects across fifteen job
rows**, six of which ran on more than one day. `PC-2026-08-23` at Afnan 5
603 ran three separate days and had never been visible as one thing.

Reading it back is what turns three job rows into one project with a
duration, a crew and a labour cost. The parser is written for how people
actually type: `Approevd` is in the real data, one reference runs the words
together as `Quotation -PC-`, one carries `REV 01`, and three are prefixed
`Contin`. A parser that only handled the tidy form would drop those
silently, and a missing project looks exactly like a project that never
existed.

**Found, not created.** What the schedule contains is the work and the
hours. What it does not contain anywhere is the amount the client approved
— so nothing is added to the project list automatically. Each one is
offered with its days, crews and hours; bringing it in opens the form on
the one field only a person has. A project list carrying costs with no
prices against them would be worse than an empty one.

**A unit's first row usually predates its quotation.** "Onboarding project"
on the 20th and "ONB - Approved - Quotation - REV 01 - PC-2026-08-17 - Duct
Cleaning" on the 23rd are both Azizi Riviera 10 701 and both the same
project. A reference-less row is folded into the referenced project for the
same unit, nearest in time.

**What is not guessed.** "Approved - Water heater replacement - Collect from
shop" says approved and carries no reference. Nothing in that text says
whether it is quoted work whose number nobody wrote down or a guest
agreeing to an ordinary repair. It is listed separately as worth a look, and
counted as neither.

### The unit that was hiding inside the building name

Fixing this exposed something bigger. **117 of the 474 rows** — a quarter of
the month — leave the unit column empty and write the unit on the end of the
building instead: `Afnan 5 603`, `Sunrise Bay Tower 1 902`, `Palm Villa E41`.

Every one of those was being counted as a building of its own. The month
read as 233 distinct buildings; it is actually **181**. Worse, the same
apartment written both ways was two different places, so **33 units that
were revisited never showed as repeat visits at all** — Harbour Gate Tower 1
unit 3403 was visited four times and read as four unrelated one-off jobs.

The split only ever runs when the unit column is genuinely empty, and only
on a tail that cannot be a building number: three or more digits, or a
letter followed by digits. `Afnan 5 603` splits; `Afnan 3` and `Azizi
Riviera 10` do not. Of the 88 distinct cases it splits 83 and leaves five
alone — `Warehouse`, `7th floor office`, and `Damac Hills 2 Victoria 61`,
where 61 could be a villa or a phase and nothing here should decide.
Rows that already have a unit are never touched.

Stored days are corrected as they are opened, so this repairs the month
already in the database rather than only new imports.

## Why is this job on this day?

Asked what they do when an issue is logged in PMS, a coordinator says they
assess it and schedule it for a future day, or the same day if possible.
That is an honest description of a decision with no stated basis — and the
queue shows the cost of it. 189 maintenance issues waiting, the oldest
reported four months ago, several with due dates that passed in early
August. Nothing was going wrong on any particular day; there was simply no
rule, so nothing was ever definitely late.

The information needed to decide is already in PMS and is not being used.
Every issue carries a priority, a reported date, a due date, and the one
that matters most: the unit's occupancy — "Vacant", or "Occupied until
2026-09-08 11:00". A unit that empties on the 8th is a three-hour job's
best day of the month and nothing points that out.

### The rule

**1. When can we get in?** The hard constraint, and the unused one.

| Occupancy | What it means for the day |
|---|---|
| Vacant | Any day. No guest to ask, no access risk. |
| Occupied until D | Work needing the unit empty — duct cleaning, painting, water off, anything over 3 hours — cannot happen before D. **That checkout is the first clean day.** Lighter work can happen around the guest, but only with an agreed time. |
| Checkout / B2B on D | D is the window, and it is hours wide, not a day. |
| Occupied, no end date | Cannot be planned at all until somebody speaks to the guest. |

**2. When must it be done by?** The PMS due date where there is one;
otherwise the reported date plus the band the priority implies — P1 same
day, P2 three days, P3 seven, P4 fourteen. These are written down here so
they can be argued with. That is the point of having them.

**3. Do those two overlap?** If not it is a conflict with no right answer:
a PPM due in July in a unit whose guest leaves in late September. Two ways
out — agree a time with the guest inside the deadline, or accept the slip
and record why. What it must not do is keep waiting, which is what happens
now.

**4. Which day inside the window?** A checkout or a vacancy wins. Otherwise
the earliest day with room in the shift. Ties go to the day the crew is
already in that building.

Ordering jobs *within* the chosen day is a separate rule and was already in
the app: confirmed appointment, then P1, then batch by building. This one
picks the day; that one picks the hour.

### What it looks like on the real queue

Fifteen issues copied from the Issues screen, run through the rule:

- **Three vacant units with work 29–53 days overdue and nothing at all
  stopping them.** Water tank cleaning at Palm Villa F30, a replenishment at
  Claren Tower 1 1301, AC grill cleaning at Golf Promenade 2A 606. The unit
  is empty, the deadline has passed, and no constraint explains the wait.
- **Six waiting on a checkout that is already in PMS.** The date the unit
  empties is on the record; nobody was reading it.
- **Five blocked on a guest** — occupied, no time agreed. They cannot be
  scheduled and should not look schedulable.
- **Two genuine conflicts**: the access window opens after the deadline has
  already gone. Those need a decision, not a date.

### It recommends; it does not schedule

The coordinator takes the day or overrules it, and overruling is one click
with the reason recorded. That is the change: not that a machine picks the
day, but that picking a different one is now a visible choice instead of the
only thing that ever happens.

Every job booked this way carries `scheduledBasis` — the reason the day was
chosen — and the dashboard reads it back under **why each job is on the day
it is on**. The figure to watch there is not how often the rule was
followed. A coordinator who never overrules it is following a script, not
exercising judgement. The figure to watch is coverage: how much of the board
was placed for a reason anybody can name.

## The operating rule, from 1 September

Two touchpoints a day, each by somebody already at a desk. Nothing else is
asked of anyone.

**Evening coordinator — every task created in PMS is also here.** They have
just finished creating those tasks in PMS; keying them again would be the
double entry this whole project exists to remove. So it is *one paste*.
**Mirror the PMS task list** takes the task table straight off the PMS
screen and builds the day from it: title, property, unit, technician,
priority, duration and the TSK reference that ties the two systems together
for good. Pasting the same list twice is safe — anything already on the day
with that reference is skipped.

**The schedule closes when the date changes.** Not when somebody remembers
to press Post. At midnight the day becomes the field team's, and from then
on a change to the *plan* — adding, moving, cancelling, editing — is logged
with a reason. Recording what *happened* is never locked and never asks for
a justification; that would be punishing the person doing the review.

**Morning coordinator — before leaving, say how the day went.** One list,
one line per job, and the count of jobs with no outcome sits on the button
so nobody has to go looking. A clean fix is one click. Anything else opens
the full close-out, because *made safe*, *diagnosed* and *not done* each
have a question behind them that decides whether the work comes back.

### What the paste reads that nobody was reading

The department already encodes the two most valuable planning facts in the
first characters of the PMS task title, and until now they were decoration:

| Title | Read as |
|---|---|
| `GC 2-4pm - Clogged Sink GR B` | guest confirmed, 14:00–16:00 |
| `GC 12.30 Pm - (Below unit tenant)` | guest confirmed, 12:30 |
| `vacant - Laundry room door is broken` | unit empty |
| `B2B- Paint touch up` | changeover day |
| `checkin - None of the sockets working` | guest arrives that day |
| `WC - Water leak from our unit` | occupied, no time agreed |

A confirmed appointment is the first thing the day gets planned around —
it is step one of the scheduling rule — and it was sitting in plain text.
An unrecognised prefix is left in the description rather than discarded.

### On PMS's own categories

PMS classifies with seven Maintenance subcategories: AC Cleaning/Servicing,
Carpentry Works, Plumbing Works, Electrical Works, Pool Works, Gardening
Works, General Inspection, Others, Appliances, Pre Handover. That is right
for a dropdown a person has to pick from under time pressure, and far too
coarse to answer "why do we keep going back to Palm Villa".

So the PMS value is stored as it was chosen, for reconciliation, and the
app classifies more finely from the task text on top of it — at no typing
cost, because it is inferred rather than asked. The two never disagree;
one is simply the summary of the other.

### One paste box, two sources

The coordinator's live Google Sheet and the PMS task list are different
tables with different headings, and asking somebody at 10pm to remember
which button matches which clipboard is a small stupid tax. So **Paste the
day in** works out which it is looking at: the sheet by the columns only it
has (Task Description / Scope of Work, Estimated Time, Guest Confirmed), the
PMS list by Title plus a task Number or Subcategory. If neither is a clear
match it says so rather than guessing — importing thirty rows into the wrong
shape is far worse than a refusal.

**Rows land on the day the paste says they belong to, never on whichever day
is open.** The evening coordinator builds tomorrow while looking at today,
and silently dropping tomorrow's schedule onto today would be the worst
failure this app could have. A sheet covering several days is split across
them.

**Re-pasting is safe, and it is the expected way to work.** The coordinator
keeps adding to the sheet all evening; they paste again and only the new
rows land. Matching is on the TSK reference where there is one and on
property + unit + task where there is not — necessary, because the real
sheet carries a reference on only about four rows in ten, and without the
second key a re-paste would duplicate most of the day.
