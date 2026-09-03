/* ---------------------------------------------------------------------- *
 * projcards.mjs — the Job Cards paste, checked without a browser.
 *
 * The README is right that only the browser proves a view works, and there
 * is a browser suite for the dialog. This one exists alongside it because
 * what it checks is arithmetic and refusal, not rendering:
 *
 *   - a multi-line quotation cell stays ONE cell (the failure that tore a
 *     pasted day into fragments on the Live Board)
 *   - the messy real quotation refs all read
 *   - contradictory dates are NOT silently accepted, and the alternative
 *     reading offered is the short one
 *   - inferred hours never cover a day the board already counted, and
 *     never cover a day that has not happened
 *
 * Run:  node test/suites/projcards.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { parseJobCards, splitPastedRows, looksLikeJobCards, titleFromScope, matchExisting }
  from "../../src/lib/projectSheet.js";
import {
  newProject, projectCost, projectCrewOn, projectSpanDates, projectActiveOn,
  projectEndDate, discoverProjects, adoptProject, backfillCrewFromJobs, updateFromCard,
} from "../../src/lib/project.js";

const HEADER = [
  "Property", "Unit", "Parking No.", "Job Type", "Quotation Ref", "Start Date",
  "Team Assigned", "Scope of Work (from quotation)", "Materials Needed?",
  "Materials List (item + qty)", "Tools Required", "Warehouse Pickup?",
  "Est. Completion Date", "Total Elapsed time ", "Priority", "Pending?",
  "Pending Details", "Notes", "Date Logged", "Job Status",
  "Actual Completion Date", "Delay Status (auto)",
].join("\t");

/* Trimmed from the nine real rows, keeping every shape that matters: the
   multi-line quoted scope, the four spellings of a reference, the crew
   written with commas and "and", and the two locale-damaged dates. */
const ROWS = [
  ['The Palm Tower', '3706', '1 Parking Slot allocated', 'Onboarding - Approved Quotation',
   'Quotation - PC-2026-08-08 ', '18/08/2026', 'Adi',
   '"pending\n-Cp filter need to fixe \n-shower lipseal 3pcs need fo replaced"',
   'Y', 'Cp filter , Lip seal and Silicone', 'NOT AVAILABLE', 'Y', '20/08/2026',
   'P2-High', 'P2-High', 'Y', 'Completed Email shared', 'Approved onboarding project.',
   '', 'Completed', '21/08/2026', 'COMPLETED LATE'],

  ['"\nClaren Tower 1"', '1301', '(B2-2029)', 'Approved Quotation - Existing Unit',
   'PC-2026-07-23 -', '04/08/2026', ' Adi', 'bathtub contractor Polishing work - 3rd party',
   'N', '', 'NOT AVAILABLE', 'TBC', '20/08/2026', 'P3-Medium', 'P3-Medium', 'N',
   'All completed', 'Work completed', '', 'Completed', '21/08/2026', 'COMPLETED LATE'],

  ['"\nDowntown Views II T3"', '1707', 'P1 - 384', 'Onboarding - Approved Quotation',
   'REV 01 - PC-2026-08-09', '19/08/2026', 'Adi, Nizar, Khaled, shafiq and bijaya',
   '"1.""AC servicing \n1. Check the thermostat.\n2. Clean drain trays."', 'Y',
   '"List of material for 1707 \n- Paint 4 litres\n- Shattaf 2 pcs"', 'NOT AVAILABLE', 'N',
   '21/08/2026', 'P2-High', 'P2-High', 'Y', '', '', '', 'Completed', '26/08/2026', 'COMPLETED LATE'],

  /* Actual completion typed 01/09/2026 day-first into a month-first sheet,
     stored as 9 January and pasted back that way. */
  ['Afnan 5 603', '', '', 'Onboarding - Approved Quotation', 'PC-2026-08-23 -', '26/08/2026',
   'Adi, Shafeeq, Bijaya , Khaled and nizar, Imtiaz', '1."AC Duct Cleaning (indoor units)',
   'Y', 'Materials arranged by ADI', '', 'Y', '30/08/2026', 'P2-High', 'P2-High', 'N', '', '',
   '', 'Completed', '09/01/2026', 'ON TIME'],

  /* Start date damaged the same way. This is the card that had Shafeeq,
     Khaled and Nizar on it while the board called all three idle. */
  ['"\nDamac Towers by Paramount D"', '4301', '', 'Onboarding - Approved Quotation',
   'REV01 - PC-2026-08-07 ', '09/01/2026', 'Shafiq,Khaled, Nizar',
   '"1. ""AC servicing \n2. Chilled water pipe insulation"', 'Y', 'Materials arranged by ADI',
   '', 'Y', '04/09/2026', 'P2-High', 'P2-High', 'N', '', '', '', 'In Progress', '', 'ON TRACK'],
].map((r) => r.join("\t"));

