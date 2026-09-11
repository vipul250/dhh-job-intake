/* ---------------------------------------------------------------------- *
 * monthly.mjs — the one report, checked against the real workbook.
 *
 * Guards the three things that would quietly make the report lie:
 *
 *   1. A two-man job must count for both men. splitCrew handles it; if it
 *      ever stops, one of the pair silently does half the work he did.
 *   2. Counts come from every completed job, durations only from timed
 *      ones. If those two denominators are ever merged, an untimed job
 *      starts dragging the average toward zero.
 *   3. major/minor must stay decided by trade. Time can be inflated by
 *      whoever is measured on it; a trade cannot.
 *
 * Run:  node test/suites/monthly.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  monthlyReport, monthsPresent, periodsPresent, periodFor, periodLabel, weekStart,
} from "../../src/lib/monthly.js";
import { parseSheetPaste } from "../../src/lib/importSheet.js";
import { matchCatalogue, seedCatalogue, applyCatalogue } from "../../src/lib/catalogue.js";
import { faultFamily, jobSize } from "../../src/lib/faultFamily.js";

const HARNESS = path.join(import.meta.dirname, "..", "harness");

/* ------------------------- 1. synthetic cases ------------------------- */

const job = (over) => ({
  state: "fixed", scheduledDate: "2026-09-04", team: "Rajesh",
  description: "Pool Cleaning", arrivedAt: "", leftAt: "", ...over,
});

/* A two-man job counts for both, and the pair each get the one job. */
{
  const r = monthlyReport([job({ team: "Rajesh + Naresh" })], "2026-09");
  assert.equal(r.technicians, 2, "a two-man job must count for both men");
  assert.deepEqual(r.byTech.map((t) => t.jobs), [1, 1]);
}

/* Trade decides size, not duration: a 10-minute leak is still major and a
   4-hour pool clean is still minor. */
{
  const r = monthlyReport([
    job({ description: "Leakage in the bathroom", arrivedAt: "09:00", leftAt: "09:10" }),
    job({ description: "Pool Cleaning", arrivedAt: "09:00", leftAt: "13:00" }),
  ], "2026-09");
  assert.equal(r.major, 1, "plumbing is major however fast it was done");
  assert.equal(r.minor, 1, "a pool clean is minor however long it took");
  assert.equal(r.majorMinutes, 10);
  assert.equal(r.minorMinutes, 240);
}

/* An untimed job counts toward jobs done but must not touch the average. */
{
  const r = monthlyReport([
    job({ description: "Leakage", arrivedAt: "09:00", leftAt: "10:00" }),
    job({ description: "Leakage" }),                     // nobody timed it
  ], "2026-09");
  assert.equal(r.jobs, 2, "both jobs were done");
  assert.equal(r.timed, 1);
  assert.equal(r.majorMinutes, 60, "the untimed job must not drag the median");
  assert.equal(r.timedPct, 50, "and the report must admit half of it is untimed");
}

/* Unfinished and cancelled work is not work done. */
{
  const r = monthlyReport([
    job({ state: "scheduled" }), job({ state: "cancelled" }), job({ state: "fixed" }),
  ], "2026-09");
  assert.equal(r.jobs, 1, "only completed jobs count");
}

/* Month filtering keeps other months out. */
{
  const jobs = [job({ scheduledDate: "2026-08-31" }), job({ scheduledDate: "2026-09-01" })];
  assert.deepEqual(monthsPresent(jobs), ["2026-09", "2026-08"]);
  /* A month holding only work that was never closed out is NOT offered.
     It used to be, and on 11 September that put the view in a dead end:
     two jobs scheduled ahead into October made October the newest month
     present, the default landed there, and the empty branch does not render
     the month picker — so there was nothing to click. */
  assert.deepEqual(
    monthsPresent([...jobs, { state: "scheduled", scheduledDate: "2026-10-02" }]),
    ["2026-09", "2026-08"],
    "a month with nothing closed out must not be offered");
  assert.equal(monthlyReport(jobs, "2026-09").jobs, 1);
  assert.equal(monthlyReport(jobs, null).jobs, 2, "no month means every month");
}

