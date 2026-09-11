# Quality-of-work metrics for a holiday-home maintenance department

Design, 11 September 2026. Approved in conversation; not yet built.

## The question that was asked

What further measures are needed to judge the **quality** of the
department's work, rather than its volume, cost or schedule adherence.

## The answer that the data forced

Not "which metrics are missing". The binding constraint is that **any
metric whose denominator is "confirmed done" currently runs on under a
tenth of the work, and therefore flatters.**

Measured on the live database, 11 August to 9 September:

| | |
|---|---|
| Jobs in range | 857 |
| Closed out on the board | 253 (29.5%) |
| With a measured duration | 158 (18%) |
| Reactive **and** confirmed done | **74 (8.6%)** |

Two quality measures already on the Dashboard disagree by forty points:

```
Rework (same fault back)   37.3%   114 of 306 reactive visits
First-time fix             98.6%   1 came back, from 74 reactive jobs confirmed done
```

They are not contradictory, they are incommensurable. `computeRepeatVisits`
counts every reactive visit; `computeFirstTimeFix` counts only work
somebody closed out. The 98.6% rests on 74 jobs and moves on a single one.

Adding more outcome-dependent measures to that base makes the reporting
worse, not better. So metrics are split by **what they depend on**, and
every outcome-dependent figure carries its own coverage.

## Tier 1 — complete for all 857 jobs today

Derived from scheduling history alone. Trustworthy from day one; nobody has
to close anything out.

| Metric | Definition | Depends on |
|---|---|---|
| **Returns per unit** (headline) | same asset, similar fault, 2–14 days apart | `assetKey`, `description`, `faultCode`, date |
| Visit load per unit | jobs and priced labour per unit per period | `assetKey`, `team`, duration |
| Time waiting | `originDate` → resolution, or → today if open. Reported as a median across the period, and per unit as that unit's oldest open wait | `originDate`, `_date`, `state` |
| Deferral depth | distribution of `pushCount`; share pushed 3+ times | `pushCount` |
| Access exposure | occupied-unit visits with no guest confirmation | `status`, `guestConfirmed` |
| Crew-size shortfall | named crew smaller than the job requires | `team`, `crewNeeded`, `crewing.js` |

**Returns per unit is the headline**, chosen over time-waiting because it is
concrete, per-asset, needs no close-out, and is already the figure used to
justify charging an owner for excessive visits.

## Tier 2 — outcome-based, each renders its own coverage

| Metric | Definition | Coverage now |
|---|---|---|
| Guest wait | report → confirmed resolved | 29.5% |
| First-time fix | reactive + done that did not come back | **8.6%** (74 jobs) |
| Cause of return | ours vs not, via `returnReason` + `isOurFault` | returns carrying a reason |
| Access failure rate | `outcomeReason` = no access / refused | 29.5% |
| Chargeable recovery | `guest-damage` returns × their cost | returns carrying a reason |
| Contractor durability | contractor-flagged visit that returned | low, and regex-detected |
| Estimate accuracy | measured against estimated | 18% (158 jobs) |
| Unaccounted time between jobs | `arrivedAt[n]` − `leftAt[n-1]` across a technician's own day | needs **both** times on **consecutive** jobs |

Each shows its denominator beside the figure. **Below 50% coverage the
figure is rendered as provisional** and the caveat names the sample size —
50% because that is already the threshold Monthly uses for its
timed-minutes warning (`r.timedPct < 50`), so this introduces no new
convention. It is the treatment `projectCost` gives a margin that rests on
estimates rather than measurements.

## Unaccounted time between jobs

Added 11 September at his request, after measuring Resty's pool round and
finding that the same five cleans cost 5.0 hours on a batched day and 7.0 on
a spread one — a two-hour difference produced entirely by which buildings
the round visited.

Today that difference is an **assumption**: `travelMinutesPerHop: 30` in
`cost.js`, flagged in that file as a placeholder. Jumeirah Golf Estates to
Binghatti Tulip is not thirty minutes in Dubai traffic. The figure can be
measured instead, from data already being collected.

### How

Order a technician's jobs for one day by `arrivedAt`. For each job after the
first, the gap is `arrivedAt` minus the previous job's `leftAt`. Sum the
gaps for the day.

Ordered by **arrival**, not by the schedule, because the schedule is a plan
and the arrival times are what happened.