const PASTE = [HEADER, ...ROWS].join("\n");
const TODAY = "2026-09-03";
let checks = 0;
const ok = (what) => { checks++; console.log("  ok  " + what); };

/* -------- 1. a multi-line quotation cell survives as one cell --------- */
{
  const rows = splitPastedRows(PASTE);
  assert.equal(rows.length, 6, "header + 5 rows, not one row per line of a quotation");
  rows.forEach((r, i) => assert.equal(r.length, 22, `row ${i} should have 22 cells`));
  assert.ok(splitPastedRows(PASTE)[3][7].includes("\n"), "the scope keeps its line breaks");
  assert.ok(rows[3][7].includes('"AC servicing'), "a doubled quote comes back as one quote");
  ok("multi-line quoted cells stay in their own column");
}

/* ---------------- 2. it recognises the tab at all -------------------- */
{
  assert.equal(looksLikeJobCards(PASTE), true);
  assert.equal(looksLikeJobCards("Palm Villa E41 AC not cooling 1h"), false,
    "a single hand-typed task is not a job-cards paste");
  ok("recognises the Job Cards tab, and does not claim a quick-add line");
}

/* ------- 3. the four spellings of a real quotation reference --------- */
{
  const { drafts } = parseJobCards(PASTE);
  assert.equal(drafts.length, 5, "every row comes through — nothing dropped quietly");
  assert.deepEqual(drafts.map((d) => d.quotationRef), [
    "PC-2026-08-08", "PC-2026-07-23", "PC-2026-08-09", "PC-2026-08-23", "PC-2026-08-07",
  ]);
  assert.equal(drafts[2].revision, 1, "REV 01");
  assert.equal(drafts[4].revision, 1, "REV01, run together");
  ok("all four written forms of a quotation reference read");
}

/* ---- 4. the unit stuck on the building, and the crew separators ----- */
{
  const { drafts } = parseJobCards(PASTE);
  const afnan = drafts.find((d) => /Afnan/.test(d.property));
  assert.equal(afnan.property, "Afnan 5");
  assert.equal(afnan.unit, "603", "unit split off the end of the building");
  assert.deepEqual(drafts[2].crew, ["Adi", "Nizar", "Khaled", "Shafeeq", "Bijaya"],
    "commas and a trailing 'and', with shafiq aliased to Shafeeq");
  assert.deepEqual(drafts[4].crew, ["Shafeeq", "Khaled", "Nizar"]);
  ok("units and crews read the way the sheet writes them");
}

/* ------ 5. the broken elapsed column is not mistaken for hours ------- */
{
  const { drafts } = parseJobCards(PASTE);
  assert.ok(drafts.every((d) => d.sheetMinutes === null),
    '"P2-High" in the elapsed column must never read as a duration');
  ok("a priority in the elapsed-time column reads as no duration at all");
}

/* ---- 6. contradictory dates are flagged, and the offer is the short one -- */
{
  const { drafts } = parseJobCards(PASTE);
  const flagged = drafts.filter((d) => d.dateProblem);
  assert.equal(flagged.length, 2, "both locale-damaged rows are caught");
  assert.ok(drafts.filter((d) => !d.dateProblem).every((d) => d.startDate),
    "the sound rows are not disturbed");

  const afnan = flagged.find((d) => /Afnan/.test(d.property));
  assert.match(afnan.dateProblem.reason, /before the start/);
  assert.equal(afnan.dateProblem.suggestion.actualCompletionDate, "2026-09-01");

  const damac = flagged.find((d) => /Damac/.test(d.property));
  assert.equal(damac.dateProblem.suggestion.startDate, "2026-09-01",
    "the four-day reading, not the ninety-day one");
  assert.equal(damac.dateProblem.suggestion.targetDate, "2026-09-04",
    "and the due date is left alone");
  ok("day/month damage is caught and the shortest sound reading offered");
}

