import React, { useMemo, useState } from "react";
import { UploadCloud, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { parseSheetPaste, groupByDate } from "../lib/importSheet.js";
import { computeAll } from "../lib/metrics.js";

/* ---------------------------------------------------------------------- *
 * SheetImport.jsx — paste the daily-input sheet straight in.
 *
 * The existing AI import tab is for schedules that arrive as prose. This
 * one is for the workbook, which is already columnar: select the rows in
 * Excel, copy, paste. It parses deterministically — no model call, so no
 * cost per paste, no invented unit numbers, and a whole month imports in
 * one go rather than four jobs at a time.
 * ---------------------------------------------------------------------- */

export default function SheetImport({ defaultDate, onCommit, existingCounts }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [mode, setMode] = useState("merge");
  const [done, setDone] = useState(null);

  function analyse() {
    const res = parseSheetPaste(text, defaultDate);
    setResult(res);
    setDone(null);
  }

  const grouped = useMemo(() => (result ? groupByDate(result.jobs) : []), [result]);
  const preview = useMemo(
    () => (result && result.jobs.length ? computeAll(result.jobs) : null),
    [result]
  );

  async function commit() {
    if (!result || !result.jobs.length) return;
    setCommitting(true);
    const summary = await onCommit(grouped, mode);
    setCommitting(false);
    setDone(summary);
    setResult(null);
    setText("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Import the daily-input sheet</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          In Excel, select the rows you want (including the header row — it makes the column
          matching reliable), copy, and paste below. Columns are matched by name, so the exact
          order does not matter and extra columns are ignored. Nothing is saved until you review
          the summary and click add.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"Paste from Excel here.\n\nDate\tShift\tTeam / Technician\tProperty\tUnit / Villa No.\tStatus\t…"}
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
        />
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button onClick={analyse} disabled={!text.trim()}
                  className="flex items-center gap-1.5 text-sm bg-slate-900 text-white px-4 py-2 rounded-md disabled:opacity-50">
            <UploadCloud className="w-4 h-4" /> Read the paste
          </button>
          <span className="text-xs text-slate-500">
            Reads it and shows you what it found. Still nothing saved at this point.
          </span>
        </div>
      </div>

      {done && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5" />
            <div className="text-sm text-emerald-900">
              <p className="font-medium">Imported {done.jobs} jobs across {done.dates} date(s).</p>
              <p className="text-xs mt-1">
                Open the Dashboard and set the range to {done.first} → {done.last} to see them.
              </p>
            </div>
          </div>
        </div>
      )}

      {result && (
        <>
          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              {result.jobs.length} job(s) read across {grouped.length} date(s)
              {result.skipped > 0 && <span className="text-slate-400 font-normal"> · {result.skipped} blank row(s) skipped</span>}
            </h2>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="text-left font-medium py-1.5">Date</th>
                    <th className="text-right font-medium py-1.5">Jobs in paste</th>
                    <th className="text-right font-medium py-1.5">Already stored</th>
                    <th className="text-left font-medium py-1.5 pl-4">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([date, list]) => (
                    <tr key={date} className="border-b border-slate-100">
                      <td className="py-1.5 text-slate-800 tabular-nums">{date}</td>
                      <td className="py-1.5 text-right tabular-nums">{list.length}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">
                        {existingCounts[date] ?? 0}
                      </td>
                      <td className="py-1.5 pl-4 text-slate-500 truncate max-w-md">
                        {list[0].property} {list[0].unit} — {(list[0].description || "").slice(0, 50)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStat label="Time estimates readable"
                          value={`${preview.capacity.estimateCoverage.pct ?? 0}%`}
                          sub={`${preview.capacity.estimateCoverage.answered}/${preview.capacity.estimateCoverage.total}`} />
                <MiniStat label="Tech-days over capacity"
                          value={preview.capacity.overloaded.length}
                          sub={`of ${preview.capacity.techDayCount}`} />
                <MiniStat label="Occupied, unconfirmed"
                          value={preview.access.atRiskCount}
                          sub={`of ${preview.access.needingConfirmation} occupied visits`} />
                <MiniStat label="Distinct buildings"
                          value={preview.mix.distinctProperties}
                          sub="after merging spellings" />
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-600 mb-2">
                Some of these dates already have jobs stored. Choose what to do with them:
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["merge", "Add to what is there", "Keeps existing jobs and appends the pasted ones. Safe, but pasting the same day twice will double it up."],
                  ["replace", "Replace those dates", "Deletes everything stored for each date in the paste and uses the pasted rows instead. Use this when re-importing a corrected sheet."],
                ].map(([id, label, hint]) => (
                  <label key={id}
                         className={`flex-1 min-w-[240px] cursor-pointer rounded-md border p-2.5 ${mode === id ? "border-slate-900 bg-slate-50" : "border-slate-300"}`}>
                    <div className="flex items-center gap-2">
                      <input type="radio" name="importmode" checked={mode === id} onChange={() => setMode(id)} />
                      <span className="text-sm font-medium text-slate-800">{label}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 ml-6">{hint}</p>
                  </label>
                ))}
              </div>

              {mode === "replace" && (
                <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  This will delete {grouped.reduce((s, [d]) => s + (existingCounts[d] ?? 0), 0)} stored
                  job(s) on {grouped.length} date(s), including any verification already recorded against them.
                </p>
              )}

              <button onClick={commit} disabled={committing}
                      className="mt-3 flex items-center gap-1.5 text-sm bg-slate-900 text-white px-4 py-2 rounded-md disabled:opacity-60">
                {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {committing ? "Saving…" : `Add ${result.jobs.length} job(s) to the board`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="rounded-md border border-slate-200 p-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
      <div className="text-[10px] text-slate-400">{sub}</div>
    </div>
  );
}
