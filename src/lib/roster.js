/* ---------------------------------------------------------------------- *
 * roster.js — who is actually available today.
 *
 * The schedule has always been built against an assumed team. Nothing in
 * the app knew that Riyaz is on his week off, that Faizal is in Fujairah,
 * or that Anthony is the only person reachable between 11pm and 2am. So a
 * job could be assigned to somebody on annual leave and nothing would say
 * a word.
 *
 * Somebody already writes the roster every day, as a message. Rather than
 * ask for it a second time in a form, that message is pasted and parsed —
 * the same approach as the technician's work report, and for the same
 * reason: the data exists, it is the re-keying that does not survive
 * contact with a working day.
 * ---------------------------------------------------------------------- */

import { squash, canonKey, canonTech, splitCrew } from "./normalize.js";

/* Why somebody is not on the board today. "Fujairah" is deliberately not
   an absence — they are working, just not on Dubai jobs, and counting them
   as away would understate the headcount the department is paying for. */
export const AWAY_KINDS = [
  { id: "week_off",   label: "Week off",       match: /^(week\s*off|off|weekly\s*off|rest\s*day)$/i,        counts: false },
  { id: "annual",     label: "Annual leave",   match: /^(annual\s*leave|annual|vacation|leave)$/i,          counts: false },
  { id: "public_hol", label: "Public holiday", match: /^(ph|public\s*holiday|holiday)$/i,                   counts: false },
  { id: "sick",       label: "Sick leave",     match: /^(sick|sick\s*leave|medical)$/i,                     counts: false },
  { id: "emergency",  label: "Emergency leave",match: /^(emergency\s*leave|emergency)$/i,                   counts: false },
  { id: "offsite",    label: "Off-site",       match: /^(fujairah|fujeirah|abu\s*dhabi|sharjah|ras\s*al\s*khaimah|rak|ajman|offsite|off\s*site)$/i, counts: true },
  { id: "training",   label: "Training",       match: /^(training|course)$/i,                               counts: true },
];

export function classifyAway(label) {
  const k = squash(label).replace(/[:\-–—]+$/, "").trim();
  const hit = AWAY_KINDS.find((a) => a.match.test(k));
  if (hit) return { ...hit, raw: k };
  return { id: "other", label: squash(label), counts: false, raw: k };
}

const TIME = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)?";
const RANGE_RE = new RegExp(`^\\s*${TIME}\\s*[-–—to]+\\s*${TIME}\\s*$`, "i");
const RANGE_ANYWHERE = new RegExp(`${TIME}\\s*[-–—]\\s*${TIME}`, "i");
const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/;

function toMin(h, m, ap) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (ap) {
    const p = ap.toLowerCase().startsWith("p");
    if (p && hh < 12) hh += 12;
    if (!p && hh === 12) hh = 0;
  }
  return hh * 60 + mm;
}

function fmt(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "9.00am - 6.00pm" -> { start:540, end:1080, label:"09:00-18:00" } */
export function parseShiftRange(line) {
  const m = squash(line).match(RANGE_ANYWHERE);
  if (!m) return null;
  const start = toMin(m[1], m[2], m[3]);
  let end = toMin(m[4], m[5], m[6]);
  // A shift with no meridiem on the end that lands before the start is the
  // evening: "2.00pm - 11.00pm" is fine, "11.00pm - 2.00am" wraps midnight.
  if (end <= start) end += 24 * 60;
  return { start, end, label: `${fmt(start)}-${fmt(end % (24 * 60))}`, minutes: end - start };
}

/* People lines may be a crew: "Adi, Khaled, Nizar, Shafiq & Bijaya" is five
   people who happen to travel together, and every one of them is a head
   the department is paying for. */
function peopleFrom(line) {
  const note = squash(line).match(/\(([^)]*)\)/);
  const clean = squash(line).replace(/\([^)]*\)/g, "").replace(PHONE_RE, "").trim();
  return {
    names: splitCrew(clean),
    crewLabel: clean,
    note: note ? squash(note[1]) : "",
  };
}

