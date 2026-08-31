/* ---------------------------------------------------------------------- *
 * schedule.js — the scheduling method, written down.
 *
 * Until now each coordinator built the day their own way and only
 * confirmed commitments were reliably honoured, so two people given the
 * same jobs produced different days and neither could say why. The rule the
 * department settled on is:
 *
 *      1. confirmed appointment
 *      2. P1
 *      3. batch by building
 *
 * Read carefully, those three do different kinds of work:
 *
 *   - A confirmed appointment is not "first", it is FIXED. A guest who
 *     agreed to 3-4pm is not served by arriving at 9am. Appointments are
 *     anchors that pin the timeline; everything else fills around them.
 *   - P1 is a true priority: it takes the earliest time still available.
 *   - Batching is an ordering preference for everything left, chosen to cut
 *     the number of building-to-building trips.
 *
 * A fourth consideration sits below all three and is NOT part of the stated
 * rule: a job with a stated time whose guest has not confirmed. Ignoring it
 * would put a job at 09:00 that somebody said 16:00 for, so it is treated
 * as a preference, applied only after P1 and only where a gap allows. It is
 * labelled differently everywhere it appears so it is never confused with a
 * real appointment.
 *
 * The output is a timeline with a reason on every line, so a coordinator
 * can see why the order is what it is and overrule it knowingly.
 * ---------------------------------------------------------------------- */

import {
  squash, canonKey, canonProperty, displayProperty, parseDurationMinutes,
  parseShiftMinutes, canonPriority, parseYN, splitCrew, canonTech,
} from "./normalize.js";

/* Which kinds of work each trade can take. Mirrors staff.js; kept here as
   a plain constant so the scheduler has no import cycle with the staff
   module. */
const TRADE_COVERAGE = {
  multi_tech: ["multi_tech", "general"],
  supervisor: ["supervisor", "multi_tech", "general"],
  pool: ["pool", "general"],
  painter: ["painter", "general"],
  carpenter: ["carpenter", "general"],
  helper: ["general"],
};

export const PLAN_DEFAULTS = {
  shiftStartMin: 9 * 60,     // used when the shift string cannot be read
  shiftEndMin: 18 * 60,
  travelMinutes: 30,         // per building change
  defaultJobMinutes: 60,     // when no estimate was given
};

/* ------------------------- reading the clock -------------------------- *
 * 97 distinct spellings in the real workbook. Everything here is driven by
 * a value that actually appears in it: "3-4pm", "4 - 5 Pm", "12.30pm",
 * "16:00:00", "Sharp 12.00", "1.30-2.30pm", "Before 2.00 Pm", "after 2pm",
 * "Not Confirmed", "Any time", "Onb".
 * -------------------------------------------------------------------- */

const NO_TIME = /^(not\s*confirmed|any\s*time|tbc|tbd|onb|check\s*-?\s*out|check\s*-?\s*in|n\/?a|-+)$/i;

function toMinutes(h, m, ampm) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (ampm) {
    const p = ampm.toLowerCase().startsWith("p");
    if (p && hh < 12) hh += 12;
    if (!p && hh === 12) hh = 0;
  }
  return hh * 60 + mm;
}

/* An hour written without am/pm, or written as "12.00am" when they plainly
   mean midday, lands outside the working shift. Nudging it by twelve hours
   when that puts it inside is a guess, but a much better one than leaving a
   pool clean scheduled for one in the morning. Flagged as `assumed` so the
   UI can say so. */
function fitToShift(min, shiftStart, shiftEnd) {
  if (min == null) return { min, assumed: false };
  if (min >= shiftStart && min <= shiftEnd) return { min, assumed: false };
  for (const shift of [12 * 60, -12 * 60]) {
    const alt = min + shift;
    if (alt >= shiftStart && alt <= shiftEnd) return { min: alt, assumed: true };
  }
  return { min, assumed: false };
}

/**
 * @returns {{start:number|null,end:number|null,kind:string,assumed:boolean}|null}
 */
