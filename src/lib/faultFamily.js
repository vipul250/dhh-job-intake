/* ---------------------------------------------------------------------- *
 * faultFamily.js — what kind of work is this, and why is it back?
 *
 * Two separate questions that the rework numbers need answered.
 *
 * The FAMILY (AC, plumbing, electrical…) is inferred from the task text.
 * It is what makes "we keep going back to Palm Villa" answerable as "for
 * AC, four times" rather than as a list of forty descriptions.
 *
 * The RETURN REASON cannot be inferred and is not guessed at. Whether a
 * fix failed, or a part failed, or the job was always going to take three
 * visits, is a judgement only the person scheduling it can make. So the
 * board asks — once, at the moment it spots a repeat — and the answer is
 * one click.
 * ---------------------------------------------------------------------- */

import { canonKey } from "./normalize.js";

/* Ordered: the first family whose pattern matches wins, so a specific
   symptom beats a generic verb. "AC not cooling" is HVAC, not "not
   working". Patterns come from the task descriptions in the real workbook. */
export const FAULT_FAMILIES = [
  /* Explicit hardware nouns come first. Without this, "shower door hinges
     need replacing" lands in Plumbing because "shower" matches before
     "hinge" does — and a hinge is a hinge whichever room it is in. */
  ["door", "Door / lock / hardware", /\b(hinge\w*|door\s*handle|handle\s*(?:is|need|broken)|latch|door\s*closer|roller|sliding\s*track|smart\s*lock|door\s*lock|main\s*door|glass\s*door)\b/],
  ["hvac", "AC / HVAC", /\b(a\/?c\b|air\s*con\w*|hvac|fcu|thermostat|chiller|duct|compressor|condenser|coil|not\s+cooling|cooling\s+issue|ac\s+ppm|air\s*flow|filter)\b/],
  ["plumbing", "Plumbing / water", /\b(leak\w*|drip\w*|water|plumb\w*|drain\w*|clog\w*|blocked?|shattaf|flush|toilet|wc\b|sink|tap|faucet|mixer|shower|bath\s*tub|bathtub|geyser|water\s*heater|angle\s*valve|trap|pipe|sewer|smell.*drain|drain.*smell)\b/],
  ["electrical", "Electrical", /\b(light\w*|bulb|downlight|spot\s*light|electric\w*|socket|switch\w*|power|tripp\w*|breaker|db\s*box|wiring|flicker\w*|short\s*circuit|no\s+electricity|circuit)\b/],
  ["appliance", "Appliance", /\b(fridge|refrigerator|washing\s*machine|dryer|dishwasher|oven|microwave|micro\s*oven|hob|cooker|stove|kettle|tv\b|television|extractor|hood)\b/],
  ["door", "Door / lock / hardware", /\b(door|lock\w*|hinge\w*|handle|latch|smart\s*lock|key\b|access\s*card|closer|sliding|track|window|fly\s*net|mesh|mosquito)\b/],
  ["finish", "Paint / finish / carpentry", /\b(paint\w*|touch\s*up|silicon\w*|sealant|gypsum|ceiling|wall|putty|plaster|tile\w*|grout|carpent\w*|wardrobe|cabinet|shelf|skirting|polish\w*)\b/],
  ["pool", "Pool / outdoor", /\b(pool|jacuzzi|garden|landscap\w*|barbecue|bbq|terrace|balcony\s*floor|irrigation)\b/],
  ["furniture", "Furniture / fittings", /\b(furniture|chair|table|bed\b|sofa|mirror|curtain\w*|blind\w*|mattress|drawer|stand\b)\b/],
  ["inspection", "Inspection / handover", /\b(inspect\w*|handover|snag\w*|survey|check\s+the\s+condition|onboard\w*|preparation)\b/],
  ["logistics", "Logistics / access", /\b(pick\s*(?:and|&|\/)?\s*drop|deliver\w*|collect\w*|warehouse|transport|qr\s*code|move\s+the)\b/],
];

export const FAMILY_LABEL = Object.fromEntries(
  FAULT_FAMILIES.map(([k, label]) => [k, label]).concat([["other", "Not classified from the task text"]])
);

export function faultFamily(description, faultCode) {
  const s = canonKey(`${description || ""} ${faultCode || ""}`);
  if (!s) return "other";
  for (const [key, , re] of FAULT_FAMILIES) if (re.test(s)) return key;
  return "other";
}

/* ---------------------------------------------------------------------- *
 * Why is this job back?
 *
 * The distinction that matters commercially: the first three are OUR
 * problem and cost money we should not be spending. The rest are not
 * failures at all, and lumping them together is how a rework rate ends up
 * meaning nothing.
 * ---------------------------------------------------------------------- */
export const RETURN_REASONS = [
  { id: "fix-failed",     label: "First fix did not hold",              ours: true,  hint: "Same fault, came back" },
  { id: "wrong-diagnosis",label: "Wrong diagnosis first time",          ours: true,  hint: "Fixed the wrong thing" },
  { id: "no-material",    label: "Right part was not on the van",       ours: true,  hint: "Had to come back with it" },
  { id: "no-access",      label: "No access on the earlier visit",      ours: false, hint: "Never got in" },
  { id: "staged",         label: "Planned continuation of the same job",ours: false, hint: "Always going to take more than one visit" },
  { id: "deeper-issue",   label: "Underlying issue — needs contractor", ours: false, hint: "Beyond a maintenance visit" },
  { id: "different",      label: "Different fault, same unit",          ours: false, hint: "Unrelated to the last visit" },
  { id: "recurring",      label: "Recurring service (PPM)",             ours: false, hint: "Supposed to come back" },
  { id: "guest-damage",   label: "New damage / guest misuse",           ours: false, hint: "Not a maintenance failure" },
];

export const RETURN_REASON_LABEL = Object.fromEntries(RETURN_REASONS.map((r) => [r.id, r.label]));
export const OUR_FAULT_REASONS = RETURN_REASONS.filter((r) => r.ours).map((r) => r.id);

export function isOurFault(reasonId) {
  return OUR_FAULT_REASONS.includes(reasonId);
}