### It is NOT called travel, and that is the point

The gap contains travel. It also contains lunch, a warehouse collection,
waiting for a guest to answer the door, writing up the last job, and
refuelling — the 1.5-hour gap after Base Tower that Kaja raised in the
coordinator meeting on 8 September. The data cannot tell these apart.

So the measure is **unaccounted time between jobs**. Naming it travel would
repeat the mistake `computeRepeatVisits` makes by naming its returns
"rework": claiming a cause the data does not carry.

### One split the data DOES support

A gap between two jobs **in the same building** cannot be travel. A gap
between two jobs in **different buildings** plausibly is. Reporting the two
separately costs nothing and is the only causal distinction available
without asking anybody anything:

- `betweenBuildings` — plausibly travel, and the figure to compare against
  the 30-minute assumption
- `withinBuilding` — definitely not travel

Resty's round is the clearest case: his Palm Villa days are one building and
should show near-zero of both.

### Edge cases, each with a wrong default

- **The first job of the day has no predecessor.** Its gap is the commute,
  which is not a job cost. `cost.js` already draws that line — the first
  building of the day is excluded from trip charges — and this follows it.
- **A negative gap means two jobs overlap**, recorded as concurrent. That is
  either a crew job or a recording error. It is **surfaced, not clamped to
  zero**: silently treating it as zero hides the recording error, and this
  app's whole argument is that nothing disappears quietly.
- **Coverage is the product of two close-outs**, so it is scarcer than
  outcome coverage: a gap needs `leftAt` on one job and `arrivedAt` on the
  next. Reported as pairs available out of pairs possible, not as a
  percentage of jobs.
- **A gap spanning a shift break** is not work. Gaps beyond a ceiling
  (start with 3 hours) are reported separately rather than summed in, for
  the same reason `actualDuration` discards a twelve-hour job as a missed
  Done click.

### What it does not do yet

It does **not** replace `travelMinutesPerHop`. That default stays until
there is enough measured data to recalibrate it, and recalibration is a
later stage: a learned travel matrix per building pair, in the shape
`learned.js` already uses for durations and `buildPriceBook` for material
costs. Explicitly out of scope here.

The immediate deliverable is the comparison — measured gap against the
assumed 30 minutes — so the assumption stops being invisible.

### Depends on A

Per-building gap counting requires one building to be one building.
`Bingatti royale` and `Binghatti Royale` counted separately read as an extra
hop, which inflates `betweenBuildings` on exactly the spread days this
measure is meant to judge. Four of Resty's eleven days carry such variants.
See the property-canonicalisation spec.

## Two corrections to measures that already exist

**`computeRepeatVisits` claims fault it cannot know.** It is labelled
"Rework (same fault back)" but it only knows that a similar job came back.
A planned second visit and a failed fix are identical to it. It becomes
**returns**; **rework** is reserved for returns where `returnReason` says
the cause was ours. The vocabulary for that already exists in
`faultFamily.js` — `RETURN_REASONS` with its `ours` flag, and
`isOurFault()`.

**`computeFirstTimeFix` flatters.** 98.6% from 74 of 857 jobs, sample size
in small text. Sample size becomes co-equal with the figure.

## One existing measure with almost no data behind it

`computeEscalations` reads `job.escalated`. That field is written in exactly
one place — `backlog.js:714`, from an `IMP_RE` regex on pasted PMS text — so
escalations register only for work that arrived through the PMS/backlog
path carrying "IMP", and never for anything escalated verbally or entered
from the daily sheet. Either state that source on the page or drop the
measure. Do not report it as an escalation rate.

## Architecture

### `src/lib/quality.js` — new, and deliberately not part of `metrics.js`

`metrics.js` is 1,412 lines and was deleted outright on 10 September before
being restored. Anything placed inside it dies with it next time.
`monthly.js` is the precedent that survived that deletion: one purpose,
~150 lines, importing only `job.js`, `faultFamily.js` and `normalize.js`,
with its own node test suite.

`quality.js` follows it exactly, and **must not import `metrics.js`**, so
that pruning that file later cannot take quality reporting with it.

