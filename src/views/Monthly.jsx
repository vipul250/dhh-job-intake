import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Download } from "lucide-react";
import { storageGet } from "../lib/storage.js";
import { parseDay, migrateDay } from "../lib/jobStore.js";
import { liveJobs } from "../lib/job.js";
import { monthlyReport, monthsPresent } from "../lib/monthly.js";

/* ---------------------------------------------------------------------- *
 * Monthly.jsx — one month, one table, no interpretation.
 *
 * Answers exactly one question: over a month, who did how many jobs, how
 * many were major, how many minor, and how long each kind typically takes
 * them. Nothing here explains why a job moved or who decided it — that is
 * the coordinator's business and not a productivity measure.
 *
 * The "timed" column is the honesty column. A technician's minutes come
 * only from jobs with a real arrive/leave time on them, so a low
 * percentage means the average is built on a handful of jobs and should
 * not be read as fact yet.
 * ---------------------------------------------------------------------- */

const MONTH_LABEL = (m) => {
  if (!m) return "";
  const [y, mo] = m.split("-");
  return `${["", "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"][Number(mo)]} ${y}`;
};

const mins = (v) => (v == null ? "—" : v >= 60
  ? `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, "0")}m`
  : `${v}m`);

export default function Monthly({ knownDates }) {
  const [jobs, setJobs] = useState(null);
  const [month, setMonth] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [knownDates]);

  async function load() {
    const dates = [...(knownDates || [])].sort();
    if (!dates.length) { setJobs([]); return; }
    setJobs(null);
    const collected = [];
    /* One round trip per day is slow over a year, so read them in batches. */
    const BATCH = 8;
    for (let i = 0; i < dates.length; i += BATCH) {
      const slice = dates.slice(i, i + BATCH);
      const results = await Promise.all(slice.map((d) => storageGet(`schedule:${d}`)));
      results.forEach((v, k) => {
        /* liveJobs drops tombstones: a job that left a day is not a job
           done on it, and counting both would double every total. */
        liveJobs(migrateDay(parseDay(v), slice[k]))
          .forEach((j) => collected.push({ ...j, _date: slice[k] }));
      });
      setProgress(Math.min(dates.length, i + BATCH));
    }
    setJobs(collected);
  }

  const months = useMemo(() => (jobs ? monthsPresent(jobs) : []), [jobs]);
  const active = month || months[0] || "";
  const r = useMemo(() => (jobs ? monthlyReport(jobs, active) : null), [jobs, active]);

  function exportCsv() {
    const head = ["Technician", "Jobs", "Major", "Minor", "Typical major", "Typical minor", "Timed %"];
    const body = r.byTech.map((t) => [t.tech, t.jobs, t.major, t.minor,
      t.majorMinutes ?? "", t.minorMinutes ?? "", t.timedPct]);
    const csv = [head, ...body].map((row) =>
      row.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `technicians-${active}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (jobs === null) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-12 justify-center">
        <Loader2 size={16} className="animate-spin" />
        Reading {progress} of {(knownDates || []).length} days…
      </div>
    );
  }

  if (!r || !r.jobs) {
    return (
      <div className="text-slate-400 text-sm py-12 text-center">
        No completed jobs on record{active ? ` for ${MONTH_LABEL(active)}` : ""}.
        <div className="text-xs mt-1">
          This report counts work that was closed out on the board. A job that was
          scheduled and never given an outcome does not appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <select
            value={active}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md text-sm px-2 py-1.5 text-slate-100"
          >
            {months.map((m) => <option key={m} value={m}>{MONTH_LABEL(m)}</option>)}
          </select>
          <span className="text-sm text-slate-400">
            {r.jobs} jobs · {r.major} major · {r.minor} minor · {r.technicians} technicians
          </span>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
        >
          <Download size={13} /> CSV
        </button>
      </div>

      {r.timedPct < 50 && (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          Only {r.timedPct}% of these jobs have a real arrive/leave time on them, so the
          typical-minutes columns are built on {r.timed} of {r.jobs} jobs. Job counts and the
          major/minor split are complete either way — those come from the trade, not the clock.
        </div>
      )}

      <Table
        caption="Per technician"
        cols={["Technician", "Jobs", "Major", "Minor", "Typical major", "Typical minor", "Timed"]}
        rows={r.byTech.map((t) => [
          t.tech, t.jobs, t.major, t.minor, mins(t.majorMinutes), mins(t.minorMinutes), `${t.timedPct}%`,
        ])}
      />

      <Table
        caption="Per trade"
        cols={["Trade", "Size", "Jobs", "Typical", "Timed"]}
        rows={r.byTrade.map((t) => [
          t.label, t.size, t.jobs, mins(t.allMinutes), `${t.timedPct}%`,
        ])}
      />
    </div>
  );
}

function Table({ caption, cols, rows }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-300 mb-2">{caption}</h3>
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60 text-slate-400 text-xs">
            <tr>{cols.map((c, i) => (
              <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-t border-slate-800">
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2 ${ci ? "text-right tabular-nums text-slate-300" : "text-slate-100"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