/* -------- 7. the crew that looked idle is on a project instead ------- */
{
  const { drafts } = parseJobCards(PASTE);
  const projects = drafts.map((d) => {
    const fixed = d.dateProblem && d.dateProblem.suggestion
      ? { ...d, ...d.dateProblem.suggestion } : d;
    return newProject({ ...fixed, id: undefined }, "test");
  });

  /* Regression: CARD_OWNED once omitted property and unit, so every card
     came in with a blank address. It built clean and read plausibly. */
  assert.ok(projects.every((p) => p.property), "every card keeps its property");
  assert.equal(projects.find((p) => /Afnan/.test(p.property)).unit, "603");

  const on = projectCrewOn(projects, TODAY, TODAY).map((x) => x.name).sort();
  assert.deepEqual(on, ["Khaled", "Nizar", "Shafeeq"],
    "the three the board listed as idle on 3 September");

  const damac = projects.find((p) => /Damac/.test(p.property));
  assert.equal(projectActiveOn(damac, "2026-09-04", TODAY), true,
    "still active tomorrow — the board opens on tomorrow");
  assert.equal(projectActiveOn(damac, "2026-09-05", TODAY), false, "and not past its due date");
  assert.equal(projectActiveOn(damac, "2026-08-31", TODAY), false, "nor before it started");
  ok("the project crew comes off the idle list, today and tomorrow");
}

/* ---- 8. inferred hours: not the future, not a day already counted --- */
{
  const { drafts } = parseJobCards(PASTE);
  const damac = newProject({
    ...(() => { const d = drafts.find((x) => /Damac/.test(x.property));
                return { ...d, ...d.dateProblem.suggestion }; })(), id: undefined,
  }, "test");

  assert.deepEqual(projectSpanDates(damac, TODAY),
    ["2026-09-01", "2026-09-02", "2026-09-03"],
    "accrual stops at today even though the card runs to the 4th");

  const bare = projectCost(damac, [], { today: TODAY });
  assert.equal(bare.inferredDays, 3);
  assert.equal(bare.inferredHours, 81, "3 days x 3 crew x 9h");
  assert.equal(bare.inferredFrom, "span");
  assert.equal(bare.labourIsInferred, true, "and it says so");

  /* A day the board DID record must not also be inferred. */
  const withJob = projectCost(damac,
    [{ _date: "2026-09-02", team: "Shafeeq & Khaled & Nizar", estimatedTime: "3 hrs" }],
    { today: TODAY });
  assert.equal(withJob.inferredDays, 2, "the 2nd is accounted for by its job row");
  assert.equal(withJob.estimatedHours, 9, "3h x a crew of three");
  assert.equal(withJob.inferredHours, 54);
  assert.equal(withJob.labourHours, 63, "no day counted twice");

  /* A real total in the sheet wins over inference. */
  const measured = projectCost({ ...damac, sheetMinutes: 40 * 60 }, [], { today: TODAY });
  assert.equal(measured.inferredFrom, "sheet");
  assert.equal(measured.labourHours, 40, "the sheet's own total, not the span's guess");
  /* And the narrower reading the Projects view actually uses: a day only
     counts when the board has a schedule for it and nothing else for that
     person. Counting the whole span read half the department's monthly
     capacity across nine cards. */
  const busyByDate = new Map([
    ["2026-09-01", new Set(["khaled", "nizar"])],   // both elsewhere that day
    ["2026-09-02", new Set(["shafeeq"])],           // Shafeeq elsewhere
    // no entry for 2026-09-03: the board knows nothing about it
  ]);
  const narrowed = projectCost(damac, [], { today: TODAY, busyByDate });
  assert.equal(narrowed.inferredFrom, "unbooked");
  assert.equal(narrowed.inferredDays, 2, "the 3rd has no schedule, so it is not counted");
  assert.equal(narrowed.inferredPersonDays, 3, "1 free on the 1st, 2 free on the 2nd");
  assert.equal(narrowed.inferredHours, 27, "3 crew-days x 9h, not 3 days x 3 crew x 9h");

  /* A day where every one of them was elsewhere adds nothing. */
  const allBusy = projectCost(damac, [],
    { today: TODAY, busyByDate: new Map([["2026-09-01", new Set(["shafeeq", "khaled", "nizar"])]]) });
  assert.equal(allBusy.inferredHours, 0, "nobody was free, so nothing is inferred");

  ok("inferred hours skip recorded days and the future, and yield to a real total");
  ok("a day only counts when the board has a schedule and nothing else for that person");
}

