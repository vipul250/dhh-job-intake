/* ---------------------------------------------------------------------- *
 * sheetText.js — reading the daily sheet as it is actually pasted.
 *
 * importSheet.js assumes tab-separated cells, which is what you get by
 * selecting rows in Excel. That is not what arrives. The live sheet is
 * shared as a locked PDF, so what reaches the clipboard is the RENDERED
 * table: one space between columns, no tabs at all, and long rows wrapped
 * over two or three physical lines.
 *
 * When that was pasted into the quick-add box every line was read as a
 * free-text job, and the damage was specific and total:
 *
 *   2026-09-03 09:00-18:00 Resty Palm villa E41 Occupied ... Pool Cleaning
 *     -> unit "2026", no property at all, and the shift, status, parking
 *        bay and PMS link left sitting in the description
 *
 * The year became the unit number on every row in the sheet, five distinct
 * Palm villas collapsed into five identical-looking cards, and every
 * wrapped continuation line became a job of its own. That is where the
 * duplicates came from.
 *
 * So this reads the rendered form directly. There are no delimiters to
 * rely on, but the sheet's columns are all self-identifying — a date, a
 * shift window, a name from the roster, a status word, a parking bay, a
 * duration, a priority code, a PMS link — so the row is parsed from both
 * ends inwards and whatever is left in the middle is the scope of work,
 * which is the one column that cannot be recognised by shape and the one
 * column that must never be guessed at.
 *
 * Nothing here infers. A field it cannot read is left empty for a human to
 * fill in, because a blank field is visible and a wrong one is not.
 * ---------------------------------------------------------------------- */

import {
  squash, canonKey, canonPriority, canonTech, TECH_ALIASES, splitTrailingUnit,
} from "./normalize.js";

/* --------------------------- the column shapes ------------------------ */

const ISO_DATE = /^\s*(\d{4}-\d{2}-\d{2})\b/;

/** Does this ISO string name a day that actually exists? */
export function isRealDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return false;
  const y = +m[1], mo = +m[2], da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
  const d = new Date(Date.UTC(y, mo - 1, da));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da;
}
const SHIFT = /^\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/;

/* Every status word the sheet uses, longest first so "Occupied - GC" is
   matched before "Occupied". Taken from the real column, not invented. */
const STATUSES = [
  "occupied - gc", "occupied-gc", "check-in", "check in", "checkin",
  "check-out", "check out", "checkout", "handover", "occupied", "vacant",
  "b2b", "onboarding", "other",
  // "WC" is the sheet's shorthand for will-check-in. It is two letters and
  // easy to miss; leaving it out cost 24 rows their building.
  "wc",
  // The rarer ones, all of them real: a unit the owner has taken off sale,
  // an onboarding property, and a staff flat.
  "property-blocked", "property blocked", "blocked", "onb", "staff",
];

/* Not every job is in a building. Warehouse runs, office work and the
   staff accommodation are real work with real hours against them, and
   leaving their location blank means those hours land nowhere. */
const PLACES = [
  ["warehouse", "Warehouse"], ["in warehouse", "Warehouse"],
  ["accomodation", "Accommodation"], ["accommodation", "Accommodation"],
  ["office", "Office"], ["staff accommodation", "Accommodation"],
];

function readPlace(s) {
  const low = canonKey(s);
  for (const [needle, label] of PLACES.slice().sort((a, b) => b[0].length - a[0].length)) {
    if (low === needle || low.startsWith(`${needle} `) || low.startsWith(`${needle} -`)) {
      const words = needle.split(" ").length;
      const parts = s.trim().split(/\s+/);
      return { property: label, rest: parts.slice(words).join(" ") };
    }
  }
  return null;
}

/* A parking bay as the sheet writes them: "P2-14", "(B3-033)", "LG-210",
   "GF - 111", "CLG-232", "b2-132", "B-257", "438", "G-141",
   "P1-27, P1-28", "P4 - 22". */
