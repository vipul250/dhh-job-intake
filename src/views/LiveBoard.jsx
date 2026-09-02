import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, Play, Check, X, ArrowRight, Clipboard, History, AlertTriangle,
  Loader2, RefreshCw, ChevronDown, ChevronRight, Users, CircleDot, Ban,
  CalendarClock, Wand2, Pin, Moon, ShieldAlert, CornerDownRight, FileText,
  Lock, Unlock, ClipboardPaste, ListChecks,
} from "lucide-react";
import {
  newJob, moveJob, setState as setJobState, applyEdit, withEvent,
  isTombstone, liveJobs, tombstones, jobMinutes, isOpen, pushSeverity,
  needsGuestConfirm, pmsText, parseQuickAdd, splitQuickAddLines, findReturn,
  actualDuration, makeFollowUp, needsFollowUp, isResolved,
  STATE_META, NOT_DONE_REASONS, MOVE_REASONS, MOVE_REASON_LABEL, SAY_WHAT_HAPPENED,
  moveReasonDisplaces, CANCEL_REASONS, EVENT_LABEL,
  OUTCOME_OPTIONS, JOB_SOURCES, SOURCE_LABEL, HOW_REPORTED,
} from "../lib/job.js";
import { parseWorkReport, fmtMin } from "../lib/workReport.js";
import { parseAnyPaste } from "../lib/backlog.js";
import { dayActivity, attributionLine } from "../lib/activity.js";
import { readGoLive, isLive, isPreGoLive } from "../lib/goLive.js";
import { parseSheetPaste } from "../lib/importSheet.js";
import { checkAgainstSchedule } from "../lib/roster.js";
import { storageGet } from "../lib/storage.js";
import { staffIndex, seedStaff, TRADE_LABEL } from "../lib/staff.js";
import {
  seedCatalogue, matchCatalogue, applyCatalogue, newCatalogueEntry,
} from "../lib/catalogue.js";
import { readPost, postDay, lockState, CHANGE_REASONS } from "../lib/dayLock.js";
import { identityFor } from "../lib/auth.js";
import { storageSet } from "../lib/storage.js";
import { jobRequirement, checkCrew, checkDayCrewing } from "../lib/crewing.js";
import { RETURN_REASONS, FAMILY_LABEL } from "../lib/faultFamily.js";
import {
  readDay, readDayResult, mutateDay, upsert, removeJob, migrateDay, needsMigration,
  createDayWatcher,
} from "../lib/jobStore.js";
import {
  splitCrew, parseShiftMinutes, formatMinutes, canonPriority, squash,
  canonProperty, displayProperty, canonKey,
} from "../lib/normalize.js";
import { planDay, fmtClock, suggestTechnician } from "../lib/schedule.js";

/* ---------------------------------------------------------------------- *
 * LiveBoard.jsx — the one place both roles work.
 *
 * What this replaces: the evening coordinator writing a schedule in
 * Sheets, and the admin re-entering the outcome somewhere else the next
 * day. That is one job done twice because the two people were never on the
 * same object. Here they are: the coordinator's job card and the admin's
 * job card are the same card, and advancing it is a click on it rather
 * than a second pass in a second tool.
 *
 * Three specific problems it is built around:
 *
 * 1. "No one knows where the older job disappeared." Nothing can leave a
 *    day silently. Moving writes a tombstone the day keeps; cancelling
 *    needs a reason; both land in the job's own history. The day shows a
 *    "left this day" section, and any job that has been pushed before says
 *    so on its face.
 *
 * 2. "Too many clicks." Capture is one line. A job needs a building and a
 *    task; everything else is optional and editable in place afterwards.
 *
 * 3. Double entry with PMS. The API route is closed, so the app formats
 *    the task and puts it on the clipboard — PMS gets a paste, not a
 *    retype.
 * ---------------------------------------------------------------------- */

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* Identity is attribution, not authentication until sign-in is switched on
   (see docs/ACCESS.md). It exists to answer "who moved this job".
 *
 * The name expires, and that matters more than it sounds. Three
 * coordinators rotate through the same desk on different shifts, so a name
 * remembered indefinitely means Kaja's afternoon changes are filed under
 * Haris, who went home at eleven the night before. The log is then worse
 * than useless: confidently wrong. Nine hours is one shift, so the name is
 * asked again after that — one box, once a shift, and every entry after it
 * belongs to the person who actually made it. */
const ME_TTL_MS = 9 * 60 * 60 * 1000;

function useMe() {
  const [me, setMe] = useState(() => {
    try {
      const raw = localStorage.getItem("dhh-me");
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v) return null;
      // Records written before this had no timestamp; treat them as stale
      // rather than trusting a name of unknown age.
      if (!v.at || Date.now() - v.at > ME_TTL_MS) return null;
      return v;
    } catch { /* fall through to the prompt */ }
    return null;
  });
  const save = (next) => {
    const stamped = next ? { ...next, at: Date.now() } : next;
    setMe(stamped);
    try { localStorage.setItem("dhh-me", JSON.stringify(stamped)); } catch { /* private mode */ }
  };
  return [me, save];
}

