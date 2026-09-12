import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, Play, Check, X, ArrowRight, Clipboard, History, AlertTriangle,
  Loader2, RefreshCw, ChevronDown, ChevronRight, Users, CircleDot, Ban,
  CalendarClock, Wand2, Pin, Moon, ShieldAlert, CornerDownRight, FileText,
  Lock, Unlock, ClipboardPaste, ListChecks,
} from "lucide-react";
import {
  newJob, moveJob, setState as setJobState, applyEdit, withEvent, uid, makeEvent,
  isTombstone, liveJobs, tombstones, latestTombstones, jobMinutes, isOpen, pushSeverity,
  needsGuestConfirm, pmsText, techSheetForDay, parseQuickAdd, splitQuickAddLines, findReturn,
  actualDuration, clockMinutes, nowClock, fmtMins, makeFollowUp, needsFollowUp, isResolved,
  STATE_META, NOT_DONE_REASONS, MOVE_REASONS, MOVE_REASON_LABEL, SAY_WHAT_HAPPENED,
  splitTaskParts,
  moveReasonDisplaces, OFF_BOARD_REASONS, OFF_BOARD_LABEL, isOffBoard, reassign, EVENT_LABEL,
  OUTCOME_OPTIONS, JOB_SOURCES, SOURCE_LABEL, HOW_REPORTED, pasteAdditions
} from "../lib/job.js";
import { parseWorkReport, fmtMin } from "../lib/workReport.js";
import { parseAnyPaste } from "../lib/backlog.js";
import { looksLikeSheetText, isMisread, misreadSigns } from "../lib/sheetText.js";
import { dayActivity, attributionLine } from "../lib/activity.js";
import { readGoLive, isLive, isPreGoLive } from "../lib/goLive.js";
import { readLearned, refreshLearned, isStale, learnedFor } from "../lib/learned.js";
import { parseSheetPaste } from "../lib/importSheet.js";
import { checkAgainstSchedule } from "../lib/roster.js";
import { projectCrewOn } from "../lib/project.js";
import { averageTravelMinutes } from "../lib/quality.js";
import { groupLoad } from "../lib/load.js";
import { storageGet } from "../lib/storage.js";
import { staffIndex, seedStaff, TRADE_LABEL } from "../lib/staff.js";
import {
  seedCatalogue, matchCatalogue, applyCatalogue, newCatalogueEntry,
} from "../lib/catalogue.js";
import { readPost, postDay, clearPost, lockState, CHANGE_REASONS } from "../lib/dayLock.js";
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
  canonProperty, displayProperty, canonKey, parseDurationMinutes, canonTech,
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

/* ---------------------------------------------------------------------- *
 * Hiding the rollover prompt, and why it has to stick.
 *
 * "Not now" only ever called setRollover(null), which lasts until the next
 * reload or date change — so the prompt came back every time, with a wall
 * of text and a "Bring all 47" button at the top of the board. That is not
 * a warning any more, it is noise, and noise is what gets ignored.
 *
 * It is per DAY rather than global on purpose. The count is the honest
 * measure of how much work never got closed out, and it is the one number
 * worth watching while outcomes are being caught up. Hiding it for good
 * would hide the problem; hiding today's, once, is just tidying.
 * ---------------------------------------------------------------------- */
const ROLLOVER_HIDDEN_KEY = "dhh-rollover-hidden";

function rolloverHidden(date) {
  try {
    return JSON.parse(localStorage.getItem(ROLLOVER_HIDDEN_KEY) || "{}")[date] === true;
  } catch {
    return false;
  }
}

