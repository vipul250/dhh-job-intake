/* ---------------------------------------------------------------------- *
 * workReport.js — read the technician's PMS write-up instead of retyping it.
 *
 * The technicians already file a structured report. Two real examples from
 * the PMS, verbatim:
 *
 *     5242 Tower 1 205
 *     Arrived @ 7:58pm
 *     Finished @ 8:40pm
 *     - water leakage in kitchen ceiling came from the fcu drain pan.
 *     - manually declogged clean and removed all dirt in drain and coil.
 *     - all water goes to drain pipe now,
 *
 *     Maintenance Work Report
 *     Time Details:
 *     - Arrival Time: 10:40 AM
 *     - Departure Time: 3:10 PM
 *     Issue / Inspection:
 *     The cold-water line copper pipe was found damaged...
 *     Material Required:
 *     - 28 mm copper pipe – 2 meters
 *     - 28 mm copper union – 2 pieces
 *
 * Everything the app needs is in there: how long the visit took, what was
 * found, and what is still required. Asking a coordinator to re-key that
 * into a form is how the follow-up gets lost — so the report is pasted and
 * parsed instead.
 *
 * The second example is the case this whole build exists for. Its PMS
 * status is "Done". Nothing is fixed. The pipe still needs replacing, and
 * the report says it "had been repaired multiple times previously".
 * ---------------------------------------------------------------------- */

import { squash } from "./normalize.js";

const TIME = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)?";

function toMinutes(h, m, ap) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (ap) {
    const p = ap.toLowerCase().startsWith("p");
    if (p && hh < 12) hh += 12;
    if (!p && hh === 12) hh = 0;
  } else if (hh <= 7) {
    // A maintenance visit at "3:10" is the afternoon, not before dawn.
    hh += 12;
  }
  return hh * 60 + mm;
}

const ARRIVE_RE = new RegExp(`\\b(?:arriv\\w*|reach\\w*|start\\w*|in)\\b[^\\d\\n]{0,20}${TIME}`, "i");
const DEPART_RE = new RegExp(`\\b(?:depart\\w*|finish\\w*|complet\\w*|left|leave|out|end\\w*)\\b[^\\d\\n]{0,20}${TIME}`, "i");

/* A "material required" block, in any of the spellings seen in the wild. */
const MATERIAL_HEAD = /^\s*(?:material|materials)\s*(?:required|needed|list)?\s*[:\-]?\s*$/i;
const SECTION_HEAD = /^\s*(?:issue|inspection|issue\s*\/\s*inspection|findings?|work\s*done|action|remarks?|time\s*details?|maintenance\s*work\s*report|recommendation)s?\s*[:\-]?\s*$/i;
const BULLET = /^\s*[-•*–—]\s*/;

/* Phrases a technician uses when the job is contained rather than
   finished. Used only to SUGGEST an outcome — never to set one. */
const CONTAINED = /\b(temporar\w*|for now|closed the valve|valve closed|isolated|shut(?:\s*off)?|turned off the|stopped the leak|arranged temporar\w*|as a temporary|until (?:the )?(?:material|part|quotation))\b/i;
const NEEDS_MORE = /\b(pending|need(?:s|ed)? to be (?:replaced|fixed|done)|require\w*|to be replaced|needs? replacement|further repair|quotation|contractor|third party|3rd party|not (?:yet )?(?:available|possible)|material required)\b/i;

/**
 * @param {string} text  the technician's report, pasted from PMS
 * @returns {{
 *   arrivalMin:number|null, departureMin:number|null, minutes:number|null,
 *   materials:string[], findings:string[],
 *   suggestedOutcome:"fixed"|"made_safe"|"diagnosed"|null,
 *   why:string
 * }}
 */
