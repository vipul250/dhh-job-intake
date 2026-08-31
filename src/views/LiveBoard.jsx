import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, Play, Check, X, ArrowRight, Clipboard, History, AlertTriangle,
  Loader2, RefreshCw, ChevronDown, ChevronRight, Users, CircleDot, Trash2,
  CalendarClock, Wand2, Pin,
} from "lucide-react";
import {
  newJob, moveJob, setState as setJobState, applyEdit, withEvent,
  isTombstone, liveJobs, tombstones, jobMinutes, isOpen, pushSeverity,
  needsGuestConfirm, pmsText, parseQuickAdd, splitQuickAddLines, findReturn,
  actualDuration,
  STATE_META, NOT_DONE_REASONS, MOVE_REASONS, CANCEL_REASONS, EVENT_LABEL,
} from "../lib/job.js";
import { RETURN_REASONS, FAMILY_LABEL } from "../lib/faultFamily.js";
import {
  readDay, mutateDay, upsert, removeJob, migrateDay, needsMigration,
  createDayWatcher,
} from "../lib/jobStore.js";
import {
  splitCrew, parseShiftMinutes, formatMinutes, canonPriority, squash,
  canonProperty, displayProperty,
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

/* Identity is attribution, not authentication — there is no login in this
   app and adding one is a different piece of work. It is enough to answer
   "who moved this job", which is the question nobody can answer today. */
function useMe() {
  const [me, setMe] = useState(() => {
    try {
      const raw = localStorage.getItem("dhh-me");
      if (raw) return JSON.parse(raw);
    } catch { /* fall through to the prompt */ }
    return null;
  });
  const save = (next) => {
    setMe(next);
    try { localStorage.setItem("dhh-me", JSON.stringify(next)); } catch { /* private mode */ }
  };
  return [me, save];
}

export default function LiveBoard({
  selectedDate, setSelectedDate, propertyMaster, knownTeams, onEditFull, showToast,
}) {
  const [me, setMe] = useMe();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rollover, setRollover] = useState(null);
  const [trailFor, setTrailFor] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  const [outcomeFor, setOutcomeFor] = useState(null);
  const [liveNote, setLiveNote] = useState("");
  const [returnPrompts, setReturnPrompts] = useState([]);
  const watcher = useRef(null);

  const jobs = useMemo(() => (rows ? liveJobs(rows) : []), [rows]);
  const tombs = useMemo(() => (rows ? tombstones(rows) : []), [rows]);

  /* ------------------------------ load ------------------------------- */
  const load = useCallback(async (date) => {
    setLoading(true);
    let day = await readDay(date);
    if (needsMigration(day)) {
      // Lazy upgrade: old rows get identity the first time their day is
      // opened, so nothing has to be migrated up front.
      day = migrateDay(day, date);
      await mutateDay(date, () => day);
    }
    setRows(day);
    setLoading(false);

    /* Anything left open on an earlier day is the thing that used to
       silently vanish. Two details matter here:

       - It only prompts when you are looking at today or a future day.
         Scrolling back through last month's boards to check something
         should not nag about decisions that are long past.
       - It looks back several days, not one. A Friday-to-Monday gap would
         otherwise strand the whole weekend, which is exactly the case
         where jobs go missing today. */
    if (date < isoToday()) { setRollover(null); return; }
    const lookback = [1, 2, 3, 4, 5].map((n) => addDays(date, -n));
    const stranded = [];
    let oldest = null;
    for (const d of lookback) {
      const rows = liveJobs(migrateDay(await readDay(d), d)).filter(isOpen);
      if (rows.length) { stranded.push(...rows); oldest = d; }
    }
    setRollover(stranded.length ? { date: oldest, jobs: stranded, days: lookback } : null);
  }, []);

  useEffect(() => { load(selectedDate); }, [selectedDate, load]);

  /* --------------------------- live refresh --------------------------- */
  useEffect(() => {
    if (!watcher.current) watcher.current = createDayWatcher({});
    const w = watcher.current;
    w.watch(selectedDate, (fresh) => {
      setRows(fresh);
      setLiveNote(`Updated by someone else at ${clock(Date.now())}`);
      setTimeout(() => setLiveNote(""), 6000);
    }, rows);
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
    const created = fieldsList.map((f) => newJob(f, selectedDate, who));
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

  async function advance(job, state, extra) {
    await change(selectedDate, (cur) => upsert(cur, setJobState(job, state, who, extra)));
  }

  async function edit(job, patch) {
    await change(selectedDate, (cur) => upsert(cur, applyEdit(job, patch, who)));
  }

  async function togglePms(job) {
    const next = job.inPms === true ? false : job.inPms === false ? null : true;
    await change(selectedDate, (cur) =>
      upsert(cur, withEvent({ ...job, inPms: next }, "pms", who, { to: String(next) })));
  }

  /* The move. Two writes: a tombstone on the day it leaves, the job itself
     on the day it lands. Deliberately not a delete anywhere. */
  async function doMove(job, toDate, reason) {
    const { moved, tomb } = moveJob(job, toDate, who, reason);
    await change(selectedDate, (cur) => [...removeJob(cur, job.id), tomb]);
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
        onAdd={addJobs}
        busy={busy}
      />

      {returnPrompts.length > 0 && (
        <ReturnPrompts
          prompts={returnPrompts}
          onAnswer={setReturnReason}
          onDismiss={(job) => setReturnPrompts((prev) => prev.filter((p) => p.job.id !== job.id))}
        />
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading {selectedDate}…
        </div>
      )}

      {!loading && jobs.length === 0 && tombs.length === 0 && (
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
          onEditFull={onEditFull} showToast={showToast}
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
          job={moveFor} fromDate={selectedDate}
          onCancel={() => setMoveFor(null)}
          onMove={(to, reason) => doMove(moveFor, to, reason)}
        />
      )}
      {outcomeFor && (
        <OutcomeDialog
          job={outcomeFor.job} kind={outcomeFor.kind}
          onCancel={() => setOutcomeFor(null)}
          onConfirm={(reason) => {
            advance(outcomeFor.job, outcomeFor.kind === "cancel" ? "cancelled" : "not_done", { reason });
            setOutcomeFor(null);
          }}
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
        Your name goes on every change you make, so the board can answer "who moved this job
        and when". It is stored on this device only — this is attribution, not a login, and it
        does not restrict what anyone can do.
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
  const [reason, setReason] = useState(MOVE_REASONS[6]);
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
              {MOVE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
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

function QuickAdd({ knownProps, knownTechs, onAdd, busy }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  const multi = text.includes("\n");

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const lines = splitQuickAddLines(text);
    return lines.map((l) => parseQuickAdd(l, { properties: knownProps, techs: knownTechs }));
  }, [text, knownProps, knownTechs]);

  const valid = preview ? preview.filter((p) => squash(p.fields.property) || squash(p.fields.description)) : [];

  async function commit() {
    if (!valid.length) return;
    await onAdd(valid.map((p) => p.fields));
    setText("");
    inputRef.current?.focus();
  }

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
            <span>Type it how you say it — order does not matter.</span>
            <span>Enter to add{multi ? " (⌘/Ctrl+Enter for a block)" : ""}. Paste several lines to add several jobs.</span>
          </div>
        </div>
        <button onClick={commit} disabled={!valid.length || busy}
                className="text-sm bg-slate-900 text-white px-3 py-2 rounded-md shrink-0 disabled:opacity-40">
          Add{valid.length > 1 ? ` ${valid.length}` : ""}
        </button>
      </div>

      {preview && valid.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5">
          <p className="text-[11px] text-slate-500">
            Read as — check it before adding, anything wrong is editable on the card afterwards:
          </p>
          {valid.slice(0, 6).map((p, i) => <ParsePreview key={i} fields={p.fields} />)}
          {valid.length > 6 && <p className="text-[11px] text-slate-400">+{valid.length - 6} more lines</p>}
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

function TeamGroup({ group, me, allJobs, selectedDate, onAdvance, onEdit, onTogglePms, onMove, onOutcome, onTrail, onEditFull, showToast, onMoveMany }) {
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
              onEditFull={onEditFull} showToast={showToast}
              suggestFrom={g.team === "Unassigned" ? allJobs : null}
            />
          ))}
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
  done: "bg-emerald-100 text-emerald-700",
  not_done: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400 line-through",
};

function JobRow({ job, me, onAdvance, onEdit, onTogglePms, onMove, onOutcome, onTrail, onEditFull, showToast, suggestFrom }) {
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
          </div>
          <p className="text-xs text-slate-600 mt-0.5">{job.description || <span className="text-slate-400">no task written</span>}</p>
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
              <IconBtn title="Done" onClick={() => onAdvance(job, "done")} tone="emerald" active={job.state === "done"}>
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
                     onClick={() => setSuggestions(suggestions ? null : suggestTechnician(job, suggestFrom))}
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
            By the rule — already going to that building, then room in the shift, then whether the
            shift covers the requested time:
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
          <InlineField label="PMS ref" value={job.pmsRef} onSave={(v) => onEdit(job, { pmsRef: v })} />
          <InlineField label="Task" value={job.description} onSave={(v) => onEdit(job, { description: v })} full />
          <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
            {onEditFull && (
              <button onClick={() => onEditFull(job)} className="text-xs border border-slate-300 rounded-md px-2 py-1 hover:bg-slate-50">
                Open full form
              </button>
            )}
            {job.state !== "cancelled" && (
              <button onClick={() => onOutcome({ job, kind: "cancel" })}
                      className="text-xs text-red-700 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Cancel this job
              </button>
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
            {t.reason && <span className="text-slate-500">· {t.reason}</span>}
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

function MoveDialog({ job, fromDate, onCancel, onMove }) {
  const [to, setTo] = useState(addDays(fromDate, 1));
  const [reason, setReason] = useState(MOVE_REASONS[0]);
  return (
    <Modal title={`Move ${job.property} ${job.unit}`} onCancel={onCancel}>
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
        Why is it moving? <span className="text-slate-400">— this is the part nobody can answer today</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          {MOVE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
        <button onClick={() => onMove(to, reason)} className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">
          Move to {to}
        </button>
      </div>
    </Modal>
  );
}

function OutcomeDialog({ job, kind, onCancel, onConfirm }) {
  const list = kind === "cancel" ? CANCEL_REASONS : NOT_DONE_REASONS;
  const [reason, setReason] = useState(list[0]);
  const [other, setOther] = useState("");
  const final = reason === "Other" ? (other.trim() || "Other") : reason;
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
      </select>
      {reason === "Other" && (
        <input autoFocus value={other} onChange={(e) => setOther(e.target.value)}
               placeholder="What happened?"
               className="mt-2 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Back</button>
        <button onClick={() => onConfirm(final)}
                className={`text-sm text-white px-3 py-1.5 rounded-md ${kind === "cancel" ? "bg-slate-700" : "bg-red-600"}`}>
          {kind === "cancel" ? "Cancel job" : "Mark not done"}
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
