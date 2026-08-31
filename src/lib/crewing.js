/* ---------------------------------------------------------------------- *
 * crewing.js — how many people a job needs, and which ones.
 *
 * The complaint from the field: a water heater takes two people, one gets
 * assigned, and when they call it in a nearby technician is pulled off his
 * own work to help. Two jobs disrupted, a wasted trip, and the second
 * technician's day rearranged — all because the schedule had no way to say
 * "this is a two-person job".
 *
 * It is not a guess that this happens. In the real workbook:
 *
 *   - water heater work: 7 jobs, 5 crewed with two people and 2 with one
 *   - glass door / mirror work: 11 jobs, 8 of them crewed with one person
 *   - and technicians write the requirement into the task text themselves,
 *     because there is nowhere else to put it: "Door is touching on the
 *     floor need to assign two", "Pending work (Need two person)"
 *
 * So the requirement is read from three places, in order of how much they
 * deserve to be trusted: what a coordinator explicitly set on the job,
 * what somebody wrote in the task text, and failing both, a rule keyed on
 * the kind of work. The rule is always shown with its reason so it can be
 * overruled by anyone who knows better.
 * ---------------------------------------------------------------------- */

import { squash, canonKey } from "./normalize.js";
import { splitCrew } from "./normalize.js";
import { lookupStaff, covers, TRADE_LABEL } from "./staff.js";
import { faultFamily } from "./faultFamily.js";

/* Somebody has already said how many are needed, in words. This outranks
   every rule below — it is a person who saw the job. */
const EXPLICIT_TWO = /\b(need|assign|require)\w*\s+(to\s+assign\s+)?(two|2)\s*(person|people|pax|man|men|tech\w*)?\b|\b(two|2)\s*(person|people|man|men|tech\w*)\s*(needed|required|job)?\b/i;
const EXPLICIT_THREE = /\b(need|assign|require)\w*\s+(three|3)\s*(person|people|man|men|tech\w*)?\b/i;

/* Keyed on the work itself. Each entry names why, because a number with no
   reason attached gets ignored the first time somebody disagrees with it. */
const CREW_RULES = [
  { people: 2, why: "a water heater is a two-person lift",
    match: /\b(water\s*heater|geyser|calorifier)\b/i },
  { people: 2, why: "duct cleaning is always crewed in pairs here",
    match: /\bduct\s*clean|\bac\s*ppm\b|\bindoor\s*unit\s*clean/i },
  { people: 2, why: "glass doors and mirrors need a second pair of hands",
    match: /\b(glass\s*door|shower\s*door|mirror|glass\s*panel)\b.*\b(align|replace|fix|install|hinge)|\b(align|replace|install)\b.*\b(glass\s*door|mirror)\b/i },
  { people: 2, why: "moving furniture single-handed is how people get hurt",
    match: /\b(move|shift|relocat\w*)\b.*\b(bed|sofa|wardrobe|fridge|washing\s*machine|furniture|cabinet)\b/i },
  { people: 2, why: "work at height needs somebody footing the ladder",
    match: /\b(scaffold\w*|at\s*height|false\s*ceiling|access\s*panel)\b/i },
  { people: 2, why: "AC indoor units are handled in pairs",
    match: /\b(fcu|indoor\s*unit|ac\s*unit)\b.*\b(replac\w*|install\w*|remov\w*)/i },
  { people: 2, why: "a full-apartment repaint is a two-person job",
    match: /\bfull\s*apartment\s*paint|\bapartment\s*painting\b/i },
];

/* Which trade the work wants. Multi technicians cover general work; a
   painter is wanted for painting and the pool cleaner for pools. */
/* `strict` separates work that genuinely needs the specialist from work a
   multi technician handles perfectly well. Flagging every paint touch-up
   for want of the painter produced 94 warnings over the real month — noise
   that would train people to ignore the whole panel. Only pool work and a
   full repaint are strict; the rest is a preference the suggester uses and
   the checker stays quiet about. */
const TRADE_RULES = [
  { trade: "pool", why: "pool work needs the pool equipment", strict: true, match: /\bpool\b/i },
  { trade: "painter", why: "a full repaint is the painter's job", strict: true, match: /\bfull\s*apartment\s*paint|\bapartment\s*painting\b/i },
  { trade: "painter", why: "painting", strict: false, match: /\bpaint\w*|touch\s*up\b/i },
  { trade: "carpenter", why: "carpentry", strict: false, match: /\bcarpent\w*|wardrobe|cabinet|door\s*frame|skirting|shelf\b/i },
];

/**
 * What this job needs.
 * @returns {{people:number, trade:string, why:string, source:string}}
 */
