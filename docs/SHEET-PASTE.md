# Why the schedule showed duplicates, and what changed

## What was reported

On 3 September the live board showed Resty with 15 jobs where the sheet had
5, six cards reading "Palm Villa 2026 — Pool cleaning" that looked
identical, cards with no building at all, and descriptions like:

```
2026- 14:00-23:00 CLG- Not N "Pending Work*:
09:00-18:00 and office - 7th floor Ms Anna office AC is not working N Y -Urgent Y https://…id=402305
```

## What was actually wrong

The sheet was fine. Its 3 September had **32 rows**, and Resty's five pool
cleans were at five *different* villas — `Palm villa E41`, `O56`, `O103`,
`F30`, `L14`. They only looked like duplicates because the villa number had
been destroyed on four of them.

The sheet had been pasted into the **quick-add box**, which reads one line
as one hand-typed job. Run against the real sheet, that produced:

```
IN : 2026-09-03 09:00-18:00 Resty Palm villa E41 Occupied … Pool Cleaning
OUT: property=undefined  unit="2026"  desc="09:00-18:00 Palm villa E41 Not Pool Cleaning Y …"
```

Three failures in one line:

1. **The year out of the date column became the unit number.** Every row in
   the sheet, on every day it was pasted. That is where "Palm Villa 2026",
   "Beach Isle Tower 2 2026" and "Avanti Tower 2026" came from — 2026 is the
   year.
2. **The building was lost entirely**, because the parser had already spent
   its property slot on the date.
3. **Every wrapped line became a job of its own.** The sheet is shared as a
   PDF, and long scopes of work wrap over two or three printed lines. Read
   line by line, one job became three. That is the duplicate count.

## Why it was pasted into the wrong box

Because the right box refused it. `importSheet.js` only understood
tab-separated cells — what you get by selecting rows in Excel. The sheet is
a locked PDF, so what reaches the clipboard is the *rendered* table: single
spaces where the tabs should be, rows wrapped. The sheet reader answered
"Could not tell what this is", so the coordinator used the box that did not
complain.

Both halves of that are the app's fault, not the coordinator's.

## What changed

**`src/lib/sheetText.js` — reads the sheet as it actually arrives.** No
delimiters to rely on, so the row is parsed from both ends inwards on the
columns that identify themselves by shape: a leading ISO date, a shift
window, a name from the roster, a status word, a parking bay, a duration, a
`P#-` priority, a PMS link. Whatever is left in the middle is the scope of
work — the one column that cannot be recognised by shape, and the one that
must never be guessed at. Continuation lines are rejoined to the row above
before anything is read.

Measured against all 20 pages of the real sheet (493 logical rows):

| Field | Read | |
|---|---|---|
| Scope of work | 492/492 | 100% |
| Building | 487/492 | 99% |
| Unit status | 483/492 | 98% |
| Technician | 484/492 | 98% |
| Unit | 475/492 | 97% |
| Estimated time | 470/492 | 96% |
| Priority | 343/492 | **100% of the 343 rows that have one** |
| Parking | 325/492 | 100% of those that have one |
| PMS ref | 206/492 | 100% of those that have one |

The last three look low and are not: those cells are blank in the sheet
itself. A field it cannot read is left empty for a person to fill in,
because a blank field is visible and a wrong one is not.

**The quick-add box refuses a schedule.** `looksLikeSheetText` catches it
before a single line is parsed, says why, and offers a button that carries
the same paste across to the reader that understands it. Nobody copies
twice.

**The mis-read rows already in the database can be retired.** Nothing is
deleted here, so `isMisread` finds them by their signature — a unit that is
the year of its own scheduled day is conclusive on its own; the torn date,
the shift window or the PMS link inside the scope need a second sign — and
a banner on the day offers to close them off with a recorded reason. Then
the sheet is pasted again, properly.

## The printed sheet mismatching status and parking

A separate, real problem in the sheet's own PDF: **167 of 492 rows have no
parking bay**, and the printed table has no gridlines. When that cell is
empty the columns close up and the Guest-Confirmed `Y`/`N` slides under the
"Parking No." heading:

```
Damac Hills 2 Albizia 197 Occupied Y      <- Y is Guest Confirmed, not a bay
Al Dhafrah 2 G11 Vacant 438 N             <- 438 IS a bay, but reads as a room
Binghatti Tulip 305 Occupied P2-14 N      <- correct, and looks the same
```

