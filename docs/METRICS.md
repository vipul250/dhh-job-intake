# What the dashboard measures, and why

Every metric here is defined by three things: the field it reads, the
denominator it divides by, and the person who can act on it. A metric that
fails any of the three is not on the dashboard.

The measurements are split into two tiers.

- **Tier A** needs nothing beyond the schedule the coordinator already
  types. It works from day one, on every row.
- **Tier B** needs the admin's daily Verify pass — one row per job, three
  buttons. Until that habit is established, Tier B numbers are shown with
  their coverage stated on the tile, never as bare percentages.

---

## Tier A — from the schedule alone

### 1. Planned load vs capacity

**Reads** Estimated Time, Team/Technician, Shift.
**Formula** For each technician-day: `(task minutes + travel minutes) /
shift minutes`. Travel is charged at 30 minutes for each *additional*
distinct building in that technician's day — the first building is the
commute, not a job cost.

Two details that make this number honest:

- A crew cell (`Adi, Khaled, Nizar, Shafiq & Bijaya`) is split into
  individuals, and the job's time is charged to **each** of them. A
  three-hour job given to a five-person crew occupies five people's
  afternoons, not one.
- Spelling variants of the same technician (`Yousoufu`/`Yousouf`,
  `Shafiq`/`Shafique`/`Shafeeq`) are merged first, or one person's load
  gets split across three names and nobody looks overloaded.

**Acts on it** The coordinator, the evening before. A technician over 100%
means something on that list will not happen; deciding which beats finding
out tomorrow.

**On the real workbook (18 Aug – 1 Sep, 474 jobs):** 86.5% average
utilisation, but **41 of 123 technician-days planned over 100%** — while
246 hours of other people's rostered time sat unfilled. The problem is
distribution, not headcount.

### 2. Access risk

**Reads** Status, Guest Confirmed, Time of Visit.
**Formula** Of visits to units where somebody is inside (Occupied,
Occupied - GC, Check-in, B2B): the share with no guest confirmation.
Unanswered is counted separately from "No" — blank is never read as a
refusal.

**Acts on it** The coordinator, with a phone call the evening before.

**On the real workbook:** 271 visits went to occupied units. **84 were
confirmed.** 187 visits — 69% — were sent to a unit whose occupant had not
agreed to it.

### 3. Material readiness

**Reads** Material Needed, Material Details.
**Formula** Of jobs needing material, the share with a specific list.
`"Basic materials"` and its variants are counted as **not ready**: it is
the absence of a picking list, not a picking list.

**On the real workbook:** 278 jobs needed material. 179 had a real list, 83
said only "basic materials", 16 said nothing.

### 4. Repeat visits and rework

**Reads** Property, Unit, Task Description, Date.
**Formula** Visits to the same unit within 14 days, split three ways:

| Class | Definition | Meaning |
|---|---|---|
| Continuation | gap ≤ 1 day | the same job carrying on |
| Return | gap ≥ 2 days | a genuine second visit |
| **Rework** | a return, similar scope, **not** recurring work | the fix did not hold |

Both exclusions matter. The median repeat gap in the real data is one day,
so counting every repeat as rework would report a 43% rework rate that is
mostly two-day paint jobs. And pool cleaning appears 57 times, every 2–3
days per villa — it is *supposed* to come back, so recurring work is never
counted as rework.

**On the real workbook:** 204 repeat visits — but 122 are continuations and
21 are scheduled recurring work. **26 are real rework: 9.8% of the 265
reactive visits.** Each one is listed with both dates so it can be checked.

### 5. Pending backlog and ageing

**Reads** Pending, Pending Details, Property, Unit.
Aged from the first date the same unit was flagged pending.

**On the real workbook:** 74 pending items, 67 of them already older than a
week, the oldest 14 days.

### 6. Schedule churn

**Reads** the app's own change log, against the timestamp set by the **Post
schedule** button.

This one is deliberately taken out of everybody's hands. The workbook has a
"Changed After 8pm Posting?" column; it is filled on 4% of rows. A field
nobody fills measures nothing. Once a day is posted, every edit to team,
shift, property, unit, scope, estimate, priority or visit time is recorded
automatically, and additions after posting are marked as additions.

### 7. Work mix — planned vs reactive

Classified from the task description into reactive breakdowns, planned/PPM,
projects and onboarding, inspections, and logistics. This is the ratio a GM
will already know how to read.

**On the real workbook:** 21.9% planned, 55.9% reactive.

---

## Tier B — needs the daily Verify pass

The schedule records what was *planned*. Nothing in the workbook records
what happened. `In PMS?` is answered on 43% of rows and says "Y" on 203 of
those 204 — it is an intention, not a check.

The Verify tab closes that gap: one row per job, three buttons, a reason
only when something did not happen. A pass over 30 jobs takes about three
minutes.

| Metric | Formula | Why it matters |
|---|---|---|
| **Completion rate** | done / verified | The number everyone assumes exists and currently does not |
| **Traceable in PMS** | in PMS / (done + partial) | Work that happened but has no PMS record is invisible to everyone downstream |
| **PMS says done, field says not** | not-done jobs with a PMS ticket | The mismatch the admin's double-check exists to catch |
| **First-time fix** | reactive jobs done with no similar return in 14 days | Whether the work is holding |
| **Estimate accuracy** | median actual / estimated | Feeds back into the capacity numbers above |
| **Failure reasons** | grouped over not-done and partial | Tells you *which* lever to pull |

---

## Cost

Cost prices **time and trips**, because those are what the schedule
records. Material spend appears only where somebody enters a figure — the
sheet records "Paint" and "Basic materials", never a number, so material is
reported as a coverage gap rather than guessed at.

