/* ---------------------------------------------------------------------- *
 * normalize.js — turns what people actually type into something countable.
 *
 * Every function here exists because of a specific mess found in the real
 * DHH daily-schedule workbook (474 rows, 18 Aug – 1 Sep). Nothing here is
 * hypothetical: if a rule looks over-engineered, it is handling a real
 * value that appeared in that file. Keep the raw text on the job record —
 * these canonical forms are only ever used for grouping and maths.
 * ---------------------------------------------------------------------- */

/* Collapse whitespace (the sheet has embedded newlines inside cells),
   strip wrapping brackets, drop trailing punctuation. */
export function squash(s) {
  return String(s == null ? "" : s)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonKey(s) {
  return squash(s).toLowerCase().replace(/[.,;:]+$/, "");
}

/* ----------------------------- durations ------------------------------ *
 * Real values seen: "1 hr" (225), "30 Mins" (88), "2 hr" (64), "1hr" (30),
 * "2 Hour" (10), "3hrs" (6), "2 hours" (4), "45 mins", "1.5 hrs".
 * Returns minutes, or null when the text carries no parseable duration —
 * null is deliberate: an unparseable estimate must NOT silently count as 0,
 * or capacity metrics quietly understate the load.
 * -------------------------------------------------------------------- */
export function parseDurationMinutes(raw) {
  const s = squash(raw).toLowerCase();
  if (!s) return null;

  // "1 hr 30 mins" / "1h30"
  let total = 0;
  let matched = false;

  const hourRe = /(\d+(?:\.\d+)?)\s*(?:hrs?|hours?|h)\b/g;
  let m;
  while ((m = hourRe.exec(s)) !== null) {
    total += parseFloat(m[1]) * 60;
    matched = true;
  }

  const minRe = /(\d+(?:\.\d+)?)\s*(?:mins?|minutes?|m)\b/g;
  while ((m = minRe.exec(s)) !== null) {
    total += parseFloat(m[1]);
    matched = true;
  }

  if (matched) return Math.round(total);

  // Bare number with no unit — the sheet uses this for hours ("2", "0.5").
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) {
    const n = parseFloat(bare[1]);
    // A bare number over 12 is far more likely minutes than hours.
    return Math.round(n > 12 ? n : n * 60);
  }
  return null;
}

export function formatMinutes(mins) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/* ------------------------------- Y / N -------------------------------- *
 * Sheet has "Y" (262), "N" (183), "y" (8), "n" (5). Returns true / false /
 * null. null means "nobody answered" and is counted separately everywhere —
 * blank must never be silently read as "No".
 * -------------------------------------------------------------------- */
export function parseYN(raw) {
  const s = squash(raw).toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|done|1)\b/.test(s)) return true;
  if (/^(n|no|false|0)\b/.test(s)) return false;
  return null;
}

/* ------------------------------ shifts -------------------------------- */
export function parseShiftMinutes(shift) {
  const s = squash(shift);
  const m = s.match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const start = +m[1] * 60 + +m[2];
  let end = +m[3] * 60 + +m[4];
  if (end <= start) end += 24 * 60;
  return end - start;
}

/* --------------------------- technicians ------------------------------ *
 * A "Team / Technician" cell is either one name or a crew: "Shafeeq &
 * Bijaya", "Adi, Khaled, Nizar, Shafiq & Bijaya", "Jabbar and anthony".
 * For load we need the individuals — a 3-hour job given to a 5-person crew
 * occupies five people's afternoons, not one.
 *
 * Spelling drift is real and it fragments every per-tech metric:
 *   Yousoufu / Yousouf   Shafiq / Shafique / Shafeeq   vitalis / Vitalis
 * ALIASES maps the variants onto one canonical spelling. Add to it as new
 * spellings show up; unknown names pass through title-cased, never dropped.
 * -------------------------------------------------------------------- */
export const TECH_ALIASES = {
  yousouf: "Yousoufu",
  yousoufu: "Yousoufu",
  yousofu: "Yousoufu",
  yousaf: "Yousoufu",
  shafiq: "Shafeeq",
  shafique: "Shafeeq",
  shafeeq: "Shafeeq",
  riyaz: "Abdul Riyaz",
  "abdul riyaz": "Abdul Riyaz",
  "abdul fazal": "Abdul Fazal",
  vitalis: "Vitalis",
  bright: "Bright",
  anthony: "Anthony",
  jabbar: "Jabbar",
  resty: "Resty",
  bijaya: "Bijaya",
  daljith: "Daljith",
  daljit: "Daljith",
  faizal: "Faizal",
  faisal: "Faizal",
  kofi: "Kofi",
  haris: "Haris",
  kaja: "Kaja",
  tiyana: "Tiyana",
  resty: "Resty",
  imtiaz: "Imtiaz",
  khaled: "Khaled",
  nizar: "Nizar",
  adi: "Adi",
  albert: "Albert",
  monish: "Monish",
};

