import React, { useState, useEffect, useMemo } from "react";
import {
  Users, Loader2, Check, AlertTriangle, Phone, Clock, Plane, Save, X,
} from "lucide-react";
import { storageGet, storageSet } from "../lib/storage.js";
import { readDay, migrateDay } from "../lib/jobStore.js";
import { liveJobs } from "../lib/job.js";
import { parseRosterMessage, rosterSummary, checkAgainstSchedule } from "../lib/roster.js";

/* ---------------------------------------------------------------------- *
 * Roster.jsx — who is actually available today.
 *
 * The department already writes this every day as a message. It is pasted
 * here rather than re-entered in a form, for the same reason the
 * technician's work report is pasted: the data exists, and re-keying it is
 * the step that does not survive a working day.
 *
 * The payoff is not the list. It is that the schedule can finally be
 * checked against it — a job assigned to somebody on annual leave was
 * previously invisible.
 * ---------------------------------------------------------------------- */

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Roster({ selectedDate, setSelectedDate, showToast }) {
  const [date, setDate] = useState(selectedDate || todayISO());
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const raw = await storageGet(`roster:${date}`);
      let r = null;
      try { r = raw ? JSON.parse(raw) : null; } catch { r = null; }
      setSaved(r);
      setText(r ? r.raw : "");
      setEditing(!r);
      const day = await readDay(date);
      setJobs(liveJobs(migrateDay(day, date)));
      setLoading(false);
    })();
  }, [date]);

  const preview = useMemo(() => (text.trim() ? parseRosterMessage(text) : null), [text]);
  const active = editing ? preview : saved;
  const check = useMemo(
    () => (active ? checkAgainstSchedule(active, jobs) : null),
    [active, jobs]
  );

  async function save() {
    if (!preview) return;
    setSaving(true);
    const toStore = { ...preview, savedAt: Date.now() };
    await storageSet(`roster:${preview.date || date}`, JSON.stringify(toStore));
    if (preview.date && preview.date !== date) setDate(preview.date);
    setSaved(toStore);
    setEditing(false);
    setSaving(false);
    showToast(`Roster saved for ${preview.date || date}.`, "ok");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Roster — who is available today</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Paste the shift message exactly as it is written. Shifts, week offs, leave, off-site
          postings, the stand-by technician and the coordinators' hours are all read from it. The
          point is not the list — it is that the day's schedule gets checked against it, so a job
          assigned to somebody on leave stops being invisible.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-600">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                 className="mt-1 block border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        {saved && !editing && (
          <button onClick={() => setEditing(true)}
                  className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-50">
            Edit / paste a new one
          </button>
        )}
        {saved && (
          <span className="text-xs text-emerald-700 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> Saved roster on file for {date}
          </span>
        )}
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>

      {editing && (
        <div className="rounded-lg border border-slate-300 bg-white p-3">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={12}
            placeholder={"*Shift Timings for 01/09/2026*\n\nWeek off - Riyaz\nPH - Imtiaz\nFujairah - Faizal\n\n9.00am - 6.00pm\nResty\nAdi, Khaled, Nizar, Shafiq & Bijaya\n\nStand-by Emergency Tech 11.00pm - 2.00am\nAnthony +971 50 260 6632\n\n*Coordinators Shift*\nHaris - 8.00 am - 5.00 pm"}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
          />
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button onClick={save} disabled={!preview || saving}
                    className="flex items-center gap-1.5 text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save roster{preview && preview.date ? ` for ${preview.date}` : ""}
            </button>
            {saved && (
              <button onClick={() => { setText(saved.raw); setEditing(false); }}
                      className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
            )}
            {preview && preview.warnings.length > 0 && (
              <span className="text-xs text-amber-700 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> {preview.warnings[0]}
              </span>
            )}
          </div>
        </div>
      )}

      {active && <RosterBoard roster={active} check={check} onOpenDay={() => setSelectedDate(date)} />}

      {!active && !loading && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No roster saved for {date}. Paste the shift message above.
        </div>
      )}
    </div>
  );
}