const BAY = String.raw`\(?[A-Za-z]{0,4}\s?\d{0,2}\s?-\s?\d{1,4}\)?|\(?\d{3,4}\)?`;
const PARKING = new RegExp(`^\\s*((?:${BAY})(?:\\s*(?:,|&|and)\\s*(?:${BAY}))*)(?=\\s|$)`);

/* "Not Confirmed", "GC available", "11.00 Am", "1.00 Pm", or a bare Y/N. */
const GUEST_PHRASE = /^\s*(not\s+confirmed|confirmed|gc\s+available|no\s+access|guest\s+confirmed)\b/i;
const GUEST_TIME = /^\s*(\d{1,2}[.:]\d{2}\s*(?:am|pm))\b/i;
/* Most often the column is simply Y or N. Read here rather than left in
   place, because a bare N at the head of the scope of work reads as part
   of the instruction — "N Thermostat replacement in ground floor". */
const GUEST_FLAG = /^\s*([YN])(?=\s|$)/i;

const DURATION = /(\b\d+(?:\.\d+)?\s*(?:hrs?|hours?|hr|mins?|minutes?|m)\b)\s*$/i;
const PRIORITY = /\b(P[1-4]\s*-\s*(?:Urgent|High|Medium|Routine|Low))\b/i;
const PMS_URL = /https?:\/\/\S*?tasks-redirect-page\?id=(\d+)/i;
const PMS_ID = /\bTSK\s?(\d{5,7})\b/i;

/* ------------------------- rejoining wrapped rows --------------------- *
 * A physical line that does not begin with a date is the tail of the row
 * above it. This is the single most important step: without it a row whose
 * scope of work ran to three lines became three jobs.
 * -------------------------------------------------------------------- */
export function rejoinRows(text) {
  const out = [];
  String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    if (!squash(line)) return;
    const d = line.match(ISO_DATE);
    if (d && isRealDate(d[1])) out.push(line.trim());
    else if (out.length) out[out.length - 1] += ` ${line.trim()}`;
    // A tail before any dated row has nothing to belong to. Kept as its
    // own row so it is visible in the preview rather than silently lost.
    else out.push(line.trim());
  });
  return out;
}

/** Does this look like the rendered daily sheet rather than one typed job? */
export function looksLikeSheetText(text) {
  /* Tabs mean the sheet was copied out of Excel or Sheets with its cells
     intact. importSheet.js reads that exactly, by column, and an exact
     read always beats one that infers from shape — so this stands aside. */
  if (String(text || "").includes("\t")) return false;
  const rows = rejoinRows(text).filter((r) => {
    const d = r.match(ISO_DATE);
    return !!d && isRealDate(d[1]);
  });
  if (!rows.length) return false;
  const shifted = rows.filter((r) => SHIFT.test(r.replace(ISO_DATE, ""))).length;
  return shifted >= Math.max(1, Math.floor(rows.length * 0.5));
}

/* -------------------------- the roster of names ----------------------- *
 * "Abdul riyaz and Bijaya" is one crew across two cells. Names are read
 * against the roster the board already knows, longest first, so "Abdul
 * riyaz" is taken whole rather than leaving "riyaz" in the property.
 * -------------------------------------------------------------------- */
function techNames(known) {
  const names = new Set();
  (known || []).forEach((n) => { if (squash(n)) names.add(canonKey(n)); });
  Object.keys(TECH_ALIASES).forEach((k) => names.add(canonKey(k)));
  Object.values(TECH_ALIASES).forEach((v) => names.add(canonKey(v)));
  return Array.from(names).filter(Boolean).sort((a, b) => b.length - a.length);
}

function readCrew(rest, roster) {
  const found = [];
  let s = rest;
  for (let guard = 0; guard < 4; guard++) {
    const low = canonKey(s);
    const hit = roster.find((n) => low === n || low.startsWith(`${n} `));
    if (!hit) break;
    // Consume exactly as many words as the matched name has.
    const words = hit.split(" ").length;
    const parts = s.trim().split(/\s+/);
    found.push(parts.slice(0, words).join(" "));
    s = parts.slice(words).join(" ");
    // "and" / "&" between two names means one crew on one job.
    const join = s.match(/^\s*(?:and|&|\+)\s+/i);
    if (join) s = s.slice(join[0].length);
    else break;
  }
  return { crew: found, rest: s };
}

