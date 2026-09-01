/* ---------------------------------------------------------------------- *
 * staff.js — who these people actually are.
 *
 * The board has treated every technician as interchangeable. They are not.
 * Khaled is a painter. Kofi is a carpenter and cannot drive. Faizal cleans
 * pools and is based in Fujairah. Bijaya is a helper. Sending "a
 * technician" to install a water heater is not a plan.
 *
 * Two attributes carry most of the weight:
 *
 *   TRADE     — a painting job wants a painter, and a pool wants the pool
 *               cleaner, and neither is satisfied by whoever is free.
 *   LICENCE   — a crew of three people none of whom can drive cannot get
 *               to site on their own. This is a hard dispatch constraint
 *               and nothing in the app knew about it.
 *
 * Licence is deliberately three-valued. Unknown is not the same as no, and
 * guessing which of the two somebody is would produce exactly the sort of
 * confident wrong answer this project keeps removing.
 * ---------------------------------------------------------------------- */

import { squash, canonKey, canonTech } from "./normalize.js";

export const TRADES = [
  { id: "multi_tech",  label: "Multi technician", short: "Multi tech" },
  { id: "pool",        label: "Pool cleaner",     short: "Pool" },
  { id: "painter",     label: "Painter",          short: "Painter" },
  { id: "carpenter",   label: "Carpenter",        short: "Carpenter" },
  { id: "supervisor",  label: "Site supervisor",  short: "Supervisor" },
  { id: "helper",      label: "General helper",   short: "Helper" },
  { id: "coordinator", label: "Coordinator",      short: "Coordinator" },
  { id: "manager",     label: "Manager",          short: "Manager" },
];

export const TRADE_LABEL = Object.fromEntries(TRADES.map((t) => [t.id, t.label]));
export const FIELD_TRADES = ["multi_tech", "pool", "painter", "carpenter", "supervisor", "helper"];

/* A multi technician can take general work; a helper cannot lead a job but
   counts as a pair of hands; a supervisor can cover general work too. */
export const TRADE_COVERS = {
  multi_tech: ["multi_tech", "general"],
  supervisor: ["supervisor", "multi_tech", "general"],
  pool: ["pool", "general"],
  painter: ["painter", "general"],
  carpenter: ["carpenter", "general"],
  helper: ["general"],
};

export function covers(trade, needed) {
  const list = TRADE_COVERS[trade] || [];
  return list.includes(needed);
}

/* Seeded from the team list the department supplied. Everything here is
   editable in the app — this is a starting point, not a fixed truth. */
