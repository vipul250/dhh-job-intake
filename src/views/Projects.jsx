import React, { useState, useEffect, useMemo } from "react";
import {
  Briefcase, Plus, Loader2, Link2, ExternalLink, Package,
  AlertTriangle, CheckCircle2, Clock, X, Wand2, Search, CalendarDays, Users,
} from "lucide-react";
import { storageGet, storageSet } from "../lib/storage.js";
import { readDays, parseDay, migrateDay } from "../lib/jobStore.js";
import { liveJobs, actualDuration } from "../lib/job.js";
import {
  newProject, materialLine, projectCost, projectDuration, buildPriceBook,
  lookupPrice, findJobsForProject, extractQuotationRef,
  discoverProjects, candidateProjects, adoptProject,
  PROJECT_STATUS, PROJECT_STATUS_LABEL, PROJECT_TYPES,
} from "../lib/project.js";
import { DEFAULT_RATES } from "../lib/cost.js";
import { squash, formatMinutes, parseDurationMinutes } from "../lib/normalize.js";

/* ---------------------------------------------------------------------- *
 * Projects.jsx — quoted work, and whether it made money.
 *
 * This replaces a read-only list that showed which daily jobs happened to
 * carry a quotation reference. It could not tell you what a project cost,
 * because a daily job has no notion of a quoted price or of material
 * bought against it.
 *
 * Labour is not typed in twice. The daily jobs linked to a project already
 * carry their hours — measured from Start and Done on the board, estimated
 * where they do not — and those roll up here. The coordinator enters what
 * only they know: the approved amount, and the materials as they are
 * bought.
 * ---------------------------------------------------------------------- */

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Projects({ knownDates, showToast }) {
  const [projects, setProjects] = useState(null);
  const [jobsByDate, setJobsByDate] = useState({});
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [filter, setFilter] = useState("open");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [raw, rateRaw] = await Promise.all([
        storageGet("projects"),
        storageGet("cost-rates"),
      ]);
      let list = [];
      try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
      setProjects(list);
      if (rateRaw) { try { setRates({ ...DEFAULT_RATES, ...JSON.parse(rateRaw) }); } catch { /* defaults */ } }

      const dates = (knownDates || []).slice(0, 120);
      const days = await readDays(dates);
      const map = {};
      Object.entries(days).forEach(([d, rows]) => { map[d] = liveJobs(migrateDay(rows, d)); });
      setJobsByDate(map);
    })();
  }, [knownDates]);

  const allJobs = useMemo(
    () => Object.entries(jobsByDate).flatMap(([d, rows]) => rows.map((j) => ({ ...j, _date: d }))),
    [jobsByDate]
  );
  const priceBook = useMemo(() => buildPriceBook(projects || []), [projects]);

  /* Projects the department has already run, read back out of the schedule
     they were written into. A discovered project stops being shown here the
     moment it is adopted — matched on the quotation reference, or on the
     jobs it is built from where there is no reference. */
  const found = useMemo(() => discoverProjects(allJobs), [allJobs]);
  const candidates = useMemo(() => candidateProjects(allJobs, found), [allJobs, found]);
  const unadopted = useMemo(() => {
    const refs = new Set((projects || []).map((p) => squash(p.quotationRef).toUpperCase()).filter(Boolean));
    const linked = new Set((projects || []).flatMap((p) => p.linkedJobIds || []));
    return found.filter((f) => {
      if (f.ref && refs.has(f.ref)) return false;
      return !(f.jobIds || []).some((id) => linked.has(id));
    });
  }, [found, projects]);

  async function save(next) {
    setSaving(true);
    setProjects(next);
    await storageSet("projects", JSON.stringify(next));
    setSaving(false);
  }

  const upsert = (p) => save((projects || []).some((x) => x.id === p.id)
    ? projects.map((x) => (x.id === p.id ? p : x))
    : [...(projects || []), p]);

  const filtered = useMemo(() => {
    const list = projects || [];
    if (filter === "open") return list.filter((p) => p.status !== "completed" && p.status !== "cancelled");
    if (filter === "completed") return list.filter((p) => p.status === "completed");
    if (filter === "losing") return list.filter((p) => {
      const c = projectCost(p, jobsFor(p, allJobs), rates);
      return c.margin != null && c.margin < 0;
    });
    return list;
  }, [projects, filter, allJobs, rates]);

  const portfolio = useMemo(() => {
    const list = projects || [];
    let quoted = 0, cost = 0, withQuote = 0, hours = 0, material = 0;
    list.forEach((p) => {
      const c = projectCost(p, jobsFor(p, allJobs), rates);
      cost += c.selfCost; hours += c.labourHours; material += c.materialCost;
      if (c.quoted != null) { quoted += c.quoted; withQuote++; }
    });
    return { quoted, cost, withQuote, hours, material, count: list.length,
             margin: withQuote ? quoted - cost : null };
  }, [projects, allJobs, rates]);

  if (projects === null) {
    return <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading projects…
    </div>;
  }

  const cur = rates.currency || "AED";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Projects — quoted work and what it cost</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Labour is not entered here. It comes from the daily jobs linked to each project, using
            the time the board measured between Start and Done, and the estimate where it has none.
            What you enter is the approved amount and the materials as they are bought.
          </p>
        </div>
        <button onClick={() => setEditing(newProject({ startDate: todayISO() }))}
                className="flex items-center gap-1.5 text-sm bg-slate-900 text-white px-3 py-2 rounded-md shrink-0">
          <Plus className="w-4 h-4" /> New project
        </button>
      </div>

      {projects.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Projects" value={portfolio.count} sub={`${portfolio.withQuote} with an approved amount`} />
          <Stat label="Quoted" value={`${cur} ${portfolio.quoted.toLocaleString()}`} sub="approved amounts" />
          <Stat label="Our cost" value={`${cur} ${portfolio.cost.toLocaleString()}`} sub={`${portfolio.hours}h labour + ${cur} ${portfolio.material.toLocaleString()} material`} />
          <Stat label="Margin" value={portfolio.margin == null ? "—" : `${cur} ${portfolio.margin.toLocaleString()}`}
                sub={portfolio.quoted ? `${Math.round((portfolio.margin / portfolio.quoted) * 100)}% of quoted` : ""}
                tone={portfolio.margin != null && portfolio.margin < 0 ? "bad" : "good"} />
          <Stat label="Material lines logged" value={projects.reduce((s, p) => s + (p.materials || []).length, 0)}
                sub={`${Object.values(priceBook).filter((b) => b.confident).length} items priced from memory`} />
        </div>
      )}

      {unadopted.length > 0 && (
        <Discovered
          items={unadopted} candidates={candidates} rates={rates}
          onAdopt={(f) => {
            const p = adoptProject(f, "coordinator");
            upsert(p);
            setEditing(p);
            showToast?.(`"${p.title}" added. Attach the approved quotation to see the margin.`, "ok");
          }}
          onAdoptAll={() => {
            const made = unadopted.map((f) => adoptProject(f, "coordinator"));
            save([...(projects || []), ...made]);
            showToast?.(`${made.length} project(s) brought in from the schedule.`, "ok");
          }}
        />
      )}

      <div className="flex gap-1.5">
        {[["open", "Open"], ["all", "All"], ["completed", "Completed"], ["losing", "Over cost"]].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
                  className={`text-xs rounded-md px-2.5 py-1.5 border ${filter === id ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
        {saving && <span className="flex items-center gap-1 text-xs text-slate-400 ml-2"><Loader2 className="w-3 h-3 animate-spin" /> saving</span>}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {projects.length === 0
            ? (unadopted.length
                ? "Nothing added by hand yet — but the projects above were found in the schedule. Bring one in to attach its quotation."
                : "No projects yet. Create one from an approved quotation, then link the daily jobs that belong to it.")
            : "No projects match this filter."}
        </div>
      )}

      {filtered.map((p) => (
        <ProjectCard
          key={p.id} project={p} allJobs={allJobs} rates={rates} priceBook={priceBook}
          onChange={upsert} onEdit={() => setEditing(p)} showToast={showToast}
          /* Nothing is deleted in this app. A project that should not have
             been raised is cancelled, keeping its quotation reference, its
             material lines and the hours already booked against it — which
             is exactly the evidence somebody will want later. */
          onCancelProject={() => upsert({ ...p, status: "cancelled" })}
        />
      ))}

      {editing && (
        <ProjectForm
          project={editing} allJobs={allJobs}
          onCancel={() => setEditing(null)}
          onSave={(p) => { upsert(p); setEditing(null); }}
        />
      )}
    </div>
  );
}

function jobsFor(project, allJobs) {
  const ids = new Set(project.linkedJobIds || []);
  return allJobs.filter((j) => ids.has(j.id));
}

/* ====================================================================== *
 * Projects found in the schedule.
 *
 * The tab used to be empty because it only listed projects somebody had
 * typed into it — while the projects themselves were in the daily schedule
 * the whole time, identified by the quotation number the coordinator
 * writes into the task: "Approved - Quotation - PC-2026-08-23 -
 * Maintenance work", the same reference appearing on each day the crew was
 * there. Reading it back is what turns three separate job rows into one
 * project that ran for three days.
 *
 * These are shown but not silently created. What the app can read is the
 * work and the hours; what it cannot read is the amount the client
 * approved, and a project list carrying costs with no prices against them
 * would be worse than none. So each one is offered, and adopting it opens
 * the form on the one field only a person has.
 * ====================================================================== */
function Discovered({ items, candidates, rates, onAdopt, onAdoptAll }) {
  const [open, setOpen] = useState(true);
  const cur = rates.currency || "AED";
  const hourly = Number(rates.techCostPerHour) || 25;

  const rows = items.map((f) => {
    let minutes = 0, measured = 0;
    (f.jobs || []).forEach((j) => {
      // Person-hours, not elapsed: five people on a four-hour job is twenty
      // hours of our cost, and cost is what this column feeds.
      const crew = splitLen(j.team);
      const act = actualDuration(j);
      if (act.minutes != null) { minutes += act.minutes * crew; measured += act.minutes * crew; return; }
      const est = parseDurationMinutes(j.estimatedTime);
      if (est != null) minutes += est * crew;
    });
    const hours = Math.round((minutes / 60) * 10) / 10;
    return { f, hours, measuredHours: Math.round((measured / 60) * 10) / 10, labour: Math.round(hours * hourly) };
  });

  const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10;
  const totalLabour = rows.reduce((s, r) => s + r.labour, 0);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <Search className="w-4 h-4 text-amber-700" />
            {items.length} project{items.length === 1 ? "" : "s"} found in the schedule
          </h2>
          <p className="text-xs text-slate-600 mt-1 max-w-3xl">
            These were never missing — they were written into the daily tasks with their quotation
            number, which is how the department has always recorded them. The days, the crews and
            the hours are read straight from the board. What is not in the schedule anywhere is the
            amount the client approved, so that is the one thing adopting a project asks you for.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setOpen(!open)}
                  className="text-xs border border-slate-300 bg-white px-2.5 py-1.5 rounded-md">
            {open ? "hide" : "show"}
          </button>
          <button onClick={onAdoptAll}
                  className="text-xs bg-slate-900 text-white px-2.5 py-1.5 rounded-md">
            Bring in all {items.length}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-700">
        <span><b>{totalHours}h</b> of crew time already booked against them</span>
        <span>≈ <b>{cur} {totalLabour.toLocaleString()}</b> of our cost, before material</span>
        <span><b>{items.filter((f) => f.days > 1).length}</b> ran more than one day</span>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {rows.map(({ f, hours, measuredHours, labour }) => (
            <div key={f.key} className="rounded-md border border-amber-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{f.title}</span>
                    {f.ref && <span className="text-[11px] font-mono bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">{f.ref}</span>}
                    {f.revision != null && <span className="text-[11px] text-slate-500">rev {f.revision}</span>}
                    <span className="text-[11px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">
                      {f.type === "onboarding" ? "Onboarding" : f.type === "snag" ? "Snag" : "Quoted"}
                    </span>
                    {!f.ref && (
                      <span className="text-[11px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200">
                        no quotation number written
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">{f.units.join(" · ")}</div>
                  <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {f.days} day{f.days === 1 ? "" : "s"}: {f.dates.join(", ")}
                      {f.continued && " · marked as continued"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3 h-3" /> {f.crew.join(", ") || "no crew recorded"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {hours}h of crew time {measuredHours > 0 ? `(${measuredHours}h measured)` : "(from estimates)"}
                      {" · ≈ "}{cur} {labour.toLocaleString()} labour
                    </span>
                  </div>
                </div>
                <button onClick={() => onAdopt(f)}
                        className="text-xs border border-slate-800 bg-white text-slate-900 px-2.5 py-1.5 rounded-md shrink-0">
                  Bring it in
                </button>
              </div>
            </div>
          ))}

          {candidates.length > 0 && (
            <div className="pt-2">
              <h3 className="text-xs font-medium text-slate-700">
                Worth a look — approved work with no quotation number
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">
                These say approved but carry no reference, so nothing here can tell whether they are
                quoted work whose number nobody wrote down or a guest agreeing to an ordinary
                repair. Guessing either way would be wrong — put the reference on the job and it
                joins its project on the next load.
              </p>
              <ul className="mt-1.5 space-y-1">
                {candidates.slice(0, 8).map((c) => (
                  <li key={c.id} className="text-xs text-slate-600">
                    <span className="text-slate-400">{c.date}</span>{" · "}
                    <b>{c.property} {c.unit}</b>{" — "}{c.description}
                    {c.team ? <span className="text-slate-400"> · {c.team}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const splitLen = (team) =>
  Math.max(1, squash(team).split(/\s*(?:,|&|\+|\/|\band\b)\s*/i).filter(Boolean).length);

function Stat({ label, value, sub, tone }) {
  const t = tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 ${t}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ========================= project card ========================= */

function ProjectCard({ project, allJobs, rates, priceBook, onChange, onEdit, onCancelProject, showToast }) {
  const [tab, setTab] = useState(null);
  const linked = jobsFor(project, allJobs);
  const cost = projectCost(project, linked, rates);
  const dur = projectDuration(project);
  const cur = cost.currency;
  const suggestions = useMemo(() => findJobsForProject(project, allJobs).slice(0, 12), [project, allJobs]);

  const marginTone = cost.margin == null ? "" : cost.margin < 0 ? "text-red-700" : "text-emerald-700";

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="p-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-sm font-medium text-slate-900">
              {project.title || `${project.property} ${project.unit}`}
            </span>
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">
              {PROJECT_STATUS_LABEL[project.status] || project.status}
            </span>
            {dur?.overdue && (
              <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-700 font-medium">overdue</span>
            )}
            {dur?.late && (
              <span className="text-[10px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-800">finished late</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {project.property} {project.unit}
            {project.quotationRef && <> · {project.quotationRef}</>}
            {project.startDate && <> · started {project.startDate}</>}
            {dur && <> · {dur.days} day{dur.days === 1 ? "" : "s"}{project.actualCompletionDate ? "" : " so far"}</>}
          </div>
          {project.quotationLink && (
            <a href={project.quotationLink} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-xs text-blue-700 underline mt-1">
              <ExternalLink className="w-3 h-3" /> Approved quotation
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-4 text-xs">
          <Figure label="Labour" value={`${cost.labourHours}h`}
                  sub={`${cur} ${cost.labourCost.toLocaleString()}`}
                  note={cost.measuredJobs ? `${cost.measuredHours}h measured` : "all estimated"} />
          <Figure label="Material" value={`${cur} ${cost.materialCost.toLocaleString()}`}
                  sub={`${(project.materials || []).length} line${(project.materials || []).length === 1 ? "" : "s"}`} />
          <Figure label="Our cost" value={`${cur} ${cost.selfCost.toLocaleString()}`} strong />
          <Figure label="Quoted" value={cost.quoted == null ? "not set" : `${cur} ${cost.quoted.toLocaleString()}`} />
          <Figure label="Margin"
                  value={cost.margin == null ? "—" : `${cur} ${cost.margin.toLocaleString()}`}
                  sub={cost.marginPct == null ? "" : `${cost.marginPct}%`}
                  className={marginTone} strong />
        </div>
      </div>

      {cost.quoted != null && !cost.labourIsMeasured && cost.linkedJobCount > 0 && (
        <div className="mx-3 mb-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          This margin rests mostly on estimated hours ({cost.measuredJobs} of {cost.linkedJobCount} jobs
          have measured time). Treat it as a forecast until the linked jobs are closed out on the board.
        </div>
      )}
      {cost.linkedJobCount === 0 && (
        <div className="mx-3 mb-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
          No daily jobs linked yet, so labour reads zero. Link them below and the hours roll in on
          their own.
        </div>
      )}

      <div className="border-t border-slate-100 px-3 py-1.5 flex flex-wrap gap-1.5">
        {[["jobs", `Linked jobs (${linked.length})`], ["material", `Material (${(project.materials || []).length})`], ["labour", "Extra labour"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(tab === id ? null : id)}
                  className={`text-xs rounded px-2 py-1 border ${tab === id ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          <button onClick={onEdit} className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-50">Edit</button>
          {project.status !== "cancelled" && (
            <button onClick={onCancelProject}
                    title="The project stays on record with its costs and hours — nothing is removed"
                    className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-1 hover:bg-slate-50">
              Cancel project
            </button>
          )}
        </div>
      </div>

      {tab === "jobs" && (
        <LinkedJobs
          project={project} linked={linked} suggestions={suggestions}
          onChange={onChange}
        />
      )}
      {tab === "material" && (
        <MaterialLog project={project} priceBook={priceBook} currency={cur} onChange={onChange} showToast={showToast} />
      )}
      {tab === "labour" && (
        <ExtraLabour project={project} onChange={onChange} />
      )}
    </div>
  );
}

function Figure({ label, value, sub, note, strong, className = "" }) {
  return (
    <div className="min-w-[74px]">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`${strong ? "text-sm font-semibold" : "text-sm"} text-slate-900 ${className}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
      {note && <div className="text-[10px] text-slate-400">{note}</div>}
    </div>
  );
}

/* ========================= linked jobs ========================= */

function LinkedJobs({ project, linked, suggestions, onChange }) {
  const link = (job) => onChange({ ...project, linkedJobIds: [...(project.linkedJobIds || []), job.id] });
  const unlink = (job) => onChange({ ...project, linkedJobIds: (project.linkedJobIds || []).filter((id) => id !== job.id) });

  return (
    <div className="border-t border-slate-100 p-3 bg-slate-50">
      <p className="text-[11px] text-slate-500 mb-2">
        The hours on these jobs are this project's labour cost. Measured time comes from Start and
        Done on the board; where a job was never started, its estimate is used instead and the card
        says so.
      </p>
      {linked.length === 0 && <p className="text-xs text-slate-400">Nothing linked yet.</p>}
      <ul className="space-y-1">
        {linked.map((j) => {
          const act = actualDuration(j);
          return (
            <li key={j.id} className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 tabular-nums shrink-0">{j._date}</span>
              <span className="text-slate-800 truncate flex-1">{j.property} {j.unit} — {j.description}</span>
              <span className="text-slate-500 shrink-0">{j.team}</span>
              <span className={`shrink-0 ${act.source === "measured" ? "text-emerald-700" : "text-slate-400"}`}>
                {act.minutes != null ? `${formatMinutes(act.minutes)} ${act.source}` : `${j.estimatedTime || "—"} est.`}
              </span>
              <button onClick={() => unlink(j)} className="text-slate-400 hover:text-red-600 shrink-0"><X className="w-3 h-3" /></button>
            </li>
          );
        })}
      </ul>

      {suggestions.length > 0 && (
        <div className="mt-3 pt-2 border-t border-slate-200">
          <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
            <Wand2 className="w-3 h-3" /> Daily jobs that look like they belong to this project —
            matched on the quotation reference in the task text, or on the same unit:
          </p>
          <ul className="space-y-1">
            {suggestions.map((j) => (
              <li key={j.id} className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 tabular-nums shrink-0">{j._date}</span>
                <span className="text-slate-700 truncate flex-1">{j.property} {j.unit} — {j.description}</span>
                <button onClick={() => link(j)}
                        className="flex items-center gap-1 border border-slate-300 rounded px-1.5 py-0.5 hover:bg-white shrink-0">
                  <Link2 className="w-3 h-3" /> link
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ========================= material log ========================= */

function MaterialLog({ project, priceBook, currency, onChange, showToast }) {
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [touchedCost, setTouchedCost] = useState(false);

  const known = item.trim() ? lookupPrice(priceBook, item) : null;

  // Fill the price from memory once the item is recognised, unless the
  // coordinator has typed over it. This is the part that gets less manual
  // every month.
  useEffect(() => {
    if (!touchedCost && known && known.confident) setUnitCost(String(known.median));
  }, [known, touchedCost]);

  function add() {
    if (!item.trim()) return;
    const line = materialLine(item, qty, unitCost, "coordinator");
    onChange({ ...project, materials: [...(project.materials || []), line] });
    setItem(""); setQty("1"); setUnitCost(""); setTouchedCost(false);
  }
  /* A material line entered by mistake is voided, not removed. It stops
     counting towards the cost and stays visible, struck through — because a
     figure that was once in the project's cost and then vanished is exactly
     the kind of thing somebody will need to account for later. Voiding is
     reversible; deleting never is. */
  function toggleVoid(id) {
    onChange({
      ...project,
      materials: (project.materials || []).map((m) => (m.id === id ? { ...m, void: !m.void } : m)),
    });
  }

  const total = (project.materials || []).reduce((s, m) => s + (m.void ? 0 : m.total || 0), 0);

  return (
    <div className="border-t border-slate-100 p-3 bg-slate-50">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-500 flex-1 min-w-[180px]">
          Item
          <input value={item} onChange={(e) => setItem(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                 placeholder="e.g. Honeywell thermostat"
                 className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="text-[11px] text-slate-500 w-20">
          Qty
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
                 className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="text-[11px] text-slate-500 w-28">
          Unit cost ({currency})
          <input type="number" min="0" step="any" value={unitCost}
                 onChange={(e) => { setUnitCost(e.target.value); setTouchedCost(true); }}
                 className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <button onClick={add} disabled={!item.trim()}
                className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          Add
        </button>
      </div>

      {known && (
        <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
          <Package className="w-3 h-3" />
          {known.confident
            ? <>Filled from memory — <span className="font-medium">{known.item}</span> has been bought {known.count} times, median {currency} {known.median}{known.min !== known.max && <> (range {known.min}–{known.max})</>}.</>
            : <>Seen {known.count} time{known.count === 1 ? "" : "s"} before at {currency} {known.latest}. Not filled in automatically until there are three.</>}
        </p>
      )}

      <ul className="mt-3 space-y-1">
        {(project.materials || []).map((m) => (
          <li key={m.id} className={`flex items-center gap-2 text-xs ${m.void ? "opacity-45 line-through" : ""}`}>
            <span className="text-slate-400 tabular-nums shrink-0">{m.date}</span>
            <span className="text-slate-800 flex-1 truncate">{m.item}</span>
            <span className="text-slate-500 tabular-nums shrink-0">{m.qty} × {m.unitCost}</span>
            <span className="text-slate-900 tabular-nums shrink-0 w-20 text-right">{currency} {m.total.toLocaleString()}</span>
            <button onClick={() => toggleVoid(m.id)}
                    title={m.void ? "Put it back in the cost" : "Stop it counting — the line stays on record"}
                    className="text-[11px] text-slate-400 hover:text-slate-900 shrink-0 no-underline">
              {m.void ? "restore" : "void"}
            </button>
          </li>
        ))}
      </ul>
      {(project.materials || []).length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-right text-slate-900 font-medium">
          Total material: {currency} {total.toLocaleString()}
        </div>
      )}
    </div>
  );
}

/* ========================= extra labour ========================= */

function ExtraLabour({ project, onChange }) {
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  function add() {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return;
    onChange({
      ...project,
      extraLabour: [...(project.extraLabour || []),
        { id: Math.random().toString(36).slice(2, 9), hours: h, note: squash(note), date: todayISO(), by: "coordinator" }],
    });
    setHours(""); setNote("");
  }
  return (
    <div className="border-t border-slate-100 p-3 bg-slate-50">
      <p className="text-[11px] text-slate-500 mb-2">
        Hours worked on this project that never appeared as a job on the board — a contractor's
        time, or work done outside the schedule. Anything already on the board is counted from the
        linked jobs; do not add it twice.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-500 w-24">
          Hours
          <input type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)}
                 className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="text-[11px] text-slate-500 flex-1 min-w-[180px]">
          What for
          <input value={note} onChange={(e) => setNote(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                 className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <button onClick={add} className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">Add</button>
      </div>
      <ul className="mt-3 space-y-1">
        {(project.extraLabour || []).map((l) => (
          <li key={l.id} className={`flex items-center gap-2 text-xs ${l.void ? "opacity-45 line-through" : ""}`}>
            <span className="text-slate-400 tabular-nums shrink-0">{l.date}</span>
            <span className="text-slate-900 shrink-0">{l.hours}h</span>
            <span className="text-slate-600 flex-1 truncate">{l.note}</span>
            <button onClick={() => onChange({ ...project, extraLabour: project.extraLabour.map((x) => (x.id === l.id ? { ...x, void: !x.void } : x)) })}
                    title={l.void ? "Put it back in the cost" : "Stop it counting — the line stays on record"}
                    className="text-[11px] text-slate-400 hover:text-slate-900">
              {l.void ? "restore" : "void"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ========================= form ========================= */

function ProjectForm({ project, allJobs, onCancel, onSave }) {
  const [f, setF] = useState(project);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const canSave = squash(f.property) || squash(f.title);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl mt-10 p-4">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            {project.createdAt && (project.property || project.title) ? "Edit project" : "New project"}
          </h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid sm:grid-cols-2 gap-2 mt-3">
          <Field label="Title" value={f.title} onChange={(v) => set("title", v)} placeholder="e.g. Afnan 5 603 onboarding" full />
          <Field label="Property" value={f.property} onChange={(v) => set("property", v)} />
          <Field label="Unit" value={f.unit} onChange={(v) => set("unit", v)} />

          <label className="block text-xs text-slate-500">
            Type
            <select value={f.type} onChange={(e) => set("type", e.target.value)}
                    className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {PROJECT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-500">
            Status
            <select value={f.status} onChange={(e) => set("status", e.target.value)}
                    className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {PROJECT_STATUS.map((v) => <option key={v} value={v}>{PROJECT_STATUS_LABEL[v]}</option>)}
            </select>
          </label>

          <Field label="Quotation ref" value={f.quotationRef} onChange={(v) => set("quotationRef", v)} placeholder="PC-2026-08-23" />
          <label className="block text-xs text-slate-500">
            Approved amount
            <input type="number" min="0" step="any" value={f.quotedAmount ?? ""}
                   onChange={(e) => set("quotedAmount", e.target.value === "" ? null : Number(e.target.value))}
                   placeholder="what the client agreed to pay"
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>

          <Field label="Link to the approved quotation" value={f.quotationLink} onChange={(v) => set("quotationLink", v)}
                 placeholder="paste a Drive / PMS / email link" full />

          <label className="block text-xs text-slate-500">
            Start date
            <input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)}
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs text-slate-500">
            Target completion
            <input type="date" value={f.targetDate} onChange={(e) => set("targetDate", e.target.value)}
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs text-slate-500">
            Actual completion
            <input type="date" value={f.actualCompletionDate} onChange={(e) => set("actualCompletionDate", e.target.value)}
                   className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>
          <Field label="Notes" value={f.notes} onChange={(v) => set("notes", v)} full />
        </div>

        <p className="text-[11px] text-slate-500 mt-2">
          The quotation is stored as a link, not as an uploaded file — the app has no file storage
          set up. A link to wherever the approved PDF already lives works the same for pulling the
          figure out.
        </p>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="text-sm border border-slate-300 px-3 py-1.5 rounded-md">Cancel</button>
          <button disabled={!canSave} onClick={() => onSave(f)}
                  className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
            Save project
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, full }) {
  return (
    <label className={`block text-xs text-slate-500 ${full ? "sm:col-span-2" : ""}`}>
      {label}
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
             className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
    </label>
  );
}