const DATE_RE = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/;
const COORD_HEAD = /coordinator/i;
const STANDBY_HEAD = /stand\s*-?\s*by|emergency\s*tech|on\s*call/i;

/**
 * Parse the daily shift message.
 * @param {string} text
 * @returns {object} roster
 */
export function parseRosterMessage(text) {
  const lines = String(text || "").split(/\r?\n/);
  const roster = {
    date: "", shifts: [], away: [], standby: null, coordinators: [],
    warnings: [], raw: String(text || ""),
  };

  let mode = "techs";       // techs | coordinators
  let current = null;       // the shift block being filled

  const dm = String(text || "").match(DATE_RE);
  if (dm) roster.date = `${dm[3]}-${String(dm[2]).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}`;

  lines.forEach((rawLine) => {
    const line = squash(rawLine.replace(/^\s*[*_~]+|[*_~]+\s*$/g, ""));
    if (!line) return;
    if (/^shift\s*timings?/i.test(line)) return;

    if (COORD_HEAD.test(line) && !RANGE_ANYWHERE.test(line)) {
      mode = "coordinators"; current = null; return;
    }

    /* Standby: the heading carries its own hours, and the person and phone
       usually follow on the next line. */
    if (STANDBY_HEAD.test(line)) {
      const range = parseShiftRange(line);
      const label = squash(line.replace(RANGE_ANYWHERE, "")).replace(/[-–—:]+$/, "").trim();
      const inline = peopleFrom(line.replace(RANGE_ANYWHERE, "").replace(/stand\s*-?\s*by|emergency\s*tech|on\s*call/ig, ""));
      const phone = (line.match(PHONE_RE) || [])[1] || "";
      roster.standby = {
        label: label || "Stand-by",
        range,
        names: inline.names.filter((n) => !/^(stand|by|emergency|tech)$/i.test(n)),
        phone: squash(phone),
      };
      current = "standby";
      return;
    }

    if (mode === "coordinators") {
      // "Haris - 8.00 am - 5.00 pm"
      const range = parseShiftRange(line);
      const name = squash(line.replace(RANGE_ANYWHERE, "").replace(/[-–—]+\s*$/, "").replace(/^[-–—]+/, ""));
      if (name) {
        roster.coordinators.push({ name: canonTech(name), range, raw: line });
      }
      return;
    }

    // "Week off - Riyaz" / "Fujairah -  Faizal"
    const awayM = line.match(/^([A-Za-z][A-Za-z\s]{1,24}?)\s*[-–—:]\s*(.+)$/);
    if (awayM && !RANGE_ANYWHERE.test(line)) {
      const kind = classifyAway(awayM[1]);
      const who = peopleFrom(awayM[2]);
      if (who.names.length) {
        roster.away.push({ kind: kind.id, label: kind.label, counts: kind.counts, names: who.names, raw: line });
        current = null;
        return;
      }
    }

    // A bare time range opens a new shift block.
    if (RANGE_RE.test(line) || (RANGE_ANYWHERE.test(line) && squash(line.replace(RANGE_ANYWHERE, "")).length < 3)) {
      const range = parseShiftRange(line);
      current = { ...range, techs: [], crews: [], raw: line };
      roster.shifts.push(current);
      return;
    }

    // Otherwise it is a person (or a crew) on the open block.
    const who = peopleFrom(line);
    if (!who.names.length) return;
    if (current === "standby") {
      if (roster.standby) {
        roster.standby.names = roster.standby.names.concat(who.names);
        if (!roster.standby.phone) {
          const ph = (line.match(PHONE_RE) || [])[1];
          if (ph) roster.standby.phone = squash(ph);
        }
      }
      return;
    }
    if (!current) {
      roster.warnings.push(`"${line}" is not under any shift heading — ignored.`);
      return;
    }
    who.names.forEach((n) => { if (!current.techs.includes(n)) current.techs.push(n); });
    if (who.names.length > 1) current.crews.push({ label: who.crewLabel, names: who.names });
    if (who.note) current.notes = [...(current.notes || []), `${who.names.join(" & ")}: ${who.note}`];
  });

  if (roster.standby && roster.standby.names.length === 0) {
    roster.warnings.push("A stand-by block was found but nobody is named in it.");
  }
  if (!roster.shifts.length) {
    roster.warnings.push("No shift blocks were found. Each shift needs its own line, e.g. \"9.00am - 6.00pm\", with the names under it.");
  }

  return roster;
}