/* --- 9. a project adopted from the schedule must name its crew -------- */
{
  /* Regression, reported from the live Roster: it read "On projects —
     nobody on a job card" while four of them were listed as idle.
     adoptProject was discarding found.crew, and set no end date at all, so
     a finished project also reported itself as still running. */
  const jobs = [
    { id: "j1", _date: "2026-09-01", property: "Damac Towers", unit: "4301",
      description: "ONB - Approved - Quotation - PC-2026-08-07 - AC servicing",
      team: "Shafiq, Khaled & Nizar", estimatedTime: "3 hrs" },
    { id: "j2", _date: "2026-09-02", property: "Damac Towers", unit: "4301",
      description: "Contin Approved - Quotation - PC-2026-08-07 - AC servicing",
      team: "Shafeeq, Khaled, Nizar", estimatedTime: "3 hrs" },
  ];
  const found = discoverProjects(jobs);
  assert.equal(found.length, 1);
  const adopted = adoptProject(found[0], "test");
  assert.deepEqual(adopted.crew, ["Shafeeq", "Khaled", "Nizar"],
    "the crew discovery found must survive being adopted");
  assert.equal(adopted.startDate, "2026-09-01");
  assert.equal(adopted.targetDate, "2026-09-02", "and it must have an end");

  /* A completed project with no dates recorded must not claim to be
     running today — that put its crew on a project they finished in
     August, every day, for ever. */
  const stale = { ...adopted, status: "completed", targetDate: "", actualCompletionDate: "" };
  assert.equal(projectEndDate(stale, "2026-09-30"), "", "cannot say, so says nothing");
  assert.equal(projectActiveOn(stale, "2026-09-30", "2026-09-30"), false);

  /* And the sixteen already stored without a crew are read back from the
     jobs linked to them rather than being asked about. */
  const legacy = [{ ...adopted, crew: [], targetDate: "", actualCompletionDate: "" }];
  const fixed = backfillCrewFromJobs(legacy, jobs, "test");
  assert.equal(fixed.filled, 1);
  assert.deepEqual(fixed.projects[0].crew, ["Shafeeq", "Khaled", "Nizar"]);
  assert.equal(fixed.projects[0].targetDate, "2026-09-02");
  assert.deepEqual(
    projectCrewOn(fixed.projects, "2026-09-02", "2026-09-02").map((x) => x.name).sort(),
    ["Khaled", "Nizar", "Shafeeq"]);

  /* It fills blanks; it does not overwrite a crew somebody typed. */
  const typed = [{ ...adopted, crew: ["Somebody Else"] }];
  assert.equal(backfillCrewFromJobs(typed, jobs, "test").filled, 0);
  ok("an adopted project keeps its crew, gets an end date, and old ones are read back");
}

