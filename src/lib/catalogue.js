/* ---------------------------------------------------------------------- *
 * catalogue.js — the standard task list.
 *
 * Free text is fast to type and impossible to compare. In the real month
 * the same job was written as "Shower door hinges need to replaced",
 * "Shower door hinges need to be replaced" and "Shower door hinges
 * replaced - Glass door alignment required"; pool cleaning appeared 57
 * times in four spellings. Every metric downstream then has to guess
 * whether those are the same work, and every coordinator invents their own
 * wording for the same thing.
 *
 * So capture stays one line, but the line SNAPS to a standard task. The
 * coordinator types what they would have typed anyway; the app recognises
 * it, writes the canonical wording, and fills in the duration, crew size
 * and trade that task always needs. Nothing extra to click, and the same
 * job is worded identically whoever entered it.
 *
 * The defaults are not invented. Durations are the median actually
 * scheduled for that work across 474 real jobs; crew sizes come from
 * crewing.js, which was itself derived from the same data.
 *
 * The catalogue is stored, editable, and grows: anything typed that
 * matches nothing can be saved as a new standard task from the board.
 * ---------------------------------------------------------------------- */

import { squash, canonKey } from "./normalize.js";

/* minutes / people / trade are the defaults applied when a line snaps to
   the entry. `aliases` are the other ways people actually write it. */
