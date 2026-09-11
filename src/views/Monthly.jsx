import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Download, ChevronRight, Merge } from "lucide-react";
import { storageGet } from "../lib/storage.js";
import { parseDay, migrateDay } from "../lib/jobStore.js";
import { liveJobs } from "../lib/job.js";
import { monthlyReport, periodsPresent, periodFor, periodLabel } from "../lib/monthly.js";
import { buildPropertyIndex } from "../lib/propertyName.js";
import { returnsByUnit } from "../lib/quality.js";

/* ---------------------------------------------------------------------- *
 * Monthly.jsx — one span, one table, no interpretation.
 *
 * Answers exactly one question: over a day, a week or a month, who did how
 * many jobs, how many were major, how many minor, how long each kind
 * typically takes them, and which trades they were. Nothing here explains
 * why a job moved or who decided it — that is the coordinator's business
 * and not a productivity measure.
 *
 * It was written against a dark palette while the rest of the app is light,
 * so every technician's name arrived as near-white on white and the table
 * could not be read at all. The palette below is the app's own.
 *
 * The "timed" column is the honesty column. A technician's minutes come
 * only from jobs with a real arrive/leave time on them, so a low
 * percentage means the average is built on a handful of jobs and should
 * not be read as fact yet.
 * ---------------------------------------------------------------------- */

const GRAINS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];

const mins = (v) => (v == null ? "—" : v >= 60
  ? `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, "0")}m`
  : `${v}m`);