/* --- 10. pasting the tab over projects already in the app ------------- */
{
  /* Measured against the real data: of nine cards, five match projects the
     Projects tab already holds and four are new. The one that used to go
     wrong is The Palm Tower 3706 — in the app as "Pick and Drop onboarding
     team" with no quotation number, and on a card carrying PC-2026-08-08
     from the same day. On reference alone that made a second project for
     one unit. */
  const inApp = [
    { id: "p1", property: "The Palm Tower", unit: "3706", quotationRef: "",
      status: "completed", startDate: "2026-08-18", targetDate: "2026-08-18",
      actualCompletionDate: "2026-08-18", crew: ["Resty"] },
    { id: "p2", property: "Al Fattain Marine Tower", unit: "2903",
      quotationRef: "PC-2026-08-28", status: "completed",
      startDate: "2026-08-31", targetDate: "2026-09-01", crew: ["Adi"] },
    { id: "p3", property: "Sunrise Bay Tower 1", unit: "902",
      quotationRef: "PC-2026-08-03", status: "completed",
      startDate: "2026-08-18", targetDate: "2026-08-29", crew: ["Adi"] },
  ];

  const cards = [
    { property: "The Palm Tower", unit: "3706", quotationRef: "PC-2026-08-08",
      startDate: "2026-08-18", targetDate: "2026-08-20", actualCompletionDate: "2026-08-21" },
    { property: "Al Fattain Marine Tower", unit: "2903", quotationRef: "PC-2026-08-05",
      startDate: "2026-08-20", targetDate: "2026-08-21", actualCompletionDate: "2026-08-21" },
    { property: "Sunrise Bay Tower 1", unit: "902", quotationRef: "PC-2026-08-03",
      startDate: "2026-08-18", targetDate: "2026-08-21", actualCompletionDate: "2026-08-29" },
    { property: "Somewhere New", unit: "101", quotationRef: "PC-2026-08-99",
      startDate: "2026-08-18", targetDate: "2026-08-19" },
  ];

  const m = matchExisting(cards, inApp);
  assert.equal(m[0].existing?.id, "p1",
    "a card's number attaches to the unquoted project already on that unit");
  assert.equal(m[0].matchedBy, "unit");
  assert.equal(m[1].existing, null,
    "two quotations on one unit stay two projects — PC-08-05 must not eat PC-08-28");
  assert.equal(m[2].existing?.id, "p3", "an exact reference match is conclusive");
  assert.equal(m[2].matchedBy, "ref");
  assert.equal(m[3].existing, null, "a genuinely new unit is new");

  /* A unit quoted again months later is a different project. */
  const later = matchExisting(
    [{ ...cards[0], startDate: "2026-11-01", targetDate: "2026-11-04",
       actualCompletionDate: "2026-11-04" }], inApp);
  assert.equal(later[0].existing, null, "beyond a fortnight it is a new project");
  ok("a card attaches to an unquoted project on its unit, and never merges two quotations");
}

/* --- 11. "In Progress" invalidates a recorded completion date --------- */
{
  /* Damac 4301 was adopted from the schedule as completed on 1 September,
     because that is the last day the schedule had a task for it. Its card
     says In Progress, due the 4th. Keeping the old completion date meant
     the project still ended on the 1st however the card was read, and its
     crew went on reading as idle on the 3rd. */
  const adopted = {
    id: "p9", property: "Damac Towers", unit: "4301", quotationRef: "PC-2026-08-07",
    status: "completed", startDate: "2026-08-31", targetDate: "2026-09-01",
    actualCompletionDate: "2026-09-01", crew: ["Shafeeq", "Khaled", "Nizar"], events: [],
  };
  const card = {
    property: "Damac Towers", unit: "4301", quotationRef: "PC-2026-08-07",
    status: "in_progress", startDate: "2026-09-01", targetDate: "2026-09-04",
    actualCompletionDate: "", crew: ["Shafeeq", "Khaled", "Nizar"],
  };
  const { project, changed } = updateFromCard(adopted, card, "test");
  assert.equal(project.status, "in_progress");
  assert.equal(project.targetDate, "2026-09-04");
  assert.equal(project.actualCompletionDate, "", "the stale completion date is dropped");
  assert.ok(changed.includes("actualCompletionDate"), "and the change is recorded");
  assert.equal(projectEndDate(project, "2026-09-03"), "2026-09-04");
  assert.deepEqual(
    projectCrewOn([project], "2026-09-03", "2026-09-03").map((x) => x.name),
    ["Shafeeq", "Khaled", "Nizar"], "so the crew is on a project on the 3rd");
  assert.equal(projectActiveOn(project, "2026-09-05", "2026-09-03"), false,
    "and off it once the card is past due");

  /* A completed card still keeps its date — the exception is only for work
     the sheet says is unfinished. */
  const finished = updateFromCard(adopted,
    { ...card, status: "completed", actualCompletionDate: "2026-09-04" }, "test");
  assert.equal(finished.project.actualCompletionDate, "2026-09-04");
  ok("a card saying In Progress clears a completion date it contradicts");
}

/* ------------------------ 12. titles --------------------------------- */
{
  assert.equal(titleFromScope('pending\n-Cp filter need to fixe', 'Onboarding'),
    "-Cp filter need to fixe", '"pending" says nothing, so it is passed over');
  assert.equal(titleFromScope('1."AC servicing \n1. Check', 'Onboarding'), "AC servicing");
  assert.equal(titleFromScope('', 'Approved Quotation - Existing Unit'),
    "Approved Quotation - Existing Unit", "falls back to the job type");
  assert.equal(titleFromScope('', ''), "Quoted work");
  ok("a card gets a label rather than a whole quotation");
}

console.log(`\n${checks} checks passed.`);