export const STAFF_SEED = [
  { name: "Abdul Riyaz", trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Imtiaz",      trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Faizal",      trade: "pool",       base: "Fujairah", licence: true,  role: "field" },
  { name: "Kofi",        trade: "carpenter",  base: "Dubai",    licence: false, role: "field" },
  { name: "Resty",       trade: "pool",       base: "Dubai",    licence: null,  role: "field" },
  { name: "Vitalis",     trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Adi",         trade: "supervisor", base: "Dubai",    licence: true,  role: "field" },
  { name: "Khaled",      trade: "painter",    base: "Dubai",    licence: false, role: "field" },
  { name: "Nizar",       trade: "multi_tech", base: "Dubai",    licence: false, role: "field" },
  { name: "Shafeeq",     trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Bijaya",      trade: "helper",     base: "Dubai",    licence: false, role: "field" },
  { name: "Jabbar",      trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Yousoufu",    trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Bright",      trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Daljith",     trade: "multi_tech", base: "Dubai",    licence: true,  role: "field" },
  { name: "Anthony",     trade: "multi_tech", base: "Dubai",    licence: true,  role: "field", note: "First day 01/09/2026" },

  { name: "Haris",  trade: "coordinator", base: "Dubai", licence: null, role: "office",
    email: "haris@deluxehomes.com", shift: "08:00-17:00",
    note: "Newest team member. Also responsible for stock availability for the teams." },
  { name: "Kaja",   trade: "coordinator", base: "Dubai", licence: null, role: "office",
    email: "kajamohideen@deluxehomes.com", shift: "08:00-17:00",
    note: "Also responsible for all projects end to end." },
  { name: "Tiyana", trade: "coordinator", base: "Dubai", licence: null, role: "office",
    email: "tiyana@deluxehomes.com", shift: "14:00-23:00",
    note: "Longest-serving coordinator. Also reviews blocked properties and major operational issues." },
  { name: "Monish", trade: "manager", base: "Dubai", licence: null, role: "office",
    email: "monishraj@deluxehomes.com", note: "Assistant Maintenance Manager." },
  { name: "Vipul",  trade: "manager", base: "Dubai", licence: null, role: "office",
    email: "vipul@deluxehomes.com", admin: true,
    note: "Administrator — can turn sign-in on and off." },
];

export function normaliseStaff(rec) {
  return {
    name: canonTech(rec.name),
    trade: rec.trade || "multi_tech",
    base: squash(rec.base) || "Dubai",
    licence: rec.licence === true ? true : rec.licence === false ? false : null,
    role: rec.role || "field",
    /* The work email, which is what ties a signed-in session to the name
       this person has on the board. Without it, signing in as
       kajamohideen.mugusin@… would file her work under "Kajamohideen
       Mugusin" while every schedule says "Kaja" — one person, two histories,
       and the who-did-what table split in half. */
    email: squash(rec.email).toLowerCase(),
    /* An administrator is the only one who can switch sign-in back OFF once
       it is on. Everything else in the app is open to everybody on purpose —
       a maintenance department does not need permission tiers to schedule a
       job, and every action already carries a name. This one control is
       different because getting it wrong shuts the whole team out. */
    admin: rec.admin === true,
    shift: squash(rec.shift),
    phone: squash(rec.phone),
    note: squash(rec.note),
    active: rec.active === false ? false : true,
  };
}

export function seedStaff() {
  return STAFF_SEED.map(normaliseStaff);
}

/* ---------------------------------------------------------------------- *
 * Backfilling contact details onto a list that is already stored.
 *
 * The team list was saved to the database before it had an email column, so
 * changing the seed alone would reach nobody — seedStaff() only runs when
 * there is no stored list at all. This fills in what is missing without
 * touching what somebody has typed:
 *
 *   - an email is only written where the stored record has none;
 *   - the admin flag is only ever raised from the seed, never lowered, so
 *     an administrator added by hand in the app is not demoted on reload;
 *   - a seeded person absent from the list is appended, matched on name,
 *     so nobody is duplicated;
 *   - a person the department added themselves is left completely alone.
 * -------------------------------------------------------------------- */
export function backfillStaff(stored) {
  const list = (stored || []).map(normaliseStaff);
  const byName = new Map(list.map((r) => [canonTech(r.name), r]));
  let changed = false;

  STAFF_SEED.forEach((seedRec) => {
    const key = canonTech(seedRec.name);
    const rec = byName.get(key);
    if (!rec) {
      list.push(normaliseStaff(seedRec));
      changed = true;
      return;
    }
    if (!rec.email && seedRec.email) { rec.email = squash(seedRec.email).toLowerCase(); changed = true; }
    if (seedRec.admin === true && !rec.admin) { rec.admin = true; changed = true; }
  });

  return { list, changed };
}

export function staffIndex(list) {
  const m = new Map();
  (list || []).forEach((s) => m.set(canonTech(s.name), normaliseStaff(s)));
  return m;
}

export function lookupStaff(index, name) {
  return index.get(canonTech(name)) || null;
}

/* ---------------------------------------------------------------------- *
 * Reading the annotated team list.
 *
 * The department writes the roster with the details inline —
 * "Khaled- Painter dubai without licence" — so that message is parsed
 * rather than turned into twenty form fields. Anything it cannot read is
 * left alone rather than overwritten with a guess.
 * ---------------------------------------------------------------------- */
/* No trailing word boundary: "supervisorDubai" is a real thing people
   type, and the space-insertion above only helps when the case changes. */
const TRADE_PATTERNS = [
  ["supervisor", /\b(site\s*)?supervisor/i],
  ["pool",       /\bpool\s*(cleaner|technician|tech)?/i],
  ["painter",    /\bpainter|\bpainting/i],
  ["carpenter",  /\bcarpenter|\bcarpentry/i],
  ["helper",     /\b(general\s*)?helper/i],
  ["coordinator",/\bcoordinator/i],
  ["manager",    /\bmanager/i],
  ["multi_tech", /\bmulti[\s-]*(technician|tech)/i],
];

const NO_LICENCE = /\b(without|no|non)\s+(a\s+)?(driver'?s?\s+)?(licen[cs]e|licencse)\b|\bno\s+licen[cs]e\b/i;
const HAS_LICENCE = /\bwith\s+(a\s+)?(driver'?s?\s+)?licen[cs]e\b|\bhas\s+licen[cs]e\b|\blicensed\b/i;

const LOCATIONS = [
  ["Fujairah", /\bfuj(ai|ie|ei)rah\b/i],
  ["Abu Dhabi", /\babu\s*dhabi\b/i],
  ["Sharjah", /\bsharjah\b/i],
  ["Dubai", /\bdubai/i],
];

/**
 * Parse lines like "Khaled- Painter dubai without licence".
 * @returns {{parsed: Array, unreadable: string[]}}
 */
export function parseStaffMessage(text) {
  const out = [];
  const unreadable = [];
  let section = "field";
  String(text || "").split(/\r?\n/).forEach((rawLine) => {
    const line = squash(rawLine.replace(/^\s*[*_~]+|[*_~]+\s*$/g, ""));
    if (!line) return;
    if (/^\d{1,2}[:.]\d{2}/.test(line)) return;      // a shift heading
    /* A "Coordinator" heading switches what the following lines are about.
       Previously these lines were skipped entirely, which lost Haris and
       Kaja — their own lines never say the word "coordinator". */
    if (/^(coordinators?)(\s*shift)?$/i.test(line)) { section = "office"; return; }
    if (/^shift\s*timings?/i.test(line)) { section = "field"; return; }

    // "Name- description" or "Name : description"
    const m = line.match(/^([^\-–—:]{2,40}?)\s*[-–—:]\s*(.+)$/);
    if (!m) return;
    const namePart = squash(m[1]).replace(/\([^)]*\)/g, "").trim();
    /* People run words together — "Site supervisorDubai". A word boundary
       cannot see the join, so a space is inserted at every lowercase-to-
       uppercase transition before anything is matched. */
    const desc = m[2].replace(/([a-z])([A-Z])/g, "$1 $2");
    if (!namePart || /\d/.test(namePart.replace(/\s/g, "")) === true && /\d{2}/.test(namePart)) return;

    const rec = { name: canonTech(namePart) };
    const trade = TRADE_PATTERNS.find(([, re]) => re.test(desc));
    if (trade) rec.trade = trade[0];
    const loc = LOCATIONS.find(([, re]) => re.test(desc));
    if (loc) rec.base = loc[0];
    if (NO_LICENCE.test(desc)) rec.licence = false;
    else if (HAS_LICENCE.test(desc)) rec.licence = true;

    const shiftM = desc.match(/(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)/i);
    if (shiftM) rec.shift = squash(shiftM[0]);

    // Anything after the trade/location/licence wording is a note worth keeping.
    const noteM = desc.match(/(?:licen[cs]e|dubai|fuj\w+|tech|technician|helper|painter|carpenter|supervisor|coordinator|manager)\s*[,\-–—]\s*(.+)$/i);
    if (noteM && squash(noteM[1]).length > 8) rec.note = squash(noteM[1]);
    else if (!trade && squash(desc).length > 8) rec.note = squash(desc);

    if (section === "office" && !rec.trade) rec.trade = "coordinator";
    if (!rec.trade && rec.licence === undefined && !rec.base) { unreadable.push(line); return; }
    if (/coordinator|manager/.test(rec.trade || "")) rec.role = "office";
    out.push(rec);
  });
  return { parsed: out, unreadable };
}

/** Merge parsed records over an existing master without losing fields. */
export function mergeStaff(existing, parsed) {
  const idx = staffIndex(existing);
  parsed.forEach((p) => {
    const key = canonTech(p.name);
    const prev = idx.get(key) || normaliseStaff({ name: key });
    idx.set(key, normaliseStaff({ ...prev, ...p, name: key }));
  });
  return Array.from(idx.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === "field" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function describeStaff(s) {
  if (!s) return "";
  const bits = [TRADE_LABEL[s.trade] || s.trade];
  if (s.base && s.base !== "Dubai") bits.push(s.base);
  bits.push(s.licence === true ? "drives" : s.licence === false ? "no licence" : "licence unknown");
  return bits.join(" · ");
}