Three rows that look alike and mean different things. That cannot be fixed
in Google Sheets' PDF export, so the technician should not be reading it.

**"Copy for the technician"** on each technician's group emits their whole
day in working order with every value named, and says `Parking: not given`
out loud rather than leaving a gap for the eye to fill in wrongly:

```
1. Damac Hills 2 Albizia 197
   Unit status : Occupied
   Parking     : not given
   Time        : 12:00-21:00
   Guest       : Y
   Work        : 3rd party completed the Guest bathroom Ceiling replacement…
   Allowed     : 1 hr
   Priority    : P2-High
```

`pmsText` had the same hole — it omitted parking when blank — and now
always states it.

---

# The other sheet: Job Cards (Projects)

The workbook has a second tab the app was ignoring. **Job Cards (Projects)**
is one row per project, twenty-two columns, and the department has been
keeping it properly: property, unit, job type, quotation ref, start date,
team assigned, scope of work from the quotation, materials list, estimated
and actual completion, job status.

Everything a project needs is in there **except the amount the client
approved**, which is exactly the field only a person can supply. So it is
pasted, not retyped: **Projects → Paste the job cards in**.

## Why it matters more than saving typing

A project runs for days off one job card. The daily board only knows about
it on the days somebody also wrote a task row for it — so the crew on it
had no job naming them, and the board called them idle.

On 3 September the Live Board listed **Khaled, Nizar and Shafeeq as idle**
while all three were named on the Damac 4301 card, in progress, due on the
4th. With the cards in, the same day reads `on projects: …` instead, and
only the genuinely unoccupied technician is listed as idle. The mechanism
was already there — `checkAgainstSchedule` has always kept a ticked project
crew off the idle list — it just had nothing feeding it but a person
remembering to tick four names every morning.

## What it reads, and what it refuses

**Multi-line cells stay in one column.** Scope of Work is the quotation
pasted whole; the real Damac row carries twenty-two numbered clauses. A cell
holding newlines comes off the clipboard wrapped in double quotes with
internal quotes doubled, so the paste is tokenised rather than split on
newlines. Splitting first is what tore a pasted day into fragments on the
Live Board.

**The messy quotation refs all read.** All four real forms —
`Quotation - PC-2026-08-08`, `PC-2026-07-23 -`, `REV 01 - PC-2026-08-09`,
`REV01 - PC-2026-08-07` — reduce to one reference and a revision number,
reusing `readQuotationRef` from the discovery path.

**"Total Elapsed time" is not read as time.** On all nine real rows that
column holds a *priority* (`P2-High`) — it is a copy of the column beside
it. It is only read when it genuinely parses as a duration, so repairing
the sheet starts feeding real hours in with no change here. Until then the
card's dates do the work.

**"Materials List" is not turned into priced lines.** It is prose:
"Materials arranged by ADI", or a shopping list with quantities and no
costs. Importing that at zero cost would put a fictional margin on a card,
so it is carried across as what the quotation *asks for*, and the priced
lines stay something a person enters as the money is spent.

**Contradictory dates stop the row.** The real tab has locale damage in it:
two rows store 1 September as **9 January**, because `01/09/2026` was typed
day-first into a sheet reading it month-first. One of them is the Damac 4301
card. The app works out the other reading, shows both, and will not bring
the row in until somebody picks one — a project on the wrong dates puts its
crew on the wrong days and invents the hours to match. Where two readings
both hold together it offers the shorter span, because the longest real job
card ran fourteen days.

## Pasting it again

Safe, and the intended way to keep it current. A card already here is
**updated** on the fields the sheet owns — status, dates, crew, scope,
reference — and **left alone** on the ones only a person can fill: the
approved amount, the priced materials, the quotation link. A blank cell
never erases a recorded value, because an empty Actual Completion column
means "not filled in", not "it never completed". What moved is written to
the project's own event log.

Daily jobs carrying the same quotation number are linked automatically. That
is not a convenience: a card's unrecorded hours are counted from its dates,
so an unlinked job row would leave that day looking empty and collect
inferred hours on top of the measured ones.

## The hours, and how far to trust them

The board measures labour from Start and Done, and falls back to the
coordinator's estimate. A project card has neither. So there is a third and
weakest tier, reported separately everywhere it appears and labelled on the
card:

> **81h of the labour above was never recorded.** It is 9 crew-days at 9h —
> days inside this card's dates when the board had a schedule and had
> nothing else for them.

