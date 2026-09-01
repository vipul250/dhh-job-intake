/* ---------------------------------------------------------------------- *
 * importSheet.js — deterministic importer for the "Daily Input - Field
 * Tasks" sheet.
 *
 * Why this exists next to the AI import tab: the workbook is already
 * columnar. Selecting the rows in Excel and pasting them gives clean
 * tab-separated data, so there is nothing here for a language model to
 * infer — and a deterministic parser cannot hallucinate a unit number,
 * costs nothing per paste, and imports a whole month in one go instead of
 * four jobs at a time. The AI tab stays for the messy case: schedules that
 * arrive as prose in WhatsApp or email.
 *
 * Header matching is fuzzy on purpose. The sheet's headers are long
 * ("Material Details (what + qty)") and people re-word them; matching on a
 * distinctive substring survives that.
 * ---------------------------------------------------------------------- */

import { squash, canonKey, toISODate, canonPriority, parseYN, splitTrailingUnit } from "./normalize.js";

/* Each target field lists substrings to look for, most specific first. */
const COLUMN_MATCHERS = [
  ["_date",           ["date"]],
  ["shift",           ["shift"]],
  ["team",            ["team", "technician"]],
  ["property",        ["property", "building"]],
  ["unit",            ["unit", "villa no"]],
  ["status",          ["status"]],
  ["parking",         ["parking"]],
  ["timeOfVisit",     ["time of visit", "visit time"]],
  ["guestConfirmed",  ["guest confirmed", "guest confirm"]],
  ["description",     ["task description", "scope of work", "description"]],
  ["materialNeeded",  ["material needed", "material?"]],
  ["materialDetails", ["material details", "material detail"]],
  ["estimatedTime",   ["estimated time", "est. time", "est time"]],
  ["pending",         ["pending? ", "pending?"]],
  ["pendingDetails",  ["pending details", "what's pending"]],
  ["priority",        ["priority"]],
  ["notes",           ["notes"]],
  ["inPmsRaw",        ["in pms"]],
  ["pmsRef",          ["pms ticket", "task ref"]],
  ["changedRaw",      ["changed after", "changed?"]],
  ["whatChanged",     ["what changed"]],
];

function matchHeaders(headerCells) {
  const lower = headerCells.map((h) => canonKey(h));
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

/* Positional fallback for the workbook's exact column order, used when the
   user pastes data rows without the header line. */
const POSITIONAL = [
  "_date", "shift", "team", "property", "unit", "status", "parking",
  "timeOfVisit", "guestConfirmed", "description", "materialNeeded",
  "materialDetails", "estimatedTime", "pending", "pendingDetails",
  "priority", "notes", "inPmsRaw", "pmsRef", "changedRaw", "whatChanged",
];

function splitRows(text) {
  // Excel quotes any cell containing a tab or newline; honour that so a
  // multi-line scope-of-work cell doesn't split into several jobs.
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  const src = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function looksLikeHeader(cells) {
  const joined = canonKey(cells.join(" "));
  return joined.includes("property") && (joined.includes("shift") || joined.includes("task") || joined.includes("date"));
}

/* Excel sometimes serialises a date cell as a serial number. */
function excelSerialToISO(n) {
  const ms = (n - 25569) * 86400000; // 1899-12-30 epoch
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return toISODate(d);
}

function normaliseDate(raw, fallback) {
  const s = squash(raw);
  if (!s) return fallback;
  const iso = toISODate(s);
  if (iso) return iso;
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) return excelSerialToISO(n);
  return fallback;
}

/* Excel writes numeric-looking unit cells as "801" but a CSV round-trip can
   yield "801.0" — both must mean unit 801. Keep the display value tidy. */
function tidyUnit(raw) {
  const s = squash(raw);
  const m = s.match(/^(\d+)\.0+$/);
  return m ? m[1] : s;
}

/**
 * Parse pasted spreadsheet text into job records.
 * @param {string} text        tab-separated paste from Excel/Sheets
 * @param {string} fallbackDate ISO date used for rows with no date cell
 * @returns {{jobs: Array, skipped: number, headerFound: boolean, columns: object, warnings: string[]}}
 */
export function parseSheetPaste(text, fallbackDate) {
  const rows = splitRows(text).filter((r) => r.some((c) => squash(c) !== ""));
  if (!rows.length) {
    return { jobs: [], skipped: 0, headerFound: false, columns: {}, warnings: ["Nothing to import — the paste was empty."] };
  }

  let colMap, dataRows, headerFound = false;
  if (looksLikeHeader(rows[0])) {
    colMap = matchHeaders(rows[0]);
    dataRows = rows.slice(1);
    headerFound = true;
  } else {
    colMap = {};
    POSITIONAL.forEach((f, i) => { colMap[f] = i; });
    dataRows = rows;
  }

  const warnings = [];
  if (headerFound) {
    ["property", "team", "description"].forEach((f) => {
      if (colMap[f] === undefined) warnings.push(`No "${f}" column found in the pasted header row — those values will be blank.`);
    });
  } else {
    warnings.push(
      "No header row detected, so columns were read in the workbook's own order " +
      "(Date, Shift, Team, Property, Unit, Status, Parking, …). If your columns are in a " +
      "different order, include the header row in the paste."
    );
  }

  const get = (row, field) => {
    const i = colMap[field];
    return i === undefined ? "" : squash(row[i]);
  };

  const jobs = [];
  let skipped = 0;
  let lastDate = fallbackDate;

  dataRows.forEach((row) => {
    const property = get(row, "property");
    const description = get(row, "description");
    // A row with neither a property nor a task is a spacer or a stray note.
    if (!property && !description) { skipped++; return; }

    const date = normaliseDate(get(row, "_date"), lastDate);
    lastDate = date;

    /* A quarter of the real rows leave the unit column empty and write the
       unit on the end of the building instead. Split it here so the job
       arrives with a building that groups and a unit that matches. */
    const place = splitTrailingUnit(property, tidyUnit(get(row, "unit")));

    jobs.push({
      _date: date,
      shift: get(row, "shift"),
      team: get(row, "team"),
      property: place.property,
      unit: place.unit,
      status: get(row, "status"),
      parking: get(row, "parking"),
      timeOfVisit: get(row, "timeOfVisit"),
      guestConfirmed: get(row, "guestConfirmed"),
      description,
      materialNeeded: get(row, "materialNeeded"),
      materialDetails: get(row, "materialDetails"),
      estimatedTime: get(row, "estimatedTime"),
      pending: get(row, "pending"),
      pendingDetails: get(row, "pendingDetails"),
      priority: canonPriority(get(row, "priority")),
      notes: get(row, "notes"),
      // The workbook's own PMS columns are carried in as the admin's
      // starting point, not as a confirmed outcome — closing the job on
      // the Live Board is what records what actually happened.
      _sheetInPms: parseYN(get(row, "inPmsRaw")),
      _sheetPmsRef: get(row, "pmsRef"),
      _sheetChanged: parseYN(get(row, "changedRaw")),
      _sheetWhatChanged: get(row, "whatChanged"),
    });
  });

  const undated = jobs.filter((j) => !j._date).length;
  if (undated) warnings.push(`${undated} row(s) had no readable date and were left undated — set a date before adding them.`);

  return { jobs, skipped, headerFound, columns: colMap, warnings };
}

/** Group parsed jobs by date, for a per-day import preview. */
export function groupByDate(jobs) {
  const m = new Map();
  jobs.forEach((j) => {
    const d = j._date || "(no date)";
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(j);
  });
  return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
