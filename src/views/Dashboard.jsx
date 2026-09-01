import React, { useMemo, useState } from "react";
import {
  AlertTriangle, TrendingUp, Loader2, Download, Info, CheckCircle2,
  Wallet, Settings2, ChevronDown, ChevronRight,
} from "lucide-react";
import { storageGet, storageSet } from "../lib/storage.js";
import { parseDay, migrateDay } from "../lib/jobStore.js";
import { readPost } from "../lib/dayLock.js";
import { peopleActivity } from "../lib/activity.js";
import { liveJobs } from "../lib/job.js";
import { computeCost, computeCostSeries, DEFAULT_RATES } from "../lib/cost.js";
import { computeAll, DEFAULTS } from "../lib/metrics.js";
import { FAMILY_LABEL } from "../lib/faultFamily.js";
import {
  splitCrew, canonPriority, workType, WORK_TYPE_LABEL, formatMinutes, parseDurationMinutes,
} from "../lib/normalize.js";
import {
  ChartFrame, LegendItem, CapacityChart, LoadHeatmap, HeatmapScale,
  RateLine, HBars, MixBar, StackedDailyBars, SERIES_COLORS as C,
} from "../components/charts.jsx";

/* ---------------------------------------------------------------------- *
 * Dashboard.jsx — the operations view.
 *
 * Two things it does that the old Trends tab did not:
 *
 * 1. Every number is built from a field somebody actually fills in, and
 *    carries its own coverage. A rate over 40% of the rows says so on the
 *    tile rather than presenting itself as a fact about the department.
 *
 * 2. It leads with what can still be changed. The top section is about
 *    tomorrow — the technician who is booked past their shift, the
 *    occupied unit nobody confirmed — because that is the only part a
 *    coordinator can still act on. The trends underneath are for the
 *    monthly review.
 * ---------------------------------------------------------------------- */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDaysISO = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Dashboard({ selectedDate, knownDates, onOpenDate }) {
  const [startDate, setStartDate] = useState(addDaysISO(todayISO(), -29));
  const [endDate, setEndDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const [loadedDays, setLoadedDays] = useState([]);
  const [progress, setProgress] = useState(0);
  const [focusDate, setFocusDate] = useState(selectedDate || todayISO());
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [ratesLoaded, setRatesLoaded] = useState(false);

  // Cost rates are shared, not per-browser: everyone reading the dashboard
  // should be reading the same numbers.
  React.useEffect(() => {
    (async () => {
      const stored = await storageGet("cost-rates");
      if (stored) {
        try { setRates({ ...DEFAULT_RATES, ...JSON.parse(stored) }); } catch { /* keep defaults */ }
      }
      setRatesLoaded(true);
    })();
  }, []);

  async function saveRates(next) {
    setRates(next);
    await storageSet("cost-rates", JSON.stringify(next));
  }

  async function run() {
    setLoading(true);
    setLoaded(null);
    setProgress(0);
    const dates = [];
    let d = startDate;
    let guard = 0;
    while (d <= endDate && guard++ < 400) { dates.push(d); d = addDaysISO(d, 1); }

    const collected = [];
    /* Kept whole, tombstones and all, alongside the live jobs. The metrics
       must not count a job that left a day, but the activity log must —
       a job leaving is one of the changes it exists to show. */
    const days = [];
    // Fetch in small batches — one round trip per day is slow over 30 days.
    const BATCH = 6;
    for (let i = 0; i < dates.length; i += BATCH) {
      const slice = dates.slice(i, i + BATCH);
      const results = await Promise.all(slice.map((date) => storageGet(`schedule:${date}`)));
      const posts = await Promise.all(slice.map((date) => readPost(date)));
      results.forEach((v, k) => {
        // Tombstones are records of a job leaving a day, not jobs — counting
        // them would inflate every rate on this page. The live jobs are
        // migrated on read so days not yet opened on the board still count.
        const day = migrateDay(parseDay(v), slice[k]);
        liveJobs(day).forEach((j) => collected.push({ ...j, _date: slice[k] }));
        if (day.length) days.push({ date: slice[k], rows: day, post: posts[k] });
      });
      setProgress(Math.min(dates.length, i + BATCH));
    }
    setLoaded(collected);
    setLoadedDays(days);
    setLoading(false);
  }

  const m = useMemo(() => (loaded ? computeAll(loaded, { asOfDate: endDate }) : null), [loaded, endDate]);

  const focusJobs = useMemo(
    () => (loaded ? loaded.filter((j) => j._date === focusDate) : []),
    [loaded, focusDate]
  );
  const focus = useMemo(
    () => (focusJobs.length ? computeAll(focusJobs, { asOfDate: focusDate }) : null),
    [focusJobs, focusDate]
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Operations dashboard</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Pull a date range, then read it top to bottom: what still needs fixing on a given day,
          then how the department is trending. Every rate shows the number of rows it was
          calculated from — if a field is only filled half the time, the metric says so instead
          of pretending.
        </p>
        <p className="text-xs text-slate-500 mt-1.5 max-w-3xl">
          <span className="font-medium text-slate-700">This page is daily field operations only.</span>{" "}
          Quoted projects have their own costs, durations and margins and are measured on the
          Projects tab — a project's labour appears here as the daily jobs that made it up, but its
          quoted amount and materials do not.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-600">
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                 className="mt-1 block border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          To
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                 className="mt-1 block border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <div className="flex gap-1.5">
          {[["7 days", 6], ["30 days", 29], ["90 days", 89]].map(([label, back]) => (
            <button key={label}
                    onClick={() => { setStartDate(addDaysISO(todayISO(), -back)); setEndDate(todayISO()); }}
                    className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-50">
              {label}
            </button>
          ))}
        </div>
        <button onClick={run} disabled={loading}
                className="flex items-center gap-1.5 text-sm bg-slate-900 text-white px-4 py-2 rounded-md disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
          {loading ? `Loading… (${progress} days)` : "Load range"}
        </button>
        {m && (
          <button onClick={() => downloadCSV(loaded, startDate, endDate)}
                  className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-md hover:bg-slate-50">
            <Download className="w-4 h-4" /> Export rows
          </button>
        )}
      </div>

      {!m && !loading && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Pick a range and load it. If you have just imported the workbook, set the range to cover
          those dates.
        </div>
      )}

      {m && m.jobCount === 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          No jobs stored between {startDate} and {endDate}. Import the schedule for those dates first.
        </div>
      )}

      {m && m.jobCount > 0 && (
        <>
          <RangeHeadline m={m} startDate={startDate} endDate={endDate} />
          <DayFocus
            m={m} focus={focus} focusDate={focusDate} setFocusDate={setFocusDate}
            availableDates={m.series.map((s) => s.date)} onOpenDate={onOpenDate}
          />
          <Containment m={m} onOpenDate={onOpenDate} />
          <Demand m={m} />
          <WhoDidWhat days={loadedDays} />
          <WhyThisDay m={m} />
          <Judgement m={m} onOpenDate={onOpenDate} />
          <Movement m={m} onOpenDate={onOpenDate} />
          <WhyWeGoBack m={m} />
          <TechTimes m={m} />
          <Trends m={m} />
          <CostSection m={m} jobs={loaded} rates={rates} onSaveRates={saveRates} ratesLoaded={ratesLoaded} />
          <WhereWorkGoes m={m} />
          <Quality m={m} />
        </>
      )}
    </div>
  );
}

/* ====================== headline tiles ====================== */