function hideRollover(date) {
  try {
    const m = JSON.parse(localStorage.getItem(ROLLOVER_HIDDEN_KEY) || "{}");
    m[date] = true;
    localStorage.setItem(ROLLOVER_HIDDEN_KEY, JSON.stringify(m));
  } catch {
    /* A private window or blocked site data. The prompt simply comes back,
       which is the right way for this to fail. */
  }
}

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
  const [accountFor, setAccountFor] = useState(null);
  const [liveNote, setLiveNote] = useState("");
  const [returnPrompts, setReturnPrompts] = useState([]);
  const [closeOutFor, setCloseOutFor] = useState(null);
  const [nightLog, setNightLog] = useState(false);
  const [taskPaste, setTaskPaste] = useState(false);
  const [clearing, setClearing] = useState(false);
  /* Carries a sheet the coordinator pasted into the wrong box across to
     the reader that understands it, so nobody has to copy it twice. */
  const [sheetSeed, setSheetSeed] = useState("");
  const [noteFor, setNoteFor] = useState(null);
  const [dayReview, setDayReview] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [todayOpen, setTodayOpen] = useState(null);
  const [goLive, setGoLiveDate] = useState(null);
  const [roster, setRoster] = useState(null);
  /* Read so the day can tell a crew on a multi-day job card apart from a
     crew with nothing to do. Without it the board called them idle. */
  const [projects, setProjects] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [post, setPost] = useState(null);
  const [changeReasonFor, setChangeReasonFor] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  /* What each kind of work has actually measured. Read from the cache on
     mount and refreshed in the background when it has gone stale, so the
     estimate on the quick-add box is the real time rather than the seeded
     guess — and so a slow refresh never holds up the board. */
  const [learned, setLearned] = useState(null);
  const watcher = useRef(null);

  const jobs = useMemo(() => (rows ? liveJobs(rows) : []), [rows]);
  /* One per job, not one per move — see latestTombstones. Moving a job
     twice used to make the day report more departures than it had jobs. */
  const tombs = useMemo(() => (rows ? latestTombstones(rows) : []), [rows]);

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
      if (rolloverHidden(date)) { setRollover(null); return; }
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

  useEffect(() => {
    let off = false;
    (async () => {
      const cached = await readLearned();
      if (off) return;
      if (cached) setLearned(cached);
      if (!isStale(cached)) return;
      try {
        const fresh = await refreshLearned();
        if (!off) setLearned(fresh);
      } catch { /* the seeded defaults stand until the next refresh */ }
    })();
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

      const praw = await storageGet("projects");
      if (cancelled) return;
      try { setProjects(praw ? JSON.parse(praw) : []); } catch { setProjects([]); }
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
      /* Deduplicated against what the DAY ALREADY HOLDS, and never against
         the other rows of the same paste — five lines the coordinator wrote
         are five jobs even when they read identically. See pasteAdditions
         in job.js for the four of Resty's five pool cleanings this cost. */
      const plan = pasteAdditions(existing, list);
      dupes += plan.dupes;
      const dayLock = lockState(day, day === selectedDate ? post : await readPost(day));
      const created = plan.add.map((r) => {
        const j = newJob(r, day, who);
        return dayLock.locked ? withEvent(j, "added_late", who, { lock: dayLock.kind }) : j;
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
    setSheetSeed("");
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

  /* Jobs on this day that carry the signature of a sheet pasted into the
     quick-add box: the year read as the unit number, the building lost,
     the shift and the PMS link left inside the scope of work. They are not
     work anybody can do — no technician is going to unit "2026" — so they
     are offered for closing off, with the sheet re-read properly after. */
  const misread = useMemo(
    () => jobs.filter((j) => !isResolved(j.state) && j.state !== "cancelled" && isMisread(j, selectedDate)),
    [jobs, selectedDate]
  );

  /* Evidence this day was damaged, whether or not the damaged rows are
     still open. Closing them off used to make the banner disappear — and
     with it the only visible route to starting the day over — leaving the
     subtler wreckage on a board that now looked fine. A day that has ever
     carried a mis-read row keeps saying so until it is cleared. */
  const wasMisread = useMemo(
    () => misread.length > 0 || jobs.some((j) => /mis-read paste/i.test(j.outcomeReason || "")),
    [jobs, misread.length]
  );

  /* ------------------------------------------------------------------ *
   * Starting a day over.
   *
   * Nothing in this app is deleted, and that rule has earned its place —
   * "where did that go" is the question the whole system exists to answer.
   * This is the one deliberate exception, and it is not a delete: the day's
   * rows are written to an archive key first and only then is the day
   * emptied, so the board is genuinely clean while the record still exists
   * for anyone who ever needs it back.
   *
   * It exists because 3 September could not be repaired job by job. A sheet
   * read through the quick-add box produced wreckage of two kinds: the
   * obvious sort, with the year as the unit number, which the mis-read
   * banner finds — and a subtler sort that looks completely legitimate,
   * where the parking bay landed in the unit ("La Vie B-257", whose unit is
   * 3503) and the description snapped to a standard task so it reads
   * cleanly. Telling those from real jobs means guessing, and guessing is
   * what caused this. Clearing the day and pasting the sheet again is the
   * only honest way back.
   * ------------------------------------------------------------------ */
  async function clearDay() {
    const current = await readDay(selectedDate);
    if (current && current.length) {
      /* Archived BEFORE the day is touched, and the write is CHECKED.
         storageSet swallows its errors and answers null rather than
         throwing, so an unchecked call would have emptied the day even when
         nothing had been saved — the one unacceptable outcome, and exactly
         the kind of silent loss this app exists to stop. */
      const ok = await storageSet(
        `archive:schedule:${selectedDate}:${Date.now()}`,
        JSON.stringify({ date: selectedDate, clearedAt: Date.now(), clearedBy: who, rows: current })
      );
      if (!ok) {
        setClearing(false);
        showToast("Could not archive the day, so nothing was cleared. Check the database connection and try again.", "bad");
        return;
      }
    }
    await mutateDay(selectedDate, () => []);
    await clearPost(selectedDate).catch(() => {});
    setClearing(false);
    await load(selectedDate);
    showToast(
      `${(current || []).length} row(s) taken off ${selectedDate} and archived. Paste the sheet in again.`,
      "ok"
    );
  }

  async function clearMisread() {
    const ids = new Set(misread.map((j) => j.id));
    await change(selectedDate, (cur) => cur.map((r) => (
      !isTombstone(r) && ids.has(r.id)
        ? setJobState(r, "cancelled", who, {
            reason: "Mis-read paste — the sheet was read line by line and lost its columns. Re-paste the sheet.",
            lock: lock.locked ? lock.kind : undefined,
          })
        : r
    )), `${misread.length} mis-read row(s) closed off. They stay on record. Now paste the sheet in again.`);
  }

  /* What the header button counts must be what the review lists, or the
     two disagree in front of the person trying to clear them. Not done is
     an answer; off the board is an answer. Neither is outstanding. */
  const unanswered = useMemo(
    () => jobs.filter((j) => !isResolved(j.state) && j.state !== "not_done" && !isOffBoard(j)).length,
    [jobs]
  );

  /* Who built this day and who has changed it since. Tombstones are
     included deliberately: a job that left the day is one of the changes
     this is here to show. */
  const activity = useMemo(() => dayActivity(rows || [], post), [rows, post]);

  /* Who a job card has on a project on the day being looked at. Passed to
     the roster check so those names come off the idle list. */
  const onProjectToday = useMemo(
    () => projectCrewOn(projects, selectedDate),
    [projects, selectedDate]
  );
  const rosterCheck = useMemo(
    () => (roster ? checkAgainstSchedule(roster, jobs, onProjectToday) : null),
    [roster, jobs, onProjectToday]
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
  /* Reassignment keeps the row live under its new owner; the other answers
     take it off the board. Both are one write and neither deletes
     anything — see OFF_BOARD_REASONS in job.js for why this exists. */
  async function accountForRow(job, payload) {
    if (payload.kind === "handover") {
      /* Handed to somebody outside the department: it has left the board.
         Handed to one of ours: it is still our job, it just belongs to a
         different man — and to a different day if he takes it on one. */
      if (payload.outside) {
        await change(selectedDate, (cur) => {
          const target = cur.find((r) => !isTombstone(r) && r.id === job.id) || job;
          return upsert(cur, setJobState(target, "cancelled", who, {
            reason: `${OFF_BOARD_LABEL["other-team"]} — ${payload.tech}`,
            offBoard: "other-team",
            handedTo: payload.tech,
            ...(lock.locked ? { lock: lock.kind } : {}),
          }));
        });
        showToast(`${payload.tech} has it. Off the board, and still on record.`, "ok");
        return;
      }

      const sameDay = payload.date === selectedDate;
      let moved = null;
      await change(selectedDate, (cur) => {
        const target = cur.find((r) => !isTombstone(r) && r.id === job.id) || job;
        const handed = reassign(target, payload.tech, who, payload.why);
        if (sameDay) return upsert(cur, handed);
        /* A later day is a move as well as a handover, so it leaves the
           tombstone every other move leaves — the day must never look as
           though the job simply vanished. */
        const r = moveJob(handed, payload.date, who, "tech-unavailable",
          { jobId: "", label: payload.why || `Handed to ${payload.tech}` }, lock.kind);
        moved = r.moved;
        return [...removeJob(cur, job.id), r.tomb];
      });
      if (moved) await mutateDay(payload.date, (cur) => [...cur, moved]);
      showToast(
        sameDay
          ? `${payload.tech} has it. It still needs his answer today.`
          : `Moved to ${payload.date} under ${payload.tech}. The trail stays on ${selectedDate}.`,
        "ok"
      );
      return;
    }

    await change(selectedDate, (cur) => {
      const target = cur.find((r) => !isTombstone(r) && r.id === job.id) || job;
      return upsert(cur, setJobState(target, "cancelled", who, {
        reason: OFF_BOARD_LABEL[payload.offBoard] || payload.offBoard,
        offBoard: payload.offBoard,
        duplicateOf: payload.duplicateOf,
        ...(lock.locked ? { lock: lock.kind } : {}),
      }));
    });
    showToast("Off the board. It counts against nobody, and it is still on record.", "ok");
  }

  async function markNotDone(job, reason, rebook) {
    const state = "not_done";
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
      const closed = setJobState(target, state, who, extra);
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
  async function closeOut(job, { outcome, reason, stillNeeded, actualMinutes, arrivedAt, leftAt, followUp }) {
    const patch = { reason, stillNeeded };
    if (actualMinutes != null) patch.actualMinutes = actualMinutes;
    if (arrivedAt !== undefined) patch.arrivedAt = arrivedAt;
    if (leftAt !== undefined) patch.leftAt = leftAt;

    /* A follow-up with no date is not an unbooked job, it is a queued one.
       Nobody in this department can say on the evening of the tenth when a
       contractor will come, and demanding a date produced invented ones —
       or, more often, the job filed as Not done and forgotten. It goes to
       the same queue the schedule is built from, carrying what it waits on
       so it can be chased. */
    let child = null, queued = null;
    if (followUp && needsFollowUp(outcome)) {
      if (squash(followUp.waitingOn)) {
        queued = {
          id: uid(),
          description: squash(followUp.scope) || squash(stillNeeded),
          property: job.property,
          unit: job.unit,
          priority: job.priority,          // a contained P1 stays a P1
          pmsStatus: "",
          dueDate: "",
          department: "",
          occupancy: job.status || "",
          reportedBy: who,
          reportedOn: selectedDate,
          reportedOnRaw: selectedDate,
          pmsRef: job.pmsRef || "",
          addedAt: Date.now(),
          scheduledFor: "",
          scheduledJobId: "",
          waitingOn: squash(followUp.waitingOn),
          followUpOf: { jobId: job.id, date: selectedDate, outcome },
          events: [makeEvent("queued", who, { reason: squash(followUp.waitingOn) })],
        };
      } else {
        child = makeFollowUp(job, followUp.date, who, {
          scope: followUp.scope,
          materials: followUp.materials,
          team: followUp.team,
          estimatedTime: followUp.estimatedTime,
        });
      }
    }

    const closed = setJobState(
      { ...job, actualMinutes: actualMinutes != null ? actualMinutes : job.actualMinutes,
        arrivedAt: arrivedAt !== undefined ? arrivedAt : job.arrivedAt,
        leftAt: leftAt !== undefined ? leftAt : job.leftAt,
        followUpJobId: child ? child.id : job.followUpJobId,
        waitingOn: queued ? queued.waitingOn : job.waitingOn,
        queuedItemId: queued ? queued.id : job.queuedItemId },
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
    if (queued) await addToQueue(queued);
    setCloseOutFor(null);
    showToast(
      child ? `Closed as ${outcome.replace("_", " ")} — follow-up booked for ${followUp.date}.`
        : queued ? `Closed. The rest is in the queue, waiting on ${queued.waitingOn.toLowerCase()}.`
        : `Closed as ${outcome.replace("_", " ")}.`,
      "ok"
    );
  }

  /* Read-modify-write on one small key that only this path and the Backlog
     screen touch. Two people closing out at the same second is possible
     and would lose one item; the queue is not the live board and this is
     not worth a version check for it.
     ponytail: plain RMW, use the optimistic path if two desks ever queue
     at once. */
  async function addToQueue(item) {
    try {
      const raw = await storageGet("backlog");
      const cur = raw ? JSON.parse(raw) : [];
      await storageSet("backlog", JSON.stringify([...(Array.isArray(cur) ? cur : []), item]));
    } catch (e) {
      showToast(`Closed, but the queue could not be written: ${e.message || e}`, "warn");
    }
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
  async function doMove(job, toDate, reason, displacedBy, winnerPriority) {
    const { moved, tomb } = moveJob(job, toDate, who, reason, displacedBy, lock.kind);
    await change(selectedDate, (cur) => {
      /* Idempotent. Two clicks, a double submit, or a re-move of a job that
         is already gone must not add a second departure to the day. */
      const already = cur.some((r) => isTombstone(r) && r.jobId === job.id && r.toDate === toDate);
      let next = already ? removeJob(cur, job.id) : [...removeJob(cur, job.id), tomb];
      // Record the other half on the job that took the slot, so the pair
      // can be read from either end.
      if (displacedBy && displacedBy.jobId) {
        const winner = next.find((r) => !isTombstone(r) && r.id === displacedBy.jobId);
        if (winner) {
          /* The priority the coordinator gave it in the move dialog lands on
             the job itself, not just on this pairing — it is the same fact
             wherever it is read, and the SLA and the queue want it too. */
          const patched = winnerPriority && !canonPriority(winner.priority)
            ? applyEdit(winner, { priority: winnerPriority }, who)
            : winner;
          next = upsert(next, {
            ...patched,
            displaced: Array.from(new Set([...(patched.displaced || []), job.id])),
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

  /* -------------------------------------------------------------------- *
   * One group per PERSON, not per team string.
   *
   * It used to key on the exact `team` text, so a pairing became its own
   * group — a phantom technician. On 26 August the board showed eleven
   * groups for seven men:
   *
   *     Bright 5 · Resty 5 · Abdul Riyaz 5 · Anthony 4 · Yousoufu 4
   *     Vitalis 3 · Jabbar 3
   *     "Vitalis and Yousoufu" 1 · "Jabbar and anthony" 1
   *     "Bright and riyaz" 1 · "Yousoufu and Vitalis" 1
   *
   * Three faults in that. A man's day was SPLIT across his own group and
   * every pairing he was in, so Vitalis showed 3 jobs when he had 5 and his
   * load bar was computed on the 3. Word order made "Vitalis and Yousoufu"
   * and "Yousoufu and Vitalis" two different groups for the same pair. And
   * the raw string ignored TECH_ALIASES, so "riyaz" was a fourth person the
   * metrics already knew was Abdul Riyaz.
   *
   * Now every job is filed under each of its crew, canonicalised. A paired
   * job appears in both men's groups, which is correct: both are there and
   * both spend the hour, and the job card says "2/2 people" so nobody
   * mistakes it for two pieces of work.
   * -------------------------------------------------------------------- */
  /* Half an hour between buildings was the department's standing guess.
     Once technicians write arrival and departure it becomes the mean of
     the actual moves, measured across this day. Which of the two is in
     use is shown, because a committed-hours figure built on a guess is a
     different claim from one built on observed moves. */
  const travelAvg = useMemo(() => averageTravelMinutes(jobs), [jobs]);

  const groups = useMemo(() => {
    const m = new Map();
    jobs.forEach((j) => {
      const crew = splitCrew(j.team).map(canonTech).filter(Boolean);
      const keys = crew.length ? [...new Set(crew)] : ["Unassigned"];
      keys.forEach((k) => {
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(j);
      });
    });
    return Array.from(m.entries())
      .map(([team, list]) => ({
        team,
        list,
        /* What he SEES is `list`; what he is CHARGED with is in groupLoad.
           See load.js — an accounted-for row stays on the card and out of
           every figure. */
        work: list.filter((j) => !isOffBoard(j)),
        members: team === "Unassigned" ? [] : [team],
        ...groupLoad(list, travelAvg.minutes,
          parseShiftMinutes(list.find((j) => j.shift)?.shift) || 540),
        shiftMin: parseShiftMinutes(list.find((j) => j.shift)?.shift) || 540,
        open: list.filter((j) => !isOffBoard(j) && isOpen(j)).length,
      }))
      .sort((a, b) => (a.team === "Unassigned" ? 1 : b.team === "Unassigned" ? -1 : b.loadPct - a.loadPct));
  }, [jobs, travelAvg]);

  /* `total` counts jobs, not rows. A row taken off the board — a duplicate,
     work handed to housekeeping — was never a job, and counting it here
     made the day's summary disagree with the end-of-day review sitting one
     click away. */
  const counts = useMemo(() => {
    const c = { total: 0, done: 0, not_done: 0, in_progress: 0, scheduled: 0, cancelled: 0 };
    jobs.forEach((j) => {
      c[j.state] = (c[j.state] || 0) + 1;
      if (!isOffBoard(j)) c.total++;
    });
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
        counts={counts} travelAvg={travelAvg} busy={busy} liveNote={liveNote}
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

      {wasMisread && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
            <span className="text-xs text-red-900">
              {misread.length > 0 ? (
                <>
                  <b>{misread.length} job{misread.length === 1 ? "" : "s"} on this day were read wrong</b>
                  {" "}— the row lost its columns, so what you are reading in one field was typed
                  into another. Each one says below which field gave it away.
                  {/* Two different causes produce this, and naming the wrong one sends
                      somebody hunting for a mistake nobody made. The signs themselves
                      say which: a torn DATE reads as the unit or opens the scope of
                      work (the sheet pasted into the quick-add box, one line per job);
                      a shifted row puts a unit status or an estimate where a person or
                      a building belongs (the nightly sync, before it quoted its cells —
                      see valuesToTsv in api/sync-sheet.js). */}
                  {misread.some((j) => misreadSigns(j, selectedDate)
                      .some((x) => x.includes("unit status") || x.includes("an estimate")))
                    ? " That is the nightly sheet sync tearing a row whose task description ran" +
                      " over more than one line. The sync is switched off as of 9 September and" +
                      " the schedule is posted by hand again, so no new day will do this — but" +
                      " the days already stored have to be put right by hand."
                    : " That is the daily sheet pasted into the quick-add box, which reads one line" +
                      " as one typed job."}
                </>
              ) : (
                <>
                  <b>This day carried rows that were read wrong.</b> They have been closed off, but
                  closing off only finds the obvious damage — anything subtler is still here and
                  looks like a real job.
                </>
              )}
            </span>
            {misread.length > 0 && (
              <button onClick={clearMisread}
                      className="ml-auto text-xs bg-red-700 text-white rounded-md px-2.5 py-1.5 shrink-0">
                Close them off
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-0.5">
            {misread.slice(0, 3).map((j) => (
              <li key={j.id} className="text-[11px] text-red-800">
                <span className="font-medium">{j.property || "(no building)"} {j.unit}</span>
                <span className="text-red-600"> — {misreadSigns(j, selectedDate)[0]}</span>
              </li>
            ))}
            {misread.length > 3 && (
              <li className="text-[11px] text-red-600">+{misread.length - 3} more</li>
            )}
          </ul>
          <div className="mt-2.5 pt-2.5 border-t border-red-200">
            <p className="text-[11px] text-red-800">
              <b>If the day is a mess, start it over instead.</b> Closing rows off leaves them on
              the board, greyed — and it only finds the obvious damage. The subtler kind reads like
              a real job (a parking bay sitting in the unit, a description snapped to a standard
              task) and cannot be told apart from one. Clearing the day and pasting the sheet again
              is the clean way back. Everything is archived first, nothing is destroyed.
            </p>
            <button onClick={() => setClearing(true)}
                    className="mt-2 text-xs bg-red-800 text-white rounded-md px-3 py-1.5">
              Clear {selectedDate} and start again
            </button>
          </div>
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

      {rosterCheck && <RosterStrip check={rosterCheck} onProject={onProjectToday} />}
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
        learned={learned}
        onAdd={addJobs}
        onSaveStandard={addCatalogueEntry}
        onSheetPaste={(t) => { setSheetSeed(t); setTaskPaste(true); }}
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
            {unanswered
              ? `End-of-day review — ${unanswered} still ${unanswered === 1 ? "needs" : "need"} an answer`
              : "End-of-day review — all answered"}
          </button>
        )}
        <button onClick={() => setNightLog(true)}
                className="flex items-center gap-1.5 text-xs border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-50">
          <Moon className="w-3.5 h-3.5" /> Log an out-of-hours job
        </button>
        {rows && rows.length > 0 && (
          <button onClick={() => setClearing(true)}
                  title="Take everything off this day and paste the sheet again. The rows are archived, not destroyed."
                  className="flex items-center gap-1.5 text-xs border border-red-300 text-red-700 rounded-md px-2.5 py-1.5 hover:bg-red-50 ml-auto">
            <History className="w-3.5 h-3.5" /> Start this day again
          </button>
        )}
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
          onAdvance={advance} onEdit={edit} onOpenNote={setNoteFor}
          onMove={setMoveFor} onOutcome={setOutcomeFor} onAccountFor={setAccountFor} onTrail={setTrailFor}
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
          onMove={(to, reason, displacedBy, winnerPriority) =>
            doMove(moveFor, to, reason, displacedBy, winnerPriority)}
        />
      )}
      {outcomeFor && (
        <OutcomeDialog
          job={outcomeFor.job} selectedDate={selectedDate}
          onCancel={() => setOutcomeFor(null)}
          onConfirm={(reason, rebook) => {
            markNotDone(outcomeFor.job, reason, rebook);
            setOutcomeFor(null);
          }}
        />
      )}
      {accountFor && (
        <AccountForDialog
          job={accountFor} dayJobs={jobs} candidates={candidates} selectedDate={selectedDate}
          onCancel={() => setAccountFor(null)}
          onConfirm={(payload) => { accountForRow(accountFor, payload); setAccountFor(null); }}
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
      {noteFor && (
        <NoteDialog
          job={noteFor}
          onCancel={() => setNoteFor(null)}
          onSave={(text) => { edit(noteFor, { notes: text }); setNoteFor(null); }}
        />
      )}
      {showLog && (
        <DayLog date={selectedDate} activity={activity} onCancel={() => setShowLog(false)} />
      )}
      {clearing && (
        <ClearDayDialog
          date={selectedDate} count={rows ? rows.length : 0}
          onCancel={() => setClearing(false)}
          onConfirm={clearDay}
        />
      )}
      {taskPaste && (
        <TaskPasteDialog
          date={selectedDate}
          seed={sheetSeed}
          knownTechs={knownTechNames}
          onCancel={() => { setTaskPaste(false); setSheetSeed(""); }}
          onCommit={addFromPaste}
        />
      )}
      {dayReview && (
        <DayReview
          date={selectedDate} jobs={jobs}
          onCancel={() => setDayReview(false)}
          onCloseOut={(job) => { setDayReview(false); setCloseOutFor(job); }}
          onQuick={(job, state) => advance(job, state, {})}
          onAccountFor={(job) => { setDayReview(false); setAccountFor(job); }}
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

function TopBar({ me, onChangeMe, selectedDate, setSelectedDate, counts, travelAvg, busy, liveNote, onRefresh }) {
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
          {counts.cancelled > 0 && (
            <span className="text-slate-400">{counts.cancelled} off the board</span>
          )}
          {travelAvg && <span className={travelAvg.measured ? "text-slate-500" : "text-slate-400"}
                title={travelAvg.measured
                  ? `The mean of ${travelAvg.moves} actual moves between buildings on this day.`
                  : "No arrival and departure times to measure from, so the department's standing half-hour is used."}>
            {travelAvg.minutes}m between buildings
            {travelAvg.measured ? ` · measured over ${travelAvg.moves}` : " · assumed"}
          </span>}
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
  const [open, setOpen] = useState(false);
  const n = rollover.jobs.length;

  /* One line until asked. The number is the point; the wall of text and the
     bulk move behind it are only wanted by somebody who has decided to act
     on it right now. */
  if (!open) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2
                      flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-slate-700">
          <b className="text-slate-900">{n}</b> job{n === 1 ? "" : "s"} from before {today}{" "}
          {n === 1 ? "was" : "were"} never closed out
        </span>
        <button onClick={() => setOpen(true)} className="text-blue-700 underline">
          what to do about them
        </button>
        <button onClick={() => { hideRollover(today); onDismiss(); }}
                title="Hides it for this day only. The count is how much work never got closed out, so it comes back on other days."
                className="ml-auto text-slate-400 hover:text-slate-700">
          hide
        </button>
      </div>
    );
  }

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
            <button onClick={() => setOpen(false)} className="text-xs text-amber-700 underline">
              Not now
            </button>
            <button onClick={() => { hideRollover(today); onDismiss(); }}
                    className="text-xs text-amber-700 underline">
              Hide for {today}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================= quick add ========================= */

function QuickAdd({ knownProps, knownTechs, catalogue, learned, onAdd, onSaveStandard, onSheetPaste, busy }) {
  const [text, setText] = useState("");
  const [showCat, setShowCat] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const inputRef = useRef(null);
  const multi = text.includes("\n");

  /* Each line is parsed, then snapped to a standard task where one clearly
     matches. Snapping is what makes two coordinators enter the same job the
     same way — and it costs no extra typing, because it works on the words
     they were going to use anyway. */
  /* The daily sheet must never be parsed here. Pasted into this box, every
     line was read as one typed job: the year out of "2026-09-03" became the
     unit number, the building was lost entirely, and each wrapped line
     became a job of its own. It is caught before a single line is read. */
  const isSheet = useMemo(() => looksLikeSheetText(text), [text]);

  const preview = useMemo(() => {
    if (!text.trim() || isSheet) return null;
    return splitQuickAddLines(text).map((l) => {
      const parsed = parseQuickAdd(l, { properties: knownProps, techs: knownTechs });
      const m = catalogue ? matchCatalogue(parsed.fields.description, catalogue) : null;
      /* Where the work has been measured enough times, the estimate on the
         line becomes what it measured rather than what it was seeded at.
         Shown, never silent — the coordinator can still overwrite it. */
      const lrn = m ? learnedFor(learned, m.entry.id) : null;
      return {
        raw: l,
        fields: m ? applyCatalogue(parsed.fields, m.entry, { learnedMinutes: lrn ? lrn.minutes : null }) : parsed.fields,
        typed: parsed.fields.description,
        match: m,
        learned: lrn,
      };
    });
  }, [text, isSheet, knownProps, knownTechs, catalogue, learned]);

  const valid = preview ? preview.filter((p) => squash(p.fields.property) || squash(p.fields.description)) : [];
  const unmatched = valid.filter((p) => !p.match && squash(p.typed).length > 6);

  async function commit() {
    if (isSheet) { onSheetPaste?.(text); setText(""); return; }
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

      {isSheet && (
        <div className="mt-2 border border-amber-300 bg-amber-50 rounded-lg p-2.5">
          <p className="text-xs text-amber-900 font-medium">
            That is the daily sheet, not a single job.
          </p>
          <p className="text-[11px] text-amber-800 mt-1">
            Read line by line here it would lose the building on every row and take the
            year out of the date as the unit number. Send it to the sheet reader instead,
            which knows the columns.
          </p>
          <button onClick={() => { onSheetPaste?.(text); setText(""); }}
                  className="mt-2 text-xs bg-amber-900 text-white rounded-md px-2.5 py-1.5">
            Read it as the daily sheet
          </button>
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
              {p.learned && (
                <div className="text-[11px] text-slate-500 mb-0.5">
                  time from what it actually took —{" "}
                  <span className="font-medium text-slate-700">{fmtMins(p.learned.minutes)}</span>
                  {" "}across {p.learned.n} job{p.learned.n === 1 ? "" : "s"}
                  {p.learned.estimate != null && p.learned.minutes !== p.learned.estimate && (
                    <span className="text-slate-400">, not the {fmtMins(p.learned.estimate)} usually estimated</span>
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

function TeamGroup({ group, me, allJobs, selectedDate, onAdvance, onEdit, onOpenNote, onMove, onOutcome, onAccountFor, onTrail, onEditFull, showToast, onMoveMany, onCloseOut, staffIdx, candidates }) {
  const [open, setOpen] = useState(true);
  const [showPlan, setShowPlan] = useState(false);
  const g = group;
  /* The order of work is the order of the jobs he actually has. A row
     accounted for is not a stop on his round. */
  const plan = useMemo(
    () => (g.team === "Unassigned" ? null : planDay(g.work)),
    [g.work, g.team]
  );
  const tone = g.loadPct > 100 ? "bad" : g.loadPct > 85 ? "warn" : "ok";
  const barCls = { ok: "bg-blue-500", warn: "bg-amber-500", bad: "bg-red-500" }[tone];

  function copyAllForPms() {
    const text = g.work.map(pmsText).join("\n\n---\n\n");
    navigator.clipboard?.writeText(text);
    showToast(`Copied ${g.work.length} job(s) — paste into PMS.`, "ok");
  }

  /* What the technician gets instead of the printed sheet. In that sheet an
     empty parking cell closes up and the Guest-Confirmed Y or N slides
     under the "Parking No." heading — a third of the rows have no bay, so
     the mismatch is routine rather than rare. Here every value is named,
     the order is the agreed working order, and "not given" is said out
     loud instead of being left as a gap for the eye to fill in wrongly. */
  function copyForTech() {
    /* planDay returns `items` in working order, each wrapping its job.
       Anything it could not fit in the shift is in `overflow` and is still
       the technician's to do, so it goes on the end rather than being
       dropped off the list he is handed. */
    const ordered = plan && plan.items && plan.items.length
      ? [...plan.items, ...(plan.overflow || [])].map((o) => o.job).filter(Boolean)
      : g.list;
    const live = ordered.filter((j) => j.state !== "cancelled");
    navigator.clipboard?.writeText(techSheetForDay(live, g.team, selectedDate));
    showToast(`Copied ${live.length} job(s) for ${g.team || "the technician"} — every field named.`, "ok");
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 p-3 border-b border-slate-100">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-sm font-medium text-slate-900 truncate">{g.team}</span>
          {g.sharedJobs > 0 && (
            <span title={`${g.sharedJobs} of these are crew jobs he shares with somebody else. They appear in that person's list too, because both of them are there for the hour.`}
                  className="text-[10px] rounded px-1.5 py-0.5 bg-violet-100 text-violet-800">
              {g.sharedJobs} shared
            </span>
          )}
          <span className="text-xs text-slate-400">{g.work.length} jobs</span>
          {g.offBoard > 0 && (
            <span title="Rows on his card that are not jobs he did — a duplicate, or work that went to another team. They stay visible and count against nobody."
                  className="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-500">
              +{g.offBoard} accounted for
            </span>
          )}
        </button>

        {/* Two figures, never merged. The pale bar is what was planned off
            the coordinator's estimates; the solid one inside it is what the
            clock actually recorded. A day with no arrival and departure
            times shows the plan alone and says so, rather than dressing an
            estimate up as a measurement. */}
        {g.team !== "Unassigned" && (
          <div className="flex items-center gap-2 min-w-[190px]">
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden relative"
                 title={g.actualPct != null
                   ? `${formatMinutes(g.actualMin)} inside the units, ${g.actualBasis}, from ${g.attended} of ${g.work.length} jobs. Travel is estimated at ${formatMinutes(g.travel)} and is NOT in this figure. Planned ${formatMinutes(g.committed)} of ${formatMinutes(g.shiftMin)}.`
                   : `Planned ${formatMinutes(g.committed)} of ${formatMinutes(g.shiftMin)}. Nothing recorded yet.`}>
              <div className={`h-full rounded-full ${barCls} opacity-30`}
                   style={{ width: `${Math.min(100, g.loadPct)}%` }} />
              {g.actualPct != null && (
                <div className={`h-full rounded-full ${barCls} absolute inset-y-0 left-0`}
                     style={{ width: `${Math.min(100, g.actualPct)}%` }} />
              )}
            </div>
            <span className={`text-xs tabular-nums ${tone === "bad" ? "text-red-700 font-medium" : tone === "warn" ? "text-amber-700" : "text-slate-500"}`}>
              {g.actualPct != null ? `${g.actualPct}%` : `${g.loadPct}%`}
              {g.actualPct == null && <span className="text-slate-400 font-normal"> planned</span>}
            </span>
          </div>
        )}

        {/* The bar answers one question — how much of the shift was spent
            inside a unit doing work. Travel is an estimate and sits beside
            it, never inside it: folding two unobserved hours into Jabbar's
            4h 15m read 69% of his shift when the truth was 47%. */}
        <span className="text-[11px] text-slate-400">
          {g.actualPct != null ? (
            <>
              <span className="text-slate-700 font-medium">{formatMinutes(g.actualMin)}</span>
              {" in the units"}
              {` from ${g.attended} of ${g.work.length} · `}
              <span className={g.actualBasis === "measured" ? "text-emerald-700" : "text-amber-600"}
                    title={g.actualBasis === "measured"
                      ? "Every one of these came from an arrival and a departure time."
                      : `His own totals, not clock times. ${g.measured} of ${g.attended} were actually timed.`}>
                {g.actualBasis}
              </span>
              {g.travel > 0 && (
                <span title={`${g.moves} move(s): ${g.betweenMoves} between properties, ${g.intraMoves} inside a villa community. Estimated — there is no route data. Not counted in the figure on the left.`}>
                  {` · + ${formatMinutes(g.travel)} travel (est)`}
                </span>
              )}
              {` · ${formatMinutes(g.committed)} planned`}
            </>
          ) : (
            <>
              {formatMinutes(g.committed)} planned of {formatMinutes(g.shiftMin)}
              <span className="text-amber-600"> · nothing recorded yet</span>
              {g.travel > 0 && ` · incl. ${formatMinutes(g.travel)} travel (est)`}
            </>
          )}
          {/* Stops, not buildings. Five pool cleans at Palm Villa are one
              property and five addresses; "1 building" was the reason
              Resty's travel estimate came out at zero. */}
          {g.stops > 1 && ` · ${g.stops} stops`}
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
          <button onClick={copyForTech}
                  title="Send the technician a labelled list — no collapsed columns, parking always stated"
                  className="flex items-center gap-1 text-xs border border-slate-300 rounded-md px-2 py-1 hover:bg-slate-50">
            <Clipboard className="w-3 h-3" /> Copy for the technician
          </button>
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
              onAdvance={onAdvance} onEdit={onEdit} onOpenNote={onOpenNote}
              onMove={onMove} onOutcome={onOutcome} onAccountFor={onAccountFor} onTrail={onTrail}
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

function RosterStrip({ check, onProject }) {
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
        {check.summary.projectTeam?.length > 0 && (
          <span className="text-slate-600"
                title={(onProject || []).map((x) => `${x.name} — ${x.title}`).join("\n")}>
            on projects: {check.summary.projectTeam.join(", ")}
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

function JobRow({ job, me, onAdvance, onEdit, onOpenNote, onMove, onOutcome, onAccountFor, onTrail, onEditFull, showToast, suggestFrom, onCloseOut, staffIdx, candidates }) {
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
            {job.escalated && (
              <span title="Marked IMP by the coordinator — somebody upstairs is watching this one. Not the same as a priority."
                    className="text-[10px] rounded px-1.5 py-0.5 bg-purple-100 text-purple-800 font-medium border border-purple-200">
                IMP
              </span>
            )}
            {job.source === "review" && (
              <span title="Raised off a low guest rating — the revenue is already gone and the review is public"
                    className="text-[10px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 font-medium border border-amber-200">
                review
              </span>
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
          {/* The "In PMS?" tick is gone. It was answered on 43% of the real
              month and read "Y" on 203 of those 204 — an intention, not a
              check, and nobody could say what it was for. The TSK reference
              below is the same claim and is verifiable. What the card
              lacked was somewhere to write what is actually going on. */}
          <button onClick={() => onOpenNote(job)}
                  title="A note on this job — anything worth knowing"
                  className={`text-[10px] rounded px-1.5 py-1 border inline-flex items-center gap-1 ${
                    squash(job.notes) ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-400"}`}>
            <FileText className="w-3 h-3" />
            {squash(job.notes) ? "note" : "add note"}
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
              <button onClick={() => onAccountFor(job)}
                      className="text-xs text-slate-700 border border-slate-300 rounded-md px-2 py-1 hover:bg-slate-50 flex items-center gap-1">
                <Ban className="w-3 h-3" /> Account for this row
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
  /* The arriving job usually has no priority — it was added mid-day and
     nothing asked. That is why "was the call right" could be answered for
     2 of 70 departures in two months: both halves are stored, but the
     winner's half is blank. Asked here, once, at the moment the judgement
     is actually being made. */
  const [winnerPriority, setWinnerPriority] = useState("");
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
            if (!w || canonPriority(w.priority)) return null;
            return (
              <div className="mt-1.5 rounded border border-blue-300 bg-white px-2 py-1.5">
                <div className="text-[11px] text-blue-900">
                  How urgent is the job that took the slot?
                  <span className="text-blue-700"> Without it nobody can weigh this call later.</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {["PRI-1", "PRI-2", "PRI-3", "PRI-4"].map((p) => (
                    <button key={p} onClick={() => setWinnerPriority(p)}
                            className={`text-[11px] rounded px-2 py-0.5 border ${
                              winnerPriority === p
                                ? "bg-blue-900 text-white border-blue-900"
                                : "bg-white border-blue-300 hover:bg-blue-100"}`}>
                      {p.replace("PRI-", "P")}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {winnerId && (() => {
            const w = others.find((o) => o.id === winnerId);
            const a = canonPriority(job.priority);
            const bpr = w && (canonPriority(w.priority) || winnerPriority);
            if (!w || !a || !bpr || a <= bpr) return null;
            // a <= bpr means the displaced job is the higher priority
            return (
              <p className="mt-1.5 text-[11px] text-amber-900 bg-amber-100 border border-amber-300 rounded px-2 py-1">
                Worth a second look: you are moving a {job.priority} to make room for a{" "}
                {canonPriority(w.priority) || winnerPriority}. That may still be right — it is
                recorded either way.
              </p>
            );
          })()}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button disabled={!canMove}
                onClick={() => onMove(to, reason, displacedBy, winnerId ? winnerPriority : "")}
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

function OutcomeDialog({ job, selectedDate, onCancel, onConfirm }) {
  const list = NOT_DONE_REASONS;
  const [reason, setReason] = useState(list[0]);
  const [other, setOther] = useState("");
  /* "" means the coordinator has not answered yet; "none" is a deliberate
     "we are not rebooking it", which is a different thing from silence and
     is recorded as such. */
  const [rebook, setRebook] = useState("");
  const [when, setWhen] = useState(addDays(selectedDate, 1));
  const saying = reason === SAY_WHAT_HAPPENED;
  const final = saying ? squash(other) : reason;
  const asking = true;
  const ready = !!final && rebook !== "";

  return (
    <Modal title={`Not done — ${job.property} ${job.unit}`} onCancel={onCancel}>
      <p className="text-xs text-slate-600">
        Not done means the work did not happen. If somebody else did it, if the row is a
        duplicate, or if it went to another team, close it with <em>Account for this row</em>
        instead — those are not failures and should not be recorded as one.
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
                className="text-sm text-white px-3 py-1.5 rounded-md disabled:opacity-40 bg-red-600">
          Mark not done
        </button>
      </div>
    </Modal>
  );
}

/* ====================================================================== *
 * Account for this row.
 *
 * The question the board never asked. Until now a coordinator with a
 * duplicate, a job somebody else picked up, or work that went to
 * housekeeping had exactly one place to put it — "not done" — and it was
 * filed as a failure against the technician originally named. He typed
 * seventeen different reasons by hand over two months trying to say
 * otherwise; twelve of them were the single word "duplicate".
 *
 * Two of these answers take the row off the board. The first does not: a
 * job handed to another technician is still owed an answer, by its new
 * owner, and saying so is the whole point.
 * ====================================================================== */
function AccountForDialog({ job, dayJobs, candidates, selectedDate, onCancel, onConfirm }) {
  const [choice, setChoice] = useState("handover");
  const [tech, setTech] = useState("");
  const [when, setWhen] = useState(selectedDate);
  const [why, setWhy] = useState("");
  const [dupOf, setDupOf] = useState("");

  const picked = OFF_BOARD_REASONS.find((r) => r.id === choice);
  const others = (dayJobs || []).filter(
    (j) => !isTombstone(j) && j.id !== job.id && !isOffBoard(j)
  );

  /* The people who can take it. A name on the technician list means the
     job moves to him and stays a maintenance job; anything else means it
     has left the department, and that is a different answer. */
  const techs = (candidates || []).filter((c) => squash(c) !== squash(job.team));
  const OUTSIDE = ["Housekeeping", "Contractor", "Building management"];
  const isOutside = OUTSIDE.some((x) => squash(x) === squash(tech));
  const sameDay = when === selectedDate;

  const ready =
    choice === "handover" ? !!squash(tech) && !!when :
    picked && picked.picksRow ? !!dupOf :
    !!picked;

  /* What will happen, said before it happens. Three different outcomes hang
     off two dropdowns and the coordinator should not have to work out which
     one he is about to get. */
  const consequence =
    !squash(tech) ? null :
    isOutside ? `It leaves the board. ${squash(tech)} has it, and it counts against nobody here.` :
    sameDay ? `It stays on ${selectedDate} under ${squash(tech)}, and he still owes the answer.` :
    `It moves to ${when} under ${squash(tech)}. ${selectedDate} keeps the trail.`;

  return (
    <Modal title={`Account for — ${job.property} ${job.unit}`} onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">
        Not every row is a job that failed. Say what this one really is, so it stops
        counting against {squash(job.team) || "the technician"}.
      </p>

      <div className="mt-3 space-y-1.5">
        <label className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer">
          <input type="radio" name="acct" className="mt-0.5"
                 checked={choice === "handover"} onChange={() => setChoice("handover")} />
          <span>
            <span className="font-medium">Somebody else has it</span>
            <span className="block text-[11px] text-slate-500">
              Another technician, or another team. Today, or on a later day.
            </span>
          </span>
        </label>
        {OFF_BOARD_REASONS.filter((r) => r.id !== "other-team").map((r) => (
          <label key={r.id} className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer">
            <input type="radio" name="acct" className="mt-0.5"
                   checked={choice === r.id} onChange={() => setChoice(r.id)} />
            <span>{r.label}</span>
          </label>
        ))}
      </div>

      {choice === "handover" && (
        <div className="mt-3 border-t border-slate-200 pt-3 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[13rem] flex-1">
              <label className="text-xs font-medium text-slate-800">Assigned to</label>
              <select value={tech} onChange={(e) => setTech(e.target.value)}
                      className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
                <option value="">Pick who has it…</option>
                {techs.length > 0 && (
                  <optgroup label="Technicians">
                    {techs.map((c) => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                )}
                <optgroup label="Outside the department">
                  {OUTSIDE.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-800">On</label>
              <input type="date" value={when} min={selectedDate}
                     onChange={(e) => setWhen(e.target.value)}
                     className="mt-1 block border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
          </div>

          {consequence && (
            <p className={`text-[11px] rounded-md px-2 py-1.5 border ${
              isOutside
                ? "text-slate-600 bg-slate-50 border-slate-200"
                : "text-blue-800 bg-blue-50 border-blue-200"}`}>
              {consequence}
            </p>
          )}

          <input value={why} onChange={(e) => setWhy(e.target.value)}
                 placeholder="Why it moved — optional, e.g. Vitalis went to a guest complaint"
                 className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
      )}

      {picked && picked.picksRow && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="text-xs font-medium text-slate-800">Which row holds the work?</div>
          <select value={dupOf} onChange={(e) => setDupOf(e.target.value)}
                  className="mt-1.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">Pick the row this duplicates…</option>
            {others.map((j) => (
              <option key={j.id} value={j.id}>
                {j.property} {j.unit} · {squash(j.team) || "unassigned"} · {squash(j.description).slice(0, 50)}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Recorded, not deleted. If the call was wrong this is what undoes it.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Back</button>
        <button
          onClick={() => onConfirm(
            choice === "handover"
              ? { kind: "handover", tech: squash(tech), date: when, outside: isOutside, why: squash(why) }
              : { kind: "offboard", offBoard: choice, duplicateOf: dupOf }
          )}
          disabled={!ready}
          className="text-sm text-white px-3 py-1.5 rounded-md disabled:opacity-40 bg-slate-900">
          {choice === "handover"
            ? (isOutside ? "Hand it over" : sameDay ? "Move it to him" : `Move it to ${when}`)
            : "Take it off the board"}
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
  const [arrivedAt, setArrivedAt] = useState(job.arrivedAt || "");
  const [leftAt, setLeftAt] = useState(job.leftAt || "");
  const [fuDate, setFuDate] = useState(addDays(selectedDate, 1));
  const [fuTeam, setFuTeam] = useState(job.team || "");
  const [fuScope, setFuScope] = useState("");
  /* "book" is a date the coordinator can actually commit to. "waiting" is
     the honest answer when he cannot: a contractor who has not confirmed,
     a quote nobody has approved, a part with no delivery date. Before this
     the dialog demanded a date he did not have, and the department's only
     way out was to invent one or to file the job as Not done. */
  const [fuMode, setFuMode] = useState("book");
  const [waitingOn, setWaitingOn] = useState("");

  /* One row, several jobs. The coordinator writes what the guest reported
     and guests report in lists, so the parts are read out of the text they
     already wrote and ticked off here. Where the parser finds nothing it can
     still be split by hand — 9% of the real month runs several jobs
     together with no separator at all. */
  const [parts, setParts] = useState(() => splitTaskParts(job.description));
  const [ticked, setTicked] = useState(() => new Set());
  const [splitting, setSplitting] = useState(false);
  const [manual, setManual] = useState("");

  const hasParts = parts.length >= 2;
  const doneParts = parts.filter((_, i) => ticked.has(i));
  const openParts = parts.filter((_, i) => !ticked.has(i));

  function toggle(i) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  /* Ticking the parts answers the outcome by itself: all of them is a clean
     fix, some of them is work still owed, and the untouched parts are the
     follow-up's scope word for word. */
  useEffect(() => {
    if (!hasParts) return;
    if (doneParts.length === 0) return;
    if (openParts.length === 0) {
      setOutcome("fixed");
      setStillNeeded("");
    } else {
      setOutcome("made_safe");
      const left = openParts.join("; ");
      setStillNeeded(left);
      setFuScope(left);
    }
  }, [hasParts, doneParts.length, openParts.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const isP1 = canonPriority(job.priority) === "PRI-1";
  const clockSpan = clockMinutes(arrivedAt, leftAt);
  const estMins = parseDurationMinutes(job.estimatedTime);

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
  const waiting = requiresFollowUp && fuMode === "waiting";
  const canConfirm = outcome && (!requiresFollowUp ||
    (squash(stillNeeded) && (waiting ? !!squash(waitingOn) : !!fuDate)));

  return (
    <Modal title={`Close out — ${job.property} ${job.unit}`} onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">{job.description}</p>

      {hasParts ? (
        <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-2.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs font-medium text-slate-900">
              This is {parts.length} jobs in one. Tick what actually got done.
            </span>
            <span className="text-[11px] text-slate-500">
              {doneParts.length} of {parts.length} done
            </span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {parts.map((part, i) => (
              <li key={i}>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={ticked.has(i)} onChange={() => toggle(i)} />
                  <span className={ticked.has(i) ? "text-slate-400 line-through" : "text-slate-800"}>{part}</span>
                </label>
              </li>
            ))}
          </ul>
          {doneParts.length > 0 && openParts.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              Part of it is still owed, so this closes as <b>made safe</b> and the {openParts.length}{" "}
              unticked line{openParts.length === 1 ? "" : "s"} become the follow-up — you do not have
              to retype them.
            </p>
          )}
          {parts.length > 0 && doneParts.length === parts.length && (
            <p className="mt-2 text-[11px] text-emerald-800">All of it done — this closes as fixed.</p>
          )}
        </div>
      ) : (
        <div className="mt-2">
          {splitting ? (
            <div className="rounded-md border border-slate-300 bg-slate-50 p-2.5">
              <span className="text-xs text-slate-700">
                One line per job. The ones left unticked afterwards become the follow-up.
              </span>
              <textarea autoFocus value={manual} onChange={(e) => setManual(e.target.value)} rows={4}
                        placeholder={"check kitchen mixer\nreplace shower fitting\ndishwasher service"}
                        className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              <div className="flex gap-2 mt-1.5">
                <button onClick={() => {
                          const list = manual.split(/\n/).map((x) => squash(x)).filter((x) => x.length >= 3);
                          if (list.length >= 2) { setParts(list); setTicked(new Set()); }
                          setSplitting(false);
                        }}
                        className="text-xs bg-slate-900 text-white rounded-md px-2.5 py-1">Use these</button>
                <button onClick={() => setSplitting(false)}
                        className="text-xs border border-slate-300 rounded-md px-2.5 py-1">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setSplitting(true); setManual(squash(job.description)); }}
                    className="text-[11px] text-slate-500 underline underline-offset-2">
              this was more than one job
            </button>
          )}
        </div>
      )}

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
            This is not finished — say what happens to the rest of it
          </h4>
          <p className="text-[11px] text-amber-800 mt-0.5 mb-2">
            A closed valve is a stopped leak, not a repaired one. Either way the remaining work is
            created now and linked to this job, so it cannot be lost in a comment thread.
            {isP1 && " This is a P1, so it stays a P1 until the work is actually done."}
          </p>

          <div className="flex flex-wrap gap-1.5 mb-2">
            {[["book", "Book the return visit"], ["waiting", "Waiting on somebody else — no date yet"]].map(([id, label]) => (
              <button key={id} onClick={() => setFuMode(id)}
                      className={`text-[11px] rounded-md px-2 py-1 border ${
                        fuMode === id
                          ? "bg-amber-900 text-white border-amber-900"
                          : "bg-white border-amber-300 hover:bg-amber-100"}`}>
                {label}
              </button>
            ))}
          </div>
          <label className="block text-[11px] text-amber-900">
            What is still needed
            <input value={stillNeeded} onChange={(e) => setStillNeeded(e.target.value)}
                   placeholder="e.g. new water heater, paint for the ceiling"
                   className="mt-0.5 w-full border border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white" />
          </label>
          {waiting ? (
            <div className="mt-2">
              <div className="text-[11px] text-amber-900">What is it waiting on?</div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {["A contractor", "A quotation", "A part on order", "Building permission", "The owner's approval"].map((x) => (
                  <button key={x} onClick={() => setWaitingOn(x)}
                          className={`text-[11px] rounded-md px-2 py-1 border ${
                            waitingOn === x
                              ? "bg-amber-900 text-white border-amber-900"
                              : "bg-white border-amber-300 hover:bg-amber-100"}`}>
                    {x}
                  </button>
                ))}
              </div>
              <input value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)}
                     placeholder="or say it in your own words"
                     className="mt-1.5 w-full border border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white" />
              <p className="text-[11px] text-amber-800 mt-1.5">
                It goes to the queue with no date, not onto a day you would have had to invent.
                It is chased from there, and it still counts as open on this unit.
              </p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {outcome && outcome !== "not_done" && (
        <div className="mt-3 border border-slate-200 rounded-lg p-2.5 bg-slate-50">
          <p className="text-[11px] font-medium text-slate-700">
            What time was he there?
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            The real arrival and departure. This is what the month is measured on —
            without it every job is filed as whatever was estimated.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {[["On site at", arrivedAt, setArrivedAt], ["Left at", leftAt, setLeftAt]].map(([label, val, set]) => (
              <label key={label} className="block text-[11px] text-slate-600">
                {label}
                <div className="flex gap-1 mt-0.5">
                  <input value={val} onChange={(e) => set(e.target.value)}
                         placeholder="09:15"
                         className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white" />
                  <button type="button" onClick={() => set(nowClock())}
                          className="text-[11px] border border-slate-300 rounded-md px-2 bg-white hover:bg-slate-100 shrink-0">
                    Now
                  </button>
                </div>
              </label>
            ))}
          </div>

          {clockSpan != null ? (
            <p className="text-[11px] text-emerald-800 mt-1.5">
              {fmtMins(clockSpan)} on site{estMins != null && (
                <> — estimated {fmtMins(estMins)}
                  {Math.abs(clockSpan - estMins) >= 15 &&
                    `, ${clockSpan > estMins ? "over" : "under"} by ${fmtMins(Math.abs(clockSpan - estMins))}`}
                </>
              )}
            </p>
          ) : (arrivedAt || leftAt) ? (
            <p className="text-[11px] text-amber-700 mt-1.5">
              Need both times, as a clock reading — 9:15, 09:15 or 9:15 am.
            </p>
          ) : null}

          <label className="block text-[11px] text-slate-500 mt-2">
            Or, if the times are not known, total minutes
            <input type="number" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)}
                   disabled={clockSpan != null}
                   placeholder={parsed && parsed.minutes != null ? String(parsed.minutes) : "leave blank"}
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400" />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button disabled={!canConfirm}
                onClick={() => onConfirm({
                  outcome, reason: reason || "", stillNeeded,
                  arrivedAt, leftAt,
                  actualMinutes: minutes === "" ? null : Number(minutes),
                  followUp: requiresFollowUp
                    ? waiting
                      ? { date: "", waitingOn: squash(waitingOn), scope: fuScope || stillNeeded, materials: stillNeeded }
                      : { date: fuDate, team: fuTeam, scope: fuScope || stillNeeded, materials: stillNeeded }
                    : null,
                })}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          {!requiresFollowUp ? "Close out"
            : waiting ? "Close it — the rest goes to the queue"
            : `Close and book ${fuDate}`}
        </button>
      </div>
      {requiresFollowUp && !squash(stillNeeded) && (
        <p className="text-[11px] text-amber-700 mt-1.5 text-right">
          Say what is still needed before closing — that text becomes the return visit.
        </p>
      )}
      {waiting && squash(stillNeeded) && !squash(waitingOn) && (
        <p className="text-[11px] text-amber-700 mt-1.5 text-right">
          Say what it is waiting on. Without it the queue cannot tell you who to chase.
        </p>
      )}
    </Modal>
  );
}

/* ====================================================================== *
 * Start this day again.
 *
 * The only thing in the app that takes rows off a day. It is not a delete:
 * everything is written to an archive record first, and the confirmation
 * asks for the date to be typed, because a day cleared by a mis-click in a
 * busy shift would be the worst failure this system could have.
 * ====================================================================== */
function ClearDayDialog({ date, count, onCancel, onConfirm }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = squash(typed) === date;

  return (
    <Modal title={`Start ${date} again`} onCancel={onCancel}>
      <p className="text-sm text-slate-700">
        This takes all <b>{count}</b> row{count === 1 ? "" : "s"} off {date} so you can paste the
        sheet in cleanly.
      </p>
      <p className="text-xs text-slate-600 mt-2">
        They are <b>archived, not deleted</b> — the whole day is written to a dated record first,
        so it can be recovered. Outcomes, notes and the change log for this day go with them.
        The day is also un-posted, so the paste is not blocked by the lock.
      </p>
      <p className="text-xs text-slate-600 mt-2">
        Nothing on any other day is touched.
      </p>

      <label className="block text-xs text-slate-600 mt-3">
        Type <span className="font-mono font-medium text-slate-900">{date}</span> to confirm
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
               placeholder={date}
               className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono" />
      </label>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">
          Keep the day as it is
        </button>
        <button disabled={!ok || busy}
                onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
                className="text-sm bg-red-700 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          {busy ? "Clearing…" : `Clear ${date} and start again`}
        </button>
      </div>
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
function TaskPasteDialog({ date, seed, knownTechs, onCancel, onCommit }) {
  const [text, setText] = useState(seed || "");
  const [preview, setPreview] = useState(null);

  function read(v) {
    setText(v);
    if (!squash(v)) { setPreview(null); return; }
    setPreview(parseAnyPaste(v, date, parseSheetPaste, { techs: knownTechs }));
  }

  /* Arrives already filled in when the coordinator pasted the sheet into
     the quick-add box and was redirected here. Parse it straight away so
     they see the rows read properly rather than an empty box. */
  useEffect(() => { if (seed) read(seed); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = preview?.jobs || [];
  /* Rows that read exactly alike. They are separate jobs and come in as
     separate jobs — but nobody on the day can tell them apart, and that is
     worth saying before it is a technician's problem. */
  const indistinct = useMemo(
    () => (rows.length ? pasteAdditions([], rows).indistinct : []),
    [rows]
  );
  const dates = preview?.dates || [];
  const elsewhere = dates.filter((d) => d && d !== date);
  const withTime = rows.filter((r) => squash(r.timeOfVisit)).length;
  const withOcc = rows.filter((r) => squash(r.status)).length;
  const withTech = rows.filter((r) => squash(r.team)).length;

  return (
    <Modal title="Paste the day in" onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">
        Two things paste in here and the box works out which is which: <b>the daily Google Sheet</b>
        exactly as the coordinator fills it — copied out of Sheets, or straight off the PDF, rows
        wrapped or not — or <b>the PMS task list</b>. Column order does not matter, and anything
        already in the app with the same TSK reference is skipped, so pasting the same thing twice
        is safe.
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
          {indistinct.length > 0 && (
            <div className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              <b>{indistinct.reduce((n, g) => n + g.count, 0)} rows read exactly alike</b>, because
              the unit is blank on them:
              <ul className="mt-0.5">
                {indistinct.slice(0, 4).map((g) => {
                  const [prop, unit, desc] = g.key.split("|");
                  return (
                    <li key={g.key}>
                      · {g.count} × {prop || "(no property)"}{unit ? ` ${unit}` : ""} — {desc}
                    </li>
                  );
                })}
              </ul>
              They come in as {indistinct.reduce((n, g) => n + g.count, 0)} separate jobs, which is
              right — five pools are five jobs. But the technician cannot tell which is which, so
              put the number in the sheet&rsquo;s <b>Unit / Villa No.</b> column and re-paste when
              you can.
            </div>
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
function DayReview({ date, jobs, onCancel, onCloseOut, onQuick, onAccountFor }) {
  /* The day split the way it actually happened. Before this, everything
     that was not a recorded outcome counted as "without an outcome" — and
     on 10 September that read seven failures where there was one. A
     duplicate, a job handed to another technician and work passed to
     housekeeping are not failures and are no longer counted as though
     they were. */
  const live = jobs.filter((j) => !isOffBoard(j));
  const offBoard = jobs.filter(isOffBoard);
  const open = live.filter((j) => !isResolved(j.state) && j.state !== "not_done");
  const fixed = live.filter((j) => j.state === "fixed");
  const returning = live.filter((j) => j.state === "made_safe" || j.state === "diagnosed");
  const notDone = live.filter((j) => j.state === "not_done");

  const byKind = {};
  offBoard.forEach((j) => {
    const k = j.offBoard || "other";
    byKind[k] = (byKind[k] || 0) + 1;
  });
  const OFF_WORD = {
    duplicate: ["duplicate", "duplicates"],
    "wrong-entry": ["raised in error", "raised in error"],
    "other-team": ["handed to another team", "handed to other teams"],
    "no-visit": ["resolved without a visit", "resolved without a visit"],
    "called-off": ["called off", "called off"],
    other: ["off the board", "off the board"],
  };
  const offParts = Object.entries(byKind).map(([k, n]) => {
    const w = OFF_WORD[k] || [k, k];
    return `${n} ${n === 1 ? w[0] : w[1]}`;
  });

  const Stat = ({ n, label, tone }) => (
    <span className={tone}>
      <span className="font-semibold tabular-nums">{n}</span> {label}
    </span>
  );

  return (
    <Modal title={`How did ${date} actually go?`} onCancel={onCancel} wide>
      <p className="text-xs text-slate-600">
        Every job needs an answer before the day closes. A clean fix is one click. Anything
        else — made safe, diagnosed, not done — opens the full close-out, because each of
        those has a question behind it that decides whether the work comes back. A row that
        is not a job at all has its own answer, and costs nobody a failure.
      </p>

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
        <div className="text-xs text-slate-500">
          <span className="tabular-nums">{jobs.length}</span> rows ·{" "}
          <span className="tabular-nums font-medium text-slate-700">{live.length}</span> jobs
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
          <Stat n={fixed.length} label="fixed" tone="text-emerald-700" />
          <Stat n={returning.length} label="need a return" tone="text-amber-700" />
          <Stat n={notDone.length} label="did not happen" tone="text-red-700" />
          {open.length > 0 && <Stat n={open.length} label="still open" tone="text-blue-700" />}
        </div>
        {offParts.length > 0 && (
          <div className="mt-1.5 text-xs text-slate-500 border-t border-slate-200 pt-1.5">
            <span className="tabular-nums">{offBoard.length}</span> rows accounted for:{" "}
            {offParts.join(" · ")}
          </div>
        )}
      </div>

      {open.length === 0 ? (
        <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-2">
          Every job on this day has an answer. Nothing here will quietly disappear.
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs text-slate-500">
            {open.length === 1 ? "One row still needs an answer." : `${open.length} rows still need an answer.`}
          </p>
          <div className="mt-1.5 max-h-[26rem] overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
            {open.map((j) => (
              <div key={j.id} className="px-2.5 py-2 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-900">
                    {j.property} {j.unit}
                    {j.team && <span className="font-normal text-slate-400"> · {j.team}</span>}
                    {j.timeOfVisit && <span className="font-normal text-slate-400"> · {j.timeOfVisit}</span>}
                    {j.reassignedFrom && (
                      <span className="font-normal text-blue-600"> · taken over from {j.reassignedFrom}</span>
                    )}
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
                  <button onClick={() => onAccountFor(j)}
                          className="text-xs border border-slate-300 bg-white px-2.5 py-1 rounded-md text-slate-600">
                    Not a job
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
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

/* ====================================================================== *
 * A note on the job.
 *
 * This replaces the "In PMS?" tick, which was answered on 43% of the real
 * month and read "Y" on 203 of those 204 — an intention rather than a
 * check, and nobody could say what it was for. The TSK reference makes the
 * same claim and can actually be verified.
 *
 * What the card lacked was somewhere to write what is going on: the guest
 * is difficult, the building needs a permit, the part is on order, the
 * owner is disputing it. That text is not decoration — read across a few
 * hundred jobs it is where the patterns nobody has a field for live, and
 * the dashboard now counts what turns up in it.
 * ====================================================================== */
function NoteDialog({ job, onCancel, onSave }) {
  const [text, setText] = useState(job.notes || "");
  return (
    <Modal title={`Note — ${job.property} ${job.unit}`} onCancel={onCancel}>
      <p className="text-xs text-slate-600">
        Anything worth knowing that no field asks for. It stays on the job, shows on the card, and
        is read back on the dashboard — so recurring themes surface instead of being retyped every
        time somebody hits the same wall.
      </p>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={5}
                placeholder="Guest works nights, will not open before 11am. Building needs 24h notice for the service lift."
                className="mt-2 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button onClick={() => onSave(text)} className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">
          Save the note
        </button>
      </div>
    </Modal>
  );
}
