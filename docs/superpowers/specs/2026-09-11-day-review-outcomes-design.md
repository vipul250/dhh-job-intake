# What "not done" is being asked to mean, and how the day should close

Design, 11 September 2026. Not yet built.

## The question that was asked

The end-of-day review says *"7 still without an outcome"* on 10 September.
The coordinator's objection: those seven are not unanswered. They are
duplicates, reassignments, and work that went out to another team. **A task
that is not done does not mean the work did not happen.**

Second, that the same day carries an unrecorded pattern — a job moves to a
different technician *on the same day*, for several different reasons —
and the system has no way to say so.

## The answer the data forced

Not "add an outcome". The binding constraint is that **`not_done` is
carrying six unrelated meanings, and only one of them is "the work did not
happen".**

Measured on the live database, 11 July to 12 September — 1,593 job rows
over 63 days, 96 of them marked `not_done`:

| What the row actually means | Rows | Share |
|---|---:|---:|
| **The work did not happen** — no access, guest unreachable, ran out of time | **26** | **27%** |
| The row should not exist — duplicate, wrong entry, added by mistake | 22 | 23% |
| Wrong unit / wrong information on the job | 24 | 25% |
| **Somebody else did it** — another technician, same day or next | 11 | 11% |
| Already done on an earlier day, or technician off | 6 | 6% |
| Waiting on material, needs rescheduling | 4 | 4% |
| Assessed, needs a contractor — i.e. `diagnosed` | 2 | 2% |
| Handed to housekeeping | 1 | 1% |

**Three quarters of every "not done" in the database is not a failure to
do the work.** At least 17 of them record work that *was* done, by
somebody, and the record says it was not.

### The coordinator has been telling us this in free text for two months

Seven canned reasons exist. The database holds **seventeen more, typed by
hand**, because none of the seven fit:

```
duplicate (×12)            wrong entry (×6)          sorry by mistake i added 7th task (×2)
done by yousuf             fixed by Yousuf daljeeth was busy
done by other tech same day because youssuf was busy (×2)
Jabbar was busy with existing task forwded to Yousuf he completed
completed by rizwan same day since anthony is off
bright was bust completed by vitalis next day
Anthony is off today work was done by vitalis next day
jabbar off work completed next day (×2)      work completed here on 6th itself
Assisgned to HK since its a minor task       once materials available need to schedule (×4)
```

Every one of those is a person working around a missing button. Twelve of
them are literally the word **duplicate** typed into a free-text box.

### The worked example: 10 September

The day the coordinator names as his most accurate. 51 rows: 13 tombstones,
38 jobs. The board reports 28 fixed, 3 diagnosed, **7 without an outcome**.

| Row | Recorded | What the coordinator's own note says |
|---|---|---|
| Damac Prive A 3010A | Not done — needs contractor | Bright attended and assessed. This is **diagnosed**. |
| Cloud A 2004 | Not done — guest not reachable | *"not done by bright but insted given to another tech"* — **reassigned**, and the reason contradicts the note |
| Sobha Hartland Waves 3411 | Not done | *"Assisgned to HK since its a minor task"* — **another team's now** |
| Ocean Heights 903 | Not done — no access | **Genuinely not done** |
| Marina Mall 2111 ×4 | Not done ×2, fixed ×1, + a "Retry" follow-up | One job. Vitalis ran out of time; **Yousoufu did it at 14:39**. Three of the four rows should not be there |

Honest reading of the same day: **28 fixed, 4 diagnosed, 1 genuinely not
done, and 1 still open** — Cloud A 2004, which was handed to another
technician whose answer was never recorded. Plus 1 job handed to
housekeeping and 3 rows belonging to the 2111 tangle. Thirty-eight rows are
thirty-four pieces of work.

The board reports seven failures where there is one. It lands on named
technicians.

### The Marina Mall 2111 event trail

The clinching evidence, timestamps from the job's own history:

