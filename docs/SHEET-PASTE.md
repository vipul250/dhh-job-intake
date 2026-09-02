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