/* ---------------------------- reading a row --------------------------- */

function readStatus(s) {
  const low = canonKey(s);
  for (const st of STATUSES) {
    if (low === st || low.startsWith(`${st} `)) {
      const words = st.split(/[\s-]+/).length;
      // Match against the ORIGINAL text so casing and punctuation survive.
      const m = s.match(new RegExp(`^\\s*(${st.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+")})`, "i"));
      return m ? { status: squash(m[1]), rest: s.slice(m[0].length), words } : null;
    }
  }
  return null;
}

/* Where does the property end and the status begin? The property runs up
   to the first status word — "Damac Hills 2 Avencia 45 G382 Occupied" has
   three numbers in it, so scanning for a number would find the wrong one. */
function splitAtStatus(s) {
  const words = s.trim().split(/\s+/);
  for (let i = 1; i <= words.length; i++) {
    const tail = words.slice(i).join(" ");
    const st = readStatus(tail);
    if (st) return { head: words.slice(0, i).join(" "), status: st.status, rest: st.rest };
  }
  return null;
}

/* The tail of the row, read right to left: the PMS link, the "In PMS?"
   flag in front of it, the priority, and the estimated time. */
function readTail(s) {
  const out = { pmsRef: "", inPms: null, priority: "", estimatedTime: "" };
  let rest = s;

  const url = rest.match(PMS_URL);
  if (url) {
    out.pmsRef = url[1];
    rest = (rest.slice(0, url.index) + rest.slice(url.index + url[0].length)).trim();
    // The lone Y or N immediately before the link is the "In PMS?" column.
    const flag = rest.match(/\b([YN])\s*$/i);
    if (flag) { out.inPms = flag[1].toUpperCase() === "Y"; rest = rest.slice(0, flag.index).trim(); }
    else out.inPms = true;   // the link itself is the proof
  } else {
    const tsk = rest.match(PMS_ID);
    if (tsk) { out.pmsRef = tsk[1]; out.inPms = true; }
  }

  const pr = rest.match(PRIORITY);
  if (pr) {
    out.priority = canonPriority(pr[1]);
    rest = (rest.slice(0, pr.index) + rest.slice(pr.index + pr[0].length)).trim();
  }

  /* Pending? and its details sit between the estimated time and the
     priority. A bare Y or N there is the flag; anything longer is the
     detail of what is pending. */
  const dur = rest.match(DURATION);
  if (dur) {
    out.estimatedTime = squash(dur[1]);
    rest = rest.slice(0, dur.index).trim();
  } else {
    // "... 1hr N Gypsum board already fixed" — duration, flag, then detail.
    const mid = rest.match(/\b(\d+(?:\.\d+)?\s*(?:hrs?|hours?|mins?|minutes?))\b/i);
    if (mid) {
      out.estimatedTime = squash(mid[1]);
      const after = rest.slice(mid.index + mid[0].length).trim();
      const fl = after.match(/^([YN])\b\s*/i);
      if (fl) { out.pending = fl[1].toUpperCase() === "Y" ? "Y" : "N"; out.pendingDetails = squash(after.slice(fl[0].length)); }
      else out.pendingDetails = squash(after);
      rest = rest.slice(0, mid.index).trim();
    }
  }

  return { ...out, rest };
}

/* What is left is the scope of work, the material flag and the material
   details. The flag is the last standalone Y or N in the run; a Y means
   the words after it are the material list. */