```
returnsByUnit(jobs, period)
  -> one row per unit: { asset, property, unit, visits, returns, returnPct,
                         labourCost, oldestWaitDays }
     returnPct is null, never 0, for a unit with fewer than two visits.

qualityReport(jobs, period)
  -> { tier1: { timeWaiting, deferralDepth, accessExposure, crewShortfall },
       tier2: { guestWait, firstTimeFix, causeOfReturn, accessFailure,
                chargeableRecovery, contractorDurability, estimateAccuracy },
       excluded: <jobs with no assetKey> }

     Every entry in BOTH tiers is { value, n, coverage } — tier 1 entries
     carry n and coverage too, even though coverage is 100% today, so no
     caller can read a figure without its denominator being available.
```

`returnsByUnit` is separate from `qualityReport` because it is a table with
one row per unit, not a set of scalars, and the Monthly view renders it as
one.

`period` uses the same contract `monthly.js` already defines: a date prefix
("2026-09" for a month, "2026-09-11" for a day) or an explicit
`{ from, to }` range for a week. One period model, not two.

### Display

**Tier 1 goes in Monthly**, as a third table beside *Per technician* and
*Per trade*. Monthly already carries the day/week/month picker, is small
and is readable; a new tab would duplicate the period control and add nav
for nothing. Monthly becomes one report with three lenses — technician,
trade, unit.

**Tier 2 stays in the Dashboard**, where the outcome-heavy measures already
live, and is where the two corrections land.

## Edge cases, each of which has a wrong-looking default

- **Recurring work must be excluded from returns.** Resty alone runs 14
  pool cleanings a week at the same villas. A naive returns-per-unit table
  ranks pools first and is worthless on sight. `computeRepeatVisits`
  already flags `workType(...) === "ppm"` as `recurring` and refuses to
  call it rework; `quality.js` inherits that rule rather than reinventing
  it.
- **A unit visited once has no return rate.** It reports `null`, never
  `0%`, or single-visit units flood the flattering end of the table.
- **A job with no property or unit has no `assetKey`.** Those jobs are
  excluded and the number excluded is reported, not swallowed.
- **Same-day and next-day repeat visits are the job continuing**, not a
  return. Already the rule at `metrics.js:687`; inherited, not re-derived.
- **A unit written into its own property name** — "Binghatti Tulip 305"
  with 305 in the unit column — must key as one asset. Fixed in
  `splitTrailingUnit` on 11 September; asserted here so it stays fixed.

## Testing

`test/suites/quality.mjs`, node-only, no browser, against the real 552-job
workbook in `test/harness/`, following `monthly.mjs`.

The assertions worth having are the ones that would otherwise be silently
wrong:

1. Resty's weekly pool cleanings produce **zero** returns.
2. A unit with a single visit reports `null`, not `0%`.
3. Per-unit returns **sum to** the whole-report return count.
4. Every Tier-2 figure carries a sample size, and the first-time-fix sample
   is asserted to be present rather than optional.
5. A unit whose property name ends in its own unit number keys as **one**
   asset.
6. A same-day second visit is not a return; a visit 3 days later is.
7. **Unaccounted time between jobs**, on a constructed day:
   - two jobs in the same building with a two-hour gap report that gap
     under `withinBuilding` and **zero** under `betweenBuildings`
   - the first job of the day contributes no gap at all
   - an overlapping pair produces a **surfaced** negative, not a zero
   - a gap over the ceiling is reported apart from the total, not summed in
   - a pair missing `leftAt` on the earlier job contributes no gap and
     reduces the reported pairs-available count

## The limit, to be stated on the page

Every measure here is a **proxy**. Quality in a holiday let is whether the
guest's stay was affected, and that needs arrival dates and complaint
records which are deliberately out of scope — no booking or PMS integration
was accepted for this work. "37% returns" must not be read as "37% of
guests unhappy", and the page should say so.

The metrics that would close that gap, if the position ever changes:
fault still open at the next check-in, faults per stay, and repeat
complaints for the same unit. All three need a booking calendar.

## Out of scope

- Any new field, dialog or close-out question. The constraint chosen was
  that nothing new gets collected.
- Guest satisfaction in any form.
- A recurring/PPM schedule model. It would make PPM adherence measurable
  and answers a real gap, but it is a subsystem, not a metric.
- The four audiences — department, technician, property, coordinator — all
  want these measures sliced differently. This spec defines the measures.
  The views are separate work.