export default function LiveBoard({
  selectedDate, setSelectedDate, propertyMaster, knownTeams, onEditFull, showToast, session,
}) {
  const [typedMe, setTypedMe] = useMe();
  const [staff, setStaff] = useState(null);

  /* A verified session outranks a typed-in name. When sign-in is on there
     is no "who are you" prompt at all, because the answer is already
     proven rather than claimed. */
  const sessionMe = useMemo(() => (session ? identityFor(session, staff) : null), [session, staff]);
  const me = sessionMe || typedMe;
  const setMe = setTypedMe;
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rollover, setRollover] = useState(null);
  const [trailFor, setTrailFor] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  const [outcomeFor, setOutcomeFor] = useState(null);
  const [liveNote, setLiveNote] = useState("");
  const [returnPrompts, setReturnPrompts] = useState([]);
  const [closeOutFor, setCloseOutFor] = useState(null);
  const [nightLog, setNightLog] = useState(false);
  const [taskPaste, setTaskPaste] = useState(false);
  const [dayReview, setDayReview] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [todayOpen, setTodayOpen] = useState(null);
  const [goLive, setGoLiveDate] = useState(null);
  const [roster, setRoster] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [post, setPost] = useState(null);
  const [changeReasonFor, setChangeReasonFor] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const watcher = useRef(null);

  const jobs = useMemo(() => (rows ? liveJobs(rows) : []), [rows]);
  const tombs = useMemo(() => (rows ? tombstones(rows) : []), [rows]);

  /* ------------------------------ load ------------------------------- *
   * Four things went wrong here, and together they are why the board
   * sometimes came up empty and stayed that way through a refresh:
   *
   * 1. A failed read was indistinguishable from an empty day, so a network
   *    blink rendered "Nothing scheduled" — the jobs appeared to be gone.
   * 2. setLoading(false) was not in a finally, so anything that threw
   *    (a write conflict during migration, a dropped request) left the
   *    board on "Loading…" permanently.
   * 3. Nothing cancelled a superseded load, so a slow response for an
   *    earlier date could land after a newer one and paint the wrong day.
   * 4. The migration wrote a snapshot taken before the re-read, ignoring
   *    the rows the mutator was handed — the exact mistake the mutator
   *    contract warns about, made in the one place that runs on every
   *    single day open.
   * ------------------------------------------------------------------ */
  const loadToken = useRef(0);

  const load = useCallback(async (date) => {
    const token = ++loadToken.current;
    const current = () => token === loadToken.current;
    setLoading(true);
    setLoadError("");
    try {
      const { rows: stored, failed } = await readDayResult(date);
      if (!current()) return;
      if (failed) {
        // Say so, and leave whatever is on screen alone. An empty board is
        // a claim about the schedule; this is a claim about the network.
        setLoadError(
          `Could not read the schedule for ${date}. This is a connection problem, not an empty day — nothing has been lost.`
        );
        return;
      }

      let day = stored;
      if (needsMigration(day)) {
        try {
          day = await mutateDay(date, (cur) => migrateDay(cur, date));
        } catch {
          // Saving the upgrade failed. Show the day anyway, upgraded in
          // memory only — a read problem must not become a blank board.
          day = migrateDay(stored, date);
        }
      }
      if (!current()) return;
      setRows(day);
      watcher.current?.noteLocalWrite(day);
    } catch (e) {
      if (current()) {
        setLoadError(
          `Could not load ${date}: ${e.message || e}. Nothing has been lost — try again.`
        );
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  /* The rollover prompt is deliberately outside the load path. It reads up
     to five more days, and a failure there used to take the whole board
     down with it. */
  const loadRollover = useCallback(async (date) => {
    if (date < isoToday()) { setRollover(null); return; }
    try {
      /* Days before the department started using the system are history,
         not a backlog: nothing in them was ever closed out because closing
         out did not exist yet. Rolling them forward is how 2 September
         opened with 110 jobs from August on it. */
      const cut = await readGoLive();
      const days = [1, 2, 3, 4, 5].map((n) => addDays(date, -n)).filter((d) => isLive(d, cut));
      if (!days.length) { setRollover(null); return; }
      const results = await Promise.all(days.map((d) => readDayResult(d)));
      const stranded = [];
      let oldest = null;
      days.forEach((d, i) => {
        if (results[i].failed) return;
        const open = liveJobs(migrateDay(results[i].rows, d)).filter(isOpen);
        if (open.length) { stranded.push(...open); oldest = d; }
      });
      setRollover(stranded.length ? { date: oldest, jobs: stranded, days } : null);
    } catch {
      setRollover(null);
    }
  }, []);

  useEffect(() => {
    let off = false;
    readGoLive().then((d) => { if (!off) setGoLiveDate(d); }).catch(() => {});
    return () => { off = true; };
  }, []);

  useEffect(() => { load(selectedDate); }, [selectedDate, load]);

  /* The board opens on tomorrow, which is right for the evening coordinator
     building the next day — and wrong for the morning coordinator, who has
     today to close out and would have to remember to click back for it. So
     when any other day is on screen, today's outstanding count is fetched
     and shown. The second touchpoint of the department's rule cannot depend
     on somebody remembering it exists. */
  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    if (selectedDate === today) { setTodayOpen(null); return undefined; }
    if (goLive && today < goLive) { setTodayOpen(null); return undefined; }
    (async () => {
      try {
        const rows = liveJobs(migrateDay(await readDay(today), today));
        if (cancelled) return;
        const open = rows.filter((j) => !isResolved(j.state) && j.state !== "cancelled");
        setTodayOpen(open.length ? { date: today, count: open.length, total: rows.length } : null);
      } catch { if (!cancelled) setTodayOpen(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedDate, rows, goLive]);
  useEffect(() => { loadRollover(selectedDate); }, [selectedDate, loadRollover]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rec = await readPost(selectedDate);
      if (!cancelled) setPost(rec);
    })();
    return () => { cancelled = true; };
  }, [selectedDate]);

  const lock = useMemo(() => lockState(selectedDate, post), [selectedDate, post]);

  async function doPost() {
    const rec = await postDay(selectedDate, who, jobs.length);
    setPost(rec);
    showToast(`${selectedDate} posted. Changes from now on are logged with a reason.`, "ok");
  }

  /* Every edit to a locked day carries the reason with it, so the history
     reads as a decision rather than a mutation. */
  async function editWithReason(job, patch, reason) {
    await change(selectedDate, (cur) => {
      const target = cur.find((r) => !isTombstone(r) && r.id === job.id) || job;
      const edited = applyEdit(target, patch, who);
      return upsert(cur, reason
        ? withEvent(edited, "edited", who, { reason, lock: lock.kind })
        : edited);
    });
  }

  // The day's roster, so the board can say when work is assigned to
  // somebody who is not there.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await storageGet(`roster:${selectedDate}`);
      if (cancelled) return;
      try { setRoster(raw ? JSON.parse(raw) : null); } catch { setRoster(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await storageGet("staff");
      if (cancelled) return;
      try { setStaff(raw ? JSON.parse(raw) : seedStaff()); } catch { setStaff(seedStaff()); }

      const catRaw = await storageGet("task-catalogue");
      if (cancelled) return;
      let cat = null;
      try { cat = catRaw ? JSON.parse(catRaw) : null; } catch { cat = null; }
      if (!cat || !cat.length) {
        cat = seedCatalogue();
        await storageSet("task-catalogue", JSON.stringify(cat));
      }
      setCatalogue(cat);
    })();
    return () => { cancelled = true; };
  }, []);

  /* The evening coordinator has just created the day's tasks in PMS. The
     rule from today is that they are in here too, and that has to cost one
     paste rather than thirty entries. Anything already on the day with the
     same TSK reference is left alone, so pasting twice is safe. */
  /* Rows land on the day the paste says they belong to, never on whichever
     day happens to be open. The evening coordinator builds tomorrow while
     looking at today, and silently dropping tomorrow's schedule onto today
     would be the worst failure this app could have. */
  async function addFromPaste(rows) {
    const byDay = new Map();
    rows.forEach((r) => {
      const d = r._date || selectedDate;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(r);
    });

    let added = 0, dupes = 0;
    for (const [day, list] of byDay) {
      const existing = day === selectedDate ? jobs : liveJobs(migrateDay(await readDay(day), day));
      /* A TSK reference is the reliable key, but the coordinator's sheet
         only carries one on about four rows in ten. Without a second key on
         the content itself, re-pasting a sheet — which people do, because
         they added two more jobs at the bottom — would duplicate most of
         the day. */
      const refKey = (j) => canonKey(j.pmsRef);
      const bodyKey = (j) =>
        `${canonKey(j.property)}|${canonKey(j.unit)}|${canonKey(j.description).slice(0, 40)}`;
      const seenRefs = new Set(existing.map(refKey).filter(Boolean));
      const seenBodies = new Set(existing.map(bodyKey));
      const dayLock = lockState(day, day === selectedDate ? post : await readPost(day));
      const created = [];
      list.forEach((r) => {
        const ref = refKey(r), body = bodyKey(r);
        if ((ref && seenRefs.has(ref)) || seenBodies.has(body)) { dupes++; return; }
        if (ref) seenRefs.add(ref);
        seenBodies.add(body);
        const j = newJob(r, day, who);
        created.push(dayLock.locked ? withEvent(j, "added_late", who, { lock: dayLock.kind }) : j);
      });
      if (!created.length) continue;
      added += created.length;
      if (day === selectedDate) await change(day, (cur) => [...cur, ...created]);
      else await mutateDay(day, (cur) => [...cur, ...created]);
    }

    if (!added) {
      showToast(dupes ? "Every one of those is already in the app." : "Nothing to add.", "warn");
    } else {
      const days = Array.from(byDay.keys()).sort();
      showToast(
        `${added} job(s) added to ${days.length === 1 ? days[0] : `${days.length} days (${days[0]} – ${days[days.length - 1]})`}.` +
        (dupes ? ` ${dupes} already here.` : ""),
        "ok"
      );
      if (!byDay.has(selectedDate) && days.length === 1) setSelectedDate(days[0]);
    }
    setTaskPaste(false);
  }

  async function addCatalogueEntry(label) {
    const entry = newCatalogueEntry(label, { by: who });
    const next = [...(catalogue || []), entry];
    setCatalogue(next);
    await storageSet("task-catalogue", JSON.stringify(next));
    showToast(`"${entry.label}" saved as a standard task.`, "ok");
    return entry;
  }

  /* What the morning coordinator is asked for before they leave: the jobs
     on this day that still have no outcome. Counted here so the button can
     carry the number rather than making somebody go and look. */
  /* Jobs sitting on this day that first appeared before the department
     started. If the rollover banner was accepted before it knew about the
     cutover, they are here — and they are not work anybody intends to do. */
  const strays = useMemo(
    () => (goLive ? jobs.filter((j) => isPreGoLive(j, goLive) && !isResolved(j.state) && j.state !== "cancelled") : []),
    [jobs, goLive]
  );

  async function clearStrays() {
    const ids = new Set(strays.map((j) => j.id));
    await change(selectedDate, (cur) => cur.map((r) => (
      !isTombstone(r) && ids.has(r.id)
        ? setJobState(r, "cancelled", who, {
            reason: `Imported history from before ${goLive} — not being worked`,
            lock: lock.locked ? lock.kind : undefined,
          })
        : r
    )), `${strays.length} job(s) from before ${goLive} closed off. They stay on record.`);
  }

  const unanswered = useMemo(
    () => jobs.filter((j) => !isResolved(j.state) && j.state !== "cancelled").length,
    [jobs]
  );

  /* Who built this day and who has changed it since. Tombstones are
     included deliberately: a job that left the day is one of the changes
     this is here to show. */
  const activity = useMemo(() => dayActivity(rows || [], post), [rows, post]);

  const rosterCheck = useMemo(
    () => (roster ? checkAgainstSchedule(roster, jobs) : null),
    [roster, jobs]
  );
  const staffIdx = useMemo(() => (staff ? staffIndex(staff) : null), [staff]);
  const crewing = useMemo(
    () => (staffIdx ? checkDayCrewing(jobs, staffIdx) : null),
    [staffIdx, jobs]
  );

  /* Everyone who could take a job today: the rostered technicians when a
     roster is saved, otherwise the field staff on the team list. */
  const candidates = useMemo(() => {
    if (rosterCheck) {
      const s = rosterCheck.summary;
      return Array.from(new Set([...s.onShift, ...s.standby]));
    }
    if (staff) return staff.filter((x) => x.role !== "office" && x.active !== false).map((x) => x.name);
    return [];
  }, [rosterCheck, staff]);

  /* --------------------------- live refresh --------------------------- */
  useEffect(() => {
    if (!watcher.current) watcher.current = createDayWatcher({});
    const w = watcher.current;
    /* No seed: `rows` here is the PREVIOUS day's data, because load is
       still in flight when this runs. load() hands the watcher the right
       baseline as soon as it has one. */
    w.watch(selectedDate, (fresh) => {
      setRows(fresh);
      setLiveNote(`Updated by someone else at ${clock(Date.now())}`);
      setTimeout(() => setLiveNote(""), 6000);
    }, null);
    return () => w.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  /* --------------------------- write helper --------------------------- *
   * Everything funnels through here so no path can write a stale array.  */
  async function change(date, mutator, note) {
    setBusy(true);
    try {
      const next = await mutateDay(date, mutator);
      if (date === selectedDate) setRows(next);
      watcher.current?.noteLocalWrite(date === selectedDate ? next : null);
      if (note) showToast(note, "ok");
      return next;
    } catch (e) {
      showToast(e.message || "Could not save.", "warn");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const who = me?.name || "unknown";

  /* ----------------------------- actions ------------------------------ */

  async function addJobs(fieldsList) {
    const created = fieldsList.map((f) => {
      const j = newJob(f, selectedDate, who);
      // A job added to a day that has already been published is a change to
      // a schedule the field team has planned around, so it is logged as one.
      return lock.locked ? withEvent(j, "added_late", who, { lock: lock.kind }) : j;
    });
    await change(selectedDate, (cur) => [...cur, ...created],
      `Added ${created.length} job${created.length === 1 ? "" : "s"}.`);

    /* Look back for the same unit having had similar work recently. This
       runs after the save, never before it — capture stays one line and
       one Enter, and the question about why a job is back is asked
       afterwards, where it can be ignored without blocking anything. */
    const lookback = [];
    for (let n = 1; n <= 21; n++) {
      const d = addDays(selectedDate, -n);
      lookback.push({ date: d, rows: liveJobs(migrateDay(await readDay(d), d)) });
    }
    const prompts = [];
    created.forEach((j) => {
      const hit = findReturn(j, lookback);
      if (hit) prompts.push({ job: j, ...hit });
    });
    if (prompts.length) setReturnPrompts((prev) => [...prev, ...prompts]);
    return created;
  }

  async function setReturnReason(job, reasonId, hit) {
    await change(selectedDate, (cur) =>
      upsert(cur, withEvent(
        { ...job, returnReason: reasonId, returnOf: { jobId: hit.prior.id, date: hit.date, gapDays: hit.gapDays } },
        "edited", who, { changes: [{ field: "returnReason", label: "Why it is back", from: "", to: reasonId }] }
      )));
    setReturnPrompts((prev) => prev.filter((p) => p.job.id !== job.id));
  }

  /* Recording an outcome is the day running its course, not a change to
     the plan — except for cancelling, which removes work the schedule
     promised and belongs in the after-posting record. */
  async function advance(job, state, extra) {
    const tag = state === "cancelled" && lock.locked ? { lock: lock.kind } : {};
    await change(selectedDate, (cur) =>
      upsert(cur, setJobState(job, state, who, { ...extra, ...tag })));
  }

  /* A job that was not done is not finished with. Whatever the coordinator
     answers about rebooking is stored on the job, and a booked date creates
     the linked job that carries the work forward — the same containment
     path used for made-safe, for the same reason: nothing contained is left
     with nobody coming back. */
  async function markNotDone(job, kind, reason, rebook) {
    const state = kind === "cancel" ? "cancelled" : "not_done";
    const extra = { reason };
    if (rebook) extra.rebook = rebook.rebook === "none" ? "none" : rebook.date;

    let child = null;
    if (rebook && rebook.date) {
      // Built from the job as it will be once closed, so the child records
      // what it is following up on rather than the state it was in before.
      child = makeFollowUp({ ...job, state, outcomeReason: reason }, rebook.date, who,
        { scope: `Retry: ${job.description}` });
    }
    await change(selectedDate, (cur) => {
      const target = cur.find((r) => !isTombstone(r) && r.id === job.id) || job;
      const closed = setJobState(target, state, who, {
        ...extra,
        ...(state === "cancelled" && lock.locked ? { lock: lock.kind } : {}),
      });
      return upsert(cur, child ? { ...closed, followUpJobId: child.id } : closed);
    });
    if (child) {
      await mutateDay(rebook.date, (cur) => [...cur, child]);
      showToast(`Not done. Booked again for ${rebook.date}.`, "ok");
    } else if (rebook && rebook.rebook === "none") {
      showToast("Not done, and recorded as not being rebooked.", "warn");
    }
  }

  /* Closing a job out. The two outcomes that are not endings — made safe
     and diagnosed — create the job that finishes the work, on the spot.
     There is no path through this dialog that leaves a contained fault
     with nobody booked to come back, which is the failure it exists to
     prevent. */
  async function closeOut(job, { outcome, reason, stillNeeded, actualMinutes, followUp }) {
    const patch = { reason, stillNeeded };
    if (actualMinutes != null) patch.actualMinutes = actualMinutes;

    let child = null;
    if (followUp && needsFollowUp(outcome)) {
      child = makeFollowUp(job, followUp.date, who, {
        scope: followUp.scope,
        materials: followUp.materials,
        team: followUp.team,
        estimatedTime: followUp.estimatedTime,
      });
    }

    const closed = setJobState(
      { ...job, actualMinutes: actualMinutes != null ? actualMinutes : job.actualMinutes,
        followUpJobId: child ? child.id : job.followUpJobId },
      outcome, who, patch
    );

    await change(selectedDate, (cur) => {
      let next = upsert(cur, closed);
      if (child && followUp.date === selectedDate) next = [...next, child];
      return next;
    });
    if (child && followUp.date !== selectedDate) {
      await mutateDay(followUp.date, (cur) => [...cur, child]);
    }
    setCloseOutFor(null);
    showToast(
      child
        ? `Closed as ${outcome.replace("_", " ")} — follow-up booked for ${followUp.date}.`
        : `Closed as ${outcome.replace("_", " ")}.`,
      "ok"
    );
  }

  /* Anything that came in after the schedule was posted. Logged against
     the day it actually happened, marked unplanned, so arriving volume
     stops being invisible. */
  async function logNightJob(fields, date) {
    const j = newJob({ ...fields, unplanned: true }, date, who);
    if (date === selectedDate) {
      await change(selectedDate, (cur) => [...cur, j], "Logged.");
    } else {
      await mutateDay(date, (cur) => [...cur, j]);
      showToast(`Logged against ${date}.`, "ok");
    }
    setNightLog(false);
  }

  async function edit(job, patch) {
    if (lock.locked) {
      // Ask once per job, then apply this and any further edits to it with
      // that reason attached.
      setChangeReasonFor({ job, patch });
      return;
    }
    await change(selectedDate, (cur) => {
      const target = cur.find((r) => !isTombstone(r) && r.id === job.id) || job;
      return upsert(cur, applyEdit(target, patch, who));
    });
  }

  async function togglePms(job) {
    const next = job.inPms === true ? false : job.inPms === false ? null : true;
    await change(selectedDate, (cur) =>
      upsert(cur, withEvent({ ...job, inPms: next }, "pms", who, { to: String(next) })));
  }

  /* The move. Two writes: a tombstone on the day it leaves, the job itself
     on the day it lands. Deliberately not a delete anywhere. */
  async function doMove(job, toDate, reason, displacedBy) {
    const { moved, tomb } = moveJob(job, toDate, who, reason, displacedBy, lock.kind);
    await change(selectedDate, (cur) => {
      let next = [...removeJob(cur, job.id), tomb];
      // Record the other half on the job that took the slot, so the pair
      // can be read from either end.
      if (displacedBy && displacedBy.jobId) {
        const winner = next.find((r) => !isTombstone(r) && r.id === displacedBy.jobId);
        if (winner) {
          next = upsert(next, {
            ...winner,
            displaced: Array.from(new Set([...(winner.displaced || []), job.id])),
          });
        }
      }
      return next;
    });
    await mutateDay(toDate, (cur) => [...cur, moved]);
    showToast(`Moved to ${toDate}. The trail stays on ${selectedDate}.`, "ok");
    setMoveFor(null);
  }

  /* Stranded jobs can come from several different days at once, so they are
     grouped by the day they are actually sitting on — each source day gets
     its own tombstones. Moving them off one assumed date would leave the
     other days looking like the jobs vanished, which is the bug. */
  async function moveStranded(jobsToMove, toDate, reason) {
    const byDay = new Map();
    jobsToMove.forEach((j) => {
      const d = j.scheduledDate;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(j);
    });
    const landing = [];
    for (const [fromDate, list] of byDay) {
      const pairs = list.map((j) => moveJob(j, toDate, who, reason));
      await mutateDay(fromDate, (cur) => {
        let next = cur;
        pairs.forEach(({ tomb }, i) => { next = [...removeJob(next, list[i].id), tomb]; });
        return next;
      });
      landing.push(...pairs.map((p) => p.moved));
    }
    const landed = await mutateDay(toDate, (cur) => [...cur, ...landing]);

    /* Only adopt the result into the view when it IS the day being viewed.
       Setting it unconditionally showed the destination day's jobs under
       the current day's date — which, on a board whose whole purpose is
       knowing where jobs are, is the worst possible thing to get wrong. */
    if (toDate === selectedDate) {
      setRows(landed);
      watcher.current?.noteLocalWrite(landed);
    } else if (byDay.has(selectedDate)) {
      const refreshed = await readDay(selectedDate);
      setRows(refreshed);
      watcher.current?.noteLocalWrite(refreshed);
    }
    showToast(`Moved ${jobsToMove.length} job(s) to ${toDate}. Every day they left keeps a record.`, "ok");
  }

  /* ---------------------------- grouping ------------------------------ */

  const groups = useMemo(() => {
    const m = new Map();
    jobs.forEach((j) => {
      const k = squash(j.team) || "Unassigned";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(j);
    });
    return Array.from(m.entries())
      .map(([team, list]) => {
        const members = splitCrew(team);
        const shiftMin = parseShiftMinutes(list.find((j) => j.shift)?.shift) || 540;
        const mins = list.reduce((s, j) => s + (jobMinutes(j) || 0), 0);
        const buildings = new Set(list.map((j) => canonProperty(j.property)).filter(Boolean));
        const travel = Math.max(0, buildings.size - 1) * 30;
        const committed = mins + travel;
        const noEstimate = list.filter((j) => jobMinutes(j) == null).length;
        return {
          team, list, members, shiftMin, committed, travel,
          loadPct: Math.round((committed / shiftMin) * 100),
          buildings: buildings.size, noEstimate,
          open: list.filter(isOpen).length,
        };
      })
      .sort((a, b) => (a.team === "Unassigned" ? 1 : b.team === "Unassigned" ? -1 : b.loadPct - a.loadPct));
  }, [jobs]);

  const counts = useMemo(() => {
    const c = { total: jobs.length, done: 0, not_done: 0, in_progress: 0, scheduled: 0, cancelled: 0 };
    jobs.forEach((j) => { c[j.state] = (c[j.state] || 0) + 1; });
    return c;
  }, [jobs]);

  const knownProps = useMemo(
    () => Array.from(new Set([
      ...(propertyMaster || []).map((p) => p.name),
      ...jobs.map((j) => j.property),
    ].filter(Boolean))),
    [propertyMaster, jobs]
  );
  const knownTechNames = useMemo(
    () => Array.from(new Set([...(knownTeams || []), ...jobs.map((j) => j.team)]
      .flatMap((t) => splitCrew(t)))),
    [knownTeams, jobs]
  );

  if (!me) return <WhoAreYou onPick={setMe} />;

  return (
    <div className="space-y-4">
      <TopBar
        me={me} onChangeMe={() => setMe(null)}
        selectedDate={selectedDate} setSelectedDate={setSelectedDate}
        counts={counts} busy={busy} liveNote={liveNote}
        onRefresh={() => load(selectedDate)}
      />

      {strays.length > 0 && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-2">
          <History className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="text-xs text-slate-700">
            <b>{strays.length} job{strays.length === 1 ? "" : "s"} on this day came from before {goLive}</b>
            {" "}— imported history, brought forward before the app knew where you started. They are
            not work anybody planned.
          </span>
          <button onClick={clearStrays}
                  className="ml-auto text-xs bg-slate-800 text-white rounded-md px-2.5 py-1.5 shrink-0">
            Close them off
          </button>
        </div>
      )}

      {todayOpen && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex flex-wrap items-center gap-2">
          <ListChecks className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="text-xs text-amber-900">
            <b>Today ({todayOpen.date}) still has {todayOpen.count} job{todayOpen.count === 1 ? "" : "s"} with no outcome</b>
            {" "}— of {todayOpen.total} on the day. Say how they went before you leave.
          </span>
          <button onClick={() => setSelectedDate(todayOpen.date)}
                  className="ml-auto text-xs bg-amber-600 text-white rounded-md px-2.5 py-1.5 shrink-0">
            Go to today
          </button>
        </div>
      )}

      <PostBar
        lock={lock} post={post} date={selectedDate}
        jobCount={jobs.length} onPost={doPost}
      />

      {(activity.builtBy.length > 0 || activity.changes > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 px-0.5">
          <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>{attributionLine(activity)}</span>
          <button onClick={() => setShowLog(true)}
                  className="underline underline-offset-2 text-slate-500 hover:text-slate-900">
            see the log
          </button>
        </div>
      )}

      {rosterCheck && <RosterStrip check={rosterCheck} />}
      {crewing && <CrewStrip crewing={crewing} />}

      {rollover && (
        <RolloverBanner
          rollover={rollover}
          today={selectedDate}
          onMoveAll={(reason) => moveStranded(rollover.jobs, selectedDate, reason).then(() => setRollover(null))}
          onDismiss={() => setRollover(null)}
          onOpenDay={() => setSelectedDate(rollover.date)}
        />
      )}

      <QuickAdd
        knownProps={knownProps}
        knownTechs={knownTechNames}
        catalogue={catalogue}
        onAdd={addJobs}
        onSaveStandard={addCatalogueEntry}
        busy={busy}
      />

      <div className="flex flex-wrap items-center gap-2 -mt-1">
        <button onClick={() => setTaskPaste(true)}
                className="flex items-center gap-1.5 text-xs bg-slate-900 text-white rounded-md px-2.5 py-1.5">
          <ClipboardPaste className="w-3.5 h-3.5" /> Paste the day in (sheet or PMS)
        </button>
        {lock.locked && jobs.length > 0 && (
          <button onClick={() => setDayReview(true)}
                  className={`flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 ${
                    unanswered ? "bg-amber-600 text-white" : "border border-slate-300 hover:bg-slate-50"}`}>
            <ListChecks className="w-3.5 h-3.5" />
            {unanswered ? `End-of-day review — ${unanswered} without an outcome` : "End-of-day review — all answered"}
          </button>
        )}
        <button onClick={() => setNightLog(true)}
                className="flex items-center gap-1.5 text-xs border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-50">
          <Moon className="w-3.5 h-3.5" /> Log an out-of-hours job
        </button>
        <span className="text-[11px] text-slate-400">
          Anything that came in after the schedule was posted — the night call, the emergency, the
          job arranged over Google Chat. It happened, so it belongs on the day it happened.
        </span>
      </div>

      {returnPrompts.length > 0 && (
        <ReturnPrompts
          prompts={returnPrompts}
          onAnswer={setReturnReason}
          onDismiss={(job) => setReturnPrompts((prev) => prev.filter((p) => p.job.id !== job.id))}
        />
      )}

      {loadError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
            <div className="text-sm text-red-900">
              <p className="font-medium">{loadError}</p>
              <button onClick={() => load(selectedDate)}
                      className="mt-1.5 text-xs bg-red-700 text-white rounded-md px-2.5 py-1">
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading {selectedDate}…
        </div>
      )}

      {!loading && !loadError && jobs.length === 0 && tombs.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">Nothing scheduled for {selectedDate} yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Type a job in the box above — one line is enough.
          </p>
        </div>
      )}

      {!loading && groups.map((g) => (
        <TeamGroup
          key={g.team} group={g} me={me} allJobs={jobs} selectedDate={selectedDate}
          onAdvance={advance} onEdit={edit} onTogglePms={togglePms}
          onMove={setMoveFor} onOutcome={setOutcomeFor} onTrail={setTrailFor}
          onEditFull={onEditFull} showToast={showToast} onCloseOut={setCloseOutFor}
          staffIdx={staffIdx} candidates={candidates}
          onMoveMany={(list, reason) => moveStranded(list, addDays(selectedDate, 1), reason)}
        />
      ))}

      {!loading && (tombs.length > 0 || jobs.some((j) => j.state === "cancelled")) && (
        <LeftThisDay
          tombs={tombs}
          cancelled={jobs.filter((j) => j.state === "cancelled")}
          onOpenDate={setSelectedDate}
          onTrail={setTrailFor}
        />
      )}

      {trailFor && <TrailDrawer job={trailFor} onClose={() => setTrailFor(null)} />}
      {moveFor && (
        <MoveDialog
          job={moveFor} fromDate={selectedDate} dayJobs={jobs}
          onCancel={() => setMoveFor(null)}
          onMove={(to, reason, displacedBy) => doMove(moveFor, to, reason, displacedBy)}
        />
      )}
      {outcomeFor && (
        <OutcomeDialog
          job={outcomeFor.job} kind={outcomeFor.kind} selectedDate={selectedDate}
          onCancel={() => setOutcomeFor(null)}
          onConfirm={(reason, rebook) => {
            markNotDone(outcomeFor.job, outcomeFor.kind, reason, rebook);
            setOutcomeFor(null);
          }}
        />
      )}
      {changeReasonFor && (
        <ChangeReasonDialog
          lock={lock}
          job={changeReasonFor.job}
          patch={changeReasonFor.patch}
          onCancel={() => setChangeReasonFor(null)}
          onConfirm={(reason) => {
            editWithReason(changeReasonFor.job, changeReasonFor.patch, reason);
            setChangeReasonFor(null);
          }}
        />
      )}
      {closeOutFor && (
        <CloseOutDialog
          job={closeOutFor} selectedDate={selectedDate}
          onCancel={() => setCloseOutFor(null)}
          onConfirm={(payload) => closeOut(closeOutFor, payload)}
        />
      )}
      {showLog && (
        <DayLog date={selectedDate} activity={activity} onCancel={() => setShowLog(false)} />
      )}
      {taskPaste && (
        <TaskPasteDialog
          date={selectedDate}
          onCancel={() => setTaskPaste(false)}
          onCommit={addFromPaste}
        />
      )}
      {dayReview && (
        <DayReview
          date={selectedDate} jobs={jobs}
          onCancel={() => setDayReview(false)}
          onCloseOut={(job) => { setDayReview(false); setCloseOutFor(job); }}
          onQuick={(job, state) => advance(job, state, {})}
        />
      )}
      {nightLog && (
        <NightLogDialog
          selectedDate={selectedDate}
          knownTechs={knownTechNames}
          onCancel={() => setNightLog(false)}
          onSave={logNightJob}
        />
      )}
    </div>
  );
}

