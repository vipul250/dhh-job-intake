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

## Known gap

**There is still no agreed method for building the schedule.** Each
coordinator does it their own way, and confirmed appointments and confirmed
guest complaints are honoured. The board now makes the *consequences*
visible — who is over capacity, which occupied units are unconfirmed, what
is being pushed repeatedly — but it does not yet propose an ordering or
suggest which technician should take a job. That is the obvious next piece,
and it needs a decision from the department about what actually takes
precedence.