export function parseTimeWindow(raw, shiftStart = PLAN_DEFAULTS.shiftStartMin, shiftEnd = PLAN_DEFAULTS.shiftEndMin) {
  const s = squash(raw);
  if (!s || NO_TIME.test(canonKey(s))) return null;

  const T = "(\\d{1,2})(?:[:.](\\d{2}))?(?::\\d{2})?\\s*(am|pm)?";

  // A range: "3-4pm", "4 - 5 Pm", "1.30-2.30pm", "11 - 12 Pm"
  const range = s.match(new RegExp(`${T}\\s*[-–—]\\s*${T}`, "i"));
  if (range) {
    const [, h1, m1, ap1, h2, m2, ap2] = range;
    // "3-4pm" puts the meridiem only on the end; it governs both.
    const ap = ap1 || ap2;
    const a = fitToShift(toMinutes(h1, m1, ap), shiftStart, shiftEnd);
    const b = fitToShift(toMinutes(h2, m2, ap2 || ap), shiftStart, shiftEnd);
    let start = a.min, end = b.min;
    if (end <= start) end = start + 60;
    return { start, end, kind: "range", assumed: a.assumed || b.assumed };
  }

  const before = s.match(new RegExp(`\\bbefore\\b\\s*${T}`, "i"));
  if (before) {
    const e = fitToShift(toMinutes(before[1], before[2], before[3]), shiftStart, shiftEnd);
    return { start: null, end: e.min, kind: "before", assumed: e.assumed };
  }

  const after = s.match(new RegExp(`\\bafter\\b\\s*${T}`, "i"));
  if (after) {
    const a = fitToShift(toMinutes(after[1], after[2], after[3]), shiftStart, shiftEnd);
    return { start: a.min, end: null, kind: "after", assumed: a.assumed };
  }

  // A single time: "12.30pm", "16:00:00", "Sharp 12.00", "11.00am"
  const point = s.match(new RegExp(T, "i"));
  if (point && point[1] !== undefined) {
    const p = fitToShift(toMinutes(point[1], point[2], point[3]), shiftStart, shiftEnd);
    if (p.min == null || Number.isNaN(p.min)) return null;
    return { start: p.min, end: p.min + 60, kind: "point", assumed: p.assumed };
  }
  return null;
}