Counting the card's whole span instead read **AED 42,125 across nine
cards**, about half the department's monthly capacity, on cards mostly
carrying one technician. The worst was a snag card open from 8 July to 21
August: 45 days, one man, 405 hours. It was *open* for 45 days. Nobody
worked it for 45 days. So a day only counts when:

- the board has a schedule for that day at all — no schedule is not
  evidence that somebody was idle, and it is what turned an empty July into
  24 invented days; and
- that person appears on no job anywhere on the board that day — not merely
  no job on this project, since a technician in another building that
  morning was not on this card.

That took the same nine cards to 837h, and the largest contributors became
the two five-person onboardings at about seven hours per person per day,
which is what an onboarding project actually looks like.

**Known overcount:** somebody on annual leave mid-project has no job that
day either, and the roster is not read here. Marked in `project.js` with the
upgrade path.

The honest reading of any of these figures: they say *these people were on
this card and not idle*, which was the question. They are not a measurement
of hours worked, and the card says so.

---

# Two faults in the workbook, and one in the app, found on 3 September

The board showed **Resty with one job where the schedule has five**, and he
was right to say that would wreck his month-end productivity numbers. Three
separate things were wrong, in a chain.

## 1. The printable view silently drops any villa number

The *Printable Schedule (PDF)* tab is filled by one Google Sheets `QUERY`
against *Daily Input*. On 3 September it loses **10 of 32 unit numbers**, and
the pattern is exact:

| Unit in Daily Input | Type | Survives the printable view? |
|---|---|---|
| `4514`, `3503`, `608`, `909`, `1211` … | number | **20 of 20 kept** |
| `E41`, `O56`, `O103`, `F30`, `L14`, `G382`, `L201`, `R01`, `P402` | text | **0 of 10 kept** |

This is a known `QUERY` behaviour rather than a formula typo: a column with
mixed types is coerced to the **majority** type and the minority comes back
**blank**. Column E is mostly apartment numbers, so every villa code — which
is text — is dropped. It is silent, which is why it survived this long.

The villa codes are the ones that matter most operationally: `Palm villa`
appears five times in one technician's day and the number is the only thing
distinguishing one pool from another.

## 2. The printable view's Parking and Status headings are the wrong way round

The same `QUERY` reads:

```
SELECT B,C,D,E,F,G,H,I,…
```

where `F` is **Status** and `G` is **Parking No.** — but the heading row
above it says `Unit`, `Parking No.`, `Status`. So the data arrives
Status-then-Parking under headings that say Parking-then-Status. This is the
long-standing "the printed sheet mismatches status and parking" complaint,
and it is not the PDF export at all — it is these two headings.

## Both are fixed by one formula

Replacing the `QUERY` with `FILTER` fixes the dropped villa numbers, because
`FILTER` does not coerce column types. Putting `G` before `F` in the same
edit fixes the headings. In the printable tab's first data cell:

```
=IFERROR(FILTER({'Daily Input- Field Tasks'!B2:E1010,
                 'Daily Input- Field Tasks'!G2:G1010,
                 'Daily Input- Field Tasks'!F2:F1010,
                 'Daily Input- Field Tasks'!H2:P1010,
                 'Daily Input- Field Tasks'!R2:R1010,
                 'Daily Input- Field Tasks'!T2:U1010,
                 'Daily Input- Field Tasks'!Q2:Q1010},
                'Daily Input- Field Tasks'!A2:A1010=$B$1,
                'Daily Input- Field Tasks'!D2:D1010<>""),
        "No tasks logged for this date yet.")
```

Nineteen columns, the same nineteen headings, Parking and Status now in the
order the headings claim. Neither fault can be fixed from inside the app —
a number that is not in the paste cannot be recovered from it.

## 3. The app was deduplicating a paste against itself

This one was ours, and it is the reason **28** rows landed instead of 32.

A re-paste has to be safe, because people do it — they add two jobs at the
bottom of the sheet and paste the lot again. A `TSK` reference would be the
reliable key but only about four rows in ten carry one, so there is a second
key on the row's content: property, unit, and the first forty characters of
the description.

That key was held in a `Set` that the incoming rows were **added to as they
were read**, so the second row of a paste was compared against the first.
With the villa numbers gone, Resty's five rows are all
`palm villa | | pool cleaning` — one key. Four were discarded as duplicates
of a job that had just been created from the same paste.

**Two rows in one paste are two lines somebody wrote, and the app has no
business deciding they are the same job.** The content key is for comparing a
paste against what the day already holds, so it is now *counted* rather than
set-tested (`pasteAdditions` in `job.js`):

