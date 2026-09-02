import React, { useState, useEffect, useMemo } from "react";
import {
  Users, Loader2, Check, AlertTriangle, Phone, Clock, Plane, Save, X,
} from "lucide-react";
import { storageGet, storageSet } from "../lib/storage.js";
import { squash, canonKey } from "../lib/normalize.js";
import { readDay, migrateDay } from "../lib/jobStore.js";
import { readGoLive, setGoLive } from "../lib/goLive.js";
import { liveJobs } from "../lib/job.js";
import { parseRosterMessage, rosterSummary, checkAgainstSchedule } from "../lib/roster.js";
import {
  seedStaff, backfillStaff, staffIndex, parseStaffMessage, mergeStaff, normaliseStaff,
  TRADES, TRADE_LABEL, describeStaff,
} from "../lib/staff.js";
import { checkDayCrewing } from "../lib/crewing.js";
import { sendCode, verifyCode, setAuthRequired as persistAuthRequired, signOut, identityFor } from "../lib/auth.js";

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

export default function Roster({ selectedDate, setSelectedDate, showToast, authRequired, setAuthRequired, session }) {
  const [date, setDate] = useState(selectedDate || todayISO());
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [projects, setProjects] = useState([]);
  const [pickBusy, setPickBusy] = useState(false);

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
      try {
        const praw = await storageGet("projects");
        setProjects(praw ? JSON.parse(praw) : []);
      } catch { setProjects([]); }
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
    /* A re-paste must not silently drop the crew that was ticked for this
       day — the message it comes from has never carried them. */
    const toStore = {
      ...preview,
      projectPicks: preview.projectPicks || (saved && saved.projectPicks) || [],
      savedAt: Date.now(),
    };
    await storageSet(`roster:${preview.date || date}`, JSON.stringify(toStore));
    if (preview.date && preview.date !== date) setDate(preview.date);
    setSaved(toStore);
    setEditing(false);
    setSaving(false);
    showToast(`Roster saved for ${preview.date || date}.`, "ok");
  }

  /* Ticking somebody onto a project writes straight through to the stored
     roster. There is no Save button for it: an unsaved tick is a tick that
     silently did nothing, and the whole point is that the board stops
     calling these people idle. */
  async function savePicks(next) {
    const base = saved || (preview ? { ...preview, savedAt: Date.now() } : null);
    if (!base) return;
    setPickBusy(true);
    const toStore = { ...base, projectPicks: next, savedAt: Date.now() };
    try {
      await storageSet(`roster:${base.date || date}`, JSON.stringify(toStore));
      setSaved(toStore);
      if (!editing) setText(toStore.raw || text);
    } catch {
      showToast("Could not save — check the database connection.", "bad");
    }
    setPickBusy(false);
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
        <p className="text-sm text-slate-600 mt-1.5 max-w-3xl">
          A project crew and the daily ops team are two different jobs and were being counted as
          one: a project crew has no daily task naming them, so the board called five working
          people idle and the day looked half empty. Tick them off in <b>Who is on a project
          today</b> below — nothing needs adding to the shift message. If whoever writes it does
          use a <b>Project team</b> heading, those names are read from it automatically.
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
            placeholder={"*Shift Timings for 02/09/2026*\n\nWeek off - Riyaz\nPH - Imtiaz\nFujairah - Faizal\n\n*Daily ops*\n9.00am - 6.00pm\nResty\nVitalis\nJabbar\n\n*Project team*\nAdi, Khaled, Nizar, Shafiq & Bijaya\n\nStand-by Emergency Tech 11.00pm - 2.00am\nAnthony +971 50 260 6632\n\n*Coordinators Shift*\nHaris - 8.00 am - 5.00 pm\nTiyana - 2.00 pm - 11.00 pm"}
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

      {active && (
        <ProjectCrewPanel
          summary={rosterSummary(active)}
          picks={(saved && saved.projectPicks) || []}
          projects={projects}
          onChange={savePicks}
          busy={pickBusy}
        />
      )}

      <Team jobs={jobs} showToast={showToast} />

      <GoLivePanel showToast={showToast} />

      <AccessPanel
        authRequired={authRequired} setAuthRequired={setAuthRequired}
        session={session} showToast={showToast}
      />

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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
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
        <Tile label="Coordinators on" value={s.coordinatorCount || "—"}
              sub={s.coordinatorHours ? `${s.coordinatorHours}h of desk cover` : "none in the message"}
              note={[
                ...(s.coordinators || []).filter((c) => c.range).map((c) => `${c.name} ${c.range.label}`),
                ...(s.coordinatorsOff || []).map((n) => `${n} — off`),
              ].join(" · ")}
              small tone={s.coordinatorCount ? "neutral" : "warn"} />
        <Tile label="On projects" value={s.projectTeam.length || "—"}
              sub={s.projectTeam.join(", ") || "nobody on a job card"}
              note="working a quoted job that runs for days — not idle"
              small />
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

/* ==================== signing in ==================== *
 * Turning a login screen on before email delivery is proven locks the
 * department out of the tool they run their day on, and the only way back
 * would be a redeploy. So this will not let you enable it until a real
 * code has arrived in a real inbox.
 * ================================================== */

/* ==================== where the record starts ==================== *
 * A month of real history was imported so the metrics had something to
 * stand on. It is not a backlog — nothing in it was ever closed out,
 * because closing out did not exist yet. Without a line the app treated all
 * of it as work still owed, and offered to bring 110 August jobs onto the
 * first day the department meant to start clean.
 * ================================================================= */
function GoLivePanel({ showToast }) {
  const [date, setDate] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    readGoLive().then((d) => { if (!off) { setDate(d); setSaved(d); } }).catch(() => {});
    return () => { off = true; };
  }, []);

  async function save() {
    setBusy(true);
    try {
      const v = await setGoLive(date);
      setSaved(v);
      showToast(`Records start ${v}. Anything before it is history, not a backlog.`, "ok");
    } catch (e) {
      showToast(e.message || "That date did not look right.", "warn");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-medium text-slate-900">Where the record starts</h3>
      <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
        Days before this date are treated as history: they still count on the dashboard, and the
        trends and technician times are built from them — but they never roll over, never appear as
        jobs that were left open, and are never offered to be brought forward. Days from this date
        on are live, and every rule applies.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-500">
          Records start
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                 className="mt-0.5 block border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <button onClick={save} disabled={busy || !date || date === saved}
                className="text-sm bg-slate-900 text-white rounded-md px-3 py-1.5 disabled:opacity-40">
          Save
        </button>
        {saved && (
          <span className="text-[11px] text-slate-500">
            Currently {saved}. The imported month (18 Aug – 1 Sep) sits behind it.
          </span>
        )}
      </div>
    </div>
  );
}