```
13:19  created                          Vitalis
14:08  moved_in       guest-complaint
14:09  not_done       Ran out of time
14:09  follow-up "Retry:" created automatically
14:11  not_done       No access / guest refused
14:37  two more rows created            Yousoufu
14:38  not_done       "duplicate"        <- typed by hand
14:39  done           Yousoufu fixes it
15:10  not_done  ->  not_done  ->  fixed  ->  not_done  ->  not_done
15:11  not_done       "duplicate"        <- typed by hand again
```

Five state changes in sixty seconds on one row. That is not a coordinator
making mistakes; it is a coordinator with nothing to press.

## What is wrong, precisely

The close-out asks one question where there are two.

1. **Did the work happen?** — fixed / made safe / diagnosed / not done.
   These are statements about *the work*.
2. **Is this row a job at all?** — duplicate / reassigned / another team's.
   These are statements about *the row*.

Question 2 has no answer, so every answer to it is forced into question 1,
where the only available word is "not done".

## The design

### 1. Two answers that take a row off the board

Both reuse the `cancelled` state, which already exists and is **already
excluded from every filter in the application**. That exclusion is the
expensive part and it is already built; what is missing is a button and a
word for why.

One new field:

```js
offBoard: "duplicate" | "other-team" | ""
```

| Answer | Sets | Also captures |
|---|---|---|
| **Duplicate of another row** | `cancelled`, `offBoard: "duplicate"` | `duplicateOf: <job id>`, picked from the same day |
| **Another team's now** | `cancelled`, `offBoard: "other-team"` | which team (housekeeping / contractor), free text |

Neither counts as work done, neither counts as work failed, and neither
appears against a technician. The row stays on record — nothing is deleted,
which is the rule the whole schema is built on.

`duplicateOf` matters and is not decoration: it is what lets the board show
*"2 duplicates"* in the review header rather than silently shrinking the
count, and it is the audit trail if the merge was wrong.

### 2. Reassignment needs no new state at all

`applyEdit` already emits an `assigned` event when `team` is the only field
that changed. The record is already correct if the coordinator edits the
technician. They do not, because at six in the evening the close-out dialog
is what is in front of them and it has no such answer.

So: **"Someone else did it"** in the close-out →
pick a technician → `applyEdit({ team })` → state returns to `scheduled`
→ the new technician closes it.

One row, one outcome, credit to whoever did the work, no failure recorded
against the original assignee. No new state, no new field, no migration.

For the *next-day* variant ("jabbar off completed next day"), this is the
existing move — reassign the technician, then move the date. Both already
exist; they are now reachable from the place where the coordinator is
standing.

### 3. One reason is in the wrong list

`"Needs contractor / out of scope"` moves out of `NOT_DONE_REASONS` and
becomes a `diagnosed` reason. The technician attended and assessed; that is
the definition of `diagnosed`, and `diagnosed` already forces the
follow-up that a contractor job needs. Two rows in the database today, and
it will grow.

### 4. A bug this uncovers: duplicates inflate the headline metric

`returnsByUnit` — the headline quality figure — counts **every non-tombstone
row** at a unit as a visit, regardless of state. It never checks
`cancelled`. Today that is only six rows; once duplicates are being
cancelled properly it would be dozens, every one of them deflating the
return rate of the units that are worst affected.

`returnsByUnit` must skip `state === "cancelled"`. One line, but it must
land in the same change, or this design makes the metrics worse.

### 5. The review header

Present the day as what it is, not as a single count:

```
38 rows · 34 jobs
28 fixed · 4 need a return · 1 did not happen · 1 still open
4 rows accounted for: 1 handed to housekeeping · 1 reassigned · 2 duplicates
```

A **reassigned job stays live**. It has a new owner and it still needs that
owner's answer — which is the point: Cloud A 2004 ends 10 September genuinely
unanswered, but against the right person, instead of counting as Bright's
failure.

The list below shows only rows that still need an answer, so "1 still open"
means one, and the coordinator finishes it. The accounted-for categories stay
expandable — they are the record of judgement calls, and nothing is hidden.

