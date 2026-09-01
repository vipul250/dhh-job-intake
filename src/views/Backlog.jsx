import React, { useState, useEffect, useMemo } from "react";
import {
  Inbox, Loader2, AlertTriangle, CalendarCheck, Clock, ClipboardPaste,
  ChevronDown, ChevronRight, CheckCircle2, HelpCircle, Trash2, Search,
} from "lucide-react";
import { storageGet, storageSet } from "../lib/storage.js";
import { readDays, mutateDay, migrateDay } from "../lib/jobStore.js";
import { liveJobs, newJob } from "../lib/job.js";
import {
  parseIssuePaste, dedupe, triage, recommendDay, backlogSummary,
  BASIS, SLA_LABEL, SLA_DAYS, addDays, daysBetween, parseOccupancy,
} from "../lib/backlog.js";
import { squash } from "../lib/normalize.js";

/* ---------------------------------------------------------------------- *
 * Backlog.jsx — the queue the schedule is built from.
 *
 * Everything the app measured until now started at the moment a job landed
 * on a day. The decision that actually matters happens before that, and it
 * was invisible: 189 maintenance issues sitting in PMS, the oldest reported
 * four months ago, waiting for a coordinator to "assess it and schedule it
 * for a future day".
 *
 * This screen shows that queue with the rule applied to every line — which
 * day, and why. It does not schedule anything on its own. What changes is
 * that the coordinator now starts from a defensible answer and their
 * departure from it is a recorded choice, rather than the only thing that
 * ever happens.
 * ---------------------------------------------------------------------- */

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Backlog({ knownDates, selectedDate, setSelectedDate, setActiveTab, showToast }) {
  const [items, setItems] = useState(null);
  const [jobsByDate, setJobsByDate] = useState({});
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  const [showRule, setShowRule] = useState(false);
  const today = todayISO();

  useEffect(() => {
    (async () => {
      const raw = await storageGet("backlog");
      let list = [];
      try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
      setItems(list);
      const dates = [];
      for (let i = -1; i <= 30; i++) dates.push(addDays(today, i));
      const days = await readDays(dates);
      const map = {};
      Object.entries(days).forEach(([d, rows]) => { map[d] = liveJobs(migrateDay(rows, d)); });
      setJobsByDate(map);
    })();
  }, [knownDates]);

  async function save(next) {
    setItems(next);
    await storageSet("backlog", JSON.stringify(next));
  }

  /* Context the rule needs: which buildings are already being visited on
     which day, and roughly how much of each day is spoken for. Both come
     from the board, so the recommendation moves as the days fill up. */
  const ctx = useMemo(() => {
    const buildingDays = new Set();
    const load = {};
    Object.entries(jobsByDate).forEach(([d, rows]) => {
      load[d] = rows.length;
      rows.forEach((j) => buildingDays.add(`${squash(j.property).toLowerCase()}|${d}`));
    });
    return {
      today,
      buildingDaysRaw: buildingDays,
      load,
      roomOn: (d) => (load[d] || 0) < 40,
    };
  }, [jobsByDate, today]);

  const ctxFor = (item) => ({
    ...ctx,
    buildingDays: {
      has: (d) => ctx.buildingDaysRaw.has(`${squash(item.property).toLowerCase()}|${d}`),
    },
  });

  const rows = useMemo(
    () => (items ? triage(items, ctx).map((r) => ({
      item: r.item, rec: recommendDay(r.item, ctxFor(r.item)),
    })) : []),
    [items, ctx]
  );
  const summary = useMemo(() => (items ? backlogSummary(items, ctx) : null), [items, ctx]);

  async function schedule(item, rec, date) {
    const day = date || rec.date;
    if (!day) return;
    setBusy(true);
    try {
      const job = newJob({
        property: item.property,
        unit: item.unit,
        description: item.description,
        priority: item.priority,
        status: rec.window.occ.raw,
        pmsRef: item.pmsRef,
        source: "pms-queue",
        reportedBy: item.reportedBy,
        // The whole point: the day carries the reason it was chosen.
        scheduledBasis: date && date !== rec.date ? "overruled" : rec.basis,
        scheduledWhy: date && date !== rec.date
          ? `Coordinator chose ${date}; the rule said ${rec.date || "not yet schedulable"}.`
          : rec.why.join(" "),
        backlogId: item.id,
        reportedOn: item.reportedOn,
        dueDate: rec.deadline || "",
      }, day, "coordinator");
      await mutateDay(day, (cur) => [...cur, job]);
      await save(items.map((i) => (i.id === item.id
        ? { ...i, scheduledFor: day, scheduledJobId: job.id } : i)));
      showToast?.(`Booked for ${day}. The reason went with it.`, "ok");
    } catch (e) {
      showToast?.(e.message || "Could not schedule that.", "warn");
    } finally {
      setBusy(false);
    }
  }

  function commitPaste() {
    const { items: parsed, skipped, error } = parseIssuePaste(paste, today);
    if (error) { showToast?.(error, "warn"); return; }
    const { fresh, dupes } = dedupe(items || [], parsed);
    save([...(items || []), ...fresh]);
    setPaste(""); setPasting(false);
    showToast?.(
      `${fresh.length} added${dupes.length ? `, ${dupes.length} already in the queue` : ""}${skipped ? `, ${skipped} row(s) unreadable` : ""}.`,
      "ok"
    );
  }

  if (items === null) {
    return <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading the queue…
    </div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">The queue — what is waiting, and which day it should go on</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Asked what happens when an issue is logged in PMS, a coordinator says they assess it and
            schedule it for a future day, or the same day if possible. That is an honest description
            of a decision with no stated basis. This screen gives it one: every line gets a day and
            the reasoning behind it, built only from information PMS already holds.
          </p>
        </div>
        <button onClick={() => setPasting(true)}
                className="flex items-center gap-1.5 text-sm bg-slate-900 text-white px-3 py-2 rounded-md shrink-0">
          <ClipboardPaste className="w-4 h-4" /> Paste the PMS queue
        </button>
      </div>

      <button onClick={() => setShowRule(!showRule)}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900">
        {showRule ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        The rule, in full
      </button>
      {showRule && <TheRule />}

      {summary && items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Waiting" value={summary.open} sub={`${summary.scheduled} booked from here`} />
          <Stat label="Past due" value={summary.overdue}
                sub={summary.open ? `${Math.round((summary.overdue / summary.open) * 100)}% of the queue` : ""}
                tone={summary.overdue ? "bad" : "good"} icon={AlertTriangle} />
          <Stat label="Oldest" value={summary.oldestDays == null ? "—" : `${summary.oldestDays}d`}
                sub={summary.medianAgeDays == null ? "" : `median ${summary.medianAgeDays}d`}
                tone={summary.oldestDays > 60 ? "bad" : "neutral"} />
          <Stat label="Blocked on a guest" value={summary.blocked}
                sub="need a time agreed first" tone={summary.blocked ? "warn" : "good"} />
          <Stat label="Empty right now" value={summary.vacantNow}
                sub="no access risk at all" tone="good" />
          <Stat label="Waiting on a checkout" value={summary.checkoutWindows}
                sub="the date is already in PMS" />
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <Inbox className="w-6 h-6 text-slate-300 mx-auto" />
          <p className="text-sm text-slate-600 mt-2 max-w-xl mx-auto">
            Nothing in the queue yet. Open <b>Issues &amp; Requests</b> in PMS, filter to Maintenance,
            select the table and paste it here. The columns it needs are Description, Priority,
            Status, Due date, Property, Occupancy and Reported on — the ones already on that screen.
          </p>
          <button onClick={() => setPasting(true)}
                  className="mt-3 text-sm bg-slate-900 text-white px-3 py-2 rounded-md">
            Paste the PMS queue
          </button>
        </div>
      )}

      <div className="space-y-2">
        {rows.map(({ item, rec }) => (
          <QueueRow
            key={item.id} item={item} rec={rec} busy={busy}
            open={openRow === item.id}
            onToggle={() => setOpenRow(openRow === item.id ? null : item.id)}
            onSchedule={(d) => schedule(item, rec, d)}
            onDrop={() => save(items.filter((i) => i.id !== item.id))}
            onOpenDay={(d) => { setSelectedDate(d); setActiveTab("live"); }}
          />
        ))}
      </div>

      {items.some((i) => i.scheduledFor) && (
        <details className="rounded-lg border border-slate-200 bg-white p-4">
          <summary className="text-sm font-medium text-slate-800 cursor-pointer">
            Booked from this queue ({items.filter((i) => i.scheduledFor).length})
          </summary>
          <ul className="mt-2 space-y-1">
            {items.filter((i) => i.scheduledFor).map((i) => (
              <li key={i.id} className="text-xs text-slate-600 flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                <button onClick={() => { setSelectedDate(i.scheduledFor); setActiveTab("live"); }}
                        className="text-slate-500 underline underline-offset-2">{i.scheduledFor}</button>
                <span><b>{i.property} {i.unit}</b> — {i.description}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pasting && (
        <PasteDialog value={paste} onChange={setPaste}
                     onCancel={() => setPasting(false)} onCommit={commitPaste} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function TheRule() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-700 space-y-3 max-w-4xl">
      <p className="text-slate-600">
        Four steps, in order. Every one of them uses a field PMS already fills in, so none of this
        asks the coordinator for anything new.
      </p>
      <Step n="1" title="When can we get in?">
        The unit's occupancy is the hard constraint, and it is the one nobody is using.
        <b> Vacant</b> means any day. <b>Occupied until a date</b> means that checkout is the first
        clean day for anything that needs the unit empty — duct cleaning, painting, water off,
        anything over three hours. Lighter work can happen around a guest, but only once a time is
        agreed. <b>Occupied with no end date</b> cannot be planned at all until somebody speaks to
        the guest.
      </Step>
      <Step n="2" title="When must it be done by?">
        The PMS due date where there is one. Otherwise the reported date plus the response time the
        priority implies: {Object.entries(SLA_LABEL).map(([k, v], i) => (
          <span key={k}>{i ? " · " : ""}<b>{k.replace("PRI-", "P")}</b> {v}</span>
        ))}. These bands are written down here so they can be argued with — that is the point of
        having them.
      </Step>
      <Step n="3" title="Do those two overlap?">
        If not, it is a conflict with no right answer: a PPM due in July in a unit whose guest
        leaves in late September. The two ways out are to agree a time with the guest inside the
        deadline, or to accept the slip and record why. What it must not do is keep waiting, which
        is what happens today.
      </Step>
      <Step n="4" title="Which day inside the window?">
        A checkout or a vacancy wins — no guest to ask, no access risk, and the unit is free for as
        long as the work needs. Otherwise the earliest day with room left in the shift. Ties go to
        the day the crew is already in that building.
      </Step>
      <p className="text-slate-500 border-t border-slate-100 pt-2">
        Ordering the jobs <i>within</i> a day is a separate rule and already in the app: confirmed
        appointment, then P1, then batch by building.
      </p>
    </div>
  );
}

const Step = ({ n, title, children }) => (
  <div className="flex gap-3">
    <div className="w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] flex items-center justify-center shrink-0 mt-0.5">{n}</div>
    <div><b className="text-slate-900">{title}</b> {children}</div>
  </div>
);

function QueueRow({ item, rec, open, onToggle, onSchedule, onDrop, onOpenDay, busy }) {
  const [pick, setPick] = useState("");
  const tone = rec.conflict ? "border-red-300 bg-red-50/50"
    : rec.blocked ? "border-amber-300 bg-amber-50/50"
    : rec.overdue ? "border-orange-200 bg-orange-50/40"
    : "border-slate-200 bg-white";

  const age = item.reportedOn ? daysBetween(item.reportedOn, new Date().toISOString().slice(0, 10)) : null;

  return (
    <div className={`rounded-lg border ${tone} p-3`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{item.property} {item.unit}</span>
            {item.priority && (
              <span className="text-[11px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-700">
                {item.priority.replace("PRI-", "P")}
              </span>
            )}
            {rec.overdue && (
              <span className="text-[11px] rounded px-1.5 py-0.5 bg-red-100 text-red-800 border border-red-200">
                {rec.deadline ? `${daysBetween(rec.deadline, new Date().toISOString().slice(0, 10))} days past due` : "past due"}
              </span>
            )}
            {age != null && (
              <span className="text-[11px] text-slate-400">reported {age}d ago{item.reportedBy ? ` by ${item.reportedBy}` : ""}</span>
            )}
            {item.pmsStatus && <span className="text-[11px] text-slate-400">· {item.pmsStatus}</span>}
          </div>
          <div className="text-xs text-slate-700 mt-1">{item.description}</div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {rec.date ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <CalendarCheck className="w-3.5 h-3.5 text-slate-500" />
                <b className="text-slate-900">{rec.date}</b>
                <span className="text-slate-500">— {BASIS[rec.basis]}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-800">
                <HelpCircle className="w-3.5 h-3.5" /> {BASIS[rec.basis]}
              </span>
            )}
            {rec.action && (
              <span className="text-[11px] rounded px-1.5 py-0.5 bg-slate-900 text-white">{rec.action}</span>
            )}
            <button onClick={onToggle} className="text-[11px] text-slate-500 underline underline-offset-2">
              {open ? "hide the reasoning" : "why"}
            </button>
          </div>

          {open && (
            <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
              {rec.why.map((w, i) => <li key={i} className="text-xs text-slate-600">{w}</li>)}
            </ul>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {rec.date && (
            <button disabled={busy} onClick={() => onSchedule(rec.date)}
                    className="text-xs bg-slate-900 text-white px-2.5 py-1.5 rounded-md disabled:opacity-40">
              Book {rec.date}
            </button>
          )}
          <div className="flex items-center gap-1">
            <input type="date" value={pick} onChange={(e) => setPick(e.target.value)}
                   className="text-xs border border-slate-300 rounded-md px-1.5 py-1" />
            <button disabled={!pick || busy} onClick={() => onSchedule(pick)}
                    className="text-xs border border-slate-300 bg-white px-2 py-1 rounded-md disabled:opacity-40">
              another day
            </button>
          </div>
          <button onClick={onDrop} className="text-[11px] text-slate-400 hover:text-red-600 inline-flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> not ours
          </button>
        </div>
      </div>
    </div>
  );
}

function PasteDialog({ value, onChange, onCancel, onCommit }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl p-4">
        <h3 className="text-sm font-semibold text-slate-900">Paste the PMS issues queue</h3>
        <p className="text-xs text-slate-600 mt-1">
          In PMS: <b>Issues &amp; Requests → Maintenance</b>. Set the page size high enough to show
          the lot, select the table including its headings, copy, and paste here. Column order does
          not matter — the headings are matched by name. Anything already in the queue is skipped,
          so pasting the same list twice is safe.
        </p>
        <textarea autoFocus value={value} onChange={(e) => onChange(e.target.value)}
                  rows={12} placeholder="Description	Priority	Status	Due date	…"
                  className="mt-3 w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs font-mono" />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
          <button onClick={onCommit} disabled={!value.trim()}
                  className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
            Add to the queue
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone = "neutral", icon: Icon }) {
  const colour = { good: "text-emerald-700", bad: "text-red-700", warn: "text-amber-700", neutral: "text-slate-900" }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] text-slate-500 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className={`text-xl font-semibold mt-0.5 ${colour}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