function AccessPanel({ authRequired, setAuthRequired, session, showToast }) {
  const [email, setEmail] = useState(session?.user?.email || "");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [proved, setProved] = useState(!!session);
  const [staff, setStaff] = useState(null);

  /* Read the team list so the panel can say, before the switch is thrown,
     whether signing in will land people under the names the board already
     uses. It is the one thing that cannot be undone quietly: a coordinator
     whose address does not match their team row starts writing history
     under a different name, and their past work stops adding up.
     
     The team list sits further down the same screen, so it is re-read when
     that list announces a save — otherwise the count sits at zero while
     somebody types addresses in directly below it and wonders why. */
  useEffect(() => {
    let off = false;
    const read = async () => {
      const raw = await storageGet("staff");
      if (off) return;
      try {
        const list = raw ? JSON.parse(raw) : null;
        // An empty stored list means the same thing as no stored list: the
        // seed is what the team list will show, so count against that.
        setStaff(list && list.length ? list : seedStaff());
      } catch { setStaff(seedStaff()); }
    };
    read();
    window.addEventListener("dhh-staff-saved", read);
    return () => { off = true; window.removeEventListener("dhh-staff-saved", read); };
  }, []);

  const people = (staff || []).filter((x) => x.active !== false);
  /* Turning sign-in ON is open to anybody, because until it is on there is
     no verified identity to check and the "prove a code arrives" gate is
     the real protection. Turning it OFF once it is on is the one control
     restricted to an administrator — otherwise anyone signed in could
     quietly reopen the app to the world. */
  const me = session ? identityFor(session, staff || []) : null;
  const canTurnOff = !!(me && me.admin);
  const admins = people.filter((x) => x.admin).map((x) => x.name);
  const withEmail = people.filter((x) => squash(x.email));
  const officeNoEmail = people.filter((x) => x.role === "office" && !squash(x.email));

  async function test() {
    setBusy(true); setErr(""); setMsg("");
    const r = await sendCode(email);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setStage("code");
    setMsg(`Code sent to ${email}. Check the inbox — including spam.`);
  }

  async function confirm() {
    setBusy(true); setErr("");
    const r = await verifyCode(email, code);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setProved(true); setStage("idle"); setCode("");
    setMsg("That worked. Email delivery is working, so the sign-in gate is safe to turn on.");
  }

  async function toggle(on) {
    await persistAuthRequired(on);
    setAuthRequired(on);
    showToast(on ? "Sign-in is now required." : "Sign-in is off — anyone with the link can use the app.", "ok");
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-medium text-slate-900">Signing in</h3>
      <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
        With this on, everyone signs in with their work email and a one-time code, and every
        change on the board carries a verified name rather than a typed one. It is off until
        somebody proves a code actually arrives — a login screen nobody can get past would take
        the whole department's day with it.
      </p>

      <div className={`mt-2 rounded-md border p-2.5 ${authRequired ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`font-medium ${authRequired ? "text-emerald-900" : "text-amber-900"}`}>
            {authRequired ? "Sign-in required" : "Sign-in is OFF"}
          </span>
          <span className={authRequired ? "text-emerald-800" : "text-amber-800"}>
            {authRequired
              ? `Only people with an address added in Supabase can open the app. Switching it back off is ${admins.length ? `${admins.join(", ")}'s` : "an administrator's"} to do.`
              : "Anyone with the link can open the app and change the board."}
          </span>
          <div className="ml-auto flex gap-1.5">
            {!authRequired && (
              <button onClick={() => toggle(true)} disabled={!proved}
                      title={proved ? "" : "Send yourself a code first — this stays disabled until one arrives."}
                      className="text-xs bg-slate-900 text-white rounded-md px-2.5 py-1 disabled:opacity-40">
                Turn sign-in on
              </button>
            )}
            {authRequired && (
              <button onClick={() => toggle(false)} disabled={!canTurnOff}
                      title={canTurnOff ? "" :
                        `Only an administrator can switch sign-in off${admins.length ? ` — ${admins.join(", ")}` : ""}. If nobody can, see docs/ACCESS.md for the one-line SQL.`}
                      className="text-xs border border-slate-300 bg-white rounded-md px-2.5 py-1 disabled:opacity-40">
                Turn it off
              </button>
            )}
          </div>
        </div>
        {!authRequired && !proved && (
          <p className="text-[11px] text-amber-800 mt-1.5">
            The button unlocks once you have received and entered a code below. Before that, see
            docs/ACCESS.md — Supabase needs email enabled, an SMTP sender configured, and each
            person invited.
          </p>
        )}
      </div>

      {staff && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
          <div className="text-[11px] font-medium text-slate-700">Before you turn it on</div>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            <li className={withEmail.length === people.length ? "text-emerald-800" : "text-amber-800"}>
              {withEmail.length === people.length ? "✓" : "!"}{" "}
              <b>{withEmail.length} of {people.length}</b> on the team have a work email recorded.
              {withEmail.length < people.length && (
                <> Without it, signing in files their work under a name taken from the address —
                  so <i>kajamohideen.mugusin@…</i> becomes “Kajamohideen Mugusin” while every
                  schedule says “Kaja”, and the two never add up. Add them in the <b>Work email</b> column of the team list above.</>
              )}
            </li>
            {officeNoEmail.length > 0 && (
              <li className="text-amber-800">
                ! The coordinators are the ones who will use this most:{" "}
                <b>{officeNoEmail.map((x) => x.name).join(", ")}</b> still have no address.
              </li>
            )}
            <li className="text-slate-600">
              · Everyone who should get in must also be invited in Supabase — the app only sends a
              code to an address that already exists there.
            </li>
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-500 flex-1 min-w-[200px]">
          Send a test code to
          <input type="email" name="access-test-email" value={email}
                 onChange={(e) => setEmail(e.target.value)}
                 placeholder="you@deluxehomes.com"
                 className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>
        <button onClick={test} disabled={!email.trim() || busy}
                className="text-sm border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40">
          {busy && stage !== "code" ? "Sending…" : "Send test code"}
        </button>
        {stage === "code" && (
          <>
            <label className="text-[11px] text-slate-500 w-28">
              Code
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
                     className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm tracking-widest" />
            </label>
            <button onClick={confirm} disabled={!code.trim() || busy}
                    className="text-sm bg-slate-900 text-white rounded-md px-3 py-1.5 disabled:opacity-40">
              Check it
            </button>
          </>
        )}
      </div>

      {msg && <p className="mt-2 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">{msg}</p>}
      {err && <p className="mt-2 text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</p>}

      {session && (
        <p className="mt-2 text-[11px] text-slate-500">
          Signed in as <span className="text-slate-800">{session.user?.email}</span>.
          <button onClick={async () => { await signOut(); window.location.reload(); }}
                  className="ml-1.5 underline hover:text-slate-800">sign out</button>
        </p>
      )}
    </div>
  );
}

/* ==================== the team ==================== *
 * Who these people are, as distinct from who is in today. A painter, a
 * carpenter who cannot drive, a pool cleaner based in Fujairah — none of
 * which the board knew, and all of which decide whether an assignment
 * makes sense.
 * ================================================== */

function Team({ jobs, showToast }) {
  const [staff, setStaff] = useState(null);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await storageGet("staff");
      let list = null;
      try { list = raw ? JSON.parse(raw) : null; } catch { list = null; }
      if (!list || !list.length) {
        list = seedStaff();
        await storageSet("staff", JSON.stringify(list));
        window.dispatchEvent(new CustomEvent("dhh-staff-saved"));
      } else {
        /* The list was stored before it had an email column, so the seed
           alone would never reach it. Fill in what is missing, leave alone
           what somebody typed, and write back only if anything changed. */
        const back = backfillStaff(list);
        list = back.list;
        if (back.changed) {
          await storageSet("staff", JSON.stringify(list));
          window.dispatchEvent(new CustomEvent("dhh-staff-saved"));
        }
      }
      setStaff(list);
    })();
  }, []);

  /* Somebody joins, and there is no reason that should need a developer. */
  function addPerson() {
    const name = squash(window.prompt("Name of the person to add") || "");
    if (!name) return;
    if ((staff || []).some((x) => canonKey(x.name) === canonKey(name))) {
      showToast(`${name} is already on the team list.`, "warn");
      return;
    }
    save([...(staff || []), normaliseStaff({ name, trade: "multi_tech", base: "Dubai", licence: null, role: "field" })]);
    showToast(`${name} added. Set their trade, licence and work email on the row.`, "ok");
  }

  const idx = useMemo(() => (staff ? staffIndex(staff) : null), [staff]);
  const crewing = useMemo(() => (idx ? checkDayCrewing(jobs, idx) : null), [idx, jobs]);

  async function save(next) {
    setSaving(true);
    setStaff(next);
    await storageSet("staff", JSON.stringify(next));
    // The sign-in readiness check above this list counts recorded emails.
    window.dispatchEvent(new CustomEvent("dhh-staff-saved"));
    setSaving(false);
  }

  function applyPaste() {
    const { parsed, unreadable } = parseStaffMessage(paste);
    if (!parsed.length) { showToast("Nothing readable in that paste.", "warn"); return; }
    save(mergeStaff(staff || [], parsed));
    setPaste(""); setShowPaste(false);
    showToast(
      `Updated ${parsed.length} people${unreadable.length ? `, ${unreadable.length} line(s) not understood` : ""}.`,
      "ok"
    );
  }

  if (!staff) return null;
  const field = staff.filter((s) => s.role !== "office");
  const office = staff.filter((s) => s.role === "office");
  const licenceGaps = field.filter((s) => s.licence === null);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-slate-900">The team</h3>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Trade and driving licence decide whether an assignment makes sense — a pool needs the
            pool cleaner's equipment, and a crew where nobody drives cannot reach the property.
            This is the same list for every day; the roster above is who is in today.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={addPerson}
                  className="text-xs bg-slate-900 text-white rounded-md px-2.5 py-1.5">
            Add someone
          </button>
          <button onClick={() => setShowPaste((v) => !v)}
                  className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-50">
            {showPaste ? "Close" : "Paste team details"}
          </button>
        </div>
      </div>

      {showPaste && (
        <div className="mt-2">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5}
                    placeholder={"Khaled- Painter dubai without licence\nFaizal- Pool cleaner in fujierah with drivers licence"}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono" />
          <button onClick={applyPaste} disabled={!paste.trim()}
                  className="mt-1.5 text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
            Update the team from this
          </button>
          <p className="text-[11px] text-slate-500 mt-1">
            Only what a line actually says is changed — anything it does not mention is left alone.
          </p>
        </div>
      )}

      {licenceGaps.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Driving licence not recorded for <span className="font-medium">{licenceGaps.map((s) => s.name).join(", ")}</span>.
          Until it is, the board cannot tell you when a crew has no way of getting to site.
        </p>
      )}

      {crewing && (crewing.short.length > 0 || crewing.wrongTrade.length > 0 || crewing.noDriver.length > 0) && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs">
          <div className="font-medium text-red-900">Crewing problems on this day's schedule</div>
          <ul className="mt-1 space-y-0.5 text-red-800">
            {crewing.short.length > 0 && (
              <li>
                <span className="font-medium">{crewing.short.length} job(s) short-crewed</span> —{" "}
                {crewing.short.slice(0, 3).map((x) => `${x.job.property} ${x.job.unit} (${x.crew.length}/${x.requirement.people})`).join(", ")}
                {crewing.short.length > 3 && `, +${crewing.short.length - 3} more`}
              </li>
            )}
            {crewing.wrongTrade.length > 0 && (
              <li>{crewing.wrongTrade.length} job(s) want a specialist who is not on the crew</li>
            )}
            {crewing.noDriver.length > 0 && (
              <li className="font-medium">{crewing.noDriver.length} crew(s) with nobody who can drive</li>
            )}
          </ul>
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left font-medium py-1.5">Name</th>
              <th className="text-left font-medium py-1.5">Trade</th>
              <th className="text-left font-medium py-1.5">Based</th>
              <th className="text-left font-medium py-1.5">Drives</th>
              <th className="text-left font-medium py-1.5">Work email</th>
              <th className="text-left font-medium py-1.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {field.concat(office).map((sRec, i) => (
              <StaffRow key={sRec.name + i} rec={sRec}
                        onChange={(next) => save(staff.map((x) => (x.name === sRec.name ? normaliseStaff({ ...x, ...next }) : x)))} />
            ))}
          </tbody>
        </table>
      </div>
      {saving && <span className="text-[11px] text-slate-400">saving…</span>}
    </div>
  );
}

function StaffRow({ rec, onChange }) {
  return (
    <tr className={`border-b border-slate-100 ${rec.role === "office" ? "bg-slate-50/60" : ""}`}>
      <td className="py-1 text-slate-800 font-medium">{rec.name}</td>
      <td className="py-1">
        <select value={rec.trade} onChange={(e) => onChange({ trade: e.target.value })}
                className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-transparent">
          {TRADES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </td>
      <td className="py-1">
        <input value={rec.base} onChange={(e) => onChange({ base: e.target.value })}
               className="border border-slate-200 rounded px-1 py-0.5 text-xs w-24 bg-transparent" />
      </td>
      <td className="py-1">
        <select value={rec.licence === true ? "y" : rec.licence === false ? "n" : ""}
                onChange={(e) => onChange({ licence: e.target.value === "y" ? true : e.target.value === "n" ? false : null })}
                className={`border rounded px-1 py-0.5 text-xs bg-transparent ${
                  rec.licence === null ? "border-amber-300 text-amber-700" : "border-slate-200"}`}>
          <option value="">not recorded</option>
          <option value="y">yes</option>
          <option value="n">no</option>
        </select>
      </td>
      <td className="py-1">
        <input type="email" value={rec.email || ""} onChange={(e) => onChange({ email: e.target.value })}
               placeholder="—"
               className={`border rounded px-1 py-0.5 text-xs w-44 bg-transparent ${
                 rec.role === "office" && !rec.email ? "border-amber-300" : "border-transparent hover:border-slate-200 focus:border-slate-300"}`} />
      </td>
      <td className="py-1 text-slate-500">
        <input value={rec.note} onChange={(e) => onChange({ note: e.target.value })}
               placeholder="—"
               className="border border-transparent hover:border-slate-200 focus:border-slate-300 rounded px-1 py-0.5 text-xs w-full bg-transparent" />
      </td>
    </tr>
  );
}

/* ====================================================================== *
 * Who is on a project today.
 *
 * The project crew was originally read from a "Project team" heading in the
 * shift message. That was wrong in practice: the shift message arrives from
 * somebody else on WhatsApp, so adding a heading means hand-editing it
 * every morning — precisely the extra daily step that stops happening after
 * a week, and there was no visible place to do it either.
 *
 * So the crew is ticked off here instead, from the names the roster already
 * knows. A project crew has no daily job naming them, so without this the
 * board calls them idle and the day looks half empty. Naming the project as
 * well is optional and does one further thing: their hours roll into that
 * project's own cost rather than disappearing into the daily total.
 * ====================================================================== */
function ProjectCrewPanel({ summary, picks, projects, onChange, busy }) {
  const chosen = new Map((picks || []).map((p) => [canonKey(p.name), p]));

  /* Everyone the roster says is working today. Somebody on leave cannot be
     on a project, so they are not offered. */
  const candidates = Array.from(new Set([
    ...(summary.onShift || []),
    ...(summary.standby || []),
    ...(summary.offsite || []),
    ...(picks || []).map((p) => p.name),
  ])).filter(Boolean).sort();

  const live = (projects || []).filter((p) => p.status !== "completed" && p.status !== "cancelled");

  function toggle(name) {
    const k = canonKey(name);
    onChange(chosen.has(k)
      ? (picks || []).filter((p) => canonKey(p.name) !== k)
      : [...(picks || []), { name, projectId: "" }]);
  }

  function setProject(name, projectId) {
    const k = canonKey(name);
    onChange((picks || []).map((p) => (canonKey(p.name) === k ? { ...p, projectId } : p)));
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-slate-900">Who is on a project today</h3>
      <p className="text-xs text-slate-500 mt-0.5 mb-2.5 max-w-3xl">
        A project crew works a quoted job that runs for days, so no daily task names them and the
        board would otherwise count them idle. Tick them here — there is nothing to add to the
        shift message. If the message already carries a <b>Project team</b> heading, those names
        are picked up on their own and appear ticked.
      </p>

      {candidates.length === 0 ? (
        <p className="text-xs text-slate-400">
          Nobody on the roster yet — paste the shift message first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {candidates.map((name) => {
            const on = chosen.has(canonKey(name));
            return (
              <button key={name} onClick={() => toggle(name)} disabled={busy}
                      className={`text-xs rounded-full border px-2.5 py-1 disabled:opacity-50 ${
                        on ? "bg-slate-900 text-white border-slate-900"
                           : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                {on && "✓ "}{name}
              </button>
            );
          })}
        </div>
      )}

      {chosen.size > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] text-slate-500">
            Which project? Optional — naming it rolls their hours into that project's own cost
            instead of the daily total.
          </p>
          {Array.from(chosen.values()).map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="text-xs text-slate-700 w-28 shrink-0">{p.name}</span>
              <select value={p.projectId || ""} onChange={(e) => setProject(p.name, e.target.value)}
                      className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white flex-1 max-w-sm">
                <option value="">not saying which</option>
                {live.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {[squash(pr.property), squash(pr.unit), squash(pr.title)].filter(Boolean).join(" ").slice(0, 60)}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {live.length === 0 && (
            <p className="text-[11px] text-slate-400">
              No open projects on the Projects tab yet, so there is nothing to attach them to.
              Ticking them still keeps them out of the idle list.
            </p>
          )}
        </div>
      )}
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