function Tile({ label, value, sub, coverage, tone = "neutral", icon: Icon }) {
  const tones = {
    neutral: "border-slate-200",
    good: "border-emerald-300 bg-emerald-50/40",
    warn: "border-amber-300 bg-amber-50/40",
    bad: "border-red-300 bg-red-50/40",
  };
  const valueTone = {
    neutral: "text-slate-900", good: "text-emerald-700", warn: "text-amber-700", bad: "text-red-700",
  };
  return (
    <div className={`rounded-lg border ${tones[tone]} bg-white p-3`}>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${valueTone[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
      {coverage && (
        <div className="text-[10px] text-slate-400 mt-1.5 border-t border-slate-100 pt-1.5">
          {coverage}
        </div>
      )}
    </div>
  );
}

function RangeHeadline({ m, startDate, endDate }) {
  const cap = m.capacity;
  const acc = m.access;
  const rep = m.repeats;
  const ver = m.verification;
  const mat = m.material;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-900">
          The range: {m.jobCount} jobs · {m.dateCount} days · {startDate} → {endDate}
        </h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile
          label="Planned load vs capacity"
          value={cap.utilisationPct == null ? "—" : `${cap.utilisationPct}%`}
          sub={`${Math.round(cap.totalCommittedMinutes / 60)}h booked of ${Math.round(cap.totalAvailableMinutes / 60)}h`}
          coverage={`from ${cap.estimateCoverage.answered}/${cap.estimateCoverage.total} jobs with a time estimate`}
          tone={cap.utilisationPct > 100 ? "bad" : cap.utilisationPct > 85 ? "warn" : "good"}
        />
        <Tile
          label="Tech-days over capacity"
          value={cap.overloaded.length}
          sub={`${cap.overloadedPct ?? 0}% of ${cap.techDayCount} tech-days`}
          coverage={`plus ${cap.tight.length} more between 85% and 100%`}
          tone={cap.overloadedPct > 20 ? "bad" : cap.overloadedPct > 10 ? "warn" : "good"}
          icon={AlertTriangle}
        />
        <Tile
          label="Occupied visits at access risk"
          value={acc.atRiskCount}
          sub={`${acc.atRiskPct ?? 0}% of ${acc.needingConfirmation} occupied-unit visits`}
          coverage={`guest confirmation answered on ${acc.coverage.answered}/${acc.coverage.total} visits`}
          tone={acc.atRiskPct > 40 ? "bad" : acc.atRiskPct > 20 ? "warn" : "good"}
        />
        <Tile
          label="Material not ready"
          value={mat.notReadyCount}
          sub={`${100 - (mat.readyPct ?? 0) > 0 ? Math.round(100 - (mat.readyPct ?? 0)) : 0}% of ${mat.needingMaterial} jobs needing material`}
          coverage={`${mat.buckets.vague} of them say only "basic materials"`}
          tone={mat.readyPct != null && mat.readyPct < 70 ? "warn" : "good"}
        />
        <Tile
          label="Rework (same fault back)"
          value={rep.reworkEvents}
          sub={`${rep.reworkRatePct ?? 0}% of ${rep.reactiveVisits} reactive visits`}
          coverage={`${rep.continuationEvents} next-day continuations excluded`}
          tone={rep.reworkRatePct > 12 ? "bad" : rep.reworkRatePct > 7 ? "warn" : "good"}
        />
        <Tile
          label="Outcome recorded"
          value={ver.coverage.pct == null ? "0%" : `${ver.coverage.pct}%`}
          sub={ver.verifiedCount ? `${ver.completionRatePct}% completed` : "no outcomes recorded yet"}
          coverage={`from ${ver.verifiedCount}/${ver.total} jobs closed out on the board`}
          tone={ver.coverage.pct >= 80 ? "good" : ver.coverage.pct >= 30 ? "warn" : "bad"}
          icon={CheckCircle2}
        />
      </div>

      {ver.verifiedCount > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Tile label="Completion rate" value={`${ver.completionRatePct}%`}
                sub={`${ver.done} done · ${ver.partial} partial · ${ver.notDone} not done`}
                coverage={`from ${ver.verifiedCount} verified jobs`}
                tone={ver.completionRatePct >= 90 ? "good" : ver.completionRatePct >= 75 ? "warn" : "bad"} />
          <Tile label="Traceable in PMS" value={ver.pmsCoveragePct == null ? "—" : `${ver.pmsCoveragePct}%`}
                sub={`${ver.missingInPms} done but not in PMS`}
                coverage="of work confirmed done or partial"
                tone={ver.pmsCoveragePct >= 95 ? "good" : "warn"} />
          <Tile label="PMS says done, field says not" value={ver.ghostTickets}
                sub="tickets closed against work that did not happen"
                coverage="the check the admin pass exists for"
                tone={ver.ghostTickets > 0 ? "bad" : "good"} />
          <Tile label="First-time fix" value={m.firstTimeFix.firstTimeFixPct == null ? "—" : `${m.firstTimeFix.firstTimeFixPct}%`}
                sub={`${m.firstTimeFix.returned} came back within ${DEFAULTS.repeatWindowDays} days`}
                coverage={`from ${m.firstTimeFix.sampleSize} reactive jobs confirmed done`}
                tone={m.firstTimeFix.firstTimeFixPct >= 90 ? "good" : "warn"} />
        </div>
      )}
    </div>
  );
}

/* ====================== the actionable day ====================== */

