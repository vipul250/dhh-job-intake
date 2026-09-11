# One property, one name

Design, 11 September 2026. Approved in conversation; not yet built.

Sub-project **A** of four. It exists because it blocks the other three, and
because it silently corrupts figures already being read.

## Why this is first

Measuring pool-contract delivery per property was the goal. It cannot be
done while one property is two properties:

```
Binghatti Tulip 305         5 visits   |  Binghatti tulips 305        1
Binghatti Tulip 1105        2          |  Binghatti tulips 1105       1
Jumeirah Golf Estates W019  6          |  Jumeirah golf estate W019   1
Binghatti Royale 605        1          |  Bingatti Royale 605         2
```

Sixteen "distinct pools" in the real workbook are twelve. A pool cleaned
six times reads as 5 + 1 across two properties, and its delivered frequency
reads 2.5 per week instead of 3.0 — against a contract that specifies 2–3
times weekly. The measurement would be wrong in the direction that matters.

It is not only the pools. Every figure grouped by property is affected
today: `computeRepeatVisits`, the per-property cost table in `cost.js`, and
any per-unit view. This is the same class of defect that `TECH_ALIASES`
already fixes for people — `Shafiq`/`Shafeeq` — and properties have no
equivalent despite a `property-master` existing to resolve against.

## Scale, measured

| | |
|---|---|
| Rows carrying a property | 474 |
| Distinct raw strings | 188 |
| After `canonProperty` | 178 |
| Pure case/space variants it already collapses | 10 |
| Genuine duplicates it still misses | **4 pairs** |

Small, and worth doing precisely because it is small and the damage is
invisible.

## Edit distance is the wrong tool, and this is the important part

Six pairs of canonical keys sit within two edits of each other. Only two of
the six are the same property:

| pair | distance | verdict |
|---|---|---|
| `jumeirah golf estates` ↔ `jumeirah golf estate` | 1 | same — plural |
| `palmera 2 villa 28 (` ↔ `palmera 2 villa 28` | 2 | same — stray paren |
| `azizi riviera 10` ↔ `azizi riviera 1` | 1 | **different buildings** |
| `azizi riviera 13` ↔ `azizi riviera 1` | 1 | **different** |
| `azizi riviera 31` ↔ `azizi riviera 1` | 1 | **different** |
| `elite residence 4` ↔ `elite residence` | 2 | **different buildings — confirmed by Vipul, 11 Sep** |

In a portfolio of numbered buildings a one-character difference is usually a
different building. Any similarity threshold merges Azizi Riviera 1 with
10, 13 and 31, and then bills one owner for three towers' visits.

## The rule

1. `canonProperty` first — the existing normalisation: case, spacing,
   `tower`/`twr`, `residences` → `residence`.
2. Punctuation becomes spaces.
3. Split into **numeric** tokens and **word** tokens.
4. **Numeric tokens must match exactly, in order.** They identify the
   building. This is the whole safety mechanism.
5. Word counts must match.
6. Words are compared **positionally** — first against first, second
   against second, which is why step 5 comes before it. Each pair passes if
   it is identical, or shares a stem after dropping a trailing `s`/`es`, or
   is within a **Levenshtein distance budget of 1 shared across the whole
   name**. Two typos in one name is a different property, not a worse typo.
7. Otherwise they are different properties.

Step 4 is why auto-merge is safe here. It is not a similarity threshold
tuned to a number; it is a categorical refusal. `Azizi Riviera 1` and
`Azizi Riviera 10` can never merge however alike they look.

### Validated against every real pair

Nine cases, nine correct — the four genuine duplicates merge, the five
dangerous ones are refused:

```
Jumeirah Golf Estates  <>  Jumeirah golf estate    merge
Palmera 2 Villa 28 (   <>  Palmera 2 Villa 28      merge
Binghatti Tulip        <>  Binghatti tulips        merge
Bingatti Royale        <>  Binghatti Royale        merge
Azizi Riviera 10       <>  Azizi Riviera 1         refuse
Azizi Riviera 13       <>  Azizi Riviera 1         refuse
Azizi Riviera 31       <>  Azizi Riviera 1         refuse
Elite Residence 4      <>  Elite Residence         refuse
Marina Gate 2          <>  Marina Gate 3           refuse
```

## Merging is automatic; every merge is reported

Chosen deliberately over a confirmation queue, on the grounds that the rule
refuses the ambiguous cases itself rather than deciding them. The figures
are therefore right immediately and there is no queue to work through.

The safeguard is visibility, not a gate:

- A panel lists every merge affecting the span currently open in Monthly —
  the same day/week/month picker, so the report and the figures it explains
  always cover the same jobs —
  `Bingatti Royale 605 -> Binghatti Royale 605 (3 jobs)`.
- Each carries a **"these are different"** action.
- A count surfaces on Monthly, so a merge is seen without going to look
  for it.

This requires **re-listing the Properties tab in the nav**. It is routed
but unlisted after the 10 September pruning.

## Which spelling wins

1. A variant matching a `property-master` entry. That list is
   authoritative.
2. Otherwise the most-used variant.
3. A tie goes to the longest string, as the most complete.

## Applied at read time, never as a migration

No stored job is rewritten.

```
buildPropertyIndex(jobs, propertyMaster) -> { resolve(name), merges }
sameProperty(a, b)                       -> boolean, the rule above

  resolve(name)  the canonical name for any spelling, or the name itself
                 when nothing matched
  merges         [{ from, to, jobs }] — what to report, and nothing else
```

Consumers that group by property resolve before calling `assetKey`.
Repeat visits, per-unit cost and per-property cost then group correctly.

Read-time resolution is chosen over rewriting because a decision can be
reversed: adding a `keepApart` entry re-groups everything on the next read,
with nothing to un-migrate. A rewrite would bake a wrong merge into the
stored record, which is the one mistake this whole exercise is about.

## Only the exceptions are stored

A `property-aliases` key in `kv_store`, holding **only**:

```json
{ "keepApart": [["azizi riviera 1", "azizi riviera 10"]] }
```

The merges themselves come from a deterministic rule, so there is nothing
to persist and nothing to go stale. Only the cases where the rule was wrong
are recorded, once, and they hold.

No positive alias list. A stored list of "these are the same" is the thing
that rots: it has to be maintained as the portfolio grows, and a missing
entry is an invisible failure. A rule plus its exceptions inverts that — the
default is correct and the exceptions are few and explicit.

## `src/lib/propertyName.js`, not `normalize.js`

`normalize.js` is the most-imported module in the app and a fault there
breaks every view. The resolver also needs a runtime index built from the
job set, which is derived state rather than a pure string function.

So: a new module importing only `normalize.js`. It follows `monthly.js` and
`dayMigrate.js` — one purpose, small, its own test suite, no dependency on
anything large.

## Testing — `test/suites/propertyname.mjs`

Node only, no browser, against the real workbook in `test/harness/`.

1. The nine validated pairs above, each asserted by name.
2. `Azizi Riviera 1`, `10`, `13` and `31` remain **four** properties. This
   is the assertion that matters most; a regression here misstates an
   owner's bill.
3. `Elite Residence` and `Elite Residence 4` remain **two** properties.
   Confirmed as different buildings by Vipul on 11 September — this is
   product truth, not an inference from the rule, and the rule happens to
   agree with it. Anybody later tempted to relax step 4 so that a missing
   trailing number is tolerated would break this and should read this line
   first. Note `canonProperty` already maps `Elite Residences 4` onto
   `elite residence 4`, so the plural spelling is not a third building.
4. Against the 474-row workbook, the merge list is **exactly** the four
   genuine duplicates — no more. An over-eager rule shows up as a fifth.
5. A `keepApart` entry overrides the rule.
6. Canonical spelling prefers a `property-master` entry over frequency.
7. The twelve real pools resolve to **twelve**, not sixteen, and
   `Jumeirah Golf Estates W019` reports 7 visits rather than 6 + 1.

## What this does not do

- It does not touch unit numbers. `splitTrailingUnit` already handles the
  unit stuck on the end of a property, including the duplicate-unit case
  fixed on 11 September.
- It does not correct the sheet. The Google Sheet keeps whatever spellings
  it has; this resolves them on the way in. Fixing the source is better and
  is a separate conversation about who maintains the property list.
- It does not merge technicians. `TECH_ALIASES` covers that, and its own
  gap — an unknown spelling silently becoming a new technician — is
  untouched here and still worth a panel of its own.

## What it unblocks

- **B**, the pool contract register: adherence per property is measurable
  once a property is one thing.
- **C**, role-aware technician metrics: Resty's planned-work adherence is
  per pool.
- **D**, the Tier 1 / Tier 2 quality set specced in `94dbb73`, whose
  headline measure is returns **per unit**, and whose unaccounted-time
  measure counts gaps between **buildings** — four of Resty's eleven pool
  days carry a name variant, so those days currently read an extra hop.