| The day has | The paste has | Added |
|---|---|---|
| 0 | 5 | **5** |
| 5 | 5 | **0** |
| 5 | 6 | **1** |
| 2 | 5 | **3** |

The old `Set` got the first row of that table wrong by four, and the third
wrong by one — a job added at the bottom of an already-pasted sheet was
silently dropped, which nobody had noticed. A `TSK` reference stays a strict
one-of, because it identifies a single PMS task however the row is worded.

Measured against the real 3 September with the villa numbers stripped the way
the printable view strips them: **32 rows read, 32 added**, split Vitalis 4,
Abdul Riyaz & Bijaya 3, Resty 5, Jabbar 5, Bright 3, Yousouf 4, Daljit 5,
Anthony 3 — and a second paste of the same text adds nothing.

**The paste dialog now says when rows are indistinguishable**, rather than
letting it become the technician's problem on site:

> **5 rows read exactly alike**, because the unit is blank on them:
> · 5 × palm villa — pool cleaning
> They come in as 5 separate jobs, which is right — five pools are five
> jobs. But the technician cannot tell which is which, so put the number in
> the sheet's **Unit / Villa No.** column and re-paste when you can.

---

# Pasting the Job Cards tab when the app already has projects

The question that matters: the Projects tab already holds projects
*discovered* out of the daily schedule, and the Job Cards tab holds cards
for some of the same work plus older ones. Copying the whole tab has to
land on the right side of that, every time.

**Copy the whole tab, header row included, old rows and all.** Measured
against the real data — nine cards over the nine projects discovery had
already adopted:

```
9 projects  ->  13     (5 updated, 4 created)
units carrying more than one project: none
completed cards: 12 of 13  (history only — nobody is on them today)
```

## How a card finds the project it belongs to

1. **By quotation number.** Exact, and conclusive. `PC-2026-08-03` on a
   card is the `PC-2026-08-03` already in the app.
2. **Failing that, by unit — but only against a project with no number of
   its own, and only if the dates are within a fortnight.** This is the
   case that used to duplicate. The Palm Tower 3706 sits in the app as
   "Pick and Drop onboarding team" with no quotation number, because the
   coordinator wrote the work before the quotation was written up; its card
   carries `PC-2026-08-08` and starts the same day. On number alone that
   read as new work and the unit ended up with two projects. The card's
   number is now attached to the project already there.
3. **Otherwise it is new.**

Two quotations on one unit stay two projects — Al Fattain 2903 has
`PC-2026-08-05` on its card and `PC-2026-08-28` in the app, and those are
genuinely different work. Beyond a fortnight it is new work too: a unit
onboarded in August and quoted again in November is not the same job.

The dialog says which of the three happened to every row before anything is
committed.

## Old cards are safe, and worth having

A completed card comes in with its status and its completion date, so it is
**history**: it lands in the month's cost and margin, and it puts nobody on
a project today. Only a card the sheet says is unfinished, whose dates cover
the day, keeps a crew off the idle list. Of the nine real cards, one — Damac
4301, In Progress, due 4 September — does that, and it puts Shafeeq, Khaled
and Nizar on a project on the 2nd, 3rd and 4th, and nobody on the 5th.

So there is no reason to pick through the tab first. Paste it whole.

## One exception to "a blank cell never erases a recorded value"

**A card that says In Progress clears a completion date already on the
project.** Everywhere else a blank cell in the sheet means "not filled in"
and never overwrites something recorded, but a card saying the work is
unfinished directly contradicts a completion date, so that date is stale
rather than merely unstated.

This is not hypothetical, and it was the last thing standing between the
job cards and the idle list. Damac 4301 was adopted from the schedule as
**completed on 1 September**, because the 1st is the last day the schedule
carried a task for it. Its card says **In Progress, due the 4th**. With the
old completion date kept, `projectEndDate` returned 1 September however the
card was read — so the project still ended before today and its crew went on
reading as idle on the 3rd, which is the exact complaint the job cards were
brought in to answer. A completed card still keeps its date; the exception
applies only to work the sheet says is unfinished.

## What to do after pasting

Two of the nine cards will ask which way to read their dates — that is the
day-first / month-first damage described above, and the app will not import
them until one is chosen. Everything else commits straight through.

Then add the **approved amount** to the cards that have one. It is the only
field in the whole exercise the sheet does not carry, and without it a card
shows its cost with no margin against it.