export function fmtClock(min) {
  if (min == null) return "—";
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`;
}

/* --------------------------- classification --------------------------- */

/** Rule 1. A guest has agreed to a time — this is a commitment, not a preference. */
export function isConfirmedAppointment(job, shiftStart, shiftEnd) {
  const w = parseTimeWindow(job.timeOfVisit, shiftStart, shiftEnd);
  // A window with no start ("before 2pm") is a deadline, not a fixed time.
  // Anchoring on it produced lines reading "confirmed with the guest for —".
  return parseYN(job.guestConfirmed) === true && !!w && w.start != null;
}

/** Rule 2. */
export function isP1(job) {
  return canonPriority(job.priority) === "PRI-1";
}

export const PLAN_CLASS = {
  appointment: { label: "Confirmed appointment", rank: 1 },
  p1:          { label: "P1 urgent", rank: 2 },
  timed:       { label: "Time requested, not confirmed", rank: 3 },
  batched:     { label: "Batched by building", rank: 4 },
};

export function classify(job, shiftStart, shiftEnd) {
  if (isConfirmedAppointment(job, shiftStart, shiftEnd)) return "appointment";
  if (isP1(job)) return "p1";
  const w = parseTimeWindow(job.timeOfVisit, shiftStart, shiftEnd);
  // Only a stated START is a time preference. A "before 2pm" deadline goes
  // into the batched pool, where it is ordered early rather than pinned.
  if (w && w.start != null) return "timed";
  return "batched";
}

/* ------------------------------ the plan ------------------------------ */

function shiftBounds(jobs, opts) {
  const withShift = jobs.find((j) => parseShiftMinutes(j.shift));
  const s = squash(withShift && withShift.shift);
  const m = s.match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return { start: opts.shiftStartMin, end: opts.shiftEndMin };
  const start = +m[1] * 60 + +m[2];
  let end = +m[3] * 60 + +m[4];
  if (end <= start) end += 24 * 60;
  return { start, end };
}

/**
 * Build one technician's day.
 * @param {Array} jobs   the jobs assigned to that technician on that date
 * @param {object} options
 * @returns {{items:Array, overflow:Array, conflicts:Array, ...}}
 */
export function planDay(jobs, options = {}) {
  const o = { ...PLAN_DEFAULTS, ...options };
  const live = jobs.filter((j) => j && j.state !== "cancelled" && j.state !== "done" || !j.state);
  const all = jobs.filter((j) => j && j.state !== "cancelled");
  const { start: shiftStart, end: shiftEnd } = shiftBounds(all, o);

  const enrich = (j) => {
    const win = parseTimeWindow(j.timeOfVisit, shiftStart, shiftEnd);
    return {
      job: j,
      minutes: parseDurationMinutes(j.estimatedTime) ?? o.defaultJobMinutes,
      estimated: parseDurationMinutes(j.estimatedTime) != null,
      window: win,
      building: canonProperty(j.property) || "(no building)",
      cls: classify(j, shiftStart, shiftEnd),
    };
  };

  const pool = all.map(enrich);

  /* --- rule 1: anchors ------------------------------------------------ */
  const anchors = pool
    .filter((p) => p.cls === "appointment")
    .sort((a, b) => a.window.start - b.window.start);

  const conflicts = [];
  const placed = [];
  let cursorAfterAnchor = shiftStart;
  anchors.forEach((a) => {
    if (a.window.start < shiftStart || a.window.start + a.minutes > shiftEnd) {
      conflicts.push({
        job: a.job,
        kind: "outside-shift",
        message: `Confirmed with the guest for ${fmtClock(a.window.start)}, which is outside this shift (${fmtClock(shiftStart)}–${fmtClock(shiftEnd)}). Either the guest or the roster has to give.`,
      });
    }
    const start = Math.max(a.window.start, cursorAfterAnchor);
    if (start > a.window.start && a.window.start >= shiftStart) {
      conflicts.push({
        job: a.job,
        kind: "appointment-overlap",
        message: `Two confirmed appointments collide: this one is promised for ${fmtClock(a.window.start)} but the previous does not finish until ${fmtClock(cursorAfterAnchor)}.`,
      });
    }
    const end = start + a.minutes;
    placed.push({ ...a, start, end, anchored: true, reason: `Confirmed with the guest for ${fmtClock(a.window.start)}` });
    cursorAfterAnchor = end;
  });

  /* --- gaps between the anchors --------------------------------------- */
  const gaps = [];
  let cur = shiftStart;
  placed.slice().sort((x, y) => x.start - y.start).forEach((p) => {
    if (p.start > cur) gaps.push({ from: cur, to: p.start });
    cur = Math.max(cur, p.end);
  });
  if (cur < shiftEnd) gaps.push({ from: cur, to: shiftEnd });

  /* --- rules 2, 3 and the soft preference ----------------------------- */
  const p1s = pool.filter((p) => p.cls === "p1")
    // A job already pushed several times goes earliest among equals: it is
    // the one most at risk of being deferred yet again.
    .sort((a, b) => (b.job.pushCount || 0) - (a.job.pushCount || 0) || a.minutes - b.minutes);
  const timed = pool.filter((p) => p.cls === "timed")
    .sort((a, b) => (a.window.start ?? 0) - (b.window.start ?? 0));
  const batched = pool.filter((p) => p.cls === "batched");

  // Building sizes drive the batching: work through the building with the
  // most left to do, so trips are not spent returning to it later.
  const buildingLoad = new Map();
  batched.forEach((p) => buildingLoad.set(p.building, (buildingLoad.get(p.building) || 0) + p.minutes));

  const remaining = { p1s: [...p1s], timed: [...timed], batched: [...batched] };
  const overflow = [];

  /* Pick the best item that fits entirely before `horizon`, honouring the
     precedence: P1 first, then batched work, preferring the building we are
     already standing in. Returns null when nothing fits, which is the
     signal to jump forward to the next requested time. */
  function pickFitting(currentBuilding, from, horizon) {
    const room = horizon - from;
    const fits = (p) => {
      const travel = currentBuilding && p.building !== currentBuilding ? o.travelMinutes : 0;
      return p.minutes + travel <= room;
    };
    // Rule 2 outranks everything that is not a confirmed appointment.
    const p1Same = remaining.p1s.findIndex((p) => p.building === currentBuilding && fits(p));
    if (p1Same >= 0) return { list: "p1s", idx: p1Same };
    const p1Any = remaining.p1s.findIndex(fits);
    if (p1Any >= 0) return { list: "p1s", idx: p1Any };
    // Rule 3: stay in this building while it still has work, otherwise move
    // to whichever building has the most left, so the trip is worth taking.
    const bSame = remaining.batched.findIndex((p) => p.building === currentBuilding && fits(p));
    if (bSame >= 0) return { list: "batched", idx: bSame };
    let best = -1, bestLoad = -1;
    remaining.batched.forEach((p, i) => {
      if (!fits(p)) return;
      const load = buildingLoad.get(p.building) || 0;
      if (load > bestLoad) { bestLoad = load; best = i; }
    });
    if (best >= 0) return { list: "batched", idx: best };
    return null;
  }

  function place(item, list, idx, from, currentBuilding, requestedStart) {
    const travel = currentBuilding && item.building !== currentBuilding ? o.travelMinutes : 0;
    const start = requestedStart != null ? Math.max(from + travel, requestedStart) : from + travel;
    const end = start + item.minutes;
    remaining[list].splice(idx, 1);
    placed.push({
      ...item,
      start, end, anchored: false, travelBefore: travel,
      reason:
        list === "p1s" ? "P1 — earliest time still free"
        : list === "timed" ? `Placed at the ${fmtClock(item.window.start)} the guest asked for, though it is not confirmed`
        : travel ? `Batched — trip to ${displayProperty(item.job.property)}`
        : `Batched — already at ${displayProperty(item.job.property)}`,
    });
    return end;
  }

  let currentBuilding = null;
  gaps.forEach((gap) => {
    let t = gap.from;
    const prev = placed.filter((p) => p.end <= gap.from).sort((a, b) => b.end - a.end)[0];
    if (prev) currentBuilding = prev.building;

    /* A requested time that cannot be honoured in this gap must not block
       the gap. An earlier version returned to the top of the loop, found
       the same unplaceable job again, and gave up — abandoning a three-hour
       window with a P1 still waiting for it. Once a timed job has been
       tried here and does not fit, it is set aside for this gap and the
       remaining space is filled with real work. */
    const setAside = new Set();

    for (;;) {
      if (gap.to - t <= 0) break;

      const timedIdx = remaining.timed.findIndex(
        (p) => !setAside.has(p) && p.window.start != null &&
               p.window.start >= t && p.window.start < gap.to
      );
      const nextTimed = timedIdx >= 0 ? remaining.timed[timedIdx] : null;
      const horizon = nextTimed ? nextTimed.window.start : gap.to;

      const pick = pickFitting(currentBuilding, t, horizon);
      if (pick) {
        const item = remaining[pick.list][pick.idx];
        t = place(item, pick.list, pick.idx, t, currentBuilding);
        currentBuilding = item.building;
        continue;
      }

      if (nextTimed) {
        const travel = currentBuilding && nextTimed.building !== currentBuilding ? o.travelMinutes : 0;
        const start = Math.max(t + travel, nextTimed.window.start);
        if (start + nextTimed.minutes <= gap.to) {
          t = place(nextTimed, "timed", timedIdx, t, currentBuilding, nextTimed.window.start);
          currentBuilding = nextTimed.building;
          continue;
        }
        // Will not fit at the time asked for; stop letting it hold the gap.
        setAside.add(nextTimed);
        continue;
      }

      // Nothing requested a time here and nothing fits before the gap ends.
      const fill = pickFitting(currentBuilding, t, gap.to);
      if (!fill) break;
      const item = remaining[fill.list][fill.idx];
      t = place(item, fill.list, fill.idx, t, currentBuilding);
      currentBuilding = item.building;
    }
  });

  // Anything with a requested time that never found a home, plus leftovers.
  /* --- what did not fit ------------------------------------------------ *
   * Ordered by what the rule says to shed first: batched work before timed,
   * timed before P1. Within a tier, a job that has already been pushed
   * repeatedly is listed LAST — pushing it again is how jobs used to
   * disappear, so the plan does not casually nominate it. */
  const tierRank = { batched: 0, timed: 1, p1s: 2 };
  ["batched", "timed", "p1s"].forEach((list) => {
    remaining[list].forEach((p) => overflow.push({ ...p, tier: list, tierRank: tierRank[list] }));
  });
  overflow.sort((a, b) =>
    a.tierRank - b.tierRank ||
    (a.job.pushCount || 0) - (b.job.pushCount || 0) ||
    b.minutes - a.minutes
  );

  placed.sort((a, b) => a.start - b.start);

  const buildingSwitches = placed.reduce((n, p, i) =>
    n + (i > 0 && p.building !== placed[i - 1].building ? 1 : 0), 0);
  const workMinutes = placed.reduce((s, p) => s + p.minutes, 0);
  const travelMinutes = placed.reduce((s, p) => s + (p.travelBefore || 0), 0);

  return {
    items: placed,
    overflow,
    conflicts,
    shiftStart, shiftEnd,
    finishAt: placed.length ? placed[placed.length - 1].end : shiftStart,
    workMinutes, travelMinutes,
    committedMinutes: workMinutes + travelMinutes,
    availableMinutes: shiftEnd - shiftStart,
    buildingSwitches,
    unestimated: pool.filter((p) => !p.estimated).length,
  };
}

/* ---------------------- suggesting a technician ----------------------- *
 * The same precedence, applied at the moment a job is assigned rather than
 * ordered. Ranked, with the reason shown, because a suggestion a
 * coordinator cannot interrogate is one they will ignore.
 * -------------------------------------------------------------------- */
export function suggestTechnician(job, dayJobs, options = {}) {
  const o = { ...PLAN_DEFAULTS, ...options };
  const staffIdx = options.staffIdx || null;
  const requirement = options.requirement || null;
  const building = canonProperty(job.property);
  const jobMins = parseDurationMinutes(job.estimatedTime) ?? o.defaultJobMinutes;
  const win = parseTimeWindow(job.timeOfVisit);

  /* Candidates are everyone rostered today, not only those who already
     have work. Building the list from the schedule alone meant the painter
     could never be suggested for a painting job unless somebody had
     already given him one — the empty diary made him invisible exactly
     when he was the right answer. */
  const byTech = new Map();
  (options.candidates || []).forEach((t) => {
    const name = canonTech(t);
    if (name) byTech.set(name, []);
  });
  dayJobs.forEach((j) => {
    if (!j || j._tomb || j.state === "cancelled") return;
    splitCrew(j.team).forEach((t) => {
      if (!byTech.has(t)) byTech.set(t, []);
      byTech.get(t).push(j);
    });
  });

  const out = [];
  byTech.forEach((list, tech) => {
    const plan = planDay(list, o);
    const room = plan.availableMinutes - plan.committedMinutes;
    const goesThere = list.length > 0 && list.some((j) => canonProperty(j.property) === building);
    const coversWindow = !win || !win.start ||
      (win.start >= plan.shiftStart && win.start + jobMins <= plan.shiftEnd);

    let score = 0;
    const why = [];
    const rec = staffIdx ? staffIdx.get(tech) : null;

    /* Trade and licence are properties of the person, not of their diary,
       and they decide whether an assignment is possible rather than merely
       convenient. A pool needs the pool cleaner's equipment; somebody who
       cannot drive needs a colleague who can; somebody based in Fujairah
       is not a candidate for a Dubai job. */
    if (rec && requirement && requirement.trade && requirement.trade !== "general") {
      const list = TRADE_COVERAGE[rec.trade] || [];
      if (list.includes(requirement.trade)) {
        score += 35;
        why.push(`is the ${String(rec.trade).replace("_", " ")}`);
      } else if (requirement.tradeStrict) {
        score -= 60;
        why.push(`not a ${String(requirement.trade).replace("_", " ")}`);
      }
    }
    if (rec && rec.licence === false) { score -= 15; why.push("cannot drive"); }
    if (rec && rec.base && rec.base !== "Dubai") { score -= 40; why.push(`based in ${rec.base}`); }

    if (goesThere) { score += 50; why.push(`already at ${displayProperty(job.property)} today`); }
    if (room >= jobMins + (goesThere ? 0 : o.travelMinutes)) {
      score += 30; why.push(`${Math.round(room / 60 * 10) / 10}h still free`);
    } else {
      score -= 40; why.push(`would go ${Math.round((jobMins - room) / 60 * 10) / 10}h over shift`);
    }
    if (coversWindow) score += 10;
    else why.push("shift does not cover the requested time");
    // Spread the urgent work rather than stacking it on one person.
    const p1count = list.filter(isP1).length;
    score -= p1count * 4;
    if (p1count) why.push(`already has ${p1count} P1`);

    if (list.length === 0) { score += 12; why.push("nothing scheduled yet"); }
    out.push({
      tech, score, why, room,
      loadPct: Math.round((plan.committedMinutes / plan.availableMinutes) * 100),
      goesThere, coversWindow, jobsToday: list.length,
    });
  });

  return out.sort((a, b) => b.score - a.score);
}