function RosterBoard({ roster, check }) {
  const s = check ? check.summary : rosterSummary(roster);
  if (!s) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Available today" value={s.liveCount}
              sub={`of ${s.totalCount} on the roster`}
              note="on shift, off-site or on stand-by" tone="good" />
        <Tile label="On shift" value={s.onShiftCount}
              sub={`${Math.round(s.rosteredMinutes / 60)}h rostered`}
              note={s.shifts.map((x) => `${x.techs.length} @ ${x.label}`).join(" · ")} />
        <Tile label="Not available" value={s.unavailable.length}
              sub={s.unavailable.join(", ") || "nobody"}
              note="week off, leave, public holiday"
              tone={s.unavailable.length ? "warn" : "neutral"} />
        <Tile label="Off-site" value={s.offsite.length}
              sub={s.offsite.join(", ") || "nobody"}
              note="working, but not on Dubai jobs" />
        <Tile label="Stand-by" value={s.standby.join(", ") || "—"}
              sub={s.standbyBlock && s.standbyBlock.range ? s.standbyBlock.range.label : ""}
              note={s.standbyBlock ? s.standbyBlock.phone : ""}
              small tone={s.standby.length ? "neutral" : "warn"} />
      </div>

      {check && (check.assignedAway.length > 0 || check.notOnRoster.length > 0 || check.idle.length > 0) && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
          <h3 className="text-sm font-medium text-slate-900">The schedule against the roster</h3>

          {check.assignedAway.length > 0 && (
            <Alert tone="bad" icon={AlertTriangle}
                   title={`${check.assignedAway.length} job(s) assigned to somebody who is not available`}>
              {check.assignedAway.slice(0, 10).map((x, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    <span className="font-medium">{x.tech}</span> ({x.reason}) — {x.job.property} {x.job.unit}
                  </span>
                </li>
              ))}
            </Alert>
          )}

          {check.notOnRoster.length > 0 && (
            <Alert tone="warn" icon={AlertTriangle}
                   title={`${check.notOnRosterTechs.length} technician(s) have jobs but are not on the roster`}>
              <li className="text-slate-700">{check.notOnRosterTechs.join(", ")}</li>
              <li className="text-slate-500">
                Either the roster message missed them, or the name is spelled differently on the board.
              </li>
            </Alert>
          )}

          {check.idle.length > 0 && (
            <Alert tone="info" icon={Clock}
                   title={`${check.idle.length} technician(s) on shift with nothing scheduled`}>
              <li className="text-slate-700">{check.idle.join(", ")}</li>
              <li className="text-slate-500">
                Paid capacity with no work against it. Worth filling with planned work before it
                becomes an inspection to pass the time.
              </li>
            </Alert>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-medium text-slate-900 mb-2">Shifts</h3>
          {s.shifts.map((sh) => (
            <div key={sh.label} className="mb-2 last:mb-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-slate-800 tabular-nums">{sh.label}</span>
                <span className="text-[11px] text-slate-400">
                  {sh.techs.length} {sh.techs.length === 1 ? "person" : "people"} · {Math.round((sh.minutes * sh.techs.length) / 60)}h
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {sh.techs.map((t) => (
                  <span key={t} className="text-[11px] rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {roster.shifts.some((x) => x.notes) && (
            <p className="text-[11px] text-slate-500 mt-2 border-t border-slate-100 pt-1.5">
              {roster.shifts.flatMap((x) => x.notes || []).join(" · ")}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-medium text-slate-900 mb-2">Away & coordinators</h3>
          {s.awayBreakdown.length === 0 && <p className="text-xs text-slate-400">Nobody away.</p>}
          {s.awayBreakdown.map((a, i) => (
            <div key={i} className="flex items-baseline gap-2 text-xs mb-1">
              {a.counts ? <Plane className="w-3 h-3 text-slate-400 shrink-0" />
                        : <X className="w-3 h-3 text-slate-400 shrink-0" />}
              <span className="text-slate-500 w-28 shrink-0">{a.label}</span>
              <span className="text-slate-800">{a.names.join(", ")}</span>
              {a.counts && <span className="text-[10px] text-slate-400">still working</span>}
            </div>
          ))}

          {s.standbyBlock && (
            <div className="mt-2 pt-2 border-t border-slate-100 text-xs">
              <div className="flex items-baseline gap-2">
                <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="text-slate-500 w-28 shrink-0">
                  Stand-by {s.standbyBlock.range ? s.standbyBlock.range.label : ""}
                </span>
                <span className="text-slate-800">
                  {s.standbyBlock.names.join(", ")}
                  {s.standbyBlock.phone && <span className="text-slate-500"> · {s.standbyBlock.phone}</span>}
                </span>
              </div>
            </div>
          )}

          {s.coordinators.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              {s.coordinators.map((c, i) => (
                <div key={i} className="flex items-baseline gap-2 text-xs mb-0.5">
                  <Users className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="text-slate-500 w-28 shrink-0">Coordinator</span>
                  <span className="text-slate-800">{c.name}</span>
                  <span className="text-slate-500 tabular-nums">{c.range ? c.range.label : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, note, tone = "neutral", small }) {
  const tones = {
    neutral: "border-slate-200", good: "border-emerald-300 bg-emerald-50/40",
    warn: "border-amber-300 bg-amber-50/40", bad: "border-red-300 bg-red-50/40",
  };
  return (
    <div className={`rounded-lg border ${tones[tone]} bg-white p-3`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`${small ? "text-sm" : "text-2xl"} font-semibold text-slate-900 mt-0.5`}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
      {note && <div className="text-[10px] text-slate-400 mt-1 border-t border-slate-100 pt-1">{note}</div>}
    </div>
  );
}

function Alert({ tone, icon: Icon, title, children }) {
  const tones = {
    bad: "border-red-200 bg-red-50 text-red-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    info: "border-blue-200 bg-blue-50 text-blue-900",
  };
  return (
    <div className={`rounded-md border p-2.5 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="w-3.5 h-3.5" /> {title}
      </div>
      <ul className="mt-1 space-y-0.5 text-xs">{children}</ul>
    </div>
  );
}
