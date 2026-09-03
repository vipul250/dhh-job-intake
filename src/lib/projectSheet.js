/* ---------------------------------------------------------------------- *
 * projectSheet.js — reads the workbook's "Job Cards (Projects)" tab.
 *
 * The Projects tab could be filled two ways and neither was the one the
 * department already uses. It could be typed in from scratch, or a project
 * could be *discovered* out of the daily schedule by its quotation number
 * (see discoverProjects in project.js). Discovery works and finds real
 * projects, but it only ever sees the days a project happened to get a
 * daily task row written for it — so a job card that ran from the 26th to
 * the 1st shows up as the two days somebody remembered to write down.
 *
 * Meanwhile the workbook has carried a "Job Cards (Projects)" tab all
 * along, one row per project, with twenty-two columns already filled in:
 *
 *   Property · Unit · Parking · Job Type · Quotation Ref · Start Date ·
 *   Team Assigned · Scope of Work · Materials Needed? · Materials List ·
 *   Tools · Warehouse Pickup? · Est. Completion · Total Elapsed time ·
 *   Priority · Pending? · Pending Details · Notes · Date Logged ·
 *   Job Status · Actual Completion Date · Delay Status
 *
 * That is the whole project except the one number nobody wrote down: the
 * amount the client approved. So this reads the tab the same way the Live
 * Board reads the daily sheet — paste it, see what was understood, commit —
 * and asks for the approved amount afterwards, per project, once.
 *
 * WHAT IT REFUSES TO DO
 *
 * Two columns in the real tab cannot be trusted and are not guessed at:
 *
 *   "Total Elapsed time" holds a PRIORITY on all nine real rows ("P2-High"),
 *   not a duration — the column is a copy of the one next to it. It is read
 *   only when it genuinely parses as a duration, so that repairing the sheet
 *   starts feeding real hours in without anything here changing.
 *
 *   "Materials List" is prose, not priced lines — "Materials arranged by
 *   ADI", or a shopping list with quantities and no costs. Turning that into
 *   material lines at zero cost would put a fictional margin on a card, so
 *   it is carried across as what the quotation ASKS for, and the priced
 *   lines stay something a person enters as the money is actually spent.
 *
 * And the dates are checked against each other rather than believed. The
 * real tab has locale damage in it: two rows carry 2026-01-09 where the
 * work plainly happened on 1 September, because "01/09/2026" was typed as
 * day-first into a sheet reading it month-first. A row whose completion
 * precedes its start, or whose span runs longer than three months, is
 * reported and left out rather than turned into eight months of inferred
 * labour.
 * ---------------------------------------------------------------------- */

import {
  squash, canonKey, toISODate, splitCrew, splitTrailingUnit, parseDurationMinutes,
} from "./normalize.js";
import { readQuotationRef, readRevision } from "./project.js";

/* A span this long is a data-entry error, not a project. The longest real
   job card ran 14 days; three months is well clear of anything genuine and
   well inside the eight months a locale-damaged date produces. */
const MAX_SPAN_DAYS = 92;

/* ---------------------------------------------------------------------- *
 * Splitting the paste.
 *
 * Copying these rows out of Sheets or Excel gives tab-separated cells —
 * but Scope of Work and Materials List are multi-line cells, and a cell
 * holding a newline comes across wrapped in double quotes with any internal
 * quote doubled. A parser that split on "\n" first would tear every one of
 * the real rows into eight or ten fragments, which is precisely the failure
 * that put a mangled day on the Live Board.
 * ---------------------------------------------------------------------- */
