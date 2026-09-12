/* ---------------------------------------------------------------------- *
 * pastedupe.mjs — five pools are five jobs.
 *
 * 3 September, reported from the live board: Resty had ONE job where the
 * schedule has five. The sheet is right and the reader is right; what went
 * wrong is that the paste deduplicated its own rows against each other.
 *
 * His five rows are Palm villa E41, O56, O103, F30 and L14, all "Pool
 * Cleaning", all an hour. The workbook's printable view drops the villa
 * number on exactly those rows — it is text in a column of numbers, and
 * Google Sheets' QUERY returns blank for the minority type — so all five
 * arrive as "Palm villa / / Pool Cleaning". One content key, five rows,
 * four thrown away. 32 rows in the schedule, 28 on the board.
 *
 * Run:  node test/suites/pastedupe.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { pasteAdditions } from "../../src/lib/job.js";

let checks = 0;
const ok = (what) => { checks++; console.log("  ok  " + what); };

/* Resty's day as it actually arrives once the printable view has dropped
   the villa numbers: five rows that read identically. */
const pools = ["Occupied", "Checkout", "Vacant", "Vacant", "Other"].map((status, i) => ({
  team: "Resty", property: "Palm villa", unit: "",
  description: "Pool Cleaning", status, estimatedTime: "1 hr", pmsRef: "",
  _row: i,
}));

const others = [
  { team: "Vitalis", property: "The Palm Tower", unit: "4514",
    description: "The switch is damaged", pmsRef: "TSK393941" },
  { team: "Vitalis", property: "La Vie", unit: "3503",
    description: "Remove DLX and QR code", pmsRef: "TSK378332" },
];

/* ---- 1. a fresh day takes all five ---------------------------------- */
{
  const plan = pasteAdditions([], [...others, ...pools]);
  assert.equal(plan.add.length, 7, "nothing is dropped on an empty day");
  assert.equal(plan.add.filter((j) => j.team === "Resty").length, 5,
    "five pools, five jobs — he is cleaning five pools");
  assert.equal(plan.dupes, 0);
  ok("five identical-looking rows in one paste become five jobs");
}

/* ---- 2. pasting the same day again adds nothing ---------------------- */
{
  const day = pasteAdditions([], [...others, ...pools]).add.map((j, i) => ({ ...j, id: `j${i}` }));
  const again = pasteAdditions(day, [...others, ...pools]);
  assert.equal(again.add.length, 0, "re-pasting a day must stay safe");
  assert.equal(again.dupes, 7);
  ok("re-pasting the same sheet still adds nothing");
}

/* ---- 3. the case a Set got wrong in BOTH directions ------------------ */
{
  const day = pasteAdditions([], pools).add.map((j, i) => ({ ...j, id: `j${i}` }));
  /* A sixth pool is added to the sheet and the lot re-pasted. Counting
     says one is new; a Set said none were, and the sixth pool vanished. */
  const plus = pasteAdditions(day, [...pools, { ...pools[0], status: "Vacant" }]);
  assert.equal(plus.add.length, 1, "the row added at the bottom of the sheet lands");
  assert.equal(plus.dupes, 5);

  /* And a partial day tops up rather than being skipped or doubled. */
  const partial = pasteAdditions(day.slice(0, 2), pools);
  assert.equal(partial.add.length, 3, "two already there, five in the sheet, three to add");
  ok("a sheet with one more row than the day adds exactly one");
}

/* ---- 4. a PMS reference is still a strict one-of --------------------- */
{
  const twice = [
    { property: "La Vie", unit: "3503", description: "Reset smart lock", pmsRef: "TSK378332" },
    { property: "La Vie", unit: "3503", description: "Something else entirely", pmsRef: "TSK378332" },
  ];
  const plan = pasteAdditions([], twice);
  assert.equal(plan.add.length, 1,
    "one PMS task is one job however the row is worded");
  ok("a repeated TSK reference is still treated as the same job");
}

/* ---- 5. rows nobody can tell apart are reported, not hidden --------- */
{
  const plan = pasteAdditions([], [...others, ...pools]);
  const flag = plan.indistinct.find((x) => x.key.startsWith("palm villa|"));
  assert.ok(flag, "the collapse-prone group is surfaced");
  assert.equal(flag.count, 5);
  assert.equal(plan.indistinct.length, 1, "the distinct rows are not flagged");
  ok("five rows that read the same are added AND flagged as unreadable apart");
}