The current sentence, *"Every job needs an answer before the day closes"*,
stays true. What changes is that three of the honest answers now exist.

### 6. Productive time counts only what the clock recorded

A second rule, from the same conversation: **a job counts toward productive
time only if the technician wrote his arrival and departure time.** And a
job that ended without the work being done — cancelled, duplicate, no
access — does **not** count as productive time even when the technician
reached the property.

That splits a technician's day three ways, and all three are reported:

| | Definition | Counts as |
|---|---|---|
| **Productive** | arrival + departure recorded **and** the job ended `fixed`, `made safe` or `diagnosed` | productive minutes |
| **Attended, nothing produced** | arrival + departure recorded, but the job ended `not done` or off-board | reported separately, never added to productive minutes, never dropped |
| **Unmeasured** | no arrival or departure time | excluded from both, and counted as missing coverage |

A typed total in "actual minutes" is no longer equivalent to a measured
visit. It stays visible as an estimate and is labelled as one. `actualDuration`
already distinguishes its three sources — `clock`, `entered`, `measured` —
so this is a filter on `source === "clock"`, not new measurement code.

**The cost of this rule, stated plainly.** Measured across all 1,593 rows,
11 July to 12 September:

| | Rows |
|---|---:|
| With arrival **and** departure time | **2** (0.1%) |
| With a typed total only | 194 |
| Resolved jobs with a measured visit | 2 of 199 (1%) |

Productive time therefore runs on **two jobs today**. The rule is right —
it is the only definition that cannot be inflated by a coordinator's
recollection — but it does not become a usable number until the field team
logs arrival and departure. Until it does, the figure renders with its
coverage attached and reads `provisional`, exactly as the Tier 2 measures
in the quality-metrics spec already do.

Two consequences follow, and both belong in the build:

1. **The close-out must ask for arrival and departure before it offers a
   total.** 194 people typed a total instead; the form is why. Arrival and
   departure move above it, and the total becomes the fallback it is.
2. **The gap is the headline, not a footnote.** Where a technician's
   productive time is shown, the count of his unmeasured visits is shown
   beside it. "4.2 hours across 2 of 38 visits" is honest. "4.2 hours" is
   not.

## Not in this change

- **The 24 rows reading "wrong unit or wrong information".** This is a real
  canned reason being used correctly *and* as a synonym for "wrong entry".
  Splitting it needs the coordinator to say which he meant; it is a
  question, not a design decision.
- **Spurious follow-ups.** 17 of 38 auto-created follow-ups (45%) ended
  `not_done`, mostly killed with the nearest reason to hand. Once
  "duplicate" exists they can be killed honestly, and the rate becomes
  measurable. Whether the follow-up should have been created at all is a
  separate question and needs the measurement first.
- **Doubled tombstones.** Eight cases where one job's move to one date was
  recorded two to four times. Real, small, and unrelated to the review —
  its own fix.
- **Backfilling the 96 existing rows.** They stay as they are. The free-text
  reasons remain readable and the analysis above is reproducible from them.
  Reclassifying history by keyword would be a guess written into the record.

## How it will be known to work

1. Re-run the 10 September board. It must read **28 fixed · 4 need a return
   · 1 did not happen · 1 still open**, with 1 handed off, 1 reassigned and
   2 duplicates accounted for — 34 jobs from 38 rows.
2. `returnsByUnit` for Dubai Marina Mall Hotel 2111 must show **1 visit on
   10 September**, not 4.
3. A cancelled row must appear in no technician's count, in no monthly
   total, and in no returns denominator — asserted directly, not eyeballed.
4. The `assigned` event must survive a reassignment made from the close-out,
   so the day's log still shows who moved the work and when.
5. A job with arrival and departure times that ends `not done` or off-board
   must contribute **zero** productive minutes and must still appear, by
   name, under attended-nothing-produced. Asserted directly.
6. Every productive-time figure must render its coverage. A productive-time
   figure with no coverage shown is a failed build, not a cosmetic issue.
