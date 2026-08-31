import React, { useMemo, useState } from "react";
import { CheckCircle2, XCircle, MinusCircle, ExternalLink, Loader2, Save } from "lucide-react";
import { NOT_DONE_REASONS } from "../lib/metrics.js";
import { parseDurationMinutes, formatMinutes, canonPriority } from "../lib/normalize.js";

/* ---------------------------------------------------------------------- *
 * Verify.jsx — the admin's next-morning pass.
 *
 * This is the piece the workbook has no column for, and the reason the old
 * dashboard could not say anything true about completion. The schedule
 * records what was *planned*; nothing recorded what happened. "In PMS?" is
 * answered on 43% of rows and says "Y" on 203 of those 204 — it is an
 * intention, not a check.
 *
 * So the design constraint here is time, not features: one row per job,
 * three buttons, keyboard-reachable, no modal, saving as you go. A pass
 * over 30 jobs should take about three minutes. Anything slower will not
 * be done daily, and a metric nobody feeds is worse than no metric — it
 * decays into a confident wrong number, which is where this started.
 *
 * A reason is only asked for when something did NOT happen, because that
 * is the only case where the answer changes a decision.
 * ---------------------------------------------------------------------- */

const OUTCOME_META = {
  done: { label: "Done", icon: CheckCircle2, on: "bg-emerald-600 text-white border-emerald-600", off: "text-emerald-700 border-emerald-300 hover:bg-emerald-50" },
  partial: { label: "Partial", icon: MinusCircle, on: "bg-amber-500 text-white border-amber-500", off: "text-amber-700 border-amber-300 hover:bg-amber-50" },
  "not-done": { label: "Not done", icon: XCircle, on: "bg-red-600 text-white border-red-600", off: "text-red-700 border-red-300 hover:bg-red-50" },
};