/* ---- 6. a tombstone: ignored for a person, counted for the sync ------ */
{
  /* A tombstone keeps what left the day under `snapshot`, so the content
     key has to read through it. If it did not, this test would pass for
     the wrong reason — the key would be "||" and match nothing. */
  const moved = {
    id: "tomb-x", _tomb: true, jobId: "x", toDate: "2026-09-05",
    snapshot: { property: "Palm villa", unit: "", description: "Pool Cleaning" },
  };
  const day = [moved];

  /* A person pasting by hand is looking at the day and can see what left
     it, so a tombstone is not a job standing in the way. */
  const byHand = pasteAdditions(day, pools);
  assert.equal(byHand.add.length, 5, "a tombstone does not block a manual paste");

  /* The nightly sync has nobody looking. The Sheet still lists the row
     under the date it was moved OFF, so without this it would be put back
     every night. */
  const bySync = pasteAdditions(day, pools, { countTombstones: true });
  assert.equal(bySync.add.length, 4,
    "the moved one is treated as dealt with; the other four still land");
  assert.equal(bySync.dupes, 1);

  /* Proof the flag is doing the work rather than the key failing to match:
     one tombstone accounts for exactly one row, two for two. */
  const twoMoved = pasteAdditions([moved, { ...moved, id: "tomb-y" }], pools,
    { countTombstones: true });
  assert.equal(twoMoved.add.length, 3);

  /* And a tombstone for different work blocks nothing. */
  const elsewhere = pasteAdditions(
    [{ ...moved, snapshot: { property: "La Vie", unit: "3503", description: "Reset smart lock" } }],
    pools, { countTombstones: true });
  assert.equal(elsewhere.add.length, 5, "a tombstone only accounts for its own row");
  ok("a tombstone is ignored for a manual paste and counted for the sync");
}

/* ---------------------------------------------------------------------- *
 * 11 September: Azizi Riviera 4 521, twice on Anthony's list.
 *
 * Once as the follow-up the app created when the job was closed out on the
 * 10th, and once from the coordinators' printable schedule — because they
 * had scheduled the same work themselves. Two rows, one job.
 *
 * The two descriptions are the same sentence. One of them begins "Retry:",
 * which is a prefix THIS APPLICATION adds, and which defeated its own
 * duplicate check. A job that was plainly moved deduplicated correctly;
 * only the ones the app had relabelled slipped through.
 *
 * It will happen on every day of the twenty-day plan-versus-actual study,
 * because the process is: paste the coordinators' plan, then record what
 * really happened. Anything already carried forward meets their version of
 * itself. And it does not merely untidy the board — the pasted row counts
 * as planned while the follow-up counts as arrived, so each duplicate
 * widens the measured gap between plan and day.
 * ---------------------------------------------------------------------- */
{
  const P = "Azizi Riviera 4", U = "521";
  const SENTENCE = "Balcony light is faulty and requires complete replacement of 1 LED downlight";
  const pasted = { property: P, unit: U, description: SENTENCE };

  const alone = (existing) => pasteAdditions([existing], [pasted]);

  assert.equal(alone({ property: P, unit: U, description: `Retry: ${SENTENCE}.` }).add.length, 0);
  ok("the coordinators' row does not land on top of our own Retry follow-up");

  assert.equal(alone({ property: P, unit: U, description: `Finish: ${SENTENCE}` }).add.length, 0);
  ok("nor on top of a Finish follow-up");

  assert.equal(alone({ property: P, unit: U, description: `Follow-up: ${SENTENCE}` }).add.length, 0);
  assert.equal(alone({ property: P, unit: U, description: `Pending work - ${SENTENCE}` }).add.length, 0);
  ok("nor the other lead-ins the department writes by hand");

  assert.equal(alone({ property: P, unit: U, description: SENTENCE }).add.length, 0);
  ok("a plainly moved job still deduplicates, as it always did");

  assert.equal(alone({ property: P, unit: U, description: "Bedroom tv cabinet broken" }).add.length, 1);
  ok("a genuinely different job at the same unit is still added");

  /* The prefix is stripped for COMPARISON only. Anthony still reads
     "Retry:" on his card, which is how he knows he is going back. */
  const kept = { property: P, unit: U, description: `Retry: ${SENTENCE}` };
  pasteAdditions([kept], [pasted]);
  assert.equal(kept.description, `Retry: ${SENTENCE}`);
  ok("the technician still sees Retry on the card — nothing is rewritten");

  /* Two different units at the same property must not collapse into one,
     which is the failure this whole file was written for. */
  const two = pasteAdditions(
    [{ property: P, unit: "521", description: `Retry: ${SENTENCE}` }],
    [{ property: P, unit: "521", description: SENTENCE },
     { property: P, unit: "306", description: SENTENCE }]
  );
  assert.equal(two.add.length, 1);
  assert.equal(two.add[0].unit, "306");
  ok("the same fault at a different unit is still its own job");
}

console.log(`\n${checks} checks passed.`);