function titleCase(s) {
  return squash(s).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

export function canonTech(name) {
  const k = canonKey(name);
  if (!k) return "";
  return TECH_ALIASES[k] || titleCase(k);
}

/* Split a crew cell into canonical individual names. */
export function splitCrew(raw) {
  const s = squash(raw);
  if (!s) return [];
  const parts = s
    .split(/\s*(?:,|&|\+|\/|\band\b)\s*/i)
    .map((p) => canonTech(p))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

/* Stable display label for a crew, so "Jabbar and anthony" and
   "Anthony, Jabbar" group as the same crew. */
export function canonCrewLabel(raw) {
  const members = splitCrew(raw);
  if (!members.length) return "Unassigned";
  return members.slice().sort().join(" & ");
}

/* ---------------------- unit stuck in the building --------------------- *
 * 117 of the 474 real rows leave the unit column empty and write the unit
 * on the end of the building instead: "Afnan 5 603", "Sunrise Bay Tower 1
 * 902", "Palm Villa E41". Left as they are, each of those is counted as a
 * building of its own — so a quarter of the month's rows sit in buildings
 * that have exactly one job, repeat visits to the same tower never match,
 * and batching by building cannot group them.
 *
 * Splitting is only safe because a Dubai unit number and a building number
 * do not look alike:
 *
 *   "Afnan 5 603"          -> Afnan 5 / 603      three digits: a unit
 *   "Afnan 3"              -> Afnan 3 / —        one digit: part of the name
 *   "Azizi Riviera 10"     -> Azizi Riviera 10   two digits: part of the name
 *   "Palm Villa E41"       -> Palm Villa / E41   letter then digits: a unit
 *   "Golf Towers T1 1905"  -> Golf Towers T1 / 1905
 *   "Warehouse"            -> Warehouse / —      not a unit at all
 *
 * The rule is deliberately conservative: it only ever runs when the unit
 * column is genuinely empty, and it would rather leave a unit inside a
 * building name than invent one. A wrong split renames a building, and a
 * renamed building is a worse error than an unsplit one.
 * -------------------------------------------------------------------- */
const UNIT_TAIL = /^(?:\d{3,}[A-Za-z]?|[A-Za-z]{1,2}\d{2,})$/;

export function splitTrailingUnit(property, unit) {
  const prop = squash(property);
  if (squash(unit)) return { property: prop, unit: squash(unit), split: false };
  const parts = prop.split(/\s+/);
  if (parts.length < 2) return { property: prop, unit: "", split: false };
  const tail = parts[parts.length - 1];
  if (!UNIT_TAIL.test(tail)) return { property: prop, unit: "", split: false };
  return { property: parts.slice(0, -1).join(" "), unit: tail.toUpperCase(), split: true };
}

/* --------------------------- properties ------------------------------- *
 * 241 distinct property strings across 474 rows, and a big share of that
 * spread is casing/spacing noise: "Palm Villa" (21) / "Palm villa" (11) /
 * "Palm VIlla" (7) are one building counted three ways. Any "top property"
 * ranking built on the raw string is wrong before it starts.
 * -------------------------------------------------------------------- */
export function canonProperty(raw) {
  let s = canonKey(raw);
  if (!s) return "";
  s = s.replace(/\b(tower|twr)\b/g, "tower")
       .replace(/\bbldg\b/g, "building")
       .replace(/\bresidences?\b/g, "residence")
       .replace(/\bapt\b/g, "apartment")
       .replace(/\s*-\s*/g, " ")
       .replace(/\s+/g, " ")
       .trim();
  return s;
}

export function displayProperty(raw) {
  return squash(raw).replace(/\s*-\s*/g, " - ");
}

/* Unit numbers arrive from Excel as floats: 1227.0, 801.0. They are labels,
   not quantities — "801.0" and "801" must be the same unit. */
export function canonUnit(raw) {
  let s = squash(raw).toUpperCase();
  if (!s) return "";
  const asNum = s.match(/^(\d+)\.0+$/);
  if (asNum) s = asNum[1];
  return s.replace(/[()\s]/g, "");
}

/* A property+unit pair is the thing that gets revisited. */
export function assetKey(property, unit) {
  const p = canonProperty(property);
  const u = canonUnit(unit);
  if (!p) return "";
  return u ? `${p}::${u.toLowerCase()}` : p;
}

/* ----------------------- priority & occupancy ------------------------- *
 * The sheet writes P1-Urgent / P2-High / P3-Medium / P4-Routine; the app
 * stores PRI-1..PRI-4. Map both ways so imported and app-entered jobs land
 * in the same buckets.
 * -------------------------------------------------------------------- */
export function canonPriority(raw) {
  const s = canonKey(raw);
  if (!s) return "";
  if (/p?1|urgent|safety/.test(s)) return "PRI-1";
  if (/p?2|high/.test(s)) return "PRI-2";
  if (/p?3|medium|med/.test(s)) return "PRI-3";
  if (/p?4|routine|low|cosmetic/.test(s)) return "PRI-4";
  return "";
}

/* Occupancy states seen: Occupied (166), Vacant (120), Occupied - GC (68),
   Checkout (45), B2B (20), Check-in (17), WC (11), Onboarding (7).
   `occupied` here means "somebody is in there" — that is what decides
   whether the visit needs guest confirmation before a tech drives over. */
export function occupancyClass(raw) {
  const s = canonKey(raw);
  if (!s) return "unknown";
  if (/^occupied/.test(s)) return "occupied";
  if (/check-?in/.test(s)) return "occupied";
  if (/b2b/.test(s)) return "occupied";      // back-to-back: guest out, guest in same day
  if (/check-?out/.test(s)) return "transition";
  if (/^wc\b/.test(s)) return "transition";  // "will check-in"
  if (/vacant/.test(s)) return "vacant";
  if (/onboard/.test(s)) return "vacant";
  return "unknown";
}

/* Does this visit need the guest to have agreed to a time before a tech
   is sent? Anyone inside the unit = yes. */
export function needsGuestConfirmation(status) {
  return occupancyClass(status) === "occupied";
}

/* ------------------------- material readiness ------------------------- *
 * "Material Needed? = Y" with details of "Basic materials" (87 rows) is not
 * a material list — it is the absence of one. A van that leaves without the
 * right part is a wasted visit, so these placeholders are counted as NOT
 * ready rather than quietly passing.
 * -------------------------------------------------------------------- */
const VAGUE_MATERIAL = /^(basic\s*materials?|basic|standard|general|tbc|tbd|na|n\/a|as required|as needed|-+)$/;

export function materialReadiness(materialNeeded, materialDetails) {
  const need = parseYN(materialNeeded);
  const detail = squash(materialDetails);
  if (need === false) return "not-needed";
  if (need === null && !detail) return "unanswered";
  if (!detail) return "missing";
  if (VAGUE_MATERIAL.test(canonKey(detail))) return "vague";
  return "specified";
}

/* ------------------------------- dates -------------------------------- */
export function toISODate(v) {
  if (!v) return "";
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = squash(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YYYY as used in the sheet, optionally followed by a time — the
  // PMS issues list writes "04-08-2026 12:00 PM", and dropping the whole
  // date because of the clock on the end is how a breached due date turns
  // into "no deadline recorded".
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T].*)?$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return "";
}

export function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = new Date(`${isoA}T00:00:00Z`).getTime();
  const b = new Date(`${isoB}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* ----------------------------- work type ------------------------------ *
 * Classifies a task by what kind of work it is. This exists because of a
 * concrete trap in the real data: "Pool Cleaning" appears 57 times and the
 * same villa's pool is cleaned every 2-3 days. Counting that as a repeat
 * visit produces a scary rework number that is really just the PPM
 * schedule working correctly. Rework is therefore only ever counted on
 * REACTIVE work.
 *
 * It also gives the department the standard planned-vs-reactive ratio,
 * which is the one maintenance KPI a GM will already recognise.
 *
 * Order matters: a job whose text mentions an actual fault is reactive even
 * if it also mentions cleaning ("FCU coil cleaning service - AC not
 * cooling" is a breakdown, not a PPM).
 * -------------------------------------------------------------------- */
const RE_PROJECT  = /\b(onboard\w*|quotation|pc-20\d\d|approved|handover|snag|project|fit-?out|contractor)\b/;
const RE_REACTIVE = /\b(leak\w*|drip\w*|not\s+(?:working|cooling|heating|closing|opening)|broken|damag\w*|clog\w*|block\w*|smell|flicker\w*|trip\w*|stuck|jam\w*|error|fault\w*|complain\w*|repair\w*|replace\w*|fix\w*|noise|hard\s+to\s+(?:open|close)|no\s+(?:water|power|light)|burst|overflow\w*)\b/;
const RE_PPM      = /\b(ppm|preventive|preventative|periodic|routine\s+service|pool\s+clean\w*|duct\s+clean\w*|deep\s+clean\w*|servicing|filter\s+chang\w*)\b/;
const RE_INSPECT  = /\b(inspect\w*|survey|assessment|check\s+the\s+condition|audit)\b/;
const RE_LOGISTIC = /\b(pick\s*(?:and|&|\/)?\s*drop|access\s+card|smart\s+lock|qr\s+code|key\s+(?:handover|collect\w*)|deliver\w*|collect\s+material|warehouse|transport)\b/;

export const WORK_TYPES = ["reactive", "ppm", "project", "inspection", "logistics", "other"];

export const WORK_TYPE_LABEL = {
  reactive: "Reactive (breakdown)",
  ppm: "Planned / PPM",
  project: "Project / onboarding",
  inspection: "Inspection",
  logistics: "Logistics",
  other: "Other",
};

export function workType(description, faultCode) {
  const s = canonKey(`${description || ""} ${faultCode || ""}`);
  if (!s) return "other";
  if (RE_PROJECT.test(s)) return "project";
  if (RE_REACTIVE.test(s)) return "reactive";
  if (RE_PPM.test(s)) return "ppm";
  if (RE_INSPECT.test(s)) return "inspection";
  if (RE_LOGISTIC.test(s)) return "logistics";
  return "other";
}
