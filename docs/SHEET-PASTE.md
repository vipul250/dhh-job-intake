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