export default function Monthly({ knownDates, propertyMaster }) {
  const [jobs, setJobs] = useState(null);
  const [grain, setGrain] = useState("month");
  /* Per grain, so switching Month -> Week -> Month returns you to the month
     you were reading rather than resetting to the newest one. */
  const [picked, setPicked] = useState({});
  const [openTech, setOpenTech] = useState(null);
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

  /* One property, one name — before anything is grouped by property.
     "Binghatti Tulip 305" and "Binghatti tulips 305" are one pool, and left
     apart they each carry half the visits. See propertyName.js. */
  const index = useMemo(() => (jobs ? buildPropertyIndex(jobs, propertyMaster) : null), [jobs, propertyMaster]);
  const resolved = useMemo(
    () => (jobs && index ? jobs.map((j) => ({ ...j, property: index.resolve(j.property) })) : jobs),
    [jobs, index]
  );

  const options = useMemo(() => (resolved ? periodsPresent(resolved, grain) : []), [resolved, grain]);
  const active = picked[grain] || options[0] || "";
  const r = useMemo(
    () => (resolved ? monthlyReport(resolved, periodFor(grain, active)) : null),
    [resolved, grain, active]
  );
  /* Returns per unit — the headline quality measure, and the one that needs
     no close-out. Recurring work is excluded inside returnsByUnit, or every
     pool Resty cleans on its cycle ranks top and the table is worthless. */
  const units = useMemo(
    () => (resolved ? returnsByUnit(resolved, periodFor(grain, active)) : []),
    [resolved, grain, active]
  );
  const label = periodLabel(grain, active);

  function exportCsv() {
    const head = ["Technician", "Jobs", "Major", "Minor", "Typical major",
                  "Typical minor", "Timed %", "Trades"];
    const body = r.byTech.map((t) => [t.tech, t.jobs, t.major, t.minor,
      t.majorMinutes ?? "", t.minorMinutes ?? "", t.timedPct,
      t.trades.map((x) => `${x.label}: ${x.jobs}`).join("; ")]);
    const csv = [head, ...body].map((row) =>
      row.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `technicians-${grain}-${active}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (jobs === null) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
        <Loader2 size={16} className="animate-spin" />
        Reading {progress} of {(knownDates || []).length} days…
      </div>
    );
  }

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
        {GRAINS.map(([id, text]) => (
          <button
            key={id}
            onClick={() => { setGrain(id); setOpenTech(null); }}
            aria-pressed={grain === id}
            className={`text-xs px-3 py-1.5 ${grain === id
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {options.length > 0 && (
        <select
          value={active}
          onChange={(e) => { setPicked((m) => ({ ...m, [grain]: e.target.value })); setOpenTech(null); }}
          className="bg-white border border-slate-300 rounded-md text-sm px-2 py-1.5 text-slate-900"
        >
          {options.map((v) => (
            <option key={v} value={v}>{periodLabel(grain, v)}</option>
          ))}
        </select>
      )}
    </div>
  );

  if (!r || !r.jobs) {
    return (
      <div className="space-y-4">
        {picker}
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">
            No completed jobs on record{label ? ` for ${label}` : ""}.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            This report counts work that was closed out on the board. A job that was
            scheduled and never given an outcome does not appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {picker}
          <span className="text-sm text-slate-600">
            {r.jobs} jobs · {r.major} major · {r.minor} minor · {r.technicians} technicians
          </span>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          <Download size={13} /> CSV
        </button>
      </div>

      {r.timedPct < 50 && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Only {r.timedPct}% of these jobs have a real arrive/leave time on them, so the
          typical-minutes columns are built on {r.timed} of {r.jobs} jobs. Job counts and the
          major/minor split are complete either way — those come from the trade, not the clock.
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-2">Per technician</h3>
        <p className="text-xs text-slate-500 mb-2">
          Open a row to see which trades their jobs were.
        </p>
        <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                {["Technician", "Jobs", "Major", "Minor", "Typical major", "Typical minor", "Timed"]
                  .map((c, i) => (
                    <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>
                      {c}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {r.byTech.map((t) => {
                const open = openTech === t.tech;
                return (
                  <React.Fragment key={t.tech}>
                    <tr className="border-t border-slate-200">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setOpenTech(open ? null : t.tech)}
                          aria-expanded={open}
                          className="flex items-center gap-1.5 text-slate-900 font-medium hover:text-slate-600"
                        >
                          <ChevronRight
                            size={13}
                            className={`text-slate-400 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                          />
                          {t.tech}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{t.jobs}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{t.major}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{t.minor}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{mins(t.majorMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{mins(t.minorMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{t.timedPct}%</td>
                    </tr>
                    {open && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="text-xs text-slate-600 mb-2">
                            {t.tech} closed <b className="text-slate-900">{t.jobs}</b> job{t.jobs === 1 ? "" : "s"} —{" "}
                            {t.major} major, {t.minor} minor — across{" "}
                            {t.trades.length} trade{t.trades.length === 1 ? "" : "s"}:
                          </div>
                          <ul className="space-y-1">
                            {t.trades.map((x) => (
                              <li key={x.family} className="flex items-baseline gap-2 text-xs">
                                <span className="tabular-nums text-slate-900 font-medium w-8 text-right">
                                  {x.jobs}
                                </span>
                                <span className="text-slate-700 flex-1 min-w-0">{x.label}</span>
                                <span className="text-slate-500">{x.size}</span>
                                <span className="text-slate-500 tabular-nums w-16 text-right">
                                  {mins(x.allMinutes)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-2">Per unit — returns</h3>
        <p className="text-xs text-slate-500 mb-2">
          A return is the same fault back at the same unit between 2 and 14 days later.
          Same-day and next-day visits are the job carrying on, and recurring work — a pool
          on its cycle — is never a return. A unit visited once has no rate, not a rate of
          zero.
        </p>
        {units.filter((u) => u.returns > 0).length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            No unit had the same fault come back in this period.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  {["Unit", "Visits", "Returns", "Return rate", "On a cycle"].map((c, i) => (
                    <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {units.filter((u) => u.returns > 0).slice(0, 20).map((u) => (
                  <tr key={u.asset} className="border-t border-slate-200">
                    <td className="px-3 py-2 text-slate-900">{u.property} {u.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{u.visits}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 font-medium">{u.returns}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${u.returnPct >= 50 ? "text-red-700" : "text-slate-700"}`}>
                      {u.returnPct == null ? "—" : `${u.returnPct}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {u.recurring || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Table
        caption="Per trade"
        cols={["Trade", "Size", "Jobs", "Typical", "Timed"]}
        rows={r.byTrade.map((t) => [
          t.label, t.size, t.jobs, mins(t.allMinutes), `${t.timedPct}%`,
        ])}
      />

      {index && index.merges.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
            <Merge className="w-3.5 h-3.5 text-slate-400" />
            {index.merges.length} property name{index.merges.length === 1 ? "" : "s"} read as
            another spelling
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Numbers and single letters have to match exactly, so Azizi Riviera 1 and 10 stay
            apart and so do Celestia A and B. Only the spelling of the name itself is
            forgiven. If any of these are genuinely different buildings, say so on the
            Properties tab and it will stop.
          </p>
          <ul className="mt-2 space-y-0.5">
            {index.merges.map((m) => (
              <li key={m.from} className="text-xs text-slate-700">
                <span className="tabular-nums text-slate-500">{m.jobs} job{m.jobs === 1 ? "" : "s"}</span>
                {" · "}<span className="text-slate-500">{m.from}</span>
                {" → "}<b className="text-slate-900">{m.to}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Table({ caption, cols, rows }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-700 mb-2">{caption}</h3>
      <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>{cols.map((c, i) => (
              <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-t border-slate-200">
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2 ${ci ? "text-right tabular-nums text-slate-700" : "text-slate-900"}`}>
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