export function splitPastedRows(text) {
  const s = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [], cell = "", quoted = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') { cell += c; continue; }
      if (s[i + 1] === '"') { cell += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (c === '"' && cell === "") { quoted = true; continue; }
    if (c === "\t") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  row.push(cell);
  if (row.some((x) => squash(x))) rows.push(row);
  return rows;
}

/* Each field lists header substrings to look for, most specific first.
   Fuzzy on purpose — the headers are long and people re-word them. Order
   matters: "Delay Status (auto)" is claimed before the bare "status"
   needle can take it, the same trap that once made the queue report that
   nothing had ever been reported. */
const COLUMN_MATCHERS = [
  ["property",        ["property", "building"]],
  ["unit",            ["unit", "villa"]],
  ["parking",         ["parking"]],
  ["jobType",         ["job type", "type of job"]],
  ["ref",             ["quotation ref", "quotation", "quote ref"]],
  ["startDate",       ["start date", "date started"]],
  ["crew",            ["team assigned", "team", "technician"]],
  ["scope",           ["scope of work", "scope", "task description"]],
  ["materialsNeeded", ["materials needed", "material needed"]],
  ["materialsWanted", ["materials list", "material list", "materials (item"]],
  ["tools",           ["tools required", "tools"]],
  ["pickup",          ["warehouse pickup", "pickup"]],
  ["actualDate",      ["actual completion"]],
  ["targetDate",      ["est. completion", "est completion", "target", "completion date"]],
  ["elapsed",         ["total elapsed", "elapsed"]],
  ["priority",        ["priority"]],
  ["pendingDetails",  ["pending details"]],
  ["pending",         ["pending?", "pending"]],
  ["notes",           ["notes", "comments"]],
  ["loggedDate",      ["date logged"]],
  ["delay",           ["delay status", "delay"]],
  ["status",          ["job status", "status"]],
];

/* The tab's own column order, for a paste that starts at the first data
   row without the header line. */
const POSITIONAL = [
  "property", "unit", "parking", "jobType", "ref", "startDate", "crew", "scope",
  "materialsNeeded", "materialsWanted", "tools", "pickup", "targetDate", "elapsed",
  "priority", "pending", "pendingDetails", "notes", "loggedDate", "status",
  "actualDate", "delay",
];

function matchHeaders(cells) {
  const lower = cells.map((h) => canonKey(h));
  const map = {};
  const taken = new Set();
  COLUMN_MATCHERS.forEach(([field, needles]) => {
    for (const needle of needles) {
      const idx = lower.findIndex((h, i) => !taken.has(i) && h.includes(needle));
      if (idx >= 0) { map[field] = idx; taken.add(idx); return; }
    }
  });
  return map;
}

/* A header row is the one that names the columns that matter. The tab's
   first three rows are a title and an instruction, so the header is hunted
   for rather than assumed to be first. */
const isHeaderRow = (cells) => {
  const m = matchHeaders(cells);
  return m.property != null && m.scope != null && (m.ref != null || m.jobType != null);
};

export function looksLikeJobCards(text) {
  const rows = splitPastedRows(text);
  if (rows.some(isHeaderRow)) return true;
  // No header pasted: the tab's shape is distinctive enough on its own.
  const wide = rows.filter((r) => r.length >= 18);
  return wide.length > 0 && wide.some((r) => readQuotationRef(r.join(" ")));
};

/* ---------------------------------------------------------------------- *
 * Job Type, as the sheet's dropdown writes it, mapped onto the types the
 * app already has. "Other" is left as ordinary quoted work rather than
 * given a bucket of its own — an unclassified type on a chart is the
 * "Other" option this app refuses to offer anywhere else.
 * ---------------------------------------------------------------------- */
function readType(jobType, scope) {
  const t = canonKey(`${jobType} ${scope}`);
  if (/onboard/.test(t)) return "onboarding";
  if (/\bsnag\b/.test(t)) return "snag";
  if (/handover/.test(t)) return "handover";
  if (/landlord|owner\s+request/.test(t)) return "landlord";
  return "quoted-existing";
}

const STATUS_WORDS = [
  [/cancel/, "cancelled"],
  [/complete|done|finish/, "completed"],
  [/in\s*progress|ongoing|started|wip/, "in_progress"],
  [/approved|not\s*started|to\s*start|pending\s*start/, "approved"],
  [/quoted|awaiting|for\s*approval/, "quoted"],
];

function readStatus(raw, actualDate) {
  const s = canonKey(raw);
  for (const [re, v] of STATUS_WORDS) if (re.test(s)) return v;
  /* No status written. A completion date is the stronger evidence anyway —
     a card with a date in the Actual Completion column is finished
     whatever the dropdown says. */
  return actualDate ? "completed" : "approved";
}

/* ---------------------------------------------------------------------- *
 * A name for the project.
 *
 * Scope of Work is the quotation pasted whole — twenty-two numbered
 * clauses on the real Damac row. The card needs a label, not the
 * quotation, so this takes the first line that says something. Real first
 * lines: "bathtub contractor Polishing work - 3rd party" (good),
 * "1."AC servicing" (numbering and a stray quote to strip), "pending"
 * (says nothing — fall back to the job type).
 * ---------------------------------------------------------------------- */
const FILLER = /^(?:pending|tbc|tba|n\/?a|none|yes|no|y|n)$/i;

export function titleFromScope(scope, jobType) {
  const lines = String(scope == null ? "" : scope).split("\n");
  for (const raw of lines) {
    const line = squash(raw)
      .replace(/^["'\s]*\d+\s*[.)\-]\s*/, "")   // "1." / "2)" / "3 -"
      .replace(/^["'“”]+/, "")
      .replace(/["'“”]+$/, "")
      .trim();
    if (line.length < 4 || FILLER.test(line)) continue;
    return (line.charAt(0).toUpperCase() + line.slice(1)).slice(0, 70);
  }
  const t = squash(jobType);
  if (t && !FILLER.test(t)) return t.slice(0, 70);
  return "Quoted work";
}

/* ---------------------------------------------------------------------- *
 * The day-first / month-first collision, and why it is offered rather
 * than fixed.
 *
 * The Job Cards tab has two rows carrying 2026-01-09 where the work
 * plainly happened on 1 September: somebody typed "01/09/2026" day-first
 * into a sheet whose own format reads month-first, and the spreadsheet
 * stored 9 January. One of those rows is the Damac 4301 card that had
 * Shafeeq, Khaled and Nizar on it while the board called all three idle.
 *
 * Swapping the two numbers back is a one-character change that turns an
 * eight-month span into a four-day one, and it is almost certainly right.
 * "Almost certainly" is not the standard this app holds itself to — a
 * wrongly dated project would put a crew on the wrong days and quietly
 * invent their hours. So the alternative reading is WORKED OUT here and
 * OFFERED in the paste dialog, and the row does not come in until somebody
 * says which reading is the true one.
 * ---------------------------------------------------------------------- */

/* Only a day of 12 or less can be a month, so only those are ambiguous. */
function swapDayMonth(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return "";
  const [, y, mo, d] = m;
  if (Number(d) > 12 || Number(d) < 1) return "";
  return `${y}-${d}-${mo}`;
}

const daysApart = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Why this set of dates cannot be right, or "" when it can. */
function dateProblem({ startDate, targetDate, actualCompletionDate }) {
  const end = actualCompletionDate || targetDate;
  if (!startDate || !end) return "";
  const span = daysApart(startDate, end);
  if (span < 0) return `completion (${end}) is before the start (${startDate})`;
  if (span > MAX_SPAN_DAYS) return `${span} days from ${startDate} to ${end}`;
  if (actualCompletionDate && targetDate && daysApart(targetDate, actualCompletionDate) < -MAX_SPAN_DAYS) {
    return `finished (${actualCompletionDate}) long before it was due (${targetDate})`;
  }
  return "";
}

/**
 * The nearest reading of these three dates that holds together.
 *
 * Each date is tried both ways round — eight combinations of three — and
 * the first that passes the same checks wins, preferring the reading that
 * swaps the fewest of them. Returns null when no reading works, which is
 * the honest answer for a row that is simply wrong rather than misread.
 */
function findSaneReading(dates) {
  const keys = ["startDate", "targetDate", "actualCompletionDate"];
  const options = keys.map((k) => {
    const swapped = swapDayMonth(dates[k]);
    return swapped && swapped !== dates[k] ? [dates[k], swapped] : [dates[k]];
  });

  const found = [];
  for (const a of options[0]) for (const b of options[1]) for (const c of options[2]) {
    const cand = { startDate: a, targetDate: b, actualCompletionDate: c };
    const changed = keys.filter((k) => cand[k] !== dates[k]).length;
    if (!changed) continue;
    if (dateProblem(cand)) continue;
    const end = c || b;
    found.push({ ...cand, changed, span: end ? daysApart(a, end) : 9999 });
  }
  if (!found.length) return null;
  /* Fewest numbers moved first, then the shortest span. Both readings of
     the Damac 4301 row move exactly one number: swapping its start gives a
     four-day card, swapping its due date gives a ninety-day one. The
     rejection threshold above stays loose so a genuinely long project is
     never thrown out, but when choosing between two readings that both
     hold together, the longest real job card in the department ran
     fourteen days — so the short one is the better offer to put in front
     of somebody. It is still only an offer. */
  found.sort((x, y) => x.changed - y.changed || x.span - y.span);
  return found[0];
}

/* ---------------------------------------------------------------------- *
 * Read the tab.
 *
 * Returns drafts, not projects: the dialog shows what was understood and
 * only then are they created, so a paste that read badly costs a Cancel
 * rather than a cleanup. Rows that cannot be read are RETURNED as skips
 * with the reason, never dropped quietly — a project missing from a list
 * looks exactly like a project that never existed, which is the whole
 * problem this app was built to end.
 * ---------------------------------------------------------------------- */
export function parseJobCards(text) {
  const rows = splitPastedRows(text);
  if (!rows.length) return { drafts: [], skipped: [], error: "" };

  let colMap = null, start = 0;
  const headerAt = rows.findIndex(isHeaderRow);
  if (headerAt >= 0) { colMap = matchHeaders(rows[headerAt]); start = headerAt + 1; }

  if (!colMap) {
    const wide = rows.find((r) => r.length >= 18);
    if (!wide) {
      return {
        drafts: [], skipped: [],
        error: "This does not look like the Job Cards tab. Copy the header row and the project " +
               "rows together out of the workbook's \"Job Cards (Projects)\" tab — including the " +
               "header means the columns do not have to be in any particular order.",
      };
    }
    colMap = {};
    POSITIONAL.forEach((f, i) => { colMap[f] = i; });
  }

  const cell = (row, field) => {
    const i = colMap[field];
    return i == null ? "" : squash(row[i]);
  };
  /* Scope and materials keep their line breaks — the numbered clauses are
     the readable part of a quotation and flattening them loses it. */
  const block = (row, field) => {
    const i = colMap[field];
    return i == null ? "" : String(row[i] == null ? "" : row[i]).replace(/\r/g, "").trim();
  };

  const drafts = [], skipped = [];

  rows.slice(start).forEach((row, n) => {
    const lineNo = start + n + 1;
    if (!row.some((c) => squash(c))) return;

    const property0 = cell(row, "property");
    const scope = block(row, "scope");

    /* The tab's title and instruction rows, and any stray note somebody
       typed under the data. One filled cell is not a project. */
    const filled = row.filter((c) => squash(c)).length;
    if (filled < 3) return;
    if (!property0 && !scope) return;

    if (!property0) {
      skipped.push({ line: lineNo, reason: "no property on the row", sample: squash(row.join(" ")).slice(0, 70) });
      return;
    }

    const { property, unit } = splitTrailingUnit(property0, cell(row, "unit"));
    const ref = readQuotationRef(`${cell(row, "ref")} ${scope}`);
    const startDate = toISODate(cell(row, "startDate"));
    const targetDate = toISODate(cell(row, "targetDate"));
    const actualDate = toISODate(cell(row, "actualDate"));
    const status = readStatus(cell(row, "status"), actualDate);

    /* Dates checked against each other rather than believed, then — where
       they fail — read the other way round to see whether that makes sense.
       Whichever way it lands, nothing is decided here. */
    const dates = { startDate, targetDate, actualCompletionDate: actualDate };
    const problem = dateProblem(dates);
    const dateProblemInfo = problem
      ? { reason: problem, asWritten: dates, suggestion: findSaneReading(dates) }
      : null;

    /* Read only if it is genuinely a duration. On every real row today this
       column holds "P2-High", so it stays null and the span does the work —
       and the day the sheet is repaired, real hours take over on their own. */
    const elapsedMin = parseDurationMinutes(cell(row, "elapsed"));

    const pending = cell(row, "pending");
    const pendingDetails = cell(row, "pendingDetails");
    const noteBits = [
      cell(row, "notes"),
      /^y/i.test(pending) && pendingDetails ? `Pending: ${pendingDetails}` : "",
      /^y/i.test(pending) && !pendingDetails ? "Pending: not said what" : "",
      cell(row, "parking") ? `Parking: ${cell(row, "parking")}` : "",
    ].filter(Boolean);

    drafts.push({
      line: lineNo,
      property, unit,
      title: titleFromScope(scope, cell(row, "jobType")),
      type: readType(cell(row, "jobType"), scope),
      quotationRef: ref,
      revision: readRevision(`${cell(row, "ref")} ${scope}`),
      status,
      startDate, targetDate, actualCompletionDate: actualDate,
      crew: splitCrew(cell(row, "crew")),
      scope,
      materialsWanted: block(row, "materialsWanted"),
      sheetMinutes: elapsedMin,
      notes: noteBits.join(" · "),
      /* Set when the dates contradict each other. The dialog will not let
         a row like this in until a reading is chosen, because a project on
         the wrong days puts a crew on the wrong days and invents the hours
         to match. */
      dateProblem: dateProblemInfo,
      /* Named so the card can say where a figure came from. Nothing in this
         app reports a number without saying what it rests on. */
      source: "job-cards-tab",
    });
  });

  return { drafts, skipped, error: "" };
}

/* ---------------------------------------------------------------------- *
 * Which of these are already here.
 *
 * The quotation reference is the identity the department uses, so it is
 * tried first and an exact match is conclusive. Pasting the tab twice has
 * to be safe.
 *
 * The reference alone is not enough, though, and the gap is not
 * theoretical — it was measured against the real data. The Projects tab
 * already holds projects DISCOVERED out of the daily schedule, and some of
 * those have no quotation number, because the coordinator wrote the work
 * before the quotation was written up. The Palm Tower 3706 is in the app as
 * "Pick and Drop onboarding team" with no reference, and the job card for
 * that same unit carries PC-2026-08-08 starting the same day. On reference
 * alone that reads as a new project, and the unit ends up with two — which
 * is exactly the fragmentation the Projects tab was built to end.
 *
 * So a card whose reference matches nothing also looks for a project on the
 * SAME UNIT that has NO reference of its own and whose dates sit alongside
 * the card's. Both conditions matter:
 *
 *   Only a reference-less project is a candidate. Two projects on one unit
 *   that each carry their own quotation number are two projects — Al
 *   Fattain 2903 has PC-2026-08-05 on its card and PC-2026-08-28 in the
 *   app, and merging those would be wrong.
 *
 *   And the dates have to be close. A unit onboarded in August and quoted
 *   again in November is not the same job, so a fortnight's slack either
 *   side is the limit. Beyond that it is a new project.
 *
 * discoverProjects already folds a reference-less group into a referenced
 * one for the same unit, for this same reason; this is the same rule
 * applied across the boundary. How each row matched is reported so the
 * dialog can say which it was rather than just "already here".
 * ---------------------------------------------------------------------- */

const SLACK_DAYS = 14;

const rangeOf = (x) => {
  const a = squash(x.startDate);
  const b = squash(x.actualCompletionDate) || squash(x.targetDate) || a;
  return a ? [a, b >= a ? b : a] : null;
};

/** Do these two spans sit within a fortnight of each other? */
function nearby(a, b) {
  const ra = rangeOf(a), rb = rangeOf(b);
  if (!ra || !rb) return false;
  const gap = Math.max(
    daysApart(ra[1], rb[0]),   // b starts after a ends
    daysApart(rb[1], ra[0]),   // a starts after b ends
  );
  return gap <= SLACK_DAYS;
}

export function matchExisting(drafts, projects) {
  const byRef = new Map();
  const byUnit = new Map();
  (projects || []).forEach((p) => {
    const r = squash(p.quotationRef).toUpperCase();
    if (r) byRef.set(r, p);
    const k = `${canonKey(p.property)}|${canonKey(p.unit)}`;
    if (!byUnit.has(k)) byUnit.set(k, []);
    byUnit.get(k).push(p);
  });

  return (drafts || []).map((d) => {
    const onUnit = byUnit.get(`${canonKey(d.property)}|${canonKey(d.unit)}`) || [];

    if (d.quotationRef) {
      const byReference = byRef.get(d.quotationRef.toUpperCase());
      if (byReference) return { ...d, existing: byReference, matchedBy: "ref" };
      const unquoted = onUnit.find((p) => !squash(p.quotationRef) && nearby(p, d));
      if (unquoted) return { ...d, existing: unquoted, matchedBy: "unit" };
      return { ...d, existing: null, matchedBy: "" };
    }

    /* No reference on the card either. Prefer a project that has none, so a
       quoted project on the same unit is not quietly overwritten by an
       unquoted card. */
    const unquoted = onUnit.find((p) => !squash(p.quotationRef));
    if (unquoted) return { ...d, existing: unquoted, matchedBy: "unit" };
    return { ...d, existing: null, matchedBy: "" };
  });
}