**Every default rate is a placeholder.** They are editable in the
dashboard under *Edit rates*, stored once and shared by everyone. Replace
them before quoting any of these figures.

| Rate | Default | What it should be |
|---|---|---|
| Technician cost / hour | AED 25 | Fully loaded: salary + accommodation + visa + insurance ÷ productive hours — not the bare salary rate |
| Overtime multiplier | 1.25 | UAE labour law: basic +25%, and +50% for hours between 22:00 and 04:00 |
| Vehicle cost / trip | AED 12 | Fuel + Salik + wear for one building-to-building hop |
| Fixed cost / visit | AED 0 | Any dispatch or admin overhead you carry per job |
| Contractor cost / hour | AED 120 | Applied to project work whose description names a contractor |

Per-technician rate overrides are available for anyone paid differently.

### The split that matters

Not the total — the division between spend that bought something and spend
that did not:

- **Overtime** — hours committed past the rostered shift
- **Wasted visits** — the technician travelled and the job did not happen
- **Material failures** — the van left without the right part
- **Rework** — the same fault paid for twice

Reported next to these, but deliberately **not** counted as waste: **idle
capacity**, the rostered hours the schedule never filled. The shift is paid
either way, so it is real money, but it is a different problem from a
wasted trip and gets its own line.

### Exposure

Before any verification exists, the schedule still shows money at risk:
labour plus a trip committed to occupied units nobody confirmed, discounted
by an assumed failure rate. The assumption is stated wherever the figure
appears, and it becomes a *measured* rate after a couple of weeks of the
Verify pass.

### Levers

The dashboard ranks the optimisation levers by size and marks each one
**measured** or **estimated**. They are deliberately not summed into a
single savings headline — they overlap (a visit that fails for access and
had no material list appears in two), and one number would overstate the
prize.

---

## Why coverage is on screen

The old Trends tab reported a "clean rate" of roughly 100% no matter what
was happening, because it was built on duplicate and carryover flags that
were only ever set against the fourteen dates cached in memory. Its
schedule-variance and safety-close figures averaged timestamps that
required somebody to press buttons in the app during the working day, which
nobody did — so those were empty samples presented as trends.

The lesson is not "compute it more carefully". It is that a rate without
its denominator on screen will eventually be wrong and nobody will notice.
So the dashboard carries a data-quality panel showing the fill rate of
every field the metrics depend on, and every tile states what it was
calculated from. A completion rate over 40% of the rows and one over 95% of
them are different kinds of fact, and the difference should not be
invisible.

---

## Added later: why we go back, how long things take, and projects

### Why we keep going back (rework, categorised)

A repeat-visit count cannot be acted on by itself. A fix that did not hold
is our cost to design out; a guest breaking the same thing twice is not.
So returns are cut two ways.

**By kind of work** — inferred from the task text into families (AC/HVAC,
plumbing, electrical, door and lock hardware, appliance, paint and finish,
pool, furniture, inspection, logistics). Over the real workbook this puts
Palm Villa's 14 returns where they belong: pool, i.e. the PPM cycle working
correctly, not rework.

**By reason** — this one cannot be inferred, so it is asked. When a job is
added to a unit that had similar work in the previous 21 days, the board
says so and offers one click:

| Reason | Ours? |
|---|---|
| First fix did not hold | yes |
| Wrong diagnosis first time | yes |
| Right part was not on the van | yes |
| No access on the earlier visit | no |
| Planned continuation of the same job | no |
| Underlying issue — needs contractor | no |
| Different fault, same unit | no |
| Recurring service (PPM) | no |
| New damage / guest misuse | no |

The three marked "ours" are the ones that cost money and can be removed by
changing how the work is done. The dashboard reports them separately and
states what share of returns actually carry a reason.

### How long jobs actually take

**Nobody types a duration.** The board already has Start and Done as
buttons, and both are timestamped, so the real duration is the gap between
them. A manually entered figure still wins where there is one.

A gap over 12 hours is discarded rather than counted: the common failure is
a technician who starts a job and marks it done the next morning, and
averaging that in would wreck every estimate the app produces.

Reported as medians — one job left open over lunch should not move a
technician's figure — broken down by technician, by kind of work, and by
technician × kind of work (only where there are at least three jobs to
measure from). The "vs estimate" column over 100% means the work reliably
takes longer than the schedule allows, which is a capacity problem before
it is a performance one.

### Projects — quoted work and what it cost

Daily field tasks and projects are different animals, and until now the
metrics measured only the first. **The Dashboard is daily operations
only**; projects have their own tab.

    margin = approved amount − (labour hours × rate + material cost)

**Labour is not entered twice.** The daily jobs linked to a project already
carry their hours — measured where the board has them, estimated where it
does not — and roll up automatically. Quotation references appear inside
task descriptions (`Approved - PC-2026-08-28 - arrange material`), so the
app suggests which daily jobs belong to a project rather than making anyone
hunt for them.

A margin resting mostly on estimated hours is labelled a forecast on the
card, because that is what it is.

**The material price book** is the memory. Every material line teaches it:
item, quantity, unit cost. After three observations of the same item the
cost is filled in automatically from the median and the coordinator can
correct it. Matching is on words rather than exact strings, so "Honeywell
Ac thermostat 220v" finds "Honeywell thermostat" — nobody retypes an item
the same way twice.

The approved quotation is stored as a **link**, not an uploaded file: the
app has no file storage configured. A link to wherever the PDF already
lives serves the same purpose for pulling the figure out. Real uploads
would need a Supabase Storage bucket — a small follow-on, not a rewrite.