export default function Verify({ selectedDate, setSelectedDate, knownDates, jobs, onSaveVerify, saving }) {
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    if (filter === "unverified") return jobs.filter((j) => !j.verify || !j.verify.outcome);
    if (filter === "exceptions") return jobs.filter((j) => j.verify && j.verify.outcome && j.verify.outcome !== "done");
    return jobs;
  }, [jobs, filter]);

  const verified = jobs.filter((j) => j.verify && j.verify.outcome);
  const done = verified.filter((j) => j.verify.outcome === "done").length;
  const pct = jobs.length ? Math.round((verified.length / jobs.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Verify — did yesterday actually happen?</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          One row per scheduled job. Mark what happened, and where PMS disagrees with the field,
          say so. This pass is what makes completion rate, PMS traceability and first-time fix real
          numbers instead of guesses — it is the only data entry the dashboard asks for that the
          schedule does not already contain.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-600">
          Verifying
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                 className="mt-1 block border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <div className="flex gap-1.5">
          {[["all", "All"], ["unverified", "Not yet checked"], ["exceptions", "Exceptions"]].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)}
                    className={`text-xs rounded-md px-2.5 py-1.5 border ${filter === id ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4 text-sm">
          {saving && <span className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> saving</span>}
          <span className="text-slate-600">
            <span className="font-semibold text-slate-900">{verified.length}</span> of {jobs.length} checked
            <span className="text-slate-400"> ({pct}%)</span>
          </span>
          {verified.length > 0 && (
            <span className="text-slate-600">
              <span className="font-semibold text-emerald-700">{done}</span> done
            </span>
          )}
        </div>
      </div>

      {jobs.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No jobs stored for {selectedDate}.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((job) => (
          <VerifyRow key={job.id} job={job} onSave={onSaveVerify} />
        ))}
      </div>

      {jobs.length > 0 && rows.length === 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Nothing matches that filter — every job for {selectedDate} has been checked.
        </div>
      )}
    </div>
  );
}

function VerifyRow({ job, onSave }) {
  const v = job.verify || {};
  const [reason, setReason] = useState(v.reason || "");
  const [pmsRef, setPmsRef] = useState(v.pmsRef || "");
  const [actual, setActual] = useState(v.actualMinutes ?? "");
  const [note, setNote] = useState(v.note || "");

  const est = parseDurationMinutes(job.estimatedTime);
  const outcome = v.outcome || null;
  const needsReason = outcome === "not-done" || outcome === "partial";

  function setOutcome(next) {
    const patch = {
      ...v,
      outcome: next === outcome ? null : next,
      reason: next === "done" ? "" : reason,
      pmsRef, note,
      actualMinutes: actual === "" ? null : Number(actual),
      verifiedAt: Date.now(),
    };
    if (patch.outcome === null) {
      onSave(job, null);
    } else {
      onSave(job, patch);
    }
  }

  function patchField(field, value) {
    if (!outcome) return; // nothing to attach it to yet
    onSave(job, { ...v, [field]: value, verifiedAt: Date.now() });
  }

  const rowTone =
    outcome === "done" ? "border-emerald-200"
      : outcome === "partial" ? "border-amber-200"
      : outcome === "not-done" ? "border-red-200"
      : "border-slate-200";

  return (
    <div className={`rounded-lg border ${rowTone} bg-white p-3`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-900">{job.property} {job.unit}</span>
            {job.status && <span className="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">{job.status}</span>}
            {canonPriority(job.priority) === "PRI-1" && (
              <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-700 font-medium">P1</span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{job.description}</p>
          <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-3">
            <span>{job.team || "Unassigned"}</span>
            {job.shift && <span>{job.shift}</span>}
            {est != null && <span>est. {formatMinutes(est)}</span>}
          </div>
        </div>

        <div className="flex gap-1.5 shrink-0">
          {Object.entries(OUTCOME_META).map(([key, meta]) => {
            const Icon = meta.icon;
            const on = outcome === key;
            return (
              <button key={key} onClick={() => setOutcome(key)}
                      aria-pressed={on}
                      className={`flex items-center gap-1 text-xs rounded-md border px-2.5 py-1.5 transition-colors ${on ? meta.on : meta.off}`}>
                <Icon className="w-3.5 h-3.5" /> {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {outcome && (
        <div className="mt-3 pt-3 border-t border-slate-100 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {needsReason && (
            <label className="text-[11px] text-slate-500 lg:col-span-2">
              Why not{outcome === "partial" ? " finished" : ""}?
              <select value={reason}
                      onChange={(e) => { setReason(e.target.value); patchField("reason", e.target.value); }}
                      className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
                <option value="">— pick a reason —</option>
                {NOT_DONE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}

          <label className="text-[11px] text-slate-500">
            Found in PMS?
            <div className="mt-0.5 flex gap-1.5">
              {[["Y", true], ["N", false]].map(([label, val]) => (
                <button key={label}
                        onClick={() => patchField("inPms", v.inPms === val ? null : val)}
                        className={`flex-1 text-xs rounded-md border px-2 py-1.5 ${v.inPms === val ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 hover:bg-slate-50"}`}>
                  {label}
                </button>
              ))}
            </div>
          </label>

          <label className="text-[11px] text-slate-500">
            PMS ticket ref
            <input value={pmsRef}
                   onChange={(e) => setPmsRef(e.target.value)}
                   onBlur={() => patchField("pmsRef", pmsRef)}
                   placeholder="task id or link"
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>

          <label className="text-[11px] text-slate-500">
            Actual time (minutes)
            <input type="number" min="0" step="15" value={actual}
                   onChange={(e) => setActual(e.target.value)}
                   onBlur={() => patchField("actualMinutes", actual === "" ? null : Number(actual))}
                   placeholder={est != null ? String(est) : "e.g. 60"}
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>

          <label className="text-[11px] text-slate-500 sm:col-span-2 lg:col-span-4">
            Note (optional)
            <input value={note}
                   onChange={(e) => setNote(e.target.value)}
                   onBlur={() => patchField("note", note)}
                   placeholder="anything the next person needs to know"
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>

          {v.inPms === false && (outcome === "done" || outcome === "partial") && (
            <p className="sm:col-span-2 lg:col-span-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              Work happened but there is no PMS record — it is invisible to anyone reading PMS.
              This is counted as a traceability gap on the dashboard.
            </p>
          )}
          {v.inPms === true && outcome === "not-done" && (
            <p className="sm:col-span-2 lg:col-span-4 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              PMS has a record but the field says this did not happen. This is the mismatch the
              verification pass exists to catch — counted separately on the dashboard.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