export function parseWorkReport(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));

  let arrivalMin = null, departureMin = null;
  lines.forEach((l) => {
    if (arrivalMin == null) {
      const m = l.match(ARRIVE_RE);
      if (m) arrivalMin = toMinutes(m[1], m[2], m[3]);
    }
    if (departureMin == null) {
      const m = l.match(DEPART_RE);
      if (m) departureMin = toMinutes(m[1], m[2], m[3]);
    }
  });

  let minutes = null;
  if (arrivalMin != null && departureMin != null) {
    let d = departureMin - arrivalMin;
    if (d < 0) d += 24 * 60;                 // crossed midnight
    if (d > 0 && d <= 12 * 60) minutes = d;  // anything longer is a typo, not a visit
  }

  /* Pull the material block: everything bulleted under a "Material
     required" heading, until the next heading or a blank run. */
  const materials = [];
  let inMaterials = false;
  lines.forEach((l) => {
    const t = squash(l);
    if (MATERIAL_HEAD.test(l)) { inMaterials = true; return; }
    if (inMaterials) {
      if (!t) return;
      if (SECTION_HEAD.test(l)) { inMaterials = false; return; }
      if (BULLET.test(l)) { materials.push(squash(l.replace(BULLET, ""))); return; }
      // A non-bulleted sentence ends the list rather than joining it.
      inMaterials = false;
    }
  });

  // Material named inline, e.g. "Material Required: 2m copper pipe"
  const inline = raw.match(/material[s]?\s*(?:required|needed)?\s*[:\-]\s*([^\n]+)/i);
  if (!materials.length && inline && squash(inline[1])) materials.push(squash(inline[1]));

  /* Findings come as bullets in one technician's style and as a paragraph
     under "Issue / Inspection:" in another's. Both are read, because the
     follow-up job's scope is written from them and losing the paragraph
     form would drop exactly the reports that matter most — the ones
     describing why the work is not finished. */
  const findings = [];
  let inNarrative = false;
  lines.forEach((l) => {
    const t = squash(l);
    if (MATERIAL_HEAD.test(l)) { inNarrative = false; return; }
    if (SECTION_HEAD.test(l)) {
      inNarrative = /issue|inspection|finding|work\s*done|remark|recommendation/i.test(l);
      return;
    }
    if (BULLET.test(l)) {
      const b = squash(l.replace(BULLET, ""));
      if (b && !materials.includes(b) && !/^(arrival|departure)\b/i.test(b)) findings.push(b);
      return;
    }
    if (inNarrative && t && t.length > 12) findings.push(t);
  });

  /* Suggest, do not decide. The technician's words are evidence; the
     person closing the job makes the call. */
  let suggestedOutcome = null;
  let why = "";
  const body = raw;
  if (CONTAINED.test(body)) {
    suggestedOutcome = "made_safe";
    why = "the report describes a temporary measure";
  } else if (materials.length || NEEDS_MORE.test(body)) {
    suggestedOutcome = "diagnosed";
    why = materials.length
      ? "the report lists material that is still required"
      : "the report describes work still outstanding";
  } else if (minutes != null) {
    suggestedOutcome = "fixed";
    why = "the report describes completed work and no outstanding material";
  }

  /* What is still NEEDED is not the same as what was FOUND. "Guest
     reported a water leak" describes the problem; "water heater is damaged
     and needs replacement" describes the return visit. Prefilling the
     follow-up with the first produces a job that restates the complaint
     and names no work, so the forward-looking lines are preferred and the
     descriptive ones are only a fallback. */
  const outstanding = findings.filter((f) => NEEDS_MORE.test(f) || /\bneed\w*\b/i.test(f));
  const stillNeeded = materials.length
    ? materials.join(", ")
    : (outstanding.length ? outstanding.join(" ") : "");

  return {
    arrivalMin, departureMin, minutes,
    materials, findings, outstanding, stillNeeded,
    suggestedOutcome, why,
    // Free-text summary for the outcome note.
    summary: findings.slice(0, 4).join("; "),
  };
}

export function fmtMin(min) {
  if (min == null) return "—";
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`;
}