function readScope(s) {
  /* The LAST standalone Y or N in the run is the material flag: earlier
     ones belong to columns already consumed, and a description that merely
     ends in the letter N is not one because it would not be standalone. */
  let flagIdx = -1, flagChar = "";
  const re = /(?:^|\s)([YN])(?=\s|$)/gi;
  let hit;
  while ((hit = re.exec(s)) !== null) {
    flagIdx = hit.index + hit[0].indexOf(hit[1]);
    flagChar = hit[1].toUpperCase();
  }
  if (flagIdx < 0) return { description: squash(s), materialNeeded: "", materialDetails: "" };

  const before = squash(s.slice(0, flagIdx));
  const after = squash(s.slice(flagIdx + 1));

  /* A Y with nothing after it is the flag and nothing more. A Y with a
     great deal after it, and nothing before it, is a flag that came BEFORE
     the scope — the sheet has both orders — so the longer side wins as the
     description rather than being thrown away. */
  if (!before && after) return { description: after, materialNeeded: flagChar, materialDetails: "" };
  if (after.length > before.length * 2 && before.length < 25) {
    return { description: after, materialNeeded: flagChar, materialDetails: before };
  }
  return { description: before, materialNeeded: flagChar, materialDetails: after };
}

/**
 * Parse the rendered daily sheet.
 *
 * @param {string} text  the paste, spaces not tabs, rows possibly wrapped
 * @param {string} fallbackDate  used only for a row with no readable date
 * @param {{techs?: string[]}} opts  the roster, for reading the crew column
 */