export function jobRequirement(job) {
  // 1. Set explicitly on the job by a coordinator.
  const setPeople = Number(job.crewNeeded);
  if (Number.isFinite(setPeople) && setPeople > 0) {
    return {
      people: setPeople,
      trade: squash(job.tradeNeeded) || inferTrade(job).trade,
      why: "set on the job",
      source: "override",
    };
  }

  const text = `${squash(job.description)} ${squash(job.notes)} ${squash(job.pendingDetails)} ${squash(job.stillNeeded)}`;

  // 2. Written into the task text by whoever raised or attended it.
  if (EXPLICIT_THREE.test(text)) {
    return { people: 3, ...inferTrade(job), why: "the task text asks for three people", source: "text" };
  }
  if (EXPLICIT_TWO.test(text)) {
    return { people: 2, ...inferTrade(job), why: "the task text asks for two people", source: "text" };
  }

  // 3. A rule keyed on the kind of work.
  const rule = CREW_RULES.find((r) => r.match.test(text));
  if (rule) return { people: rule.people, ...inferTrade(job), why: rule.why, source: "rule" };

  return { people: 1, ...inferTrade(job), why: "no rule matched — assumed one person", source: "default" };
}

function inferTrade(job) {
  const text = `${squash(job.description)} ${squash(job.notes)}`;
  const t = TRADE_RULES.find((r) => r.match.test(text));
  if (t) return { trade: t.trade, tradeWhy: t.why, tradeStrict: !!t.strict };
  const fam = faultFamily(job.description, job.faultCode);
  if (fam === "pool") return { trade: "pool", tradeWhy: "pool work needs the pool equipment", tradeStrict: true };
  if (fam === "finish") return { trade: "painter", tradeWhy: "paint / finish work", tradeStrict: false };
  return { trade: "general", tradeWhy: "general maintenance", tradeStrict: false };
}

/* ---------------------------------------------------------------------- *
 * Checking who is actually on it.
 *
 * Three failures, in the order they cost money:
 *   short-crewed — the second person gets pulled off other work mid-shift
 *   wrong trade  — a painter's job with nobody who paints on it
 *   no driver    — a crew that cannot physically get to the property
 * -------------------------------------------------------------------- */
export function checkCrew(job, staffIdx, req) {
  const requirement = req || jobRequirement(job);
  const crew = splitCrew(job.team);
  const issues = [];

  if (crew.length === 0) {
    return { requirement, crew, issues: [{ id: "unassigned", tone: "warn", text: "Nobody assigned yet." }], ok: false };
  }

  if (crew.length < requirement.people) {
    issues.push({
      id: "short",
      tone: "bad",
      text: `Needs ${requirement.people} people, ${crew.length} assigned — ${requirement.why}.`,
      short: `needs ${requirement.people}, has ${crew.length}`,
    });
  }

  const members = crew.map((n) => ({ name: n, rec: staffIdx ? lookupStaff(staffIdx, n) : null }));
  const known = members.filter((m) => m.rec);

  if (requirement.trade && requirement.trade !== "general" && requirement.tradeStrict && known.length) {
    const has = known.some((m) => covers(m.rec.trade, requirement.trade));
    if (!has) {
      issues.push({
        id: "trade",
        tone: "warn",
        text: `Wants a ${TRADE_LABEL[requirement.trade] || requirement.trade} (${requirement.tradeWhy}); assigned ${known.map((m) => TRADE_LABEL[m.rec.trade] || m.rec.trade).join(", ")}.`,
        short: `no ${requirement.trade}`,
      });
    }
  }

  /* Only raise this when it is actually true. An unrecorded licence is a
     gap in the staff list, not a dispatch problem, and raising it per job
     put the same warning on 56 jobs because one person's licence was never
     entered. That is surfaced once on the team list instead. */
  let unknownLicence = [];
  if (known.length) {
    const drivers = known.filter((m) => m.rec.licence === true);
    unknownLicence = known.filter((m) => m.rec.licence === null).map((m) => m.name);
    const definitelyNoDriver = drivers.length === 0 && unknownLicence.length === 0;
    if (definitelyNoDriver) {
      issues.push({
        id: "driver",
        tone: "bad",
        text: `Nobody on this crew holds a licence — ${known.map((m) => m.name).join(", ")} cannot get to the property on their own.`,
        short: "no driver",
      });
    }
  }

  return {
    requirement,
    crew,
    members,
    issues,
    unknownLicence,
    ok: issues.length === 0,
    short: crew.length < requirement.people,
  };
}

/** Roll the check across a day, for the board's warning strip. */
export function checkDayCrewing(jobs, staffIdx) {
  const short = [], wrongTrade = [], noDriver = [];
  const licenceGaps = new Set();
  (jobs || []).forEach((j) => {
    if (!j || j._tomb || j.state === "cancelled") return;
    const r = checkCrew(j, staffIdx);
    (r.unknownLicence || []).forEach((n) => licenceGaps.add(n));
    r.issues.forEach((i) => {
      if (i.id === "short") short.push({ job: j, ...r });
      if (i.id === "trade") wrongTrade.push({ job: j, ...r });
      if (i.id === "driver") noDriver.push({ job: j, ...r });
    });
  });
  return {
    short, wrongTrade, noDriver,
    licenceGaps: Array.from(licenceGaps),
    // The hours that get disrupted when the second person is fetched
    // mid-shift: the helper's own day, not just this job's.
    peopleShort: short.reduce((n, s) => n + (s.requirement.people - s.crew.length), 0),
  };
}