export const CATALOGUE_SEED = [
  // --- pool -------------------------------------------------------------
  { id: "pool-clean", label: "Pool cleaning", minutes: 60, people: 1, trade: "pool",
    aliases: ["pool clean", "clean the pool", "pool service", "swimming pool cleaning"] },
  { id: "pool-gate", label: "Pool gate mechanism repair", minutes: 60, people: 1, trade: "general",
    aliases: ["pool exit gate", "pool gate cylinder", "pool gate not closing"] },

  // --- AC ---------------------------------------------------------------
  { id: "ac-ppm", label: "AC PPM — filter and coil service", minutes: 180, people: 2, trade: "general",
    aliases: ["ac ppm", "ac servicing", "ac service", "aircon service"] },
  { id: "ac-not-cooling", label: "AC not cooling — diagnose and repair", minutes: 120, people: 1, trade: "general",
    aliases: ["ac not cooling", "not cooling", "aircon not cooling", "ac weak cooling"] },
  { id: "ac-duct", label: "AC duct cleaning (indoor units)", minutes: 180, people: 2, trade: "general",
    aliases: ["duct cleaning", "ac duct clean", "indoor unit cleaning"] },
  { id: "fcu-coil", label: "FCU coil cleaning", minutes: 240, people: 2, trade: "general",
    aliases: ["fcu coil cleaning", "coil cleaning", "fcu clean"] },
  { id: "ac-drain", label: "AC drain pan declog", minutes: 60, people: 1, trade: "general",
    aliases: ["fcu drain pan", "ac drain blocked", "water from fcu", "ac leaking water"] },
  { id: "thermostat", label: "Thermostat replacement", minutes: 60, people: 1, trade: "general",
    aliases: ["thermostat not working", "thermostat replacement", "thermostat error"] },

  // --- plumbing ---------------------------------------------------------
  { id: "drain-clog", label: "Drain unclogging", minutes: 30, people: 1, trade: "general",
    aliases: ["drain clogged", "bathroom drain clogged", "sink blocked", "shower drain blocked", "declog"] },
  { id: "drain-smell", label: "Drainage smell — trap and vent check", minutes: 30, people: 1, trade: "general",
    aliases: ["bad smell from drain", "smell from drainage", "sewage smell"] },
  { id: "leak-ceiling", label: "Water leak from ceiling — trace and stop", minutes: 120, people: 1, trade: "general",
    aliases: ["water leak from ceiling", "leak from the ceiling", "water dripping from light", "ceiling leak"] },
  { id: "water-heater", label: "Water heater replacement", minutes: 180, people: 2, trade: "general",
    material: "water heater unit, fittings",
    aliases: ["water heater replacement", "geyser replacement", "replace water heater", "water heater not working"] },
  { id: "shattaf", label: "Shattaf / flexible hose replacement", minutes: 30, people: 1, trade: "general",
    aliases: ["shattaf leaking", "flexible hose", "shattaf replacement"] },
  { id: "mixer-tap", label: "Mixer / tap replacement", minutes: 60, people: 1, trade: "general",
    aliases: ["mixer leaking", "tap leaking", "angle valve leaking", "bathtub mixer"] },
  { id: "wc-flush", label: "WC flush mechanism repair", minutes: 60, people: 1, trade: "general",
    aliases: ["flush not working", "toilet flush", "wc flush mechanism"] },

  // --- electrical -------------------------------------------------------
  { id: "light-replace", label: "Light / downlight replacement", minutes: 30, people: 1, trade: "general",
    material: "downlight or bulb",
    aliases: ["light not working", "lights need to be replaced", "bulb replacement", "downlight", "light flickering", "spot light not working"] },
  { id: "socket-switch", label: "Socket / switch repair", minutes: 30, people: 1, trade: "general",
    aliases: ["socket not working", "switch not working", "power point"] },
  { id: "tripping", label: "Electrical tripping — trace circuit", minutes: 60, people: 1, trade: "general",
    aliases: ["tripping issue", "breaker tripping", "no electricity", "power trip"] },

  // --- doors, windows, hardware ----------------------------------------
  { id: "shower-door", label: "Shower door hinge replacement and alignment", minutes: 120, people: 2, trade: "general",
    material: "shower door hinges",
    aliases: ["shower door hinges", "glass door alignment", "shower door not closing"] },
  { id: "door-lock", label: "Door lock repair / replacement", minutes: 60, people: 1, trade: "general",
    aliases: ["door lock", "main door lock", "lock not working", "replacement of door lock"] },
  { id: "door-align", label: "Door alignment — hard to open or close", minutes: 60, people: 1, trade: "general",
    aliases: ["door not closing properly", "hard to open and close", "door alignment"] },
  { id: "smart-lock", label: "Remove DLX and QR code — reset smart lock", minutes: 30, people: 1, trade: "general",
    aliases: ["remove dlx", "reset smart lock", "qr code removal"] },
  { id: "fly-net", label: "Balcony fly net / mesh repair", minutes: 60, people: 1, trade: "general",
    material: "fly mesh",
    aliases: ["fly net", "balcony window net", "mosquito mesh", "balcony door net"] },

  // --- finishes ---------------------------------------------------------
  { id: "paint-touchup", label: "Paint touch-up", minutes: 60, people: 1, trade: "painter",
    material: "paint",
    aliases: ["paint touch up", "touch up painting", "touch-ups"] },
  { id: "ceiling-paint", label: "Ceiling painting", minutes: 120, people: 1, trade: "painter",
    material: "paint, putty",
    aliases: ["ceiling painting work", "ceiling putty and painting"] },
  { id: "ceiling-access", label: "Ceiling access panel fitting", minutes: 120, people: 2, trade: "general",
    material: "access panel",
    aliases: ["access panel", "ceiling fixing access panel"] },
  { id: "full-repaint", label: "Full apartment painting", minutes: 480, people: 2, trade: "painter",
    material: "paint",
    aliases: ["full apartment paint", "apartment painting", "full painting"] },
  { id: "silicone", label: "Silicone / sealant work", minutes: 60, people: 1, trade: "general",
    material: "silicone",
    aliases: ["silicon work", "sealant", "silicone replacement"] },

  // --- furniture and fittings ------------------------------------------
  { id: "furniture-fix", label: "Furniture repair", minutes: 60, people: 1, trade: "carpenter",
    aliases: ["chair leg damage", "mirror stand broken", "table broken", "furniture fix"] },
  { id: "wardrobe", label: "Wardrobe / cabinet door repair", minutes: 60, people: 1, trade: "carpenter",
    aliases: ["wardrobe door", "cabinet handle", "cabinet door coming off"] },
  { id: "curtain", label: "Curtain track / hook repair", minutes: 30, people: 1, trade: "general",
    material: "curtain hooks",
    aliases: ["curtains hard to open", "curtain hooks", "curtain track"] },
  { id: "appliance", label: "Appliance fault — diagnose", minutes: 60, people: 1, trade: "general",
    aliases: ["fridge not working", "washing machine", "dishwasher not working", "oven not working", "micro oven"] },

  // --- inspections and handover ----------------------------------------
  { id: "general-inspection", label: "General inspection and maintenance", minutes: 60, people: 1, trade: "general",
    aliases: ["general inspection", "inspection and maintenance", "full inspection"] },
  { id: "owner-arrival", label: "Preparation for owner arrival", minutes: 60, people: 1, trade: "general",
    aliases: ["preparation to owner arrival", "owner arrival", "vvip preparation"] },
  { id: "joint-inspection", label: "Joint inspection with building management", minutes: 60, people: 1, trade: "general",
    aliases: ["joint inspection", "check with bm", "inspection with building management"] },
  { id: "handover-check", label: "Handover / snag check", minutes: 60, people: 1, trade: "general",
    aliases: ["snag", "handover check", "snag works"] },
];

