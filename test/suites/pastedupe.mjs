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

/* ---- 6. a cancelled or departed job does not block a re-add --------- */
{
  const day = [{ id: "t1", _tomb: true, property: "Palm villa", unit: "", description: "Pool Cleaning" }];
  const plan = pasteAdditions(day, pools);
  assert.equal(plan.add.length, 5, "a tombstone is not a job standing in the way");
  ok("a tombstone does not count against the paste");
}

console.log(`\n${checks} checks passed.`);