/* -------------------- day, week and month -----------------------------
 * He asked to read the same table per day and per week, not only per month.
 * A day and a month are prefixes of the job's date so they cost nothing; a
 * week is nobody's prefix and passes an explicit range.
 * -------------------------------------------------------------------- */
{
  const week = [
    job({ scheduledDate: "2026-09-07", team: "Rajesh" }),   // Monday
    job({ scheduledDate: "2026-09-09", team: "Rajesh" }),   // Wednesday
    job({ scheduledDate: "2026-09-13", team: "Rajesh" }),   // Sunday, same week
    job({ scheduledDate: "2026-09-14", team: "Rajesh" }),   // Monday, NEXT week
    job({ scheduledDate: "2026-08-31", team: "Rajesh" }),   // the week before
  ];

  assert.equal(weekStart("2026-09-09"), "2026-09-07", "the week starts on Monday");
  assert.equal(weekStart("2026-09-13"), "2026-09-07", "Sunday belongs to the week it ends");
  assert.equal(weekStart("2026-09-14"), "2026-09-14", "Monday starts its own week");

  assert.equal(monthlyReport(week, periodFor("day", "2026-09-09")).jobs, 1, "one day");
  assert.equal(monthlyReport(week, periodFor("week", "2026-09-07")).jobs, 3,
    "Mon to Sun inclusive, and nothing from the Monday after");
  assert.equal(monthlyReport(week, periodFor("month", "2026-09")).jobs, 4);
  assert.equal(monthlyReport(week, null).jobs, 5, "no period means everything");

  /* The pickers only ever offer spans that have completed work in them —
     the same rule that stopped the month picker landing on an empty
     October and rendering a dead end. */
  assert.deepEqual(periodsPresent(week, "day"),
    ["2026-09-14", "2026-09-13", "2026-09-09", "2026-09-07", "2026-08-31"]);
  assert.deepEqual(periodsPresent(week, "week"),
    ["2026-09-14", "2026-09-07", "2026-08-31"]);
  assert.deepEqual(periodsPresent(week, "month"), ["2026-09", "2026-08"]);
  assert.deepEqual(monthsPresent(week), periodsPresent(week, "month"),
    "monthsPresent must stay the month case of the same rule");

  assert.equal(periodLabel("month", "2026-09"), "September 2026");
  assert.equal(periodLabel("day", "2026-09-07"), "7 Sep 2026");
  assert.equal(periodLabel("week", "2026-09-07"), "7 Sep 2026 – 13 Sep 2026");
}

/* -------------------- who did what trade ------------------------------
 * "Jabbar did 28 jobs, 12 major and 16 minor — and 20 of them were
 * plumbing" was two tables and a join done by eye. Each technician now
 * carries their own trade split.
 * -------------------------------------------------------------------- */
{
  const r = monthlyReport([
    job({ team: "Jabbar", description: "Leakage in the bathroom" }),
    job({ team: "Jabbar", description: "Water heater replacement" }),
    job({ team: "Jabbar", description: "AC is not cooling" }),
    job({ team: "Jabbar", description: "Pool Cleaning" }),
    job({ team: "Resty",  description: "Pool Cleaning" }),
  ], "2026-09");

  const jabbar = r.byTech.find((t) => t.tech === "Jabbar");
  assert.equal(jabbar.jobs, 4);
  /* The split must account for every one of his jobs and no more. */
  assert.equal(jabbar.trades.reduce((n, x) => n + x.jobs, 0), jabbar.jobs,
    "a technician's trade split must sum to their job count");
  assert.equal(jabbar.trades[0].jobs, 2, "biggest trade first — two plumbing jobs");
  assert.ok(/plumb/i.test(jabbar.trades[0].label));

  const resty = r.byTech.find((t) => t.tech === "Resty");
  assert.equal(resty.trades.length, 1, "one trade, not everybody's trades");
  assert.equal(resty.trades[0].jobs, 1);

  /* And the whole-report trade table still agrees with the sum of the
     per-technician ones. */
  const fromTech = {};
  r.byTech.forEach((t) => t.trades.forEach((x) => {
    fromTech[x.family] = (fromTech[x.family] || 0) + x.jobs;
  }));
  r.byTrade.forEach((x) => assert.equal(fromTech[x.family], x.jobs,
    `byTrade and the per-technician split disagree on ${x.family}`));
}

/* ---------------------- 2. the real workbook -------------------------- *
 * 474 rows of real task descriptions. This is the check that the trade
 * classifier still splits them roughly the way the map was calibrated for
 * — a regex edit in faultFamily.js that swings the split shows up here.
 * -------------------------------------------------------------------- */
{
  const tsv = fs.readFileSync(path.join(HARNESS, "paste.tsv"), "utf8");
  const { jobs: rows } = parseSheetPaste(tsv, "2026-09-01");
  assert.ok(rows.length > 400, `expected the full workbook, parsed ${rows.length}`);

  const jobs = rows.map((r) => ({ ...r, state: "fixed", scheduledDate: r._date || "2026-09-01" }));
  const r = monthlyReport(jobs, null);

  assert.equal(r.jobs > 400, true);
  assert.ok(r.major > 0 && r.minor > 0, "the real workbook has both sizes");
  const majorShare = Math.round((r.major / r.jobs) * 100);
  assert.ok(majorShare > 25 && majorShare < 50,
    `major share was ${majorShare}%, expected 25-50% — check MAJOR_FAMILIES`);

  /* Sheet rows carry no arrive/leave time: the sheet has no column for it.
     This asserts the gap rather than papering over it — the average-time
     half of the report only fills in once technicians close out in the app. */
  assert.equal(r.timed, 0, "sheet-only data cannot be timed");
  assert.equal(r.allMinutes, null);

  console.log(`  real workbook: ${r.jobs} jobs, ${r.major} major / ${r.minor} minor `
    + `(${majorShare}% major), ${r.technicians} technicians, ${r.timedPct}% timed`);
}