export function parseSheetText(text, fallbackDate, opts = {}) {
  const roster = techNames(opts.techs);
  const rows = rejoinRows(text);
  const jobs = [];
  const unread = [];
  let skipped = 0;

  rows.forEach((row) => {
    const d = row.match(ISO_DATE);
    if (!d) { skipped++; unread.push(row.slice(0, 120)); return; }
    /* The shape of a date is not proof of one. "2026-13-45" matches the
       pattern and would put a job on a day that does not exist, where
       nobody would ever find it again. */
    if (!isRealDate(d[1])) { skipped++; unread.push(row.slice(0, 120)); return; }
    let rest = row.slice(d[0].length);

    let shift = "";
    const sh = rest.match(SHIFT);
    if (sh) { shift = squash(sh[1]).replace(/\s*-\s*/, "-"); rest = rest.slice(sh[0].length); }

    const { crew, rest: afterCrew } = readCrew(rest, roster);
    rest = afterCrew;

    /* Read the tail off before touching the middle: the priority and the
       PMS link are unmistakable, and removing them stops a description
       ending in "N" from being mistaken for a material flag. */
    const tail = readTail(rest);
    rest = tail.rest;

    const at = splitAtStatus(rest);
    let property = "", unit = "", status = "", parking = "", guestConfirmed = "";
    if (at) {
      const place = splitTrailingUnit(at.head, "");
      property = place.property || at.head;
      unit = place.unit;
      /* "Celestia A 557 557" — the coordinator typed the unit in both
         columns and the render ran them together. One of them is the unit;
         repeating it in the building name would split that building in
         two on every report. */
      if (unit) {
        const dup = new RegExp(`\\s+${unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
        if (dup.test(property)) property = squash(property.replace(dup, ""));
      }
      status = at.status;
      rest = at.rest;

      const pk = rest.match(PARKING);
      if (pk) { parking = squash(pk[1]); rest = rest.slice(pk[0].length); }

      const gp = rest.match(GUEST_PHRASE) || rest.match(GUEST_TIME) || rest.match(GUEST_FLAG);
      if (gp) { guestConfirmed = squash(gp[1]); rest = rest.slice(gp[0].length); }
    } else {
      /* No status word anywhere. Most of these are the "office - 7th floor
         Ms Anna office AC is not working" shape: real work in a place that
         is not one of our buildings. Where the place is named, it becomes
         the property so the hours have somewhere to land; where it is not,
         the building is left blank rather than invented, and the row is
         reported so a person can look at it. */
      const pl = readPlace(rest);
      if (pl) { property = pl.property; rest = pl.rest.replace(/^\s*-\s*/, ""); }
      else unread.push(row.slice(0, 120));
    }

    const scope = readScope(rest);
    // A row with no scope of work and no building is a spacer line.
    if (!squash(scope.description) && !property) { skipped++; return; }

    jobs.push({
      _date: d[1],
      shift,
      team: crew.join(" & "),
      property,
      unit,
      status,
      parking,
      timeOfVisit: "",
      guestConfirmed,
      description: scope.description,
      materialNeeded: scope.materialNeeded,
      materialDetails: scope.materialDetails,
      estimatedTime: tail.estimatedTime,
      pending: tail.pending || "",
      pendingDetails: tail.pendingDetails || "",
      priority: tail.priority,
      notes: "",
      _sheetInPms: tail.inPms,
      _sheetPmsRef: tail.pmsRef,
      _sheetChanged: null,
      _sheetWhatChanged: "",
    });
  });

  const warnings = [];
  const noProp = jobs.filter((j) => !squash(j.property)).length;
  if (noProp) warnings.push(`${noProp} row(s) had no recognisable building — check those before adding them.`);
  const noDesc = jobs.filter((j) => !squash(j.description)).length;
  if (noDesc) warnings.push(`${noDesc} row(s) had no scope of work.`);
  if (!jobs.length) warnings.push("No dated rows found. Each row has to start with its date, like 2026-09-03.");

  const dates = Array.from(new Set(jobs.map((j) => j._date))).sort();
  return { jobs, skipped, dates, warnings, unread: unread.slice(0, 8), headerFound: false, columns: {} };
}

export { parseSheetText as default };

/* ---------------------- finding what was already broken --------------- *
 * The sheet was pasted into the quick-add box for at least one day before
 * this file existed, and those jobs are in the database. They are not
 * history worth keeping — no technician was ever sent to unit "2026" —
 * but nothing in this app is deleted, so they have to be findable in order
 * to be closed off with a reason and re-imported properly.
 *
 * The signature is unmistakable and cannot occur in a hand-typed job:
 *
 *   - the unit is the four-digit year of the day the job sits on
 *   - the scope of work opens with a shift window, "09:00-18:00"
 *   - the scope of work still has the PMS link in it
 *   - the scope opens with the torn remains of the date, "2026- "
 *
 * Two or more of those together is conclusive. One alone is not: a
 * description may legitimately mention a time window, and there are real
 * units numbered in the two thousands.
 * -------------------------------------------------------------------- */
export function misreadSigns(job, date) {
  const desc = squash(job && job.description);
  const unit = squash(job && job.unit);
  const year = String(squash(date) || "").slice(0, 4);
  const signs = [];

  if (year && /^\d{4}$/.test(year) && unit === year) {
    signs.push(`unit reads "${unit}", which is the year out of the date column`);
  }
  if (/^\d{4}\s*-\s/.test(desc)) {
    signs.push("the scope of work opens with the torn remains of the date");
  }
  /* Not anchored: "2026- 14:00-23:00 CLG- ..." carries the torn date first
     and the shift straight after, so both signs have to be able to fire. */
  if (/^.{0,8}\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(desc)) {
    signs.push("the scope of work opens with the shift window");
  }
  if (/tasks-redirect-page\?id=\d+/i.test(desc)) {
    signs.push("the PMS link is inside the scope of work");
  }
  if (!squash(job && job.property) && /\b(?:vacant|occupied|checkout|check-in|handover)\b/i.test(desc)) {
    signs.push("no building, and the status word is inside the scope");
  }
  return signs;
}

/* A unit that is exactly the year of the day the job sits on is conclusive
   on its own. No unit in the portfolio is numbered 2026, and the only way
   for one to appear on a 2026 day is for the date column to have been read
   as the unit. Everything else needs a second sign. */
export function isMisread(job, date) {
  const signs = misreadSigns(job, date);
  if (!signs.length) return false;
  if (signs[0].includes("year out of the date column")) return true;
  return signs.length >= 2;
}