function DayFocus({ m, focus, focusDate, setFocusDate, availableDates, onOpenDate }) {
  const overloaded = focus ? focus.capacity.overloaded : [];
  const atRisk = focus ? focus.access.atRisk : [];
  const notReady = focus ? focus.material.notReady : [];
  const stale = m.pending.stale.filter((p) => p._date === focusDate);
  const nothing = !overloaded.length && !atRisk.length && !notReady.length && !stale.length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Fix before this day runs</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            The four things that reliably cost a visit, for one day at a time. This is the part
            a coordinator can still change.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={focusDate} onChange={(e) => setFocusDate(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            {availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {onOpenDate && (
            <button onClick={() => onOpenDate(focusDate)}
                    className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-50">
              Open board
            </button>
          )}
        </div>
      </div>

      {!focus && <p className="text-sm text-slate-500">No jobs stored for {focusDate}.</p>}

      {focus && nothing && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
          <CheckCircle2 className="w-4 h-4" /> Nothing flagged for {focusDate}. Every tech is inside
          their shift, occupied units are confirmed, and material is specified.
        </div>
      )}

      {focus && !nothing && (
        <div className="grid md:grid-cols-2 gap-3">
          {overloaded.length > 0 && (
            <RiskCard
              tone="bad"
              title={`${overloaded.length} technician${overloaded.length === 1 ? "" : "s"} booked past the shift`}
              hint="Work + travel exceeds the rostered hours. Something on this list will not happen — decide which, rather than finding out tomorrow."
            >
              {overloaded.map((r) => (
                <li key={r.tech} className="flex justify-between gap-2">
                  <span className="text-slate-700">{r.tech}</span>
                  <span className="text-red-700 font-medium tabular-nums">
                    {r.loadPct}% · {formatMinutes(r.committedMinutes)} of {formatMinutes(r.shiftMinutes)}
                    <span className="text-slate-400 font-normal"> · {r.jobs} jobs, {r.properties} bldgs</span>
                  </span>
                </li>
              ))}
            </RiskCard>
          )}

          {atRisk.length > 0 && (
            <RiskCard
              tone="warn"
              title={`${atRisk.length} occupied unit${atRisk.length === 1 ? "" : "s"} with no guest confirmation`}
              hint="Somebody is in the unit and has not agreed to the visit. These are the visits that turn into a wasted drive."
            >
              {atRisk.slice(0, 12).map((j, i) => (
                <li key={j.id || i} className="flex justify-between gap-2">
                  <span className="text-slate-700 truncate">{j.property} {j.unit}</span>
                  <span className="text-slate-500 shrink-0">{j.status} · {j.team}</span>
                </li>
              ))}
              {atRisk.length > 12 && <li className="text-slate-400">+{atRisk.length - 12} more</li>}
            </RiskCard>
          )}

          {notReady.length > 0 && (
            <RiskCard
              tone="warn"
              title={`${notReady.length} job${notReady.length === 1 ? "" : "s"} with no specific material list`}
              hint={`"Basic materials" is not a picking list. The van leaves without the part and the job comes back.`}
            >
              {notReady.slice(0, 12).map((j, i) => (
                <li key={j.id || i} className="flex justify-between gap-2">
                  <span className="text-slate-700 truncate">{j.property} {j.unit} — {(j.description || "").slice(0, 40)}</span>
                  <span className="text-slate-500 shrink-0">{j._readiness === "vague" ? "vague" : "blank"}</span>
                </li>
              ))}
              {notReady.length > 12 && <li className="text-slate-400">+{notReady.length - 12} more</li>}
            </RiskCard>
          )}

          {stale.length > 0 && (
            <RiskCard
              tone="warn"
              title={`${stale.length} pending item${stale.length === 1 ? "" : "s"} older than ${DEFAULTS.pendingStaleDays} days`}
              hint="Carried day after day. Each one needs a decision: schedule it, quote it, or close it."
            >
              {stale.slice(0, 12).map((j, i) => (
                <li key={j.id || i} className="flex justify-between gap-2">
                  <span className="text-slate-700 truncate">{j.property} {j.unit} — {(j.pendingDetails || j.description || "").slice(0, 40)}</span>
                  <span className="text-slate-500 shrink-0 tabular-nums">{j._ageDays}d</span>
                </li>
              ))}
            </RiskCard>
          )}
        </div>
      )}
    </div>
  );
}

function RiskCard({ tone, title, hint, children }) {
  const border = tone === "bad" ? "border-red-200 bg-red-50/40" : "border-amber-200 bg-amber-50/40";
  const dot = tone === "bad" ? "text-red-600" : "text-amber-600";
  return (
    <div className={`rounded-md border ${border} p-3`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${dot}`} />
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-slate-900">{title}</h3>
          <p className="text-xs text-slate-600 mt-0.5">{hint}</p>
        </div>
      </div>
      <ul className="mt-2 space-y-1 text-xs">{children}</ul>
    </div>
  );
}

/* ============== stopped, not finished ============== */

function Containment({ m, onOpenDate }) {
  const c = m.containment;
  if (!c) return null;
  const none = c.resolvedCount === 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Stopped, not finished</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        A technician who closes a valve on a leak has stopped it, not repaired it. PMS marks that
        task Done — one real example is titled "pending work, the existing 28mm copper pipe needs
        to be replaced", lists the pipe and unions still required, and its status is Done. Here the
        two are counted apart, and a contained fault with nothing booked to finish it is the number
        to watch.
      </p>

      {none ? (
        <p className="text-xs text-slate-400 py-3">
          No closed-out visits in this range yet. This fills in as jobs are closed on the board.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Tile label="Actually fixed" value={c.fixed}
                  sub={`${c.firstVisitFixPct ?? 0}% of ${c.resolvedCount} visits that ended`}
                  coverage="nothing left to do"
                  tone={c.firstVisitFixPct >= 75 ? "good" : "warn"} />
            <Tile label="Made safe or diagnosed" value={c.contained}
                  sub={`${c.containedPct ?? 0}% of visits that ended`}
                  coverage="the work is not done" />
            <Tile label="Follow-up booked" value={`${c.followUpBookedPct ?? 0}%`}
                  sub={`${c.withFollowUp} of ${c.contained} contained jobs`}
                  coverage="booked at close-out, not left to memory"
                  tone={c.followUpBookedPct >= 95 ? "good" : "bad"} />
            <Tile label="Open containments" value={c.openContainments}
                  sub={c.openP1 > 0 ? `${c.openP1} of them P1` : "none of them P1"}
                  coverage="running on a temporary measure, nobody booked"
                  tone={c.openContainments > 0 ? "bad" : "good"}
                  icon={AlertTriangle} />
            <Tile label="Days to come back" value={c.medianReturnGapDays == null ? "—" : `${c.medianReturnGapDays}d`}
                  sub="median, close-out to return visit"
                  coverage={`oldest still open: ${c.oldestOpenDays}d`} />
          </div>

          {c.openList.length > 0 && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
              <h3 className="text-xs font-medium text-red-900">
                {c.openContainments} unit{c.openContainments === 1 ? "" : "s"} running on a temporary
                measure with nothing booked
              </h3>
              <p className="text-[11px] text-red-800 mt-0.5 mb-1.5">
                Each of these had a visit that stopped the symptom. Nobody is scheduled to finish
                the work.
              </p>
              <ul className="space-y-0.5 text-xs">
                {c.openList.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-red-900 font-medium">{j.property} {j.unit}</span>
                    <span className="text-red-800 truncate flex-1">
                      {j.stillNeeded ? `needs ${j.stillNeeded}` : j.description}
                    </span>
                    {canonPriority(j.priority) === "PRI-1" && (
                      <span className="text-[10px] bg-red-200 text-red-900 rounded px-1">P1</span>
                    )}
                    <button onClick={() => onOpenDate && onOpenDate(j._date)}
                            className="text-red-700 underline shrink-0 tabular-nums">
                      {j._date} · {j._ageDays}d ago
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============== where the work comes from ============== */

function Demand({ m }) {
  const d = m.demand;
  if (!d) return null;
  const none = d.coverage.answered === 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Where the work comes from</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        Every job looks the same once it is on the schedule, so what the field team is being asked
        to do has never been visible. Splitting demand by its route separates what arrives — guest
        complaints, things housekeeping spotted, night emergencies — from what the department chose
        to schedule, including inspections used to fill an idle afternoon.
      </p>

      {none ? (
        <p className="text-xs text-slate-400 py-3">
          No source recorded on any job in this range. It is set on the job card and on the
          out-of-hours log; rows imported from the workbook predate the field.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Tile label="Source recorded" value={`${d.coverage.pct ?? 0}%`}
                  sub={`${d.coverage.answered} of ${d.total} jobs`}
                  coverage="set on the card"
                  tone={d.coverage.pct >= 70 ? "good" : "warn"} />
            <Tile label="Arrived, not planned" value={d.unplanned}
                  sub={`${d.unplannedPct ?? 0}% of jobs · ${d.unplannedHours}h`}
                  coverage="added after the schedule was posted"
                  tone={d.unplannedPct > 20 ? "warn" : "neutral"} />
            <Tile label="Reactive share" value={`${d.reactivePct ?? 0}%`}
                  sub="guest, HK, GRO and emergencies"
                  coverage={`of ${d.coverage.answered} jobs with a source`} />
            <Tile label="Inspection filling time" value={`${d.fillerHours}h`}
                  sub={`${d.fillerJobs} job${d.fillerJobs === 1 ? "" : "s"}`}
                  coverage="looks like demand on every capacity chart until it is named"
                  tone={d.fillerHours > 0 ? "warn" : "neutral"} />
          </div>
          <HBars items={d.bySource.map((s) => ({
            label: s.label, value: s.jobs,
            display: `${s.jobs} · ${Math.round(s.minutes / 60)}h`,
          }))} />
        </>
      )}
    </div>
  );
}

/* ============== the coordinator's calls ============== */

/* Why a job is on the day it is on — the question the department could not
   answer at all until the queue existed. */
/* Three coordinators rotate through the same desk. Until the log was read
   back together, a pattern belonging to one person's judgement looked like
   a property of the department. */
function WhoDidWhat({ days }) {
  const people = React.useMemo(() => peopleActivity(days), [days]);
  if (!people.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Who did what</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        Shifts rotate, so nobody could say who built a given schedule or who changed it during the
        day. Every event has always carried a name; it was written onto individual jobs and never
        read back together. The column worth reading is the last one — how much a person's schedule
        has to move once the day starts. It is a signal about how the day was built, and it is
        invisible one day at a time.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 pr-3 font-medium">Who</th>
              <th className="py-1.5 pr-3 font-medium">Days built</th>
              <th className="py-1.5 pr-3 font-medium">Jobs scheduled</th>
              <th className="py-1.5 pr-3 font-medium">Posted</th>
              <th className="py-1.5 pr-3 font-medium">Outcomes recorded</th>
              <th className="py-1.5 pr-3 font-medium">Changes after close</th>
              <th className="py-1.5 font-medium">Changes per job built</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => (
              <tr key={p.by}>
                <td className="py-1.5 pr-3 font-medium text-slate-900">{p.by}</td>
                <td className="py-1.5 pr-3 text-slate-600">{p.daysBuilt || "—"}</td>
                <td className="py-1.5 pr-3 text-slate-600">{p.built || "—"}</td>
                <td className="py-1.5 pr-3 text-slate-600">{p.posted || "—"}</td>
                <td className="py-1.5 pr-3 text-slate-600">{p.recorded || "—"}</td>
                <td className={`py-1.5 pr-3 ${p.changed ? "text-amber-800" : "text-slate-400"}`}>{p.changed || "—"}</td>
                <td className="py-1.5 text-slate-600">{p.churnPerJob == null ? "—" : p.churnPerJob}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Read after a month, not a week. One coordinator having more changes than another may mean
        their days were harder, not worse built — the number opens the conversation, it does not
        settle it.
      </p>
    </div>
  );
}

function WhyThisDay({ m }) {
  const b = m.schedulingBasis;
  if (!b || !b.placed) return null;
  const LABEL = {
    vacancy: "Unit was empty",
    checkout: "Guest checked out that day",
    appointment: "Guest agreed that time",
    urgent: "P1 — first day possible",
    overdueNow: "Already past due, and reachable",
    deadline: "Last day inside the response time",
    earliest: "Earliest the access window allowed",
    batched: "Crew already in that building",
    conflict: "No day met both the deadline and access",
    overruled: "Coordinator chose a different day",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Why each job is on the day it is on</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        Asked how a day gets chosen, the honest answer was that the coordinator assesses the issue
        and picks one. Jobs booked through the queue now carry the reason with them. The figure to
        watch is not how often the rule was followed — a coordinator who never overrules it is
        following a script, not exercising judgement — but how much of the board was placed for a
        reason anybody can name.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Placed with a stated reason" value={`${b.coverage.pct}%`}
              sub={`${b.placed} of ${b.total} jobs`}
              coverage="the rest predate the queue or were typed straight onto a day"
              tone={b.coverage.pct >= 50 ? "good" : "neutral"} />
        <Tile label="Into an empty unit" value={b.cleanAccessPct == null ? "—" : `${b.cleanAccessPct}%`}
              sub={`${b.cleanAccess} of ${b.placed} placed jobs`}
              coverage="no guest to ask, no door that fails to open"
              tone={b.cleanAccessPct >= 30 ? "good" : "neutral"} />
        <Tile label="Coordinator overruled the rule" value={b.overruled}
              sub={b.overruledPct == null ? "" : `${b.overruledPct}% of placed jobs`}
              coverage="a recorded choice, which is the point" />
        <Tile label="Booked knowing it breaches" value={b.conflicts}
              sub="deadline already past, access later"
              coverage="these used to sit in the queue instead"
              tone={b.conflicts > 0 ? "warn" : "neutral"} icon={b.conflicts ? AlertTriangle : undefined} />
      </div>

      {b.byBasis.length > 0 && (
        <div className="mt-4 max-w-xl">
          <h3 className="text-xs font-medium text-slate-700 mb-1.5">On what basis</h3>
          <HBars items={b.byBasis.map(([k, n]) => ({ label: LABEL[k] || k, value: n, display: String(n) }))} />
        </div>
      )}
    </div>
  );
}

function Judgement({ m, onOpenDate }) {
  const d = m.displacement;
  const c = m.churn;
  if (!d) return null;
  const none = d.total === 0 && (!c || c.changesAfterPost === 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">The coordinator's calls</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        When one job is moved so another can have its slot, somebody decided that this work matters
        more than that work today. Both halves are now recorded — what moved and what took its place
        — which is what makes it possible to look back and ask whether the call was sound. Bumping a
        P3 for an emergency is right; bumping the same P3 four times running is a decision nobody is
        making.
      </p>

      {none ? (
        <p className="text-xs text-slate-400 py-3">
          No displacements or post-publication changes recorded in this range yet. This builds up as
          the board is used — it is the one section that only becomes useful with a few weeks behind
          it.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Tile label="Slots given away" value={d.total}
                  sub={`${d.linkedToAJob} linked to the job that took it`}
                  coverage="a job moved so another could run" />
            <Tile label="Higher priority displaced" value={d.questionable}
                  sub={d.questionablePct == null ? "" : `${d.questionablePct}% of calls`}
                  coverage="more urgent work moved for less urgent"
                  tone={d.questionable > 0 ? "warn" : "good"}
                  icon={AlertTriangle} />
            <Tile label="Displaced work finished" value={d.loserSettledPct == null ? "—" : `${d.loserSettledPct}%`}
                  sub={`${d.loserSettled} of ${d.total} got done afterwards`}
                  coverage="the real test of the call"
                  tone={d.loserSettledPct >= 80 ? "good" : d.loserSettledPct != null ? "warn" : "neutral"} />
            <Tile label="Changed after posting" value={c ? c.jobsChanged : 0}
                  sub={c && c.churnRatePct != null ? `${c.churnRatePct}% of jobs` : ""}
                  coverage={`${c ? c.changesAfterPost : 0} change(s), each with a reason`} />
            <Tile label="Bumped more than once" value={d.repeatedlyBumped.length}
                  sub="each call may have been fine"
                  coverage="the cumulative effect is the problem"
                  tone={d.repeatedlyBumped.length > 0 ? "bad" : "good"} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            {d.byCoordinator.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-700 mb-1.5">By coordinator</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="text-left font-medium py-1.5">Who</th>
                      <th className="text-right font-medium py-1.5">Calls</th>
                      <th className="text-right font-medium py-1.5">Higher pri. moved</th>
                      <th className="text-right font-medium py-1.5">Displaced job done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byCoordinator.map((x) => (
                      <tr key={x.by} className="border-b border-slate-100">
                        <td className="py-1.5 text-slate-800">{x.by}</td>
                        <td className="py-1.5 text-right tabular-nums">{x.calls}</td>
                        <td className={`py-1.5 text-right tabular-nums ${x.questionable ? "text-amber-700" : "text-slate-400"}`}>
                          {x.questionable || "—"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{x.loserDone}/{x.calls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-slate-400 mt-1">
                  Small numbers say very little. Read this after a month, not after a week.
                </p>
              </div>
            )}

            <div>
              {d.reasons.length > 0 && (
                <>
                  <h3 className="text-xs font-medium text-slate-700 mb-1.5">What takes the slots</h3>
                  <HBars items={d.reasons.map(([label, n]) => ({ label, value: n, display: String(n) }))} />
                </>
              )}
              {c && c.reasons.length > 0 && (
                <>
                  <h3 className="text-xs font-medium text-slate-700 mb-1.5 mt-3">Why posted schedules change</h3>
                  <HBars items={c.reasons.slice(0, 6).map(([label, n]) => ({ label, value: n, display: String(n) }))} />
                </>
              )}
            </div>
          </div>

          {d.events.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-slate-700 mb-1.5">Recent calls</h3>
              <ul className="space-y-1 text-xs">
                {d.events.slice(0, 10).map((e, i) => (
                  <li key={i} className={`flex flex-wrap items-baseline gap-x-2 ${e.questionable ? "text-amber-900" : "text-slate-700"}`}>
                    <span className="text-slate-400 tabular-nums shrink-0">{e.date}</span>
                    <span className="truncate">
                      {e.loser.property} {e.loser.unit}
                      {e.loserPri && <span className="text-slate-400"> [{e.loser.priority}]</span>}
                    </span>
                    <span className="text-slate-400">made way for</span>
                    <span className="truncate">
                      {e.winnerLabel || "(not recorded)"}
                      {e.winnerPri && <span className="text-slate-400"> [{e.winner.priority}]</span>}
                    </span>
                    <span className="text-slate-400">· {e.by}</span>
                    {e.questionable && <span className="text-amber-700 font-medium">· higher priority moved</span>}
                    {!e.settled && <span className="text-red-700">· still not done</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ====================== movement ====================== */

function Movement({ m, onOpenDate }) {
  const mv = m.movement;
  if (!mv) return null;
  const noHistory = mv.coverage.pct === 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Where jobs went</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        The question nobody could answer before: a job that did not happen simply stopped
        appearing. Every job now carries its own history, so being moved is a recorded event with
        a reason and a name on it — and a job that stops appearing without ever being closed out
        is countable instead of invisible.
      </p>

      {noHistory ? (
        <p className="text-xs text-slate-400 py-3">
          No job history in this range yet. Jobs imported from the workbook predate the live
          board, so they have nothing to report here. This fills in as the board is used.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Tile label="Jobs pushed at least once" value={mv.pushedJobs}
                  sub={`${mv.pushedPct ?? 0}% of ${mv.total} jobs`}
                  coverage={`${mv.moveEvents} move(s) recorded`}
                  tone={mv.pushedPct > 25 ? "warn" : "neutral"} />
            <Tile label="Pushed 3+ times" value={mv.chronic}
                  sub="chronically deferred"
                  coverage="each one is a decision nobody is making"
                  tone={mv.chronic > 0 ? "bad" : "good"} />
            <Tile label="Oldest job still moving" value={`${mv.maxAgeDays}d`}
                  sub={`median ${mv.medianAgeDays ?? 0}d from first scheduled`}
                  coverage="age from the day it first appeared" />
            <Tile label="Cancelled with a reason" value={mv.cancelled}
                  sub="visible, not vanished"
                  coverage="was previously indistinguishable from a deletion" />
            <Tile label="Not done, booked again" value={mv.notDone ? `${mv.rebookedPct ?? 0}%` : "—"}
                  sub={`${mv.rebooked ?? 0} of ${mv.notDone ?? 0} missed jobs`}
                  coverage={mv.droppedOnPurpose
                    ? `${mv.droppedOnPurpose} deliberately not rebooked`
                    : (mv.rebookUnanswered ? `${mv.rebookUnanswered} closed before the question existed` : "every missed job was answered for")}
                  tone={mv.notDone && mv.rebookedPct != null && mv.rebookedPct < 60 ? "warn" : "neutral"} />
            <Tile label="Open on a day already past" value={mv.lost}
                  sub="never closed out"
                  coverage="the disappearances, now counted"
                  tone={mv.lost > 0 ? "bad" : "good"}
                  icon={AlertTriangle} />
          </div>

          {mv.reasons.length > 0 && (
            <div className="mt-4 grid lg:grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-medium text-slate-700 mb-1.5">Why jobs move</h3>
                <HBars
                  items={mv.reasons.slice(0, 8).map(([label, n]) => ({ label, value: n, display: String(n) }))}
                />
              </div>
              {mv.chronicJobs.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-slate-700 mb-1.5">Pushed the most</h3>
                  <ul className="space-y-1 text-xs">
                    {mv.chronicJobs.slice(0, 8).map((j) => (
                      <li key={j.id} className="flex justify-between gap-2">
                        <span className="text-slate-700 truncate">{j.property} {j.unit} — {j.description}</span>
                        <button onClick={() => onOpenDate && onOpenDate(j.scheduledDate)}
                                className="text-red-700 font-medium shrink-0 underline">
                          {j.pushCount}× · since {j.originDate}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {mv.lostJobs.length > 0 && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
              <h3 className="text-xs font-medium text-red-900">
                {mv.lost} job(s) sitting on a day that has already passed, with no outcome
              </h3>
              <p className="text-[11px] text-red-800 mt-0.5 mb-1.5">
                Nobody marked these done, not done, moved or cancelled. Open the day and close
                them out — the Live Board will also prompt for them the next morning.
              </p>
              <ul className="space-y-0.5 text-xs">
                {mv.lostJobs.slice(0, 10).map((j) => (
                  <li key={j.id} className="flex justify-between gap-2">
                    <span className="text-red-900 truncate">{j.property} {j.unit} — {j.description}</span>
                    <button onClick={() => onOpenDate && onOpenDate(j._date)}
                            className="text-red-700 underline shrink-0">{j._date}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ====================== why we go back ====================== */

function WhyWeGoBack({ m }) {
  const rr = m.returnReasons;
  if (!rr) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Why we keep going back</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        A repeat visit count on its own cannot be acted on. A fix that did not hold is our cost to
        design out; a guest breaking the same thing twice is not. The kind of work is inferred from
        the task; the reason is answered by whoever schedules the return, because it cannot be
        inferred from anything the schedule records.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tile label="Return visits" value={rr.totalReturns}
              sub="a unit revisited after a gap"
              coverage="next-day continuations excluded" />
        <Tile label="Reason recorded" value={rr.coverage.pct == null ? "0%" : `${rr.coverage.pct}%`}
              sub={`${rr.answered} of ${rr.totalReturns} returns`}
              coverage="asked on the board when a repeat is spotted"
              tone={rr.coverage.pct >= 70 ? "good" : rr.coverage.pct >= 30 ? "warn" : "bad"} />
        <Tile label="Ours to fix" value={rr.ourFault}
              sub={rr.ourFaultPct == null ? "no reasons recorded yet" : `${rr.ourFaultPct}% of answered returns`}
              coverage="failed fix, wrong diagnosis, missing part"
              tone={rr.ourFaultPct > 40 ? "bad" : rr.ourFaultPct != null ? "warn" : "neutral"} />
        <Tile label="Trades pulling us back" value={rr.byFamily.length}
              sub={rr.byFamily[0] ? `most: ${rr.byFamily[0].label}` : ""}
              coverage="classified from the task text" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-medium text-slate-700 mb-1.5">By kind of work</h3>
          <HBars items={rr.byFamily.slice(0, 10).map((f) => ({
            label: f.label, value: f.returns,
            display: f.ourFault ? `${f.returns}  (${f.ourFault} ours)` : String(f.returns),
          }))} />
        </div>
        <div>
          <h3 className="text-xs font-medium text-slate-700 mb-1.5">By reason</h3>
          {rr.byReason.length === 0 ? (
            <p className="text-xs text-slate-400 py-4">
              No reasons recorded yet. The board asks the coordinator the moment it spots a unit
              coming back, so this fills in from the next return onwards — historical rows imported
              from the workbook have nothing to report here.
            </p>
          ) : (
            <HBars
              items={rr.byReason.map((r) => ({ label: r.label, value: r.count, display: String(r.count), ours: r.ours }))}
              colorFor={(it) => (it.ours ? C.critical : C.s1)}
            />
          )}
        </div>
      </div>

      {rr.byProperty.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-slate-700 mb-1.5">Buildings we return to most</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left font-medium py-1.5">Building</th>
                  <th className="text-right font-medium py-1.5">Returns</th>
                  <th className="text-left font-medium py-1.5 pl-4">Mostly for</th>
                  <th className="text-right font-medium py-1.5">Ours to fix</th>
                </tr>
              </thead>
              <tbody>
                {rr.byProperty.map((p) => (
                  <tr key={p.key} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-800">{p.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.returns}</td>
                    <td className="py-1.5 pl-4 text-slate-500">
                      {p.topFamily ? `${FAMILY_LABEL[p.topFamily[0]]} (${p.topFamily[1]})` : "—"}
                    </td>
                    <td className={`py-1.5 text-right tabular-nums ${p.ourFault ? "text-red-700 font-medium" : "text-slate-400"}`}>
                      {p.ourFault || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ====================== how long jobs take ====================== */

function TechTimes({ m }) {
  const tt = m.techTimes;
  if (!tt) return null;
  const none = tt.measuredJobs === 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">How long jobs actually take</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
        Measured from Start to Done on the board — nobody types a duration. Medians, not averages,
        so one job left open over lunch does not move a technician's figure, and every row states
        how many jobs it was measured from.
      </p>

      {none ? (
        <p className="text-xs text-slate-400 py-4">
          No measured times in this range yet. Every job where a technician's Start and Done are
          both recorded produces one, so this fills in as the board is used. Rows imported from the
          workbook have no timestamps and contribute nothing.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Tile label="Jobs with measured time" value={tt.measuredJobs}
                  sub={`${tt.coverage.pct ?? 0}% of ${tt.coverage.total}`}
                  coverage="needs both Start and Done"
                  tone={tt.coverage.pct >= 70 ? "good" : "warn"} />
            <Tile label="Kinds of work measured" value={tt.byFamily.length}
                  sub={tt.byFamily[0] ? `most: ${tt.byFamily[0].label}` : ""}
                  coverage="" />
            <Tile label="Technicians measured" value={tt.byTech.length} sub="" coverage="" />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-medium text-slate-700 mb-1.5">By kind of work</h3>
              <TimeTable rows={tt.byFamily.map((f) => ({ name: f.label, ...f }))} />
            </div>
            <div>
              <h3 className="text-xs font-medium text-slate-700 mb-1.5">By technician</h3>
              <TimeTable rows={tt.byTech.map((t) => ({ name: t.tech, ...t }))} />
            </div>
          </div>

          {tt.byTechFamily.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-slate-700 mb-1.5">
                Technician × kind of work
                <span className="font-normal text-slate-400"> — only where there are at least {tt.minSample} jobs to measure from</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="text-left font-medium py-1.5">Technician</th>
                      <th className="text-left font-medium py-1.5">Work</th>
                      <th className="text-right font-medium py-1.5">Jobs</th>
                      <th className="text-right font-medium py-1.5">Median</th>
                      <th className="text-right font-medium py-1.5">Range</th>
                      <th className="text-right font-medium py-1.5">vs estimate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tt.byTechFamily.slice(0, 25).map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5 text-slate-800">{r.tech}</td>
                        <td className="py-1.5 text-slate-600">{r.label}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.jobs}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatMinutes(r.medianMinutes)}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-400">
                          {formatMinutes(r.minMinutes)}–{formatMinutes(r.maxMinutes)}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums ${
                          r.estimateRatioPct == null ? "text-slate-300"
                          : r.estimateRatioPct > 125 ? "text-red-700"
                          : r.estimateRatioPct < 75 ? "text-amber-700" : "text-emerald-700"}`}>
                          {r.estimateRatioPct == null ? "—" : `${r.estimateRatioPct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                "vs estimate" over 100% means the work reliably takes longer than the schedule
                allows for — which is a capacity problem before it is a performance one.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TimeTable({ rows }) {
  if (!rows.length) return <p className="text-xs text-slate-400">Nothing measured yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-200">
            <th className="text-left font-medium py-1.5"> </th>
            <th className="text-right font-medium py-1.5">Jobs</th>
            <th className="text-right font-medium py-1.5">Median</th>
            <th className="text-right font-medium py-1.5">Range</th>
            <th className="text-right font-medium py-1.5">vs est.</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((r) => (
            <tr key={r.name} className="border-b border-slate-100">
              <td className="py-1.5 text-slate-800">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums">{r.jobs}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMinutes(r.medianMinutes)}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-400">
                {formatMinutes(r.minMinutes)}–{formatMinutes(r.maxMinutes)}
              </td>
              <td className={`py-1.5 text-right tabular-nums ${
                r.estimateRatioPct == null ? "text-slate-300"
                : r.estimateRatioPct > 125 ? "text-red-700"
                : r.estimateRatioPct < 75 ? "text-amber-700" : "text-emerald-700"}`}>
                {r.estimateRatioPct == null ? "—" : `${r.estimateRatioPct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ====================== trends ====================== */

function Trends({ m }) {
  // committedHours / capacityHours come from the metrics engine, so this
  // chart and the tiles above it are reading one number, not two.
  const series = m.series;

  const techs = useMemo(() => {
    const totals = new Map();
    m.capacity.rows.forEach((r) => totals.set(r.tech, (totals.get(r.tech) || 0) + r.committedMinutes));
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 18);
  }, [m]);

  const accessSeries = m.series.map((d) => ({
    ...d,
    confirmedPct: d.jobs ? Math.round(((d.jobs - d.accessAtRisk) / d.jobs) * 100) : null,
  }));

  const hasVerification = m.verification.verifiedCount > 0;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Trend — is it getting better or worse?</h2>

      <ChartFrame
        title="Committed hours vs available hours, per day"
        subtitle="Bars are the hours the schedule commits (task time plus 30 minutes for each extra building). The dark tick is the hours the rostered technicians actually have. A bar above the tick is a plan that cannot finish."
        legend={<>
          <LegendItem color={C.s1} label="Within capacity" />
          <LegendItem color={C.critical} label="Over capacity" />
          <LegendItem color={C.ink} label="Available hours" shape="line" />
        </>}
      >
        <CapacityChart series={series} />
      </ChartFrame>

      <ChartFrame
        title="Load by technician and day"
        subtitle="Each cell is one technician's day as a share of their shift. Blue is room to spare, grey is right at capacity, red is over. Cells at or above capacity carry their number so the colour is never doing the work alone."
        legend={<HeatmapScale />}
      >
        <LoadHeatmap rows={m.capacity.rows} dates={m.series.map((s) => s.date)} techs={techs} />
      </ChartFrame>

      <div className="grid lg:grid-cols-2 gap-3">
        <ChartFrame
          title="Guest confirmation rate"
          subtitle="Share of each day's occupied-unit visits that a guest had confirmed. Below the line is where wasted trips come from."
        >
          <RateLine series={accessSeries} valueKey="confirmedPct" label="Confirmed" color={C.s1} target={90} />
        </ChartFrame>

        <ChartFrame
          title="Completion rate"
          subtitle={hasVerification
            ? "Share of closed-out jobs marked done."
            : "Fills in as jobs are closed out on the Live Board. Nothing is shown here until there is real data behind it."}
        >
          {hasVerification
            ? <RateLine series={m.series} valueKey="completionRatePct" label="Completed" color={C.s3} target={95} />
            : <div className="text-xs text-slate-400 py-10 text-center px-6">
                No outcomes recorded in this range. Marking jobs done or not done on the Live
                Board turns this chart on — and with it completion rate, PMS traceability and
                first-time fix.
              </div>}
        </ChartFrame>
      </div>
    </div>
  );
}

/* ====================== where the work goes ====================== */

function WhereWorkGoes({ m }) {
  const mix = m.mix;
  const segments = [
    { label: WORK_TYPE_LABEL.reactive, value: mix.workTypes.reactive, color: C.s2 },
    { label: WORK_TYPE_LABEL.ppm, value: mix.workTypes.ppm, color: C.s1 },
    { label: WORK_TYPE_LABEL.project, value: mix.workTypes.project, color: C.s3 },
    { label: WORK_TYPE_LABEL.inspection, value: mix.workTypes.inspection, color: C.s4 },
    { label: "Not classified from the task text", value: mix.workTypes.other + mix.workTypes.logistics, color: "#94a3b8" },
  ];

  const propItems = mix.topProperties.slice(0, 10).map((p) => ({
    label: p.label,
    value: Math.round(p.minutes / 60),
    display: `${Math.round(p.minutes / 60)}h · ${p.jobs} jobs`,
  }));

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <ChartFrame
        title="Planned vs reactive"
        subtitle="Classified from the task description. A department mostly reacting to breakdowns is a department without a maintenance programme — this is the ratio a GM will already know how to read."
      >
        <MixBar segments={segments} total={m.jobCount} />
        <p className="text-xs text-slate-500 mt-3">
          Planned work (PPM, projects, inspections) is <span className="font-medium text-slate-700">{mix.plannedSharePct}%</span> of
          the range; reactive breakdowns are <span className="font-medium text-slate-700">{mix.reactiveSharePct}%</span>.
        </p>
      </ChartFrame>

      <ChartFrame
        title="Buildings consuming the most hours"
        subtitle={`Spelling variations are merged before counting — ${mix.distinctProperties} distinct buildings in this range.`}
      >
        <HBars items={propItems} unit="h" />
      </ChartFrame>

      <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold text-slate-900">Units the department keeps going back to</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">
          A visit the next day is the same job carrying on, so it is counted separately. A return
          after a gap, for a fault that looks like the last one, is rework — and recurring work like
          pool cleaning is never counted as rework, because it is supposed to come back.
        </p>
        {m.repeats.topAssets.length === 0 ? (
          <p className="text-xs text-slate-400 py-4">No unit was visited more than once in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left font-medium py-1.5">Unit</th>
                  <th className="text-right font-medium py-1.5">Visits</th>
                  <th className="text-right font-medium py-1.5">Continuations</th>
                  <th className="text-right font-medium py-1.5">Returns</th>
                  <th className="text-right font-medium py-1.5">Rework</th>
                  <th className="text-right font-medium py-1.5">Hours</th>
                  <th className="text-left font-medium py-1.5 pl-4">Dates</th>
                </tr>
              </thead>
              <tbody>
                {m.repeats.topAssets.map((a) => (
                  <tr key={a.asset} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-800">{a.property} {a.unit}</td>
                    <td className="py-1.5 text-right tabular-nums">{a.visits}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{a.continuations}</td>
                    <td className="py-1.5 text-right tabular-nums">{a.returns}</td>
                    <td className={`py-1.5 text-right tabular-nums font-medium ${a.rework > 0 ? "text-red-700" : "text-slate-400"}`}>{a.rework}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{Math.round(a.minutes / 60)}</td>
                    <td className="py-1.5 pl-4 text-slate-400">{a.dates.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ====================== data quality ====================== */

function Quality({ m }) {
  const items = m.quality.map((q) => ({
    label: `${q.label}`,
    value: q.pct ?? 0,
    display: `${q.pct ?? 0}% (${q.answered}/${q.total})`,
    tier: q.tier,
    why: q.why,
  }));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-2 mb-1">
        <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900">What the numbers above are standing on</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">
            Fill rate for each field the metrics depend on. This is on the dashboard rather than
            buried, because a completion rate over 40% of the rows and one over 95% of them are
            different kinds of fact, and the difference should not be invisible.
          </p>
        </div>
      </div>
      <div className="mt-3">
        <HBars
          items={items}
          max={100}
          colorFor={(it) => (it.value >= 90 ? C.good : it.value >= 60 ? C.s4 : C.critical)}
        />
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1">
        {m.quality.map((q) => (
          <div key={q.key} className="text-[11px] text-slate-500 flex gap-2">
            <span className={`shrink-0 rounded px-1 ${q.tier === "A" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-700"}`}>
              Tier {q.tier}
            </span>
            <span><span className="text-slate-700">{q.label}</span> — {q.why}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ====================== cost ====================== */

function CostSection({ m, jobs, rates, onSaveRates, ratesLoaded }) {
  const [showRates, setShowRates] = useState(false);
  const cost = useMemo(
    () => computeCost(jobs, rates, m.capacity, m.repeats),
    [jobs, rates, m]
  );
  const costSeries = useMemo(() => computeCostSeries(jobs, rates), [jobs, rates]);
  const cur = cost.currency;
  const fmt = (n) => (n == null ? "—" : `${cur} ${Number(n).toLocaleString()}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Cost — what the schedule spends, and what it wastes</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">
            This prices time and trips, because those are what the schedule records. Material spend
            only appears where somebody entered a figure. Every rate is editable and every default
            is a placeholder — put DHH's real numbers in before quoting any of this.
          </p>
        </div>
        <button onClick={() => setShowRates((v) => !v)}
                className="flex items-center gap-1.5 text-xs border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-50 shrink-0">
          <Settings2 className="w-3.5 h-3.5" />
          {showRates ? "Hide rates" : "Edit rates"}
          {showRates ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {showRates && <RatesEditor rates={rates} onSave={onSaveRates} techs={cost.byTech.map((t) => t.tech)} />}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile label="Planned spend, this range" value={fmt(cost.totalPlanned)}
              sub={`${fmt(cost.costPerJob)} per job`}
              coverage={`from labour priced on ${cost.labourCoverage.answered}/${cost.labourCoverage.total} jobs`} />
        <Tile label="Spent, bought nothing" value={fmt(cost.totalWaste)}
              sub={cost.wasteSharePct == null ? "" : `${cost.wasteSharePct}% of planned spend`}
              coverage="overtime + rework + failed visits"
              tone={cost.wasteSharePct > 15 ? "bad" : cost.wasteSharePct > 8 ? "warn" : "good"}
              icon={Wallet} />
        <Tile label="Paid capacity unused" value={fmt(cost.idleCost)}
              sub={`${Math.round(cost.idleMinutes / 60)}h of rostered time unfilled`}
              coverage="kept apart from waste — the shift is paid either way"
              tone={cost.idleCost > cost.totalPlanned * 0.2 ? "warn" : "neutral"} />
        <Tile label="Overtime committed" value={fmt(cost.overtimeCost)}
              sub={`${Math.round(cost.overtimeMinutes / 60)}h past shift end`}
              coverage={`at ${rates.overtimeMultiplier}× the hourly rate`}
              tone={cost.overtimeCost > 0 ? "warn" : "good"} />
        <Tile label="At risk on unconfirmed visits" value={fmt(cost.exposureExpected)}
              sub={`of ${fmt(cost.exposureFull)} committed to ${cost.unconfirmedVisits} unconfirmed visits`}
              coverage={`assumes ${Math.round(rates.wastedVisitProbability * 100)}% fail — replace with the measured rate after two weeks of verifying`}
              tone="warn" />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <ChartFrame
          title="Daily spend"
          subtitle="Labour and travel share one axis because both are money. Material is not drawn — nobody has entered a figure for it yet."
          legend={<>
            <LegendItem color={C.s1} label="Labour" />
            <LegendItem color={C.s2} label="Travel" />
          </>}
        >
          <StackedDailyBars
            series={costSeries}
            unit={`${cur} `}
            stacks={[
              { key: "labourCost", label: "Labour", color: C.s1 },
              { key: "travelCost", label: "Travel", color: C.s2 },
            ]}
          />
        </ChartFrame>

        <ChartFrame
          title="Cost by technician"
          subtitle="Committed hours at each technician's rate. A crew job costs every member of the crew, which is why crew names are split before this is added up."
        >
          <HBars
            items={cost.byTech.slice(0, 10).map((t) => ({
              label: t.tech,
              value: t.cost,
              display: `${cur} ${t.cost.toLocaleString()} · ${Math.round(t.minutes / 60)}h`,
            }))}
          />
        </ChartFrame>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Where the money could come back</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl">
          Ranked by size. These are deliberately not added into one savings headline: they overlap
          — a visit that fails for access and had no material list appears in two — and a single
          number would overstate the prize. Each one is marked measured or estimated, so you can
          tell which are facts about {m.dateCount} days of real schedule and which are still
          assumptions waiting on jobs being closed out on the board.
        </p>
        <div className="space-y-2">
          {cost.levers.map((l) => (
            <div key={l.id} className="flex flex-wrap items-start gap-3 border-b border-slate-100 pb-2 last:border-0">
              <div className="w-28 shrink-0">
                <div className="text-base font-semibold text-slate-900 tabular-nums">
                  {l.value == null ? "—" : fmt(Math.round(l.value))}
                </div>
                <span className={`text-[10px] rounded px-1 ${l.measured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {l.measured ? "measured" : "estimated"}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800">{l.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{l.basis}</div>
                <div className="text-xs text-slate-600 mt-0.5">{l.action}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ChartFrame
        title="Cost by building"
        subtitle="Where the department's hours are actually being spent. Spelling variants are merged first, so a building is not split across three rows."
      >
        <HBars
          items={cost.byProperty.slice(0, 10).map((p) => ({
            label: p.label,
            value: p.cost,
            display: `${cur} ${p.cost.toLocaleString()} · ${p.jobs} jobs`,
          }))}
        />
      </ChartFrame>
    </div>
  );
}

function RatesEditor({ rates, onSave, techs }) {
  const [draft, setDraft] = useState(rates);
  React.useEffect(() => setDraft(rates), [rates]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setTech = (t, v) => setDraft((d) => ({
    ...d,
    perTech: { ...(d.perTech || {}), [t]: v === "" ? undefined : Number(v) },
  }));

  const fields = [
    ["techCostPerHour", "Technician cost per hour", "Fully loaded: salary + accommodation + visa + insurance, divided by productive hours — not the bare salary rate."],
    ["overtimeMultiplier", "Overtime multiplier", "UAE labour law prices overtime at basic +25%, and +50% for hours between 22:00 and 04:00."],
    ["vehicleCostPerTrip", "Vehicle cost per trip", "Fuel, Salik and wear for one building-to-building hop. The first building of the day is the commute and is not charged."],
    ["callOutFixedCost", "Fixed cost per visit", "Any dispatch or admin overhead you want carried on every job. Leave at 0 if you do not track one."],
    ["contractorCostPerHour", "Contractor cost per hour", "Applied instead of the technician rate on project work whose description mentions a contractor or third party."],
    ["wastedVisitProbability", "Assumed failure rate, unconfirmed visits", "Only used for the forward-looking exposure figure. Once jobs have been closed out on the board for a couple of weeks, replace it with the rate you actually measure."],
  ];

  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Cost rates</h3>
      <p className="text-xs text-slate-600 mt-0.5 mb-3">
        Shared across everyone using the app. The defaults shipped with it are plausible
        placeholders, not DHH figures.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {fields.map(([key, label, hint]) => (
          <label key={key} className="text-xs text-slate-600">
            <span className="font-medium text-slate-800">{label}</span>
            <input
              type="number" step="any" min="0"
              value={draft[key] ?? ""}
              onChange={(e) => set(key, e.target.value === "" ? "" : Number(e.target.value))}
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
            />
            <span className="block text-[10px] text-slate-500 mt-1 leading-snug">{hint}</span>
          </label>
        ))}
      </div>

      {techs.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-slate-700 cursor-pointer">
            Per-technician rates (optional — anyone left blank uses the rate above)
          </summary>
          <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-2">
            {techs.map((t) => (
              <label key={t} className="text-[11px] text-slate-600">
                {t}
                <input
                  type="number" step="any" min="0"
                  value={(draft.perTech && draft.perTech[t]) ?? ""}
                  onChange={(e) => setTech(t, e.target.value)}
                  placeholder={String(draft.techCostPerHour)}
                  className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1 text-sm bg-white"
                />
              </label>
            ))}
          </div>
        </details>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button onClick={() => onSave(draft)}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">
          Save rates
        </button>
        <button onClick={() => { setDraft(DEFAULT_RATES); onSave(DEFAULT_RATES); }}
                className="text-sm border border-slate-300 px-3 py-1.5 rounded-md hover:bg-white">
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

/* ====================== export ====================== */

function downloadCSV(jobs, startDate, endDate) {
  const headers = [
    "Date", "Shift", "Team", "Technicians", "Property", "Unit", "Status", "Occupancy needs confirm",
    "Guest confirmed", "Time of visit", "Task", "Work type", "Priority", "Estimated time",
    "Estimated minutes", "Material needed", "Material details", "Pending", "Pending details",
    "Verify outcome", "Verify reason", "In PMS", "PMS ref", "Actual minutes", "Verified at", "Notes",
  ];
  const rows = jobs.map((j) => [
    j._date, j.shift, j.team, splitCrew(j.team).join(" | "), j.property, j.unit, j.status,
    j.status, j.guestConfirmed, j.timeOfVisit, j.description,
    workType(j.description, j.faultCode), canonPriority(j.priority) || j.priority,
    j.estimatedTime, parseDurationMinutes(j.estimatedTime) ?? "",
    j.materialNeeded, j.materialDetails, j.pending, j.pendingDetails,
    j.verify?.outcome || "", j.verify?.reason || "",
    j.verify?.inPms === true ? "Y" : j.verify?.inPms === false ? "N" : "",
    j.verify?.pmsRef || "", j.verify?.actualMinutes ?? "",
    j.verify?.verifiedAt ? new Date(j.verify.verifiedAt).toISOString() : "", j.notes,
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DHH_jobs_${startDate}_to_${endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