/* ========================= who am I ========================= */

function WhoAreYou({ onPick }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("coordinator");
  return (
    <div className="max-w-md mx-auto mt-10 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Who is using this board?</h2>
      <p className="text-xs text-slate-500 mt-1">
        Your name goes on every change you make, so the board can answer "who built this schedule"
        and "who moved this job at eleven". It is stored on this device only — attribution, not a
        login, and it does not restrict what anyone can do.
      </p>
      <p className="text-xs text-slate-500 mt-1.5">
        It is asked again each shift. Three of you share this desk, and a name that never expires
        would file the afternoon's changes under whoever was here last night.
      </p>
      <label className="block text-xs text-slate-600 mt-3">
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onPick({ name: name.trim(), role }); }}
               placeholder="e.g. Ahmed"
               className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      </label>
      <div className="mt-3">
        <span className="text-xs text-slate-600">Mainly doing</span>
        <div className="flex gap-2 mt-1">
          {[["coordinator", "Building the schedule"], ["admin", "Checking what happened"]].map(([id, label]) => (
            <button key={id} onClick={() => setRole(id)}
                    className={`flex-1 text-xs rounded-md border px-2 py-2 ${role === id ? "border-slate-900 bg-slate-50 font-medium" : "border-slate-300"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">
          This only decides which buttons sit in front. Everyone can do everything.
        </p>
      </div>
      <button disabled={!name.trim()} onClick={() => onPick({ name: name.trim(), role })}
              className="mt-4 w-full text-sm bg-slate-900 text-white px-4 py-2 rounded-md disabled:opacity-40">
        Start
      </button>
    </div>
  );
}

/* ========================= top bar ========================= */

function TopBar({ me, onChangeMe, selectedDate, setSelectedDate, counts, busy, liveNote, onRefresh }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setSelectedDate(addDays(selectedDate, -1))}
                  className="p-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-600">‹</button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                 className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          <button onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                  className="p-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-600">›</button>
          {selectedDate !== isoToday() && (
            <button onClick={() => setSelectedDate(isoToday())}
                    className="text-xs px-2 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-800">
              Today
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span><span className="font-semibold text-slate-900">{counts.total}</span> jobs</span>
          {counts.scheduled > 0 && <span>{counts.scheduled} scheduled</span>}
          {counts.in_progress > 0 && <span className="text-blue-700">{counts.in_progress} started</span>}
          {counts.done > 0 && <span className="text-emerald-700">{counts.done} done</span>}
          {counts.not_done > 0 && <span className="text-red-700">{counts.not_done} not done</span>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {liveNote && (
            <span className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
              <CircleDot className="w-3 h-3" /> {liveNote}
            </span>
          )}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          <button onClick={onRefresh} title="Reload this day"
                  className="p-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-500">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={onChangeMe}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1.5 hover:bg-slate-50">
            {me.name} · {me.role === "admin" ? "checking" : "scheduling"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========================= rollover ========================= */

function RolloverBanner({ rollover, today, onMoveAll, onDismiss, onOpenDay }) {
  const [reason, setReason] = useState("out-of-time");
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-amber-900">
            {rollover.jobs.length} job{rollover.jobs.length === 1 ? "" : "s"} from before {today} {rollover.jobs.length === 1 ? "was" : "were"} never
            closed out
          </h3>
          <p className="text-xs text-amber-800 mt-0.5">
            These are the ones that used to disappear — still open on a day that has already
            passed, with nobody having said done, not done, moved or cancelled. Decide now:
            bring them to {today}, or open the day and close each one properly. Nothing moves
            on its own.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-amber-900 max-h-32 overflow-y-auto">
            {rollover.jobs.slice(0, 8).map((j) => (
              <li key={j.id} className="truncate">
                · {j.property} {j.unit} — {j.description || "(no task)"}{" "}
                <span className="text-amber-700">({j.team || "unassigned"})</span>
              </li>
            ))}
            {rollover.jobs.length > 8 && <li className="text-amber-700">+{rollover.jobs.length - 8} more</li>}
          </ul>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <select value={reason} onChange={(e) => setReason(e.target.value)}
                    className="text-xs border border-amber-300 rounded-md px-2 py-1.5 bg-white">
              {MOVE_REASONS.filter((r) => !r.displaces).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <button onClick={() => onMoveAll(reason)}
                    className="text-xs bg-amber-700 text-white rounded-md px-3 py-1.5">
              Bring all {rollover.jobs.length} to {today}
            </button>
            <button onClick={onOpenDay}
                    className="text-xs border border-amber-400 rounded-md px-3 py-1.5 bg-white">
              Open {rollover.date} instead
            </button>
            <button onClick={onDismiss} className="text-xs text-amber-700 underline">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================= quick add ========================= */

function QuickAdd({ knownProps, knownTechs, catalogue, onAdd, onSaveStandard, busy }) {
  const [text, setText] = useState("");
  const [showCat, setShowCat] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const inputRef = useRef(null);
  const multi = text.includes("\n");

  /* Each line is parsed, then snapped to a standard task where one clearly
     matches. Snapping is what makes two coordinators enter the same job the
     same way — and it costs no extra typing, because it works on the words
     they were going to use anyway. */
  const preview = useMemo(() => {
    if (!text.trim()) return null;
    return splitQuickAddLines(text).map((l) => {
      const parsed = parseQuickAdd(l, { properties: knownProps, techs: knownTechs });
      const m = catalogue ? matchCatalogue(parsed.fields.description, catalogue) : null;
      return {
        raw: l,
        fields: m ? applyCatalogue(parsed.fields, m.entry) : parsed.fields,
        typed: parsed.fields.description,
        match: m,
      };
    });
  }, [text, knownProps, knownTechs, catalogue]);

  const valid = preview ? preview.filter((p) => squash(p.fields.property) || squash(p.fields.description)) : [];
  const unmatched = valid.filter((p) => !p.match && squash(p.typed).length > 6);

  async function commit() {
    if (!valid.length) return;
    await onAdd(valid.map((p) => p.fields));
    setText("");
    inputRef.current?.focus();
  }

  function insertTask(entry) {
    // Keep whatever building/unit they already typed; replace the task part.
    const parsed = text.trim()
      ? parseQuickAdd(text, { properties: knownProps, techs: knownTechs })
      : null;
    const prefix = parsed
      ? [parsed.fields.property, parsed.fields.unit].filter(Boolean).join(" ")
      : "";
    setText(`${prefix} ${entry.label}`.trim() + " ");
    setShowCat(false);
    inputRef.current?.focus();
  }

  const catList = useMemo(() => {
    if (!catalogue) return [];
    const q = canonKey(catSearch);
    const list = catalogue.filter((c) => c.active !== false);
    if (!q) return list;
    return list.filter((c) =>
      canonKey(c.label).includes(q) || (c.aliases || []).some((a) => canonKey(a).includes(q))
    );
  }, [catalogue, catSearch]);

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-3">
      <div className="flex items-start gap-2">
        <Plus className="w-4 h-4 text-slate-400 mt-2 shrink-0" />
        <div className="flex-1 min-w-0">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !multi) { e.preventDefault(); commit(); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
            }}
            rows={multi ? Math.min(8, text.split("\n").length + 1) : 1}
            placeholder="Palm Villa E41 AC not cooling 1h Vitalis occupied p2 3-4pm"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm resize-y"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-400">
            <button onClick={() => setShowCat((v) => !v)}
                    className="text-slate-600 underline hover:text-slate-900">
              {showCat ? "hide" : "pick from"} standard tasks
            </button>
            <span>Type it how you say it — order does not matter.</span>
            <span>Enter to add{multi ? " (⌘/Ctrl+Enter for a block)" : ""}.</span>
          </div>
        </div>
        <button onClick={commit} disabled={!valid.length || busy}
                className="text-sm bg-slate-900 text-white px-3 py-2 rounded-md shrink-0 disabled:opacity-40">
          Add{valid.length > 1 ? ` ${valid.length}` : ""}
        </button>
      </div>

      {showCat && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <input value={catSearch} onChange={(e) => setCatSearch(e.target.value)} autoFocus
                 placeholder="search standard tasks…"
                 className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-2" />
          <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto">
            {catList.map((c) => (
              <button key={c.id} onClick={() => insertTask(c)}
                      title={`${c.minutes} min · ${c.people} ${c.people === 1 ? "person" : "people"}${c.material ? ` · ${c.material}` : ""}`}
                      className="text-[11px] border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 text-slate-700">
                {c.label}
                <span className="text-slate-400"> · {c.minutes >= 60 ? `${Math.round(c.minutes / 60)}h` : `${c.minutes}m`}</span>
                {c.people > 1 && <span className="text-violet-700"> · {c.people}p</span>}
              </button>
            ))}
            {catList.length === 0 && <span className="text-xs text-slate-400">Nothing matches that.</span>}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Picking one keeps the building and unit you have already typed. The duration, crew size
            and material come with it.
          </p>
        </div>
      )}

      {preview && valid.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5">
          <p className="text-[11px] text-slate-500">
            Read as — anything wrong is editable on the card afterwards:
          </p>
          {valid.slice(0, 6).map((p, i) => (
            <div key={i}>
              {p.match && (
                <div className="text-[11px] text-emerald-700 mb-0.5">
                  standard task: <span className="font-medium">{p.match.entry.label}</span>
                  {squash(p.typed).toLowerCase() !== p.match.entry.label.toLowerCase() && (
                    <span className="text-slate-400"> (you typed “{p.typed}”)</span>
                  )}
                </div>
              )}
              <ParsePreview fields={p.fields} />
            </div>
          ))}
          {valid.length > 6 && <p className="text-[11px] text-slate-400">+{valid.length - 6} more lines</p>}

          {unmatched.length > 0 && onSaveStandard && (
            <div className="text-[11px] text-slate-500 pt-1">
              {unmatched.length === 1 ? "This wording is not" : "These are not"} a standard task yet.
              {unmatched.slice(0, 2).map((p, i) => (
                <button key={i} onClick={() => onSaveStandard(p.typed)}
                        className="ml-1.5 underline text-slate-700 hover:text-slate-900">
                  save “{p.typed.slice(0, 40)}” as one
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParsePreview({ fields }) {
  const chips = [
    ["Building", fields.property, "bg-blue-50 text-blue-800 border-blue-200"],
    ["Unit", fields.unit, "bg-blue-50 text-blue-800 border-blue-200"],
    ["Task", fields.description, "bg-slate-100 text-slate-700 border-slate-200"],
    ["Tech", fields.team, "bg-violet-50 text-violet-800 border-violet-200"],
    ["Est", fields.estimatedTime, "bg-emerald-50 text-emerald-800 border-emerald-200"],
    ["Unit state", fields.status, "bg-amber-50 text-amber-800 border-amber-200"],
    ["Priority", fields.priority, "bg-red-50 text-red-800 border-red-200"],
    ["Visit", fields.timeOfVisit, "bg-amber-50 text-amber-800 border-amber-200"],
    ["Guest", fields.guestConfirmed === "Y" ? "confirmed" : "", "bg-emerald-50 text-emerald-800 border-emerald-200"],
    ["People", fields.crewNeeded > 1 ? `${fields.crewNeeded} needed` : "", "bg-violet-50 text-violet-800 border-violet-200"],
    ["Material", fields.materialDetails, "bg-slate-100 text-slate-700 border-slate-200"],
  ].filter(([, v]) => squash(v));
  const missing = [];
  if (!squash(fields.team)) missing.push("technician");
  if (!squash(fields.estimatedTime)) missing.push("estimate");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map(([label, v, cls]) => (
        <span key={label} className={`text-[10px] border rounded px-1.5 py-0.5 ${cls}`}>
          <span className="opacity-60">{label}</span> {v}
        </span>
      ))}
      {missing.length > 0 && (
        <span className="text-[10px] text-slate-400">· no {missing.join(", ")} yet</span>
      )}
    </div>
  );
}

/* ========================= team group ========================= */

function TeamGroup({ group, me, allJobs, selectedDate, onAdvance, onEdit, onTogglePms, onMove, onOutcome, onTrail, onEditFull, showToast, onMoveMany, onCloseOut, staffIdx, candidates }) {
  const [open, setOpen] = useState(true);
  const [showPlan, setShowPlan] = useState(false);
  const g = group;
  const plan = useMemo(
    () => (g.team === "Unassigned" ? null : planDay(g.list)),
    [g.list, g.team]
  );
  const tone = g.loadPct > 100 ? "bad" : g.loadPct > 85 ? "warn" : "ok";
  const barCls = { ok: "bg-blue-500", warn: "bg-amber-500", bad: "bg-red-500" }[tone];

  function copyAllForPms() {
    const text = g.list.filter((j) => j.state !== "cancelled").map(pmsText).join("\n\n---\n\n");
    navigator.clipboard?.writeText(text);
    showToast(`Copied ${g.list.length} job(s) — paste into PMS.`, "ok");
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 p-3 border-b border-slate-100">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-sm font-medium text-slate-900 truncate">{g.team}</span>
          {g.members.length > 1 && (
            <span title={`${g.members.length} people who work together: ${g.members.join(", ")}. The load bar is elapsed time on site — they are all there for it.`}
                  className="text-[10px] rounded px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 shrink-0">
              {g.members.length} people
            </span>
          )}
          <span className="text-xs text-slate-400">{g.list.length} jobs</span>
        </button>

        {g.team !== "Unassigned" && (
          <div className="flex items-center gap-2 min-w-[190px]">
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(100, g.loadPct)}%` }} />
            </div>
            <span className={`text-xs tabular-nums ${tone === "bad" ? "text-red-700 font-medium" : tone === "warn" ? "text-amber-700" : "text-slate-500"}`}>
              {g.loadPct}%
            </span>
          </div>
        )}

        <span className="text-[11px] text-slate-400">
          {formatMinutes(g.committed)} of {formatMinutes(g.shiftMin)}
          {g.travel > 0 && ` · ${g.buildings} buildings`}
          {g.noEstimate > 0 && ` · ${g.noEstimate} with no estimate`}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {plan && (
            <button onClick={() => setShowPlan((v) => !v)}
                    title="Order the day by the agreed rule: confirmed appointment, then P1, then batch by building"
                    className={`flex items-center gap-1 text-xs rounded-md px-2 py-1 border ${
                      showPlan ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 hover:bg-slate-50"}`}>
              <CalendarClock className="w-3 h-3" /> Order of work
              {plan.overflow.length > 0 && (
                <span className="ml-0.5 rounded-full bg-red-600 text-white px-1.5">{plan.overflow.length}</span>
              )}
            </button>
          )}
          <button onClick={copyAllForPms} title="Copy this technician's jobs formatted for PMS"
                  className="flex items-center gap-1 text-xs border border-slate-300 rounded-md px-2 py-1 hover:bg-slate-50">
            <Clipboard className="w-3 h-3" /> Copy for PMS
          </button>
        </div>
      </div>

      {showPlan && plan && (
        <DayPlan plan={plan} team={g.team} onMoveMany={onMoveMany} onTrail={onTrail} />
      )}

      {open && (
        <div className="divide-y divide-slate-100">
          {g.list.map((job) => (
            <JobRow
              key={job.id} job={job} me={me}
              onAdvance={onAdvance} onEdit={onEdit} onTogglePms={onTogglePms}
              onMove={onMove} onOutcome={onOutcome} onTrail={onTrail}
              onEditFull={onEditFull} showToast={showToast} onCloseOut={onCloseOut}
              staffIdx={staffIdx} candidates={candidates}
              suggestFrom={g.team === "Unassigned" ? allJobs : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ==================== posting and locking ==================== *
 * The evening coordinator publishes the day; from then on the field team
 * has planned around it and guests have been told times. Changing it after
 * that is an event with a cost, and this is where that becomes visible.
 * ============================================================== */

function PostBar({ lock, post, date, jobCount, onPost }) {
  if (lock.kind === "past") {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span className="font-medium text-amber-900">{lock.label}</span>
          <span className="text-amber-800">{lock.why}</span>
        </div>
      </div>
    );
  }
  if (lock.kind === "posted" || lock.kind === "started") {
    return (
      <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="font-medium text-slate-800">{lock.label}</span>
          <span className="text-slate-600">{lock.why}</span>
          {lock.kind === "started" && jobCount > 0 && (
            <button onClick={onPost}
                    className="ml-auto text-xs border border-slate-300 bg-white rounded-md px-2.5 py-1">
              Mark as posted
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center gap-2">
      <Unlock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className="text-xs text-slate-600">
        <span className="font-medium text-slate-800">Not posted yet.</span> Edits are not being
        logged as changes — this is still a draft.
      </span>
      <button onClick={onPost} disabled={!jobCount}
              className="ml-auto text-xs bg-slate-900 text-white rounded-md px-3 py-1.5 disabled:opacity-40">
        Post {date} ({jobCount} jobs)
      </button>
    </div>
  );
}

function ChangeReasonDialog({ lock, job, patch, onCancel, onConfirm }) {
  const [reason, setReason] = useState(CHANGE_REASONS[0]);
  const [other, setOther] = useState("");
  const saying = reason === SAY_WHAT_HAPPENED;
  const final = saying ? squash(other) : reason;
  const ready = !!final;
  const fields = Object.keys(patch || {});

  return (
    <Modal title={lock.kind === "past" ? "Changing a day that has passed"
                  : lock.kind === "started" ? "Changing today's schedule"
                  : "Changing a posted schedule"}
           onCancel={onCancel}>
      <p className="text-xs text-slate-600">{lock.why}</p>
      <div className="mt-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
        <span className="font-medium">{job.property} {job.unit}</span>
        <div className="text-slate-500 mt-0.5">
          changing {fields.join(", ")}
        </div>
      </div>
      <label className="block text-xs text-slate-600 mt-3">
        Why?
        <select value={reason} onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          {CHANGE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value={SAY_WHAT_HAPPENED}>None of these — say what happened</option>
        </select>
      </label>
      {saying && (
        <input autoFocus value={other} onChange={(e) => setOther(e.target.value)}
               placeholder="In your own words — this is what gets counted"
               className="mt-2 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">
          Leave it as it was
        </button>
        <button onClick={() => onConfirm(final)} disabled={!ready}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">
          Save the change
        </button>
      </div>
    </Modal>
  );
}

/* ==================== crewing, on the board ==================== *
 * The complaint this answers: a water heater needs two people, one gets
 * assigned, and the second is fetched off other work mid-shift. In the
 * real month that happened 17 times. Saying so the evening before costs
 * nothing; discovering it at 11am costs two people's afternoons.
 * ============================================================== */

function CrewStrip({ crewing }) {
  const { short, wrongTrade, noDriver, peopleShort } = crewing;
  if (!short.length && !wrongTrade.length && !noDriver.length) return null;

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-red-900">
        <Users className="w-3.5 h-3.5" /> Crewing
      </div>
      <ul className="mt-1 space-y-1 text-xs text-red-900">
        {short.length > 0 && (
          <li>
            <span className="font-medium">
              {short.length} job{short.length === 1 ? "" : "s"} short-crewed
            </span>{" "}
            ({peopleShort} more {peopleShort === 1 ? "person" : "people"} needed).
            <span className="text-red-800"> Fix it now, or somebody gets pulled off their own work at 11am.</span>
            <ul className="mt-0.5 ml-3 space-y-0.5 text-red-800">
              {short.slice(0, 6).map((x, i) => (
                <li key={i} className="truncate">
                  {x.job.property} {x.job.unit} — <span className="font-medium">{x.crew.length} of {x.requirement.people}</span>
                  {" · "}{x.requirement.why}
                  {x.job.team && <span className="text-red-700"> ({x.job.team})</span>}
                </li>
              ))}
              {short.length > 6 && <li>+{short.length - 6} more</li>}
            </ul>
          </li>
        )}
        {noDriver.length > 0 && (
          <li className="font-medium">
            {noDriver.length} crew{noDriver.length === 1 ? "" : "s"} with nobody who can drive —{" "}
            {noDriver.slice(0, 3).map((x) => x.job.team).join("; ")}
          </li>
        )}
        {wrongTrade.length > 0 && (
          <li>
            {wrongTrade.length} job{wrongTrade.length === 1 ? "" : "s"} want a specialist who is not on the crew —{" "}
            {wrongTrade.slice(0, 3).map((x) => `${x.job.property} ${x.job.unit}`).join(", ")}
          </li>
        )}
      </ul>
    </div>
  );
}

/* ==================== the roster, on the board ==================== *
 * A job assigned to somebody on their week off used to be invisible until
 * the morning. The check runs against the roster saved for the day.
 * ============================================================== */

function RosterStrip({ check }) {
  const s = check.summary;
  const problems = check.assignedAway.length > 0 || check.notOnRosterTechs.length > 0;

  return (
    <div className={`rounded-lg border p-2.5 ${problems ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-700">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-semibold">{s.liveCount}</span> of {s.totalCount} available
          <span className="text-slate-400">· {s.onShiftCount} on shift</span>
        </span>
        {s.shifts.map((sh) => (
          <span key={sh.label} className="text-slate-500 tabular-nums">
            {sh.label} <span className="text-slate-700 font-medium">{sh.techs.length}</span>
          </span>
        ))}
        {s.unavailable.length > 0 && (
          <span className="text-slate-500">away: {s.unavailable.join(", ")}</span>
        )}
        {s.offsite.length > 0 && <span className="text-slate-500">off-site: {s.offsite.join(", ")}</span>}
        {s.standby.length > 0 && (
          <span className="text-slate-500">
            stand-by: <span className="text-slate-700">{s.standby.join(", ")}</span>
            {s.standbyBlock && s.standbyBlock.phone && <span className="text-slate-400"> {s.standbyBlock.phone}</span>}
          </span>
        )}
        {check.idle.length > 0 && (
          <span className="text-amber-700">idle: {check.idle.join(", ")}</span>
        )}
      </div>

      {check.assignedAway.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-red-200 text-xs text-red-900">
          <span className="font-medium flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {check.assignedAway.length} job(s) are assigned to somebody who is not available today
          </span>
          <ul className="mt-0.5 space-y-0.5">
            {check.assignedAway.slice(0, 6).map((x, i) => (
              <li key={i} className="truncate">
                <span className="font-medium">{x.tech}</span> ({x.reason}) — {x.job.property} {x.job.unit}
              </li>
            ))}
          </ul>
        </div>
      )}
      {check.notOnRosterTechs.length > 0 && (
        <div className="mt-1 text-[11px] text-amber-800">
          Not on today's roster but has jobs: {check.notOnRosterTechs.join(", ")} — either the roster
          message missed them, or the name is spelled differently on the board.
        </div>
      )}
    </div>
  );
}

/* ==================== why is this job back? ==================== *
 * Whether a fix failed, or a part failed, or the job was always going to
 * take three visits, is a judgement only the person scheduling it can
 * make — so it is asked for rather than inferred. One click, and it can be
 * ignored: an unanswered return still counts as a return, it just does not
 * carry a reason, and the dashboard reports that coverage honestly.
 * ============================================================== */

function ReturnPrompts({ prompts, onAnswer, onDismiss }) {
  return (
    <div className="rounded-lg border border-blue-300 bg-blue-50 p-3">
      <h3 className="text-sm font-medium text-blue-900">
        {prompts.length} unit{prompts.length === 1 ? " was" : "s were"} visited recently for similar work
      </h3>
      <p className="text-xs text-blue-800 mt-0.5 mb-2">
        Why is it back? This is the one thing that cannot be worked out from the schedule, and it
        is what separates a fix that did not hold from a guest breaking the same thing twice.
      </p>
      <div className="space-y-2">
        {prompts.map((p) => (
          <div key={p.job.id} className="rounded-md border border-blue-200 bg-white p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-900">
                  {p.job.property} {p.job.unit} — {p.job.description}
                </div>
                <div className="text-[11px] text-slate-500">
                  Last visited {p.date} ({p.gapDays} day{p.gapDays === 1 ? "" : "s"} ago)
                  {p.sameFamily && " · same kind of work"} — “{squash(p.prior.description).slice(0, 70)}”
                </div>
              </div>
              <button onClick={() => onDismiss(p.job)} className="text-slate-400 hover:text-slate-600 shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {RETURN_REASONS.map((r) => (
                <button key={r.id} onClick={() => onAnswer(p.job, r.id, p)} title={r.hint}
                        className={`text-[11px] rounded border px-1.5 py-0.5 hover:bg-slate-50 ${
                          r.ours ? "border-red-200 text-red-800" : "border-slate-300 text-slate-600"}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-blue-700 mt-2">
        Red options are the ones that cost us money and can be designed out.
      </p>
    </div>
  );
}

/* ========================= the day plan ========================= *
 * The scheduling rule made visible: confirmed appointment, then P1, then
 * batch by building. Each line says why it sits where it does, because a
 * plan a coordinator cannot interrogate is one they will quietly ignore.
 * ============================================================== */

function DayPlan({ plan, team, onMoveMany, onTrail }) {
  const [moving, setMoving] = useState(false);
  const over = plan.overflow;

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <h4 className="text-xs font-semibold text-slate-700">Order of work — {team}</h4>
        <span className="text-[11px] text-slate-500">
          {fmtClock(plan.shiftStart)}–{fmtClock(plan.shiftEnd)} · finishes {fmtClock(plan.finishAt)} ·{" "}
          {plan.buildingSwitches} building move{plan.buildingSwitches === 1 ? "" : "s"} ·{" "}
          {formatMinutes(plan.travelMinutes)} travelling
        </span>
      </div>

      {plan.conflicts.length > 0 && (
        <div className="mb-2 space-y-1">
          {plan.conflicts.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span><span className="font-medium">{c.job.property} {c.job.unit}</span> — {c.message}</span>
            </div>
          ))}
        </div>
      )}

      <ol className="space-y-0.5">
        {plan.items.map((it, i) => (
          <li key={it.job.id} className="flex items-baseline gap-2 text-xs">
            <span className="tabular-nums text-slate-500 w-28 shrink-0">
              {fmtClock(it.start)}–{fmtClock(it.end)}
            </span>
            {it.anchored
              ? <Pin className="w-3 h-3 text-blue-600 shrink-0" title="Fixed by a confirmed appointment" />
              : <span className="w-3 shrink-0" />}
            <span className="text-slate-800 truncate max-w-[260px]">
              {displayProperty(it.job.property)} {it.job.unit}
            </span>
            <span className="text-slate-400 truncate flex-1">{it.reason}</span>
            {it.travelBefore > 0 && (
              <span className="text-[10px] text-amber-700 shrink-0">+{it.travelBefore}m travel</span>
            )}
            {!it.estimated && <span className="text-[10px] text-amber-600 shrink-0">assumed 1h</span>}
          </li>
        ))}
        {plan.items.length === 0 && <li className="text-xs text-slate-400">Nothing could be placed in this shift.</li>}
      </ol>

      {over.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2">
          <h5 className="text-xs font-medium text-red-900">
            {over.length} job{over.length === 1 ? "" : "s"} will not fit in this shift
          </h5>
          <p className="text-[11px] text-red-800 mt-0.5 mb-1.5">
            Listed in the order the rule says to shed them — batched work first, then requested
            times, then P1 last. A job that has already been pushed is placed at the bottom of its
            tier, because pushing it again is how jobs used to disappear.
          </p>
          <ul className="space-y-0.5 text-xs">
            {over.map((x) => (
              <li key={x.job.id} className="flex items-baseline gap-2">
                <span className="text-red-900 truncate flex-1">
                  {displayProperty(x.job.property)} {x.job.unit} — {x.job.description}
                </span>
                <span className="text-red-700 shrink-0">{formatMinutes(x.minutes)}</span>
                {(x.job.pushCount || 0) > 0 && (
                  <button onClick={() => onTrail(x.job)} className="text-[10px] text-red-800 underline shrink-0">
                    pushed {x.job.pushCount}×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            disabled={moving}
            onClick={async () => {
              setMoving(true);
              await onMoveMany(over.map((x) => x.job), "Ran out of time");
              setMoving(false);
            }}
            className="mt-2 flex items-center gap-1 text-xs bg-red-700 text-white rounded-md px-2.5 py-1 disabled:opacity-50">
            {moving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
            Move these {over.length} to tomorrow
          </button>
        </div>
      )}
    </div>
  );
}

/* ========================= job row ========================= */

const STATE_CHIP = {
  scheduled: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-700",
  fixed: "bg-emerald-100 text-emerald-700",
  done: "bg-emerald-100 text-emerald-700",
  made_safe: "bg-amber-100 text-amber-800",
  diagnosed: "bg-amber-100 text-amber-800",
  not_done: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400 line-through",
};

function JobRow({ job, me, onAdvance, onEdit, onTogglePms, onMove, onOutcome, onTrail, onEditFull, showToast, suggestFrom, onCloseOut, staffIdx, candidates }) {
  const crew = useMemo(() => checkCrew(job, staffIdx), [job, staffIdx]);
  const [expanded, setExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const mins = jobMinutes(job);
  const pushed = job.pushCount || 0;
  const sev = pushSeverity(job);
  const accessRisk = needsGuestConfirm(job) && squash(job.guestConfirmed).toUpperCase() !== "Y";
  const isAdmin = me.role === "admin";

  function copyPms() {
    navigator.clipboard?.writeText(pmsText(job));
    showToast("Copied — paste into PMS.", "ok");
  }

  return (
    <div className={`px-3 py-2 ${job.state === "cancelled" ? "opacity-55" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${STATE_CHIP[job.state]}`}>
              {STATE_META[job.state]?.short || job.state}
            </span>
            <span className="text-sm font-medium text-slate-900">
              {job.property} {job.unit}
            </span>
            {job.status && <span className="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-500">{job.status}</span>}
            {canonPriority(job.priority) === "PRI-1" && (
              <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-700 font-medium">P1</span>
            )}
            {pushed > 0 && (
              <button onClick={() => onTrail(job)}
                      title={`First scheduled ${job.originDate}. Moved ${pushed} time(s). Click for the full trail.`}
                      className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${sev === "bad" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                pushed {pushed}× · since {job.originDate}
              </button>
            )}
            {accessRisk && (
              <span title="Someone is in the unit and has not confirmed the visit"
                    className="text-[10px] rounded px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">
                unconfirmed
              </span>
            )}
            {job.source && (
              <span title={`Where this job came from: ${SOURCE_LABEL[job.source] || job.source}`}
                    className="text-[10px] rounded px-1.5 py-0.5 bg-slate-50 text-slate-500 border border-slate-200">
                {SOURCE_LABEL[job.source] || job.source}
              </span>
            )}
            {job.unplanned && (
              <span title="Came in after the schedule was posted"
                    className="text-[10px] rounded px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200">
                unplanned
              </span>
            )}
            {job.displacedBy && (
              <span title={`Moved because: ${job.displacedBy.label}`}
                    className="text-[10px] rounded px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200">
                bumped by {squash(job.displacedBy.label).slice(0, 34)}
              </span>
            )}
            {(job.displaced || []).length > 0 && (
              <span title="This job took another job's slot"
                    className="text-[10px] rounded px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200">
                took {job.displaced.length} slot{job.displaced.length === 1 ? "" : "s"}
              </span>
            )}
            {job.followUpOf && (
              <span title={`Finishes work started on ${job.followUpOf.date}`}
                    className="text-[10px] rounded px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 inline-flex items-center gap-0.5">
                <CornerDownRight className="w-2.5 h-2.5" /> follow-up from {job.followUpOf.date}
              </span>
            )}
            {crew.requirement.people > 1 && (
              <span title={`${crew.requirement.why} (${crew.requirement.source === "text" ? "from the task text" : crew.requirement.source === "override" ? "set on the job" : "rule"})`}
                    className={`text-[10px] rounded px-1.5 py-0.5 border ${
                      crew.short ? "bg-red-100 text-red-800 border-red-300 font-medium"
                                 : "bg-slate-50 text-slate-600 border-slate-200"}`}>
                {crew.crew.length}/{crew.requirement.people} people
              </span>
            )}
            {crew.issues.some((i) => i.id === "trade") && (
              <span title={crew.issues.find((i) => i.id === "trade").text}
                    className="text-[10px] rounded px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200">
                wants a {TRADE_LABEL[crew.requirement.trade] || crew.requirement.trade}
              </span>
            )}
            {crew.issues.some((i) => i.id === "driver") && (
              <span title={crew.issues.find((i) => i.id === "driver").text}
                    className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-800 border border-red-300 font-medium">
                no driver
              </span>
            )}
            {needsFollowUp(job.state) && !job.followUpJobId && (
              <span title="Contained but not finished, and nothing is booked to come back"
                    className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-800 border border-red-300 font-medium inline-flex items-center gap-0.5">
                <ShieldAlert className="w-2.5 h-2.5" /> no follow-up booked
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-0.5">{job.description || <span className="text-slate-400">no task written</span>}</p>
          {squash(job.stillNeeded) && (
            <p className="text-xs text-amber-800 mt-0.5">
              <span className="font-medium">Still needed:</span> {job.stillNeeded}
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-400 mt-0.5">
            {mins != null ? <span>{formatMinutes(mins)}</span> : <span className="text-amber-600">no estimate</span>}
            {(() => {
              const a = actualDuration(job);
              if (a.minutes == null) return null;
              const over = mins != null && a.minutes > mins * 1.25;
              return (
                <span className={over ? "text-amber-700" : "text-emerald-700"}
                      title={a.source === "measured" ? "Measured between Start and Done" : "Entered by hand"}>
                  took {formatMinutes(a.minutes)}
                </span>
              );
            })()}
            {job.timeOfVisit && <span>{job.timeOfVisit}</span>}
            {job.outcomeReason && <span className="text-red-600">{job.outcomeReason}</span>}
            <button onClick={() => setExpanded((v) => !v)} className="underline hover:text-slate-600">
              {expanded ? "less" : "more"}
            </button>
            <button onClick={() => onTrail(job)} className="underline hover:text-slate-600 flex items-center gap-0.5">
              <History className="w-3 h-3" /> history ({(job.events || []).length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Outcome actions — the admin's job, but on the coordinator's card.
              This is what removes the second pass in a second tool. */}
          {job.state !== "cancelled" && (
            <>
              {job.state === "scheduled" && (
                <IconBtn title="Started" onClick={() => onAdvance(job, "in_progress")} tone="blue"><Play className="w-3.5 h-3.5" /></IconBtn>
              )}
              <IconBtn title="Close out — fixed, made safe, or diagnosed"
                       onClick={() => onCloseOut(job)} tone="emerald"
                       active={isResolved(job.state)}>
                <Check className="w-3.5 h-3.5" />
              </IconBtn>
              <IconBtn title="Not done" onClick={() => onOutcome({ job, kind: "not_done" })} tone="red" active={job.state === "not_done"}>
                <X className="w-3.5 h-3.5" />
              </IconBtn>
              <IconBtn title="Move to another day" onClick={() => onMove(job)} tone="slate">
                <ArrowRight className="w-3.5 h-3.5" />
              </IconBtn>
            </>
          )}
          {suggestFrom && (
            <IconBtn title="Suggest a technician using the scheduling rule"
                     onClick={() => setSuggestions(suggestions ? null : suggestTechnician(job, suggestFrom, { staffIdx, requirement: crew.requirement, candidates }))}
                     tone="slate">
              <Wand2 className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          <IconBtn title="Copy for PMS" onClick={copyPms} tone="slate"><Clipboard className="w-3.5 h-3.5" /></IconBtn>
          <button onClick={() => onTogglePms(job)}
                  title="Is this job recorded in PMS?"
                  className={`text-[10px] rounded px-1.5 py-1 border ${
                    job.inPms === true ? "bg-slate-900 text-white border-slate-900"
                    : job.inPms === false ? "bg-red-50 text-red-700 border-red-300"
                    : "border-slate-300 text-slate-400"}`}>
            PMS {job.inPms === true ? "✓" : job.inPms === false ? "✕" : "?"}
          </button>
        </div>
      </div>

      {suggestions && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <p className="text-[11px] text-slate-500 mb-1">
            By the rule — the right trade and somebody who can drive, then already going to that
            building, then room in the shift.
            {crew.requirement.people > 1 && (
              <span className="text-amber-700"> This job needs {crew.requirement.people} people — {crew.requirement.why}.</span>
            )}
          </p>
          {suggestions.length === 0 && <p className="text-xs text-slate-400">Nobody is scheduled today yet.</p>}
          <div className="space-y-1">
            {suggestions.slice(0, 3).map((s) => (
              <div key={s.tech} className="flex items-center gap-2 text-xs">
                <button onClick={() => { onEdit(job, { team: s.tech }); setSuggestions(null); }}
                        className="border border-slate-300 rounded px-2 py-0.5 hover:bg-slate-50 font-medium shrink-0">
                  {s.tech}
                </button>
                <span className={s.loadPct > 100 ? "text-red-600" : "text-slate-500"}>{s.loadPct}%</span>
                <span className="text-slate-500 truncate">{s.why.join(" · ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t border-slate-100 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <InlineField label="Technician" value={job.team} onSave={(v) => onEdit(job, { team: v })} />
          <InlineField label="Estimate" value={job.estimatedTime} onSave={(v) => onEdit(job, { estimatedTime: v })} placeholder="1 hr" />
          <InlineField label="Visit time" value={job.timeOfVisit} onSave={(v) => onEdit(job, { timeOfVisit: v })} />
          <InlineSelect label="Guest confirmed" value={job.guestConfirmed}
                        options={[["", "not asked"], ["Y", "yes"], ["N", "no"]]}
                        onSave={(v) => onEdit(job, { guestConfirmed: v })} />
          <InlineField label="Unit state" value={job.status} onSave={(v) => onEdit(job, { status: v })} />
          <InlineField label="Priority" value={job.priority} onSave={(v) => onEdit(job, { priority: v })} placeholder="P2-High" />
          <InlineField label="Material" value={job.materialDetails} onSave={(v) => onEdit(job, { materialDetails: v, materialNeeded: v ? "Y" : job.materialNeeded })} placeholder="item + qty" />
          <label className="block text-[11px] text-slate-500">
            People needed
            <input type="number" min="1" max="8"
                   value={job.crewNeeded ?? ""}
                   onChange={(e) => onEdit(job, { crewNeeded: e.target.value === "" ? "" : Number(e.target.value) })}
                   placeholder={`${crew.requirement.people} — ${crew.requirement.why}`}
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1 text-sm" />
          </label>
          <InlineSelect label="Where it came from" value={job.source}
                        options={[["", "not set"], ...JOB_SOURCES.map((x) => [x.id, x.label])]}
                        onSave={(v) => onEdit(job, { source: v })} />
          <InlineField label="Reported by" value={job.reportedBy} onSave={(v) => onEdit(job, { reportedBy: v })} placeholder="support agent / HK / GRO" />
          <InlineField label="PMS ref" value={job.pmsRef} onSave={(v) => onEdit(job, { pmsRef: v })} placeholder="TSK401787" />
          <InlineField label="Task" value={job.description} onSave={(v) => onEdit(job, { description: v })} full />
          <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
            {onEditFull && (
              <button onClick={() => onEditFull(job)} className="text-xs border border-slate-300 rounded-md px-2 py-1 hover:bg-slate-50">
                Open full form
              </button>
            )}
            {/* Cancelling is only available before the visit happens. Once a
                technician has been and an outcome is recorded, that is a fact
                about the day and there is no route in the app that removes it —
                the whole point of the design is that nothing disappears. */}
            {job.state !== "cancelled" && !isResolved(job.state) && (
              <button onClick={() => onOutcome({ job, kind: "cancel" })}
                      className="text-xs text-red-700 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50 flex items-center gap-1">
                <Ban className="w-3 h-3" /> Cancel this job
              </button>
            )}
            {isResolved(job.state) && (
              <span className="text-[11px] text-slate-400 self-center">
                Closed out — it stays on the record. Reopen it from the history if it was a mistake.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, children, tone = "slate", active }) {
  const tones = {
    slate: "border-slate-300 text-slate-500 hover:bg-slate-50",
    blue: "border-blue-300 text-blue-600 hover:bg-blue-50",
    emerald: "border-emerald-300 text-emerald-600 hover:bg-emerald-50",
    red: "border-red-300 text-red-600 hover:bg-red-50",
  };
  const on = {
    blue: "bg-blue-600 text-white border-blue-600",
    emerald: "bg-emerald-600 text-white border-emerald-600",
    red: "bg-red-600 text-white border-red-600",
    slate: "bg-slate-900 text-white border-slate-900",
  };
  return (
    <button title={title} onClick={onClick}
            className={`rounded-md border p-1.5 transition-colors ${active ? on[tone] : tones[tone]}`}>
      {children}
    </button>
  );
}

function InlineField({ label, value, onSave, placeholder, full }) {
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);
  return (
    <label className={`block text-[11px] text-slate-500 ${full ? "sm:col-span-2 lg:col-span-4" : ""}`}>
      {label}
      <input value={v} onChange={(e) => setV(e.target.value)}
             onBlur={() => { if ((value || "") !== v) onSave(v); }}
             onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
             placeholder={placeholder}
             className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1 text-sm" />
    </label>
  );
}

function InlineSelect({ label, value, options, onSave }) {
  return (
    <label className="block text-[11px] text-slate-500">
      {label}
      <select value={value || ""} onChange={(e) => onSave(e.target.value)}
              className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/* ========================= left this day ========================= */

function LeftThisDay({ tombs, cancelled, onOpenDate, onTrail }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-medium text-slate-700">
        Left this day ({tombs.length + cancelled.length})
      </h3>
      <p className="text-xs text-slate-500 mt-0.5 mb-2">
        Everything that was on this day and is not any more, and where it went. This section is
        the reason a job can no longer quietly disappear.
      </p>
      <ul className="space-y-1 text-xs">
        {tombs.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
            <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="text-slate-700">{t.snapshot.property} {t.snapshot.unit}</span>
            <span className="text-slate-500 truncate">— {t.snapshot.description}</span>
            <button onClick={() => onOpenDate(t.toDate)} className="text-blue-700 underline">
              moved to {t.toDate}
            </button>
            <span className="text-slate-400">by {t.by} at {clock(t.at)}</span>
            {t.reason && <span className="text-slate-500">· {MOVE_REASON_LABEL[t.reason] || t.reason}</span>}
            {t.displacedBy && (
              <span className="text-blue-700">· made way for {squash(t.displacedBy.label).slice(0, 46)}</span>
            )}
          </li>
        ))}
        {cancelled.map((j) => (
          <li key={j.id} className="flex flex-wrap items-baseline gap-x-2">
            <X className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="text-slate-700 line-through">{j.property} {j.unit}</span>
            <span className="text-slate-500 truncate">— {j.description}</span>
            <span className="text-slate-500">cancelled{j.outcomeReason ? `: ${j.outcomeReason}` : ""}</span>
            <button onClick={() => onTrail(j)} className="text-blue-700 underline">history</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ========================= dialogs ========================= */

function MoveDialog({ job, fromDate, dayJobs, onCancel, onMove }) {
  const [to, setTo] = useState(addDays(fromDate, 1));
  const [reason, setReason] = useState(MOVE_REASONS[0].id);
  const [winnerId, setWinnerId] = useState("");
  const [winnerText, setWinnerText] = useState("");

  const displaces = moveReasonDisplaces(reason);

  /* Candidates for "what took the slot": the other jobs on this day, most
     recently added first, since whatever bumped this one is usually the
     thing that just arrived. */
  const others = useMemo(
    () => (dayJobs || [])
      .filter((j) => j.id !== job.id && j.state !== "cancelled")
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 40),
    [dayJobs, job.id]
  );

  const displacedBy = displaces
    ? {
        jobId: winnerId,
        label: winnerId
          ? (() => { const w = others.find((o) => o.id === winnerId); return w ? `${w.property} ${w.unit} — ${w.description}` : ""; })()
          : squash(winnerText),
      }
    : null;

  const canMove = !displaces || !!(winnerId || squash(winnerText));

  return (
    <Modal title={`Move ${job.property} ${job.unit}`} onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">
        {fromDate} keeps a record that this job left and where it went. The job carries its
        history with it — it will show as pushed {(job.pushCount || 0) + 1}× on the new day.
      </p>

      <label className="block text-xs text-slate-600 mt-3">
        Move to
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
               className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      </label>
      <div className="flex gap-1.5 mt-1.5">
        {[1, 2, 7].map((n) => (
          <button key={n} onClick={() => setTo(addDays(fromDate, n))}
                  className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-50">
            +{n} day{n > 1 ? "s" : ""}
          </button>
        ))}
      </div>

      <label className="block text-xs text-slate-600 mt-3">
        Why is it moving?
        <select value={reason} onChange={(e) => { setReason(e.target.value); setWinnerId(""); setWinnerText(""); }}
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          {MOVE_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>

      {displaces && (
        <div className="mt-3 rounded-md border border-blue-300 bg-blue-50 p-2.5">
          <h4 className="text-xs font-medium text-blue-900">What took the slot?</h4>
          <p className="text-[11px] text-blue-800 mt-0.5 mb-2">
            This is a judgement call — one piece of work was preferred over another. Recording
            both halves is what lets anyone look back and ask whether it was the right one. Without
            it, all the record shows is that a job moved.
          </p>
          <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)}
                  className="w-full border border-blue-300 rounded-md px-2 py-1.5 text-sm bg-white">
            <option value="">— pick the job that took it, or describe it below —</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.property} {o.unit} — {squash(o.description).slice(0, 60)}
                {canonPriority(o.priority) ? ` [${o.priority}]` : ""}
              </option>
            ))}
          </select>
          {!winnerId && (
            <input value={winnerText} onChange={(e) => setWinnerText(e.target.value)}
                   placeholder="e.g. emergency leak at Marina Gate 2 3705"
                   className="mt-1.5 w-full border border-blue-300 rounded-md px-2 py-1.5 text-sm bg-white" />
          )}
          {winnerId && (() => {
            const w = others.find((o) => o.id === winnerId);
            const a = canonPriority(job.priority), bpr = w && canonPriority(w.priority);
            if (!w || !a || !bpr || a <= bpr) return null;
            // a <= bpr means the displaced job is the higher priority
            return (
              <p className="mt-1.5 text-[11px] text-amber-900 bg-amber-100 border border-amber-300 rounded px-2 py-1">
                Worth a second look: you are moving a {job.priority} to make room for a {w.priority}.
                That may still be right — it is recorded either way.
              </p>
            );
          })()}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button disabled={!canMove}
                onClick={() => onMove(to, reason, displacedBy)}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          Move to {to}
        </button>
      </div>
      {displaces && !canMove && (
        <p className="text-[11px] text-blue-700 mt-1.5 text-right">
          Say what took the slot before moving it.
        </p>
      )}
    </Modal>
  );
}

function OutcomeDialog({ job, kind, selectedDate, onCancel, onConfirm }) {
  const list = kind === "cancel" ? CANCEL_REASONS : NOT_DONE_REASONS;
  const [reason, setReason] = useState(list[0]);
  const [other, setOther] = useState("");
  /* "" means the coordinator has not answered yet; "none" is a deliberate
     "we are not rebooking it", which is a different thing from silence and
     is recorded as such. */
  const [rebook, setRebook] = useState("");
  const [when, setWhen] = useState(addDays(selectedDate, 1));
  const saying = reason === SAY_WHAT_HAPPENED;
  const final = saying ? squash(other) : reason;
  const asking = kind !== "cancel";
  const ready = !!final && (!asking || rebook !== "");

  return (
    <Modal title={kind === "cancel" ? `Cancel ${job.property} ${job.unit}` : `Not done — ${job.property} ${job.unit}`} onCancel={onCancel}>
      <p className="text-xs text-slate-600">
        {kind === "cancel"
          ? "The job stays on the day with the reason attached, so it is visible rather than gone."
          : "The reason is what turns a missed job into something you can act on later."}
      </p>
      <select value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-3 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
        {list.map((r) => <option key={r} value={r}>{r}</option>)}
        <option value={SAY_WHAT_HAPPENED}>None of these — say what happened</option>
      </select>
      {saying && (
        <input autoFocus value={other} onChange={(e) => setOther(e.target.value)}
               placeholder="In your own words — this is what gets counted"
               className="mt-2 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      )}

      {/* The question the app never asked. A job marked not done used to sit
          on a day that had already passed, with nobody booked to go back —
          which is exactly how work went missing before. */}
      {asking && (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="text-xs font-medium text-slate-800">When does it happen instead?</div>
          <div className="mt-2 space-y-1.5">
            {[
              { id: "next", label: `Book it for ${addDays(selectedDate, 1)}` },
              { id: "pick", label: "Book it for another day" },
              { id: "none", label: "Not rebooking it — the guest or the building will raise it again" },
            ].map((o) => (
              <label key={o.id} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="radio" name="rebook" className="mt-0.5"
                       checked={rebook === o.id} onChange={() => setRebook(o.id)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          {rebook === "pick" && (
            <input type="date" value={when} min={selectedDate}
                   onChange={(e) => setWhen(e.target.value)}
                   className="mt-2 border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          )}
          {rebook === "none" && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
              This is recorded as a decision, not an oversight. It shows on the dashboard as work
              that was dropped rather than rescheduled.
            </p>
          )}
          {rebook === "" && (
            <p className="mt-2 text-xs text-slate-500">Pick one — a missed job with no answer here is how work used to disappear.</p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Back</button>
        <button onClick={() => onConfirm(final, asking
                  ? { rebook, date: rebook === "next" ? addDays(selectedDate, 1) : rebook === "pick" ? when : null }
                  : null)}
                disabled={!ready}
                className={`text-sm text-white px-3 py-1.5 rounded-md disabled:opacity-40 ${kind === "cancel" ? "bg-slate-700" : "bg-red-600"}`}>
          {kind === "cancel" ? "Cancel job" : "Mark not done"}
        </button>
      </div>
    </Modal>
  );
}

/* ==================== closing a job out ==================== *
 * The dialog that replaces a single "Done" button.
 *
 * PMS marks a task Done when a technician stops working on it. One of the
 * real examples reads "Pending work - the existing 28mm copper pipe is
 * pinched and needs to be replaced", lists the copper pipe and unions
 * still required, and its PMS status is Done. Nothing was fixed. The
 * distinction between finishing a job and stopping work on it is the whole
 * point of this screen.
 * ========================================================== */

function CloseOutDialog({ job, selectedDate, onCancel, onConfirm }) {
  const [outcome, setOutcome] = useState(null);
  const [report, setReport] = useState("");
  const [parsed, setParsed] = useState(null);
  const [stillNeeded, setStillNeeded] = useState("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("");
  const [fuDate, setFuDate] = useState(addDays(selectedDate, 1));
  const [fuTeam, setFuTeam] = useState(job.team || "");
  const [fuScope, setFuScope] = useState("");

  const isP1 = canonPriority(job.priority) === "PRI-1";

  function readReport(text) {
    setReport(text);
    if (!squash(text)) { setParsed(null); return; }
    const r = parseWorkReport(text);
    setParsed(r);
    if (r.minutes != null) setMinutes(String(r.minutes));
    const needed = r.stillNeeded;
    if (needed) setStillNeeded(needed);
    if (r.summary) setReason(r.summary.slice(0, 200));
    if (r.suggestedOutcome && outcome === null) setOutcome(r.suggestedOutcome);
    if (needed) setFuScope(r.materials.length ? `Fit / replace: ${needed}` : needed);
  }

  const requiresFollowUp = needsFollowUp(outcome);
  const canConfirm = outcome && (!requiresFollowUp || (squash(stillNeeded) && fuDate));

  return (
    <Modal title={`Close out — ${job.property} ${job.unit}`} onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">{job.description}</p>

      <label className="block text-xs text-slate-600 mt-3">
        <span className="flex items-center gap-1">
          <FileText className="w-3 h-3" /> Paste the technician's report from PMS
          <span className="text-slate-400">— optional, but it fills everything below</span>
        </span>
        <textarea value={report} onChange={(e) => readReport(e.target.value)} rows={4}
                  placeholder={"Arrived @ 7:58pm\nFinished @ 8:40pm\n- closed the valve to stop the leak\nMaterial Required:\n- water heater"}
                  className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono" />
      </label>

      {parsed && (
        <div className="mt-1 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
          {parsed.minutes != null
            ? <>On site {fmtMin(parsed.arrivalMin)} → {fmtMin(parsed.departureMin)} · <span className="font-medium">{formatMinutes(parsed.minutes)}</span>. </>
            : <>No arrival/departure times found. </>}
          {parsed.materials.length > 0 && <>Material still required: <span className="font-medium">{parsed.materials.join(", ")}</span>. </>}
          {parsed.suggestedOutcome && (
            <>Reads like <span className="font-medium">{OUTCOME_OPTIONS.find((o) => o.id === parsed.suggestedOutcome)?.label}</span> — {parsed.why}. You decide.</>
          )}
        </div>
      )}

      <div className="mt-3">
        <span className="text-xs text-slate-600">What actually happened?</span>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          {OUTCOME_OPTIONS.map((o) => (
            <button key={o.id} onClick={() => setOutcome(o.id)}
                    className={`text-left rounded-md border p-2 ${
                      outcome === o.id
                        ? o.needsFollowUp ? "border-amber-500 bg-amber-50" : "border-slate-900 bg-slate-50"
                        : "border-slate-300 hover:bg-slate-50"}`}>
              <div className="text-xs font-medium text-slate-900">{o.label}</div>
              <div className="text-[10px] text-slate-500 leading-snug">{o.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {outcome === "not_done" && (
        <label className="block text-xs text-slate-600 mt-3">
          Why not?
          <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">— pick a reason —</option>
            {NOT_DONE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      )}

      {requiresFollowUp && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5">
          <h4 className="text-xs font-medium text-amber-900">
            This is not finished — book the visit that finishes it
          </h4>
          <p className="text-[11px] text-amber-800 mt-0.5 mb-2">
            A closed valve is a stopped leak, not a repaired one. The follow-up is created now and
            linked to this job, so it cannot be lost in a comment thread.
            {isP1 && " This is a P1, so it stays a P1 until the work is actually done."}
          </p>
          <label className="block text-[11px] text-amber-900">
            What is still needed
            <input value={stillNeeded} onChange={(e) => setStillNeeded(e.target.value)}
                   placeholder="e.g. new water heater, paint for the ceiling"
                   className="mt-0.5 w-full border border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white" />
          </label>
          <div className="grid sm:grid-cols-3 gap-2 mt-2">
            <label className="block text-[11px] text-amber-900">
              Come back on
              <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)}
                     className="mt-0.5 w-full border border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white" />
            </label>
            <label className="block text-[11px] text-amber-900">
              Technician
              <input value={fuTeam} onChange={(e) => setFuTeam(e.target.value)}
                     placeholder="leave blank to decide later"
                     className="mt-0.5 w-full border border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white" />
            </label>
            <label className="block text-[11px] text-amber-900">
              Scope of the return visit
              <input value={fuScope} onChange={(e) => setFuScope(e.target.value)}
                     placeholder="defaults to what is still needed"
                     className="mt-0.5 w-full border border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white" />
            </label>
          </div>
          <div className="flex gap-1.5 mt-1.5">
            {[["Today", selectedDate], ["Tomorrow", addDays(selectedDate, 1)], ["+3 days", addDays(selectedDate, 3)]].map(([l, d]) => (
              <button key={l} onClick={() => setFuDate(d)}
                      className="text-[11px] border border-amber-300 rounded px-2 py-0.5 bg-white hover:bg-amber-100">{l}</button>
            ))}
          </div>
        </div>
      )}

      {outcome && outcome !== "not_done" && (
        <label className="block text-xs text-slate-600 mt-3">
          Time on site (minutes)
          <input type="number" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)}
                 placeholder={parsed && parsed.minutes != null ? String(parsed.minutes) : "from the report, or leave blank"}
                 className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button disabled={!canConfirm}
                onClick={() => onConfirm({
                  outcome, reason: reason || "", stillNeeded,
                  actualMinutes: minutes === "" ? null : Number(minutes),
                  followUp: requiresFollowUp
                    ? { date: fuDate, team: fuTeam, scope: fuScope || stillNeeded, materials: stillNeeded }
                    : null,
                })}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          {requiresFollowUp ? `Close and book ${fuDate}` : "Close out"}
        </button>
      </div>
      {requiresFollowUp && !squash(stillNeeded) && (
        <p className="text-[11px] text-amber-700 mt-1.5 text-right">
          Say what is still needed before closing — that text becomes the return visit.
        </p>
      )}
    </Modal>
  );
}

/* ==================== out-of-hours log ==================== */

function NightLogDialog({ selectedDate, knownTechs, onCancel, onSave }) {
  const [date, setDate] = useState(addDays(selectedDate, -1));
  const [text, setText] = useState("");
  const [team, setTeam] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const [how, setHow] = useState(HOW_REPORTED[0]);
  const [priority, setPriority] = useState("P1-Urgent");
  const [pmsRef, setPmsRef] = useState("");

  const parsedLine = useMemo(
    () => (text.trim() ? parseQuickAdd(text, { techs: knownTechs }) : null),
    [text, knownTechs]
  );

  return (
    <Modal title="Log an out-of-hours job" onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">
        The night call, the emergency, the job arranged over Google Chat while nobody was looking at
        the schedule. It happened and it consumed a technician, so it belongs on the day it
        happened — otherwise the only record is a chat thread and a PMS task nobody links back.
      </p>

      <div className="grid sm:grid-cols-2 gap-2 mt-3">
        <label className="block text-xs text-slate-600">
          Which day did it happen?
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                 className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-xs text-slate-600">
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            {["P1-Urgent", "P2-High", "P3-Medium", "P4-Routine"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      <label className="block text-xs text-slate-600 mt-2">
        What happened — same one line as the board
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
               placeholder="Marina Gate 2 3705 water leak from washroom 1h Anthony occupied"
               className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      </label>
      {parsedLine && <div className="mt-1"><ParsePreview fields={parsedLine.fields} /></div>}

      <div className="grid sm:grid-cols-3 gap-2 mt-2">
        <label className="block text-xs text-slate-600">
          Who attended
          <input value={team} onChange={(e) => setTeam(e.target.value)}
                 placeholder="night technician"
                 className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-xs text-slate-600">
          Reported by
          <input value={reportedBy} onChange={(e) => setReportedBy(e.target.value)}
                 placeholder="support agent"
                 className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-xs text-slate-600">
          How it reached us
          <select value={how} onChange={(e) => setHow(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            {HOW_REPORTED.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      </div>

      <label className="block text-xs text-slate-600 mt-2">
        PMS task ref
        <input value={pmsRef} onChange={(e) => setPmsRef(e.target.value)} placeholder="TSK401787"
               className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      </label>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button disabled={!text.trim()}
                onClick={() => onSave({
                  ...(parsedLine ? parsedLine.fields : {}),
                  team: team || (parsedLine && parsedLine.fields.team) || "",
                  priority,
                  source: "emergency",
                  reportedBy, howReported: how, pmsRef, inPms: pmsRef ? true : null,
                }, date)}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          Log it against {date}
        </button>
      </div>
    </Modal>
  );
}

function TrailDrawer({ job, onClose }) {
  const events = (job.events || []).slice().sort((a, b) => a.at - b.at);
  return (
    <Modal title={`${job.property} ${job.unit}`} onCancel={onClose} wide>
      <p className="text-xs text-slate-500">
        First scheduled {job.originDate}
        {job.pushCount > 0 && ` · moved ${job.pushCount} time${job.pushCount === 1 ? "" : "s"} since`}
        {" · "}now on {job.scheduledDate}
      </p>
      <ol className="mt-3 space-y-2">
        {events.map((e, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-800">
                <span className="font-medium">{EVENT_LABEL[e.kind] || e.kind}</span>
                {e.to && e.from && <span className="text-slate-500"> · {e.from} → {e.to}</span>}
                {e.reason && <span className="text-slate-600"> · {e.reason}</span>}
              </div>
              {e.changes && (
                <ul className="text-slate-500 mt-0.5">
                  {e.changes.map((c, k) => (
                    <li key={k}>{c.label}: {c.from || "—"} → {c.to || "—"}</li>
                  ))}
                </ul>
              )}
              <div className="text-slate-400">
                {e.by} · {new Date(e.at).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

function Modal({ title, children, onCancel, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={`bg-white rounded-lg shadow-xl w-full ${wide ? "max-w-lg" : "max-w-sm"} mt-16 p-4`}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

/* ====================================================================== *
 * Mirroring the PMS task list onto a day.
 *
 * From today the rule is that every task created in PMS is also here,
 * entered by the evening coordinator. They have just finished creating
 * those tasks; keying them again would be the double entry this whole
 * project exists to remove. So it is one copy and one paste, and the
 * parse is always shown before anything is written.
 * ====================================================================== */
function TaskPasteDialog({ date, onCancel, onCommit }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);

  function read(v) {
    setText(v);
    if (!squash(v)) { setPreview(null); return; }
    setPreview(parseAnyPaste(v, date, parseSheetPaste));
  }

  const rows = preview?.jobs || [];
  const dates = preview?.dates || [];
  const elsewhere = dates.filter((d) => d && d !== date);
  const withTime = rows.filter((r) => squash(r.timeOfVisit)).length;
  const withOcc = rows.filter((r) => squash(r.status)).length;
  const withTech = rows.filter((r) => squash(r.team)).length;

  return (
    <Modal title="Paste the day in" onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">
        Two things paste in here and the box works out which is which: <b>the daily Google Sheet</b>
        exactly as the coordinator fills it, or <b>the PMS task list</b>. Select the table including
        its heading row and paste. Column order does not matter, and anything already in the app
        with the same TSK reference is skipped — so pasting the same thing twice is safe.
      </p>
      <textarea autoFocus value={text} onChange={(e) => read(e.target.value)} rows={7}
                placeholder="Number	Title	Property	Subcategory	Priority	Status	Assignees	Due date	Duration"
                className="mt-2 w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs font-mono" />

      {preview?.error && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
          {preview.error}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
            <span className="rounded px-1.5 bg-slate-900 text-white text-[11px]">
              {preview.format === "sheet" ? "daily sheet" : "PMS task list"}
            </span>
            <span><b className="text-slate-900">{rows.length}</b> task(s) read</span>
            <span><b>{withTech}</b> already have a technician</span>
            <span><b>{withOcc}</b> carry the unit state</span>
            <span><b>{withTime}</b> have a confirmed time</span>
            {preview.skipped > 0 && <span className="text-amber-700">{preview.skipped} row(s) unreadable</span>}
          </div>
          {preview.format === "pms" && (
            <p className="text-[11px] text-slate-500 mt-1">
              Unit state and appointment times are read out of the title prefix — <code>GC 2-4pm</code>,
              <code> vacant</code>, <code>B2B</code>, <code>WC</code> — so they do not have to be typed
              again. A confirmed time is the first thing the day gets planned around.
            </p>
          )}
          {elsewhere.length > 0 && (
            <p className="mt-2 text-xs text-slate-800 bg-slate-100 border border-slate-200 rounded px-2 py-1.5">
              These rows carry their own dates and will go to {dates.join(", ")} — not to {date}.
              The sheet is trusted over whichever day happens to be open, because the evening
              coordinator builds tomorrow while looking at today.
            </p>
          )}
          <div className="mt-2 max-h-64 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
            {rows.map((r, i) => (
              <div key={i} className="px-2 py-1.5 text-xs flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-slate-900">{r.property} {r.unit}</span>
                <span className="text-slate-600 flex-1 min-w-0 truncate">{r.description}</span>
                {r.status && <span className="text-[11px] rounded px-1.5 bg-slate-100 text-slate-600">{r.status}</span>}
                {r.timeOfVisit && <span className="text-[11px] rounded px-1.5 bg-emerald-100 text-emerald-800">{r.timeOfVisit}</span>}
                {r.team && <span className="text-[11px] text-slate-500">{r.team}</span>}
                {r.estimatedTime && <span className="text-[11px] text-slate-400">{r.estimatedTime}</span>}
                {r.pmsRef && <span className="text-[11px] font-mono text-slate-400">{r.pmsRef}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button onClick={() => onCommit(rows)} disabled={!rows.length}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          Add {rows.length || ""} to {dates.length === 1 ? dates[0] : dates.length > 1 ? `${dates.length} days` : date}
        </button>
      </div>
    </Modal>
  );
}

/* ====================================================================== *
 * The end-of-day review.
 *
 * The other half of the department's rule: before the morning coordinator
 * leaves, they say how the day actually went. Until now that meant opening
 * each card in turn, which is why it never happened and why nobody could
 * say what really took place.
 *
 * So it is one list, one line per job, and the two common answers are one
 * click. Anything that was not a clean fix goes to the full close-out,
 * because "made safe" and "not done" both have a question behind them that
 * must not be skipped — what is still needed, and when it happens instead.
 * ====================================================================== */
function DayReview({ date, jobs, onCancel, onCloseOut, onQuick }) {
  const open = jobs.filter((j) => !isResolved(j.state) && j.state !== "cancelled");
  const done = jobs.filter((j) => isResolved(j.state) || j.state === "cancelled");

  return (
    <Modal title={`How did ${date} actually go?`} onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">
        Every job needs an answer before the day closes. A clean fix is one click. Anything else —
        made safe, diagnosed, not done — opens the full close-out, because each of those has a
        question behind it that decides whether the work comes back.
      </p>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span className={open.length ? "text-amber-800 font-medium" : "text-emerald-700 font-medium"}>
          {open.length} still without an outcome
        </span>
        <span className="text-slate-500">{done.length} of {jobs.length} answered</span>
      </div>

      {open.length === 0 ? (
        <p className="mt-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-2">
          Every job on this day has an outcome. Nothing here will quietly disappear.
        </p>
      ) : (
        <div className="mt-3 max-h-[26rem] overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
          {open.map((j) => (
            <div key={j.id} className="px-2.5 py-2 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-900">
                  {j.property} {j.unit}
                  {j.team && <span className="font-normal text-slate-400"> · {j.team}</span>}
                  {j.timeOfVisit && <span className="font-normal text-slate-400"> · {j.timeOfVisit}</span>}
                </div>
                <div className="text-xs text-slate-600 truncate">{j.description}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => onQuick(j, "fixed")}
                        className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded-md">
                  Fixed
                </button>
                <button onClick={() => onCloseOut(j)}
                        className="text-xs border border-slate-300 bg-white px-2.5 py-1 rounded-md">
                  Something else…
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">
          {open.length ? "Close for now" : "Done"}
        </button>
      </div>
    </Modal>
  );
}

/* ====================================================================== *
 * The day's log.
 *
 * Three coordinators rotate through the same desk and nobody could say who
 * built a given schedule or who changed it at eleven in the morning. Every
 * event has carried a name and a timestamp all along; they were written
 * onto individual jobs and never read back together.
 *
 * Changes after the day closed are marked, because those are the ones a
 * manager is actually looking for. Recording an outcome is not a change and
 * is not flagged as one.
 * ====================================================================== */
function DayLog({ date, activity, onCancel }) {
  const [only, setOnly] = useState("all");
  const rows = activity.timeline.filter((t) =>
    only === "all" ? true : only === "changes" ? t.change : t.group === only);

  const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = (at) => new Date(at).toLocaleDateString();

  return (
    <Modal title={`Who did what on ${date}`} onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">{attributionLine(activity) || "Nothing recorded on this day yet."}</p>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        <LogStat label="Built the schedule" people={activity.builtBy} unit="jobs" />
        <LogStat label="Changed it after it closed" people={activity.changedBy} unit="changes" warn />
        <LogStat label="Recorded what happened" people={activity.recordedBy} unit="updates" />
        <div className="rounded-md border border-slate-200 bg-white p-2">
          <div className="text-[11px] text-slate-500">Posted</div>
          <div className="text-xs text-slate-900 mt-0.5">
            {activity.posted
              ? <>{activity.posted.by}<div className="text-[11px] text-slate-400">{clock(activity.posted.at)}</div></>
              : <span className="text-slate-400">not posted</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        {[["all", "Everything"], ["changes", "Changes after it closed"], ["planning", "Schedule"], ["doing", "Outcomes"]].map(([id, label]) => (
          <button key={id} onClick={() => setOnly(id)}
                  className={`text-xs rounded-md px-2.5 py-1 border ${only === id ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400 py-4 text-center">Nothing under this filter.</p>
      ) : (
        <div className="mt-2 max-h-[24rem] overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
          {rows.map((t, i) => (
            <div key={i} className={`px-2.5 py-1.5 text-xs flex flex-wrap items-baseline gap-x-2 ${t.change ? "bg-amber-50/60" : ""}`}>
              <span className="text-slate-400 tabular-nums shrink-0" title={day(t.at)}>{clock(t.at)}</span>
              <span className="font-medium text-slate-900 shrink-0">{t.by}</span>
              <span className="text-slate-700">{t.label}</span>
              <span className="text-slate-500 flex-1 min-w-0 truncate">{t.job}</span>
              {t.reason && <span className="text-[11px] text-slate-500 italic">“{t.reason}”</span>}
              {t.change && (
                <span className="text-[11px] rounded px-1.5 bg-amber-200 text-amber-900 shrink-0">
                  after it closed
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-[11px] text-slate-400">
        Names come from whoever was signed in when the action was taken. Recording an outcome is the
        day running its course and is never marked as a change.
      </p>

      <div className="flex justify-end mt-4">
        <button onClick={onCancel} className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">Close</button>
      </div>
    </Modal>
  );
}

function LogStat({ label, people, unit, warn }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      {people.length === 0 ? (
        <div className="text-xs text-slate-400 mt-0.5">—</div>
      ) : (
        <div className="mt-0.5 space-y-0.5">
          {people.slice(0, 3).map((p) => (
            <div key={p.by} className="text-xs">
              <span className={warn ? "text-amber-900" : "text-slate-900"}>{p.by}</span>
              <span className="text-slate-400"> {p.n} {unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