/* ---------------------------------------------------------------------- *
 * Headcount.
 *
 * "Live" is the number of technicians actually available to take a job
 * today. Somebody in Fujairah is working and is counted; somebody on their
 * week off is not. Both are on the payroll, which is why total is reported
 * beside it — the gap between the two is what a 100%-utilised board is
 * really running on.
 * ---------------------------------------------------------------------- */
export function rosterSummary(roster) {
  if (!roster) return null;
  const onShift = new Set();
  roster.shifts.forEach((s) => s.techs.forEach((t) => onShift.add(t)));
  const standby = new Set((roster.standby && roster.standby.names) || []);

  const awayNotWorking = new Set();
  const awayWorking = new Set();
  roster.away.forEach((a) => a.names.forEach((n) => (a.counts ? awayWorking : awayNotWorking).add(n)));

  const live = new Set([...onShift, ...standby, ...awayWorking]);
  const all = new Set([...live, ...awayNotWorking]);

  return {
    date: roster.date,
    onShift: Array.from(onShift).sort(),
    standby: Array.from(standby),
    offsite: Array.from(awayWorking).sort(),
    unavailable: Array.from(awayNotWorking).sort(),
    liveCount: live.size,
    totalCount: all.size,
    onShiftCount: onShift.size,
    // Capacity actually rostered today, in minutes, ignoring stand-by.
    rosteredMinutes: roster.shifts.reduce((s, sh) => s + sh.techs.length * (sh.minutes || 0), 0),
    shifts: roster.shifts.map((s) => ({ label: s.label, minutes: s.minutes, techs: s.techs })),
    coordinators: roster.coordinators,
    standbyBlock: roster.standby,
    awayBreakdown: roster.away,
  };
}

/** Which shift is this technician on today, if any. */
export function shiftFor(roster, tech) {
  if (!roster) return null;
  const t = canonTech(tech);
  const s = (roster.shifts || []).find((sh) => sh.techs.includes(t));
  return s || null;
}

/* ---------------------------------------------------------------------- *
 * The check the roster exists for: does today's schedule match today's
 * team? Assigning work to somebody on annual leave has always been
 * possible and nothing said a word about it.
 * ---------------------------------------------------------------------- */
export function checkAgainstSchedule(roster, jobs) {
  const summary = rosterSummary(roster);
  if (!summary) return null;

  const unavailable = new Set(summary.unavailable);
  const known = new Set([...summary.onShift, ...summary.standby, ...summary.offsite, ...summary.unavailable]);

  const assignedAway = [];
  const notOnRoster = [];
  const assigned = new Map();

  jobs.forEach((j) => {
    if (!j || j._tomb || j.state === "cancelled") return;
    const crew = splitCrew(j.team);
    if (!crew.length) return;
    crew.forEach((t) => {
      assigned.set(t, (assigned.get(t) || 0) + 1);
      if (unavailable.has(t)) assignedAway.push({ tech: t, job: j, reason: reasonFor(roster, t) });
      else if (!known.has(t)) notOnRoster.push({ tech: t, job: j });
    });
  });

  const idle = summary.onShift.filter((t) => !assigned.has(t));

  return {
    summary,
    assignedAway,
    assignedAwayTechs: Array.from(new Set(assignedAway.map((x) => x.tech))),
    notOnRoster,
    notOnRosterTechs: Array.from(new Set(notOnRoster.map((x) => x.tech))),
    idle,
    assignedCount: assigned.size,
  };
}

function reasonFor(roster, tech) {
  const a = (roster.away || []).find((x) => x.names.includes(tech));
  return a ? a.label : "not available";
}