/* -------------------- 3. the five-column sheet ------------------------ *
 * The whole point of the trimmed sheet: five columns must import cleanly
 * and reach the report.
 *
 * This failed silently before. looksLikeHeader insisted on a "property"
 * column, did not find one, and fell through to the 21-column positional
 * order — so the technician arrived as "Unit / Villa No.", the description
 * arrived empty, and the report counted five technicians who do not exist.
 * Nothing errored. That is why it is asserted here.
 * -------------------------------------------------------------------- */
{
  const tsv = [
    ["Date", "Team / Technician", "Unit / Villa No.", "Task Description (Scope of Work)", "Status"],
    ["2026-09-02", "Rajesh", "DIBBA 1322", "AC is not cooling", "Fixed"],
    ["2026-09-02", "Naresh + Adil", "Palm Villa 4", "Pool Cleaning", "Fixed"],
    ["2026-09-03", "Rajesh", "Leakage in the bathroom", "Leakage in the bathroom", "Fixed"],
  ].map((r) => r.join("\t")).join("\n");

  const { jobs, headerFound } = parseSheetPaste(tsv, "2026-09-02");
  assert.equal(headerFound, true, "a five-column header must be recognised as a header");
  assert.equal(jobs.length, 3);
  assert.equal(jobs[0].team, "Rajesh", "the technician must not be read out of the wrong column");
  assert.equal(jobs[0].description, "AC is not cooling");

  const r = monthlyReport(jobs.map((j) => ({ ...j, state: "fixed" })), "2026-09");
  assert.equal(r.technicians, 3, "Rajesh, Naresh, Adil — and nobody invented");
  assert.equal(r.byTech.find((t) => t.tech === "Rajesh").major, 2);
  assert.equal(r.byTech.find((t) => t.tech === "Adil").minor, 1, "the pair each keep the pool clean");
}

/* ------------- 4. the catalogue must not change the trade ------------- *
 * applyCatalogue replaces the typed description outright, and the report
 * reads the trade back out of that text. So a wrong snap does not just
 * mislabel a job, it moves it between major and minor.
 *
 * "Fridge door not closing" used to snap to the alias "shower door not
 * closing": two of three tokens shared, score 0.67, over the 0.60 bar. The
 * word that distinguished them — fridge against shower — is the one the
 * score ignores. A fridge (appliance, major) was filed as shower-door
 * hardware (minor), silently.
 * -------------------------------------------------------------------- */
{
  const cat = seedCatalogue();

  assert.equal(matchCatalogue("Fridge door not closing", cat), null,
    "a fridge must not snap to a shower door, however many words they share");

  /* The guard must not have cost the good matches. */
  for (const [typed, expected] of [
    ["AC is not cooling", "AC not cooling — diagnose and repair"],
    ["Shower door hinges need to replace", "Shower door hinge replacement and alignment"],
    ["Pool Cleaning", "Pool cleaning"],
    ["oven is not working", "Appliance fault — diagnose"],
  ]) {
    const m = matchCatalogue(typed, cat);
    assert.ok(m, `"${typed}" should still match a standard task`);
    assert.equal(m.entry.label, expected);
  }

  /* Whatever a job snaps to, its size must survive the rewrite. This is
     what caught "Appliance fault — diagnose": faultFamily had every
     appliance noun but not the word "appliance", so the label itself read
     as unclassified and every snapped oven turned minor. */
  for (const entry of cat) {
    assert.notEqual(faultFamily(entry.label), "other",
      `catalogue label "${entry.label}" cannot be classified, so snapping to it loses the trade`);
  }

  for (const typed of ["oven is not working", "Washing Machine not working",
                       "AC is not cooling", "Pool Cleaning", "Touch up Painting"]) {
    const m = matchCatalogue(typed, cat);
    if (!m) continue;
    const after = applyCatalogue({ description: typed }, m.entry).description;
    assert.equal(jobSize(typed), jobSize(after),
      `snapping "${typed}" to "${after}" changed it from ${jobSize(typed)} to ${jobSize(after)}`);
  }
}

console.log("monthly.mjs OK");