export function seedCatalogue() {
  return CATALOGUE_SEED.map((c) => ({ ...c, aliases: c.aliases || [], active: true }));
}

/* ---------------------------------------------------------------------- *
 * Matching.
 *
 * Deliberately conservative. Silently rewriting a coordinator's words into
 * the wrong standard task is worse than not matching at all — they would
 * stop trusting the box, and a wrong canonical label corrupts every metric
 * built on it. So a match needs real overlap, and the snap is always shown
 * before it is applied.
 * ---------------------------------------------------------------------- */
const STOP = new Set(["the", "and", "for", "with", "need", "needs", "needed", "please",
  "not", "was", "are", "is", "in", "of", "to", "a", "an", "on", "it", "its", "this", "that",
  "from", "there", "again", "pending", "work", "please", "check"]);

function tokens(s) {
  return canonKey(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export function matchCatalogue(text, catalogue) {
  const q = tokens(text);
  if (!q.length) return null;
  const qs = new Set(q);
  let best = null, bestScore = 0;

  (catalogue || []).forEach((entry) => {
    if (entry.active === false) return;
    const candidates = [entry.label, ...(entry.aliases || [])];
    candidates.forEach((c) => {
      const ct = tokens(c);
      if (!ct.length) return;
      let hit = 0;
      ct.forEach((w) => { if (qs.has(w)) hit++; });
      if (!hit) return;
      // How much of the standard task's wording the typed text covers,
      // nudged by how much of what they typed it explains.
      const coverage = hit / ct.length;
      const precision = hit / q.length;
      const score = coverage * 0.75 + precision * 0.25;
      if (score > bestScore) { bestScore = score; best = entry; }
    });
  });

  // Two thirds of the standard wording has to be present. Below that it is
  // a guess, and a guess here rewrites somebody's job description.
  if (!best || bestScore < 0.6) return null;
  return { entry: best, score: Math.round(bestScore * 100) };
}

const asDuration = (mins) => (mins % 60 === 0 ? `${mins / 60} hr` : `${mins} mins`);

/**
 * Apply an entry's defaults, without overwriting anything typed explicitly.
 *
 * `opts.learnedMinutes` is what this kind of work actually measured, from
 * learned.js. Where it exists it wins over the entry's seeded default,
 * because the default is the median of the coordinators' own estimates and
 * this is the median of the real times. It is only ever passed once a kind
 * of work has been measured enough times to be trusted — see learned.js
 * for why that threshold is not optional.
 */
export function applyCatalogue(fields, entry, opts = {}) {
  const out = { ...fields, catalogueId: entry.id, description: entry.label };
  const learned = Number(opts.learnedMinutes);
  const minutes = Number.isFinite(learned) && learned > 0 ? Math.round(learned) : entry.minutes;
  if (!squash(fields.estimatedTime) && minutes) {
    out.estimatedTime = asDuration(minutes);
    if (minutes !== entry.minutes) out.estimateFromMeasured = true;
  }
  if (!fields.crewNeeded && entry.people > 1) out.crewNeeded = entry.people;
  if (!squash(fields.materialDetails) && entry.material) {
    out.materialNeeded = "Y";
    out.materialDetails = entry.material;
  }
  return out;
}

export function newCatalogueEntry(label, opts = {}) {
  return {
    id: canonKey(label).replace(/[^a-z0-9]+/g, "-").slice(0, 40) || `task-${Date.now()}`,
    label: squash(label),
    minutes: opts.minutes || 60,
    people: opts.people || 1,
    trade: opts.trade || "general",
    material: squash(opts.material),
    aliases: [],
    active: true,
    addedBy: opts.by || "",
  };
}
