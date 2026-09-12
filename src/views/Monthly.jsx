import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Download, ChevronRight, Merge } from "lucide-react";
import { storageGet } from "../lib/storage.js";
import { parseDay, migrateDay } from "../lib/jobStore.js";
import { liveJobs } from "../lib/job.js";
import {
  monthlyReport, periodsPresent, periodFor, periodLabel, periodRange,
} from "../lib/monthly.js";
import { buildPropertyIndex } from "../lib/propertyName.js";
import { returnsByUnit, rolesByTech } from "../lib/quality.js";
import { poolAdherence, SEEDED_POOL_CONTRACTS } from "../lib/pools.js";
import { timeByTech } from "../lib/quality.js";
import { feedQuality, againstBenchmark, BENCHMARK_DATE } from "../lib/feed.js";
import { displacementReport } from "../lib/displacement.js";

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
  /* The days as stored, tombstones and all. feedQuality needs the moves,
     which liveJobs drops. */
  const [byDay, setByDay] = useState({});
  const [grain, setGrain] = useState("month");
  /* Per grain, so switching Month -> Week -> Month returns you to the month
     you were reading rather than resetting to the newest one. */
  const [picked, setPicked] = useState({});
  const [openTech, setOpenTech] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [knownDates]);

  async function load() {
    const dates = [...(knownDates || [])].sort();
    if (!dates.length) { setJobs([]); setByDay({}); return; }
    setJobs(null);
    const collected = [];
    const raw = {};
    /* One round trip per day is slow over a year, so read them in batches. */
    const BATCH = 8;
    for (let i = 0; i < dates.length; i += BATCH) {
      const slice = dates.slice(i, i + BATCH);
      const results = await Promise.all(slice.map((d) => storageGet(`schedule:${d}`)));
      results.forEach((v, k) => {
        const day = migrateDay(parseDay(v), slice[k]);
        raw[slice[k]] = day;
        /* liveJobs drops tombstones: a job that left a day is not a job
           done on it, and counting both would double every total. */
        liveJobs(day).forEach((j) => collected.push({ ...j, _date: slice[k] }));
      });
      setProgress(Math.min(dates.length, i + BATCH));
    }
    setJobs(collected);
    setByDay(raw);
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
  /* Role comes from each man's own work mix, so nobody is judged on a
     yardstick for work they do not do. Resty has zero reactive jobs. */
  const roles = useMemo(
    () => (resolved ? rolesByTech(resolved, periodFor(grain, active)) : []),
    [resolved, grain, active]
  );
  const roleOf = useMemo(() => Object.fromEntries(roles.map((r) => [r.tech, r])), [roles]);

  /* Pools are measured against a RATE, so the window has to be its true
     length: periodRange clamps an unfinished month to today, or every pool
     reads short on the 12th against a full month's expectation. */
  const range = useMemo(() => periodRange(grain, active), [grain, active]);
  const ponds = useMemo(
    () => (resolved && range ? poolAdherence(resolved, SEEDED_POOL_CONTRACTS, range) : null),
    [resolved, range]
  );
  /* Productive time runs on arrival and departure only — see timeByTech.
     Same input as every other table here; a visit that ended in nothing is
     not filtered out, because showing it is the point. */
  const time = useMemo(
    () => (resolved ? timeByTech(resolved, periodFor(grain, active)) : []),
    [resolved, grain, active]
  );

  /* How well the days themselves were written down. Every figure above is
     downstream of this, so it is reported rather than assumed. */
  const feed = useMemo(
    () => feedQuality(byDay, periodFor(grain, active)),
    [byDay, grain, active]
  );
  const benchRow = useMemo(
    () => feedQuality(byDay, BENCHMARK_DATE)[0] || null,
    [byDay]
  );
  const vsBench = useMemo(() => againstBenchmark(feed, benchRow), [feed, benchRow]);

  /* Was the call right? Both priorities have always been stored; nobody
     had put them side by side. Coverage is poor and is shown, because the
     arriving job's priority was almost never recorded before 12 September
     — see displacement.js. */
  const displaced = useMemo(
    () => displacementReport(byDay, periodFor(grain, active)),
    [byDay, grain, active]
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
            {r.distinctJobs} job{r.distinctJobs === 1 ? "" : "s"}
            {r.jobs !== r.distinctJobs && (
              <span title="A job with two technicians on it counts once for each of them. The first number is pieces of work; this one is how many times somebody was sent.">
                {" · "}{r.jobs} assignments
              </span>
            )}
            {" · "}{r.major} major · {r.minor} minor · {r.technicians} technicians
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
                          {roleOf[t.tech] && roleOf[t.tech].role !== "reactive" && (
                            <span
                              title={roleOf[t.tech].role === "unrated"
                                ? `Only ${roleOf[t.tech].jobs} job(s) in this period — too few to say what kind of work he does`
                                : undefined}
                              className={`text-[10px] rounded px-1.5 py-0.5 font-normal ${
                                roleOf[t.tech].role === "planned" ? "bg-sky-100 text-sky-800"
                                : roleOf[t.tech].role === "mixed" ? "bg-violet-100 text-violet-800"
                                : roleOf[t.tech].role === "unrated" ? "bg-slate-100 text-slate-500 italic"
                                : "bg-slate-100 text-slate-600"}`}>
                              {roleOf[t.tech].role === "unrated" ? "too few to say" : roleOf[t.tech].role}
                            </span>
                          )}
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
                          {roleOf[t.tech] && roleOf[t.tech].role === "unrated" && (
                            <div className="text-xs text-slate-600 mb-2 pb-2 border-b border-slate-200">
                              Only {roleOf[t.tech].jobs} job{roleOf[t.tech].jobs === 1 ? "" : "s"} in
                              this period, so there is nothing to say about what kind of work he
                              does — one job is 100% of whatever it happened to be. Widen the
                              period to see him properly.
                            </div>
                          )}
                          {roleOf[t.tech] && roleOf[t.tech].role !== "unrated" && (
                            <div className="text-xs text-slate-600 mb-2 pb-2 border-b border-slate-200">
                              {roleOf[t.tech].plannedPct}% of his work is planned,{" "}
                              {roleOf[t.tech].reactivePct}% is faults — so he is judged on{" "}
                              <b className="text-slate-900">
                                {roleOf[t.tech].judgeOn.length
                                  ? roleOf[t.tech].judgeOn.join(", ")
                                  : "neither returns nor consistency"}
                              </b>
                              {roleOf[t.tech].judgeOn.length === 0 &&
                                " — a job card is measured on the Projects tab against its quoted amount"}
                              {roleOf[t.tech].consistency.n >= 3 && (
                                <>. His planned round runs{" "}
                                  <b className="text-slate-900">{mins(roleOf[t.tech].consistency.median)}</b>
                                  {" "}typically, varying by up to{" "}
                                  {mins(roleOf[t.tech].consistency.spreadMins)}, on{" "}
                                  {roleOf[t.tech].perDay.median} a day
                                </>
                              )}
                            </div>
                          )}
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

      {displaced.displacements > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-2">
            Jobs displaced — was the call right?
          </h3>
          <p className="text-xs text-slate-500 mb-2">
            A job that left the day to make room for another. Both priorities are compared, and a
            lower priority winning is <em>not</em> a mistake — a P3 with a guest standing in the
            unit beats a P1 nobody can get into. These are descriptions, not scores. The last
            column is the only one worth reading closely.
          </p>

          <div className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-slate-700">
              <span className="font-semibold tabular-nums">{displaced.displacements}</span> displaced
            </span>
            <span className={displaced.coverage != null && displaced.coverage < 50 ? "text-amber-700" : "text-slate-500"}>
              <span className="tabular-nums">{displaced.comparable}</span> comparable
              {displaced.coverage != null && ` · ${displaced.coverage}%`}
            </span>
            {displaced.comparable > 0 && (
              <>
                <span className="text-emerald-700"><span className="tabular-nums">{displaced.higher}</span> higher priority won</span>
                <span className="text-slate-500"><span className="tabular-nums">{displaced.same}</span> same</span>
                <span className={displaced.lower ? "text-amber-800 font-medium" : "text-slate-500"}>
                  <span className="tabular-nums">{displaced.lower}</span> lower priority won
                </span>
              </>
            )}
          </div>

          {displaced.comparable === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-medium">Nothing in this period can be compared yet.</div>
              <div className="mt-1 text-xs">
                Both halves are needed: the displaced job's priority and the arriving job's. The
                arriving job is usually added mid-day, and until 12 September nothing asked for its
                priority. The move dialog asks now, so this fills from here on.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs">
                  <tr>
                    {["Day", "Job that moved", "What took the slot", "Verdict"].map((c, i) => (
                      <th key={c} className={`px-3 py-2 font-medium ${i === 3 ? "text-right" : "text-left"}`}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displaced.rows.filter((r) => r.comparable).slice(0, 30).map((r) => (
                    <tr key={`${r.date}-${r.jobId}`} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-slate-500 tabular-nums whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-2 text-slate-900">
                        {r.lost.property} {r.lost.unit}
                        <span className="ml-1.5 text-[10px] rounded px-1 py-0.5 bg-slate-100 text-slate-600">
                          {r.lost.priority.replace("PRI-", "P")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.won.property} {r.won.unit}
                        <span className="ml-1.5 text-[10px] rounded px-1 py-0.5 bg-slate-100 text-slate-600">
                          {r.won.priority.replace("PRI-", "P")}
                        </span>
                        {r.resolvedBy === "label" && (
                          <span className="ml-1.5 text-[10px] text-slate-400" title="Matched from the coordinator's own words, not a link. Only where exactly one job on the day was at that address.">
                            matched
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap ${
                        r.verdict === "lower" ? "text-amber-800 font-medium"
                          : r.verdict === "same" ? "text-slate-500" : "text-emerald-700"}`}>
                        {r.verdict === "lower" ? "lower priority won"
                          : r.verdict === "same" ? "same priority" : "higher priority won"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {feed.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-2">
            How the days were fed — against {BENCHMARK_DATE}
          </h3>
          <p className="text-xs text-slate-500 mb-2">
            Every figure on this page is downstream of whether the day was written down
            properly. {BENCHMARK_DATE} is the standard because it was filled by hand and
            vouched for: every row answered, and almost every move saying what took the
            slot. It is also honest about the gap — even that day timed one visit in
            thirty-eight.
          </p>

          {vsBench && (
            <div className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs flex flex-wrap gap-x-5 gap-y-1">
              <span className="text-slate-700">
                <span className="font-semibold tabular-nums">{vsBench.meets}</span> of{" "}
                <span className="tabular-nums">{vsBench.days}</span> days meet it
              </span>
              <span className="text-slate-500">
                <span className="tabular-nums">{vsBench.fullyAnswered}</span> fully answered
              </span>
              <span className={vsBench.daysWithAnyTiming ? "text-slate-500" : "text-amber-700"}>
                <span className="tabular-nums">{vsBench.daysWithAnyTiming}</span> with any timing at all
              </span>
            </div>
          )}

          <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  {["Day", "Rows", "Answered", "Moves explained", "Visits timed"].map((c, i) => (
                    <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feed.map((d) => {
                  const tone = (v, floor) =>
                    v == null ? "text-slate-400"
                      : v >= floor ? "text-emerald-700"
                      : v >= floor - 25 ? "text-amber-700" : "text-red-700";
                  return (
                    <tr key={d.date} className={`border-t border-slate-200 ${
                      d.date === BENCHMARK_DATE ? "bg-blue-50/60" : ""}`}>
                      <td className="px-3 py-2 text-slate-900">
                        {d.date}
                        {d.date === BENCHMARK_DATE && (
                          <span className="ml-2 text-[10px] rounded px-1.5 py-0.5 bg-blue-100 text-blue-700">
                            benchmark
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{d.jobs}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${tone(d.answeredPct, 100)}`}>
                        {d.answeredPct == null ? "—" : `${d.answeredPct}%`}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${tone(d.explainedPct, 90)}`}>
                        {d.explainedPct == null
                          ? <span className="text-slate-400">no moves</span>
                          : `${d.explainedPct}% of ${d.moves}`}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${tone(d.timedPct, 90)}`}>
                        {d.timedPct == null ? "—" : `${d.timedPct}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-2">Productive time</h3>
        <p className="text-xs text-slate-500 mb-2">
          A visit counts here only if the technician wrote his arrival and departure time.
          A typed total is a recollection, not a measurement. Work that produced nothing —
          no access, called off — is shown apart and never added to productive hours, even
          where the technician reached the property.
        </p>
        {time.filter((t) => t.measured > 0).length === 0 ? (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-medium">No visit in this period has both an arrival and a departure time.</div>
            <div className="mt-1 text-xs">
              {time.reduce((n, t) => n + t.jobs, 0)} visits, none measured. Until the times are
              written at close-out there is no honest productive-time figure — and a figure built
              on typed totals would read as though there were.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  {["Technician", "Productive", "Attended, nothing produced", "Measured", "Coverage"].map((c, i) => (
                    <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {time.map((t) => (
                  <tr key={t.tech} className="border-t border-slate-200">
                    <td className="px-3 py-2 text-slate-900">{t.tech}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 font-medium">
                      {t.productiveHours == null ? "—" : `${t.productiveHours}h`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                      {t.attendedHours == null ? "—" : `${t.attendedHours}h`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {t.measured} of {t.jobs}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${t.coverage.provisional ? "text-amber-700" : "text-slate-700"}`}>
                      {t.coverage.coverage == null ? "—" : `${t.coverage.coverage}%`}
                      {t.coverage.provisional && <span className="ml-1 text-[11px]">provisional</span>}
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

      {ponds && ponds.pools.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-2">
            Pools — recorded against contracted
          </h3>
          <p className="text-xs text-slate-500 mb-2 max-w-3xl">
            {ponds.weeks} week{ponds.weeks === 1 ? "" : "s"}
            {range.truncated && " so far"} · Palm Villa and Jumeirah Golf Estates are
            contracted at 6 cleans a week, the small pools at 2–3. Two cleans logged on one
            day count as one — a pool is cleaned or it is not.
          </p>
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-2 max-w-3xl">
            <b>This counts cleans that reached the board, not cleans delivered.</b> A shortfall
            here is either a pool that went unserved or a clean nobody wrote down, and nothing
            on this page can tell those apart.
            {ponds.summary.withoutContractRecord > 0 && (
              <> {ponds.summary.withoutContractRecord} of {ponds.summary.pools} pools have no
                terms recorded and are shown on the small-pool cadence — those verdicts are
                the least reliable here.</>
            )}
          </p>
          <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  {["Pool", "Per week", "Recorded", "Contracted", "", "Short"].map((c, i) => (
                    <th key={c || i} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ponds.pools.map((p) => (
                  <tr key={p.asset} className="border-t border-slate-200">
                    <td className="px-3 py-2 text-slate-900">
                      {p.label}
                      {!p.hasContract && (
                        <span className="ml-1.5 text-[10px] text-slate-500 italic">terms not recorded</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{p.perWeekActual ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 font-medium">{p.recorded}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {p.expected[0] === p.expected[1] ? p.expected[0] : `${p.expected[0]}–${p.expected[1]}`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`text-[10px] rounded px-1.5 py-0.5 ${
                        p.verdict === "under" ? "bg-red-100 text-red-800"
                        : p.verdict === "over" ? "bg-amber-100 text-amber-900"
                        : p.verdict === "on contract" ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-600"}`}>
                        {p.verdict}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {p.shortfall || (p.surplus ? `+${p.surplus}` : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-600 mt-2">
            {ponds.summary.under} under · {ponds.summary.onContract} on contract ·{" "}
            {ponds.summary.over} over · <b className="text-slate-900">
              {ponds.summary.totalShortfall} clean{ponds.summary.totalShortfall === 1 ? "" : "s"} short
            </b>{" "}
            across {ponds.summary.pools} pools worth AED{" "}
            {ponds.summary.annualValue.toLocaleString()} a year.
          </p>
        </div>
      )}

      {index && index.merges.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
            <Merge className="w-3.5 h-3.5 text-slate-400" />
            {index.merges.length} property name{index.merges.length === 1 ? "" : "s"} grouped
            with another spelling
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Numbers and single letters have to match exactly, so Azizi Riviera 1 and 10 stay
            apart and so do Celestia A and B. Only the spelling of the name itself is
            forgiven.
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            <b>The spelling on the right is whichever is used most</b>, which is not always
            the correct one — a typo used sixteen times beats the right name used twice. Add
            the building on the <b>Properties</b> tab and that spelling wins instead. If two
            of these are genuinely different buildings, say so there too and the grouping
            stops.
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
