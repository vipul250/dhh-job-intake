import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus, Check, AlertTriangle, X,
  ClipboardList, Database, BarChart3, Loader2,
  ChevronRight, ChevronLeft, RefreshCw, TrendingUp, Briefcase, Clock, Building2, Radio, Users, Inbox
} from "lucide-react";
import { storageGet, storageSet, storageList } from "./lib/storage.js";
import Dashboard from "./views/Dashboard.jsx";
import LiveBoard from "./views/LiveBoard.jsx";
import Projects from "./views/Projects.jsx";
import Roster from "./views/Roster.jsx";
import Backlog from "./views/Backlog.jsx";
import SignIn from "./views/SignIn.jsx";
import { isAuthRequired, currentSession, onAuthChange, signOut } from "./lib/auth.js";
import { mutateDay } from "./lib/jobStore.js";

import { needsGuestConfirmation, squash } from "./lib/normalize.js";


/* ---------------------------------------------------------------------- *
 * SEED DATA — the Fault Code Master, ships pre-loaded on first run.
 * Anyone can add rows later from the "Fault Codes" tab; it lives in
 * shared storage so every user of this board sees the same master.
 * ---------------------------------------------------------------------- */
const FAULT_MASTER_SEED = [
  ["LOCK-RESET", "Remove branding/QR + reset smart lock", "Adhesive scraper, heat gun, screwdriver set, smart lock programming device/app", "Adhesive remover, replacement lock batteries", "Access Control", "Housekeeping"],
  ["AC-NOCOOL", "AC not cooling / not working", "AC toolkit, multimeter, refrigerant gauges, insulated screwdriver set, capacitor tester", "Capacitor/fuse (per diagnosis), refrigerant (if low charge confirmed), electrical tape", "AC", "Maintenance"],
  ["AC-NOISE", "AC making noise", "AC toolkit, multimeter, refrigerant gauges, coil cleaning brush, inspection torch", "Capacitor, fan belt/bearing, motor lubricant, coil cleaner", "AC", "Maintenance"],
  ["AC-LEAK", "AC condensate leak / ceiling stain from AC", "Ladder, wet-dry vacuum/drain snake, moisture meter, multimeter, sealant gun", "Stain-block primer + paint, condensate drain cleaner/tablets, silicone sealant", "AC", "Maintenance"],
  ["AC-PPM", "AC planned preventive maintenance", "AC service toolkit, multimeter, coil cleaning brush, condensate line check kit, filter gauge", "Replacement filter (if due), coil cleaner, lubricant", "AC", "Maintenance"],
  ["AC-VENT", "AC vent issue", "Screwdriver set, vent adjustment tool, vacuum with vent attachment", "Vent cover/damper replacement parts if broken, filter if clogged", "AC", "Maintenance"],
  ["AC-DUCT-CLEAN", "AC duct cleaning", "Duct brush kit, vacuum with duct attachment, inspection borescope, PPE (mask/gloves)", "Duct sanitizer/cleaning chemical, replacement filter, duct tape/sealant", "AC", "Maintenance"],
  ["WH-FAULT", "Water heater not working / no hot water", "Multimeter, voltage tester, pipe wrench, pressure gauge", "Heating element/thermostat (per diagnosis), anode rod (if corroded), pressure relief valve", "Plumbing/Electrical", "Maintenance"],
  ["PLUMB-LEAK-CEIL", "Ceiling water leak (non-AC source)", "Ladder, moisture meter, drain snake/auger, sealant gun, borescope", "Waterproof sealant, ceiling patch compound, stain-block primer + paint, PTFE tape", "Plumbing", "Maintenance"],
  ["PLUMB-DRAIN", "Blocked drain — assess priority: non-functional = immediate, minor drip = can schedule next day", "Plunger, plumber's snake/hand auger, pipe wrench, bucket", "Enzyme drain cleaner, PTFE tape, P-trap gasket/washer", "Plumbing", "Maintenance"],
  ["PLUMB-FIXTURE", "Showerhead / shattaf / tap / toilet fixture fault", "Adjustable/basin wrench, PTFE tape applicator, screwdriver set", "Replacement showerhead/shattaf/seat, PTFE tape", "Plumbing", "Maintenance"],
  ["PIPE-INSULATION-REPLACE", "Chilled water / pipe insulation damaged", "Pipe insulation cutting knife, tape measure, adjustable wrench", "Matching diameter pipe insulation, insulation tape", "Plumbing/HVAC", "Maintenance"],
  ["DOOR-LOCK-FAIL", "Door lock mechanism not working / needs replacement", "Screwdriver set, cordless drill, chisel, tape measure", "Door lock set/mechanism, strike plate, mounting screws", "Door Hardware - Security", "Maintenance"],
  ["DOOR-HANDLE", "Door handle fault", "Screwdriver set, cordless drill, tape measure", "Replacement handle/lockset, mounting screws", "Door Hardware", "Maintenance"],
  ["DOOR-ALIGN", "Door not closing properly / hinge misalignment / hard to open", "Screwdriver set, adjustable wrench, hinge alignment tool, sander", "Hinge screws, weatherstrip seal, lubricant spray", "Door Hardware", "Maintenance"],
  ["ACCESS-PANEL-INSTALL", "New access panel install (ceiling/wall)", "Hacksaw/panel cutting tool, drill, tape measure, putty knife", "Access panel (size per spec), gypsum putty, screws", "Carpentry/Finishing", "Maintenance"],
  ["FURN-DRAWER", "Drawer/cabinet fault", "Screwdriver set, drill, wood glue clamp, chisel, sandpaper", "Drawer slides/runners, wood glue, screws, cabinet hardware", "Carpentry", "Maintenance"],
  ["FURN-GEN", "Furniture fault (chair/table leg, shoe rack etc.)", "Screwdriver set, wood glue clamp, sandpaper", "Wood glue, replacement leg/dowel/brackets, screws", "Carpentry", "Maintenance"],
  ["CARPENTRY-HINGE", "Hinge repair/alignment (wardrobe, cabinets)", "Screwdriver set, chisel, wood glue clamp", "Hinge hardware, screws, wood filler", "Carpentry", "Maintenance"],
  ["CARPENTRY-GEN", "Carpentry issue - unspecified", "General carpentry kit: screwdriver set, wood glue, sandpaper, wood filler, screws, chisel", "Wood filler, wood glue, screws - confirm exact scope on site", "Carpentry", "Maintenance"],
  ["CURTAIN-REPAIR", "Curtain / curtain track repair/install — per Jul-13 policy: Inventory/Warehouse handles; Maintenance assists ONLY when a long ladder is required (e.g. Palm Villas)", "Screwdriver set, ladder, curtain track tools", "Curtain track brackets/hooks/runners", "Soft Furnishing", "Inventory/Warehouse"],
  ["PAINT-WALL", "Wall or ceiling painting / touch-up", "Paint roller/brush, masking tape, drop cloth, sandpaper", "Matching paint, primer (if patching), masking tape", "Painting", "Maintenance"],
  ["CEIL-COSMETIC", "Ceiling cosmetic patch (no active leak)", "Putty knife, sandpaper, paint roller/brush", "Filler/putty, primer, matching paint", "Painting/Finishing", "Maintenance"],
  ["SILICONE-RESEAL", "Bathroom silicone/sealant replacement", "Caulking gun, utility knife/scraper, masking tape", "Mold-resistant silicone sealant", "Plumbing/Finishing", "Maintenance"],
  ["POOL-CLEAN", "Pool cleaning — checklist required: chlorine level, pH, pump check", "Telescopic pole, skimmer net, pool brush, vacuum/robotic cleaner, water test kit", "Chlorine tablets, pH balancer, algaecide, filter cleaner", "Pool Maintenance", "Maintenance"],
  ["ELEC-LIGHT", "Light fixture not working", "Voltage tester, screwdriver set, ladder, non-contact voltage detector", "Bulb/LED (matching fitting), fuse, wire connectors", "Electrical", "Maintenance"],
  ["ELEC-SOCKET-TEST", "Socket/power issue — FIRST STEP per Jul-13 policy: field staff run basic voltage-tester diagnosis before any technician is dispatched", "Voltage tester (basic, carried by field staff)", "None — diagnostic step only", "Electrical", "Guest Relations"],
  ["ELEC-SOCKET", "Faulty socket/switch — CONFIRMED replacement needed after field-staff testing ruled out a simple fix", "Voltage tester, screwdriver set, wire strippers, insulated pliers", "Socket/switch + wall plate, wire connectors", "Electrical", "Maintenance"],
  ["ELEC-THERMOSTAT", "Thermostat replacement/configuration", "Screwdriver set, voltage tester, wire strippers, drill", "Thermostat unit, wire connectors, mounting screws/anchors, batteries", "Electrical - AC Control", "Maintenance"],
  ["ELEC-INSTALL", "Light/fixture installation (new, non-fault)", "Drill, wire strippers, voltage tester, spirit level", "Fixture/strip lights, driver/transformer, mounting brackets, wire connectors", "Electrical - Install", "Maintenance"],
  ["BATH-ACCESSORY", "Bathroom accessory fault (towel holder etc.)", "Cordless drill, screwdriver set, wall anchor setting tool", "Replacement accessory, wall anchors/screws", "Finishing", "Maintenance"],
  ["SAFE-BOX-BATTERY", "Safe box battery replacement — per Jul-13 policy: field staff (GRO/HK) with a basic screwdriver, not a technician dispatch", "Small screwdriver (basic kit carried by field staff)", "Safe box battery (size per unit model)", "Guest Room Amenities", "Guest Relations"],
  ["SMALL-APPLIANCE-MINOR", "Minor small-appliance fault (kettle, coffee machine, microwave, toaster, clock) — per Jul-13 policy: replace, don't repair, unless genuinely major", "None — swap the unit", "Replacement small appliance (same spec)", "Small Appliances", "Housekeeping"],
  ["LARGE-APPLIANCE-FAULT", "Large appliance fault (fridge, oven, dishwasher) — confirm it isn't guest/user error before dispatch (e.g. igniter confusion, not a mechanical fault)", "Appliance-specific toolkit, multimeter", "Replacement part per diagnosis", "Large Appliances", "Maintenance"],
  ["SAFETY-GAS-ALARM", "Gas detector alarming - SAFETY CRITICAL", "Certified independent gas leak detector/sniffer, multimeter, ladder", "Replacement gas detector/sensor, batteries", "SAFETY - independent gas test required before any action", "Maintenance"],
  ["SAFETY-SMOKE-CO", "Smoke/CO detector alarm - SAFETY CRITICAL", "CO meter, smoke test aerosol, ladder, multimeter", "Replacement detector/sensor, batteries", "SAFETY - verify before disabling any alarm", "Maintenance"],
  ["ODOR-INVESTIGATION", "Bad smell - undiagnosed", "Moisture meter, inspection borescope, sewage trap test kit, PPE, gas detector as precaution", "Enzyme odor treatment, P-trap water top-up, sewer trap seal, pest referral if needed", "Investigation", "Maintenance"],
  ["INSPECTION-GEN", "General inspection - full appliance sweep (AC, water heater, electrical, plumbing)", "Inspection tablet, flashlight, moisture meter, voltage tester, multimeter, water pressure gauge, camera", "None anticipated - carry spare filter/bulb/battery as contingency", "Inspection", "Maintenance"],
  ["INSPECTION-ONB", "Onboarding baseline inspection — feeds a Job Card: set an estimated completion date and quotation ref once scoped", "Same as INSPECTION-GEN plus tape measure, ladder", "None for inspection itself", "Onboarding - gates portfolio entry", "Maintenance"],
  ["APPLIANCE-INSTALL", "Appliance installation (washing machine etc.)", "Spirit level, adjustable wrench, screwdriver set, voltage tester, water pressure gauge", "Inlet/drain hose kit, isolation valve fittings, Teflon tape, anti-vibration pads", "Appliance Installation", "Maintenance"],
  ["WORKS-QUOTED", "Approved quotation-driven work - variable scope. Set quotation ref + estimated completion date — this becomes a Job Card.", "Confirm against quotation before dispatch", "Confirm against quotation and warehouse stock before dispatch", "Approved Works - Scope Variable", "Maintenance"],
  ["SCOPE-UNKNOWN", "Referenced report/description not attached - scope unclear", "Cannot specify until source document is attached", "Cannot specify until source document is attached", "BLOCKED - attach the referenced document before dispatch", "Maintenance"],
  ["HANDOVER-VERIFY", "Handover photo/completion verification", "Camera/tablet, checklist", "None", "Verification", "Guest Relations"],
  ["PREP-OWNER", "Owner arrival preparation", "Inspection checklist, camera", "Welcome amenities per SOP, linen if swap required", "Owner Prep", "Guest Relations"],
  ["ACCESS-CARD-COLLECT", "Collect access card from office before visit", "None beyond standard kit for the paired task", "Access card (collect from office first)", "Logistics", "Guest Relations"],
].map(([code, description, tools, materials, category, defaultOwnerTeam]) => ({
  code, description, tools, materials, category, defaultOwnerTeam: defaultOwnerTeam || "Maintenance",
}));

const OWNER_TEAM_OPTIONS = ["Maintenance", "Housekeeping", "Guest Relations", "Inventory/Warehouse"];
const OWNER_TEAM_COLORS = {
  "Maintenance": "bg-slate-100 text-slate-700 border-slate-300",
  "Housekeeping": "bg-purple-50 text-purple-700 border-purple-300",
  "Guest Relations": "bg-sky-50 text-sky-700 border-sky-300",
  "Inventory/Warehouse": "bg-teal-50 text-teal-700 border-teal-300",
};
const JOB_STATUS_OPTIONS = ["Open", "In Progress", "Blocked", "Completed"];
const BLOCK_REASON_OPTIONS = ["Permit denied", "Access denied", "Material unavailable", "Awaiting owner approval", "Other"];

/* ---------------------------------------------------------------------- *
 * PROPERTY MASTER — seeded from every building/community referenced
 * across the schedules and PMS screenshots reviewed in this project.
 * This is a STARTER list, not the full 850-property portfolio — all
 * seeded entries are tagged Dubai because no Fujairah property was ever
 * named in the source material. The admin adds the rest (Section on
 * Properties tab explains this explicitly so nobody mistakes it for complete).
 * Entries are building/community level — the specific unit still goes in
 * the separate Unit field on each job.
 * ---------------------------------------------------------------------- */
const PROPERTY_MASTER_SEED = [
  "Paramount Tower Hotel and Residences", "Bayz Tower", "Burj Royale", "Prive by Damac",
  "Iris Blue", "5242 Tower 1", "Palm Villa", "Marina Vista Tower 1", "Dubai Marina Mall Hotel",
  "La Vie", "Damac Hills 2 - Amazonia", "Damac Hills 2 - Victoria", "Miraclz Tower by Danube",
  "Azizi Riviera 43", "Azizi Riviera 18", "Azizi Riviera 17", "Azizi Riviera 36", "Azizi Riviera 4",
  "LIVA", "Binghatti House", "Socio Tower 1", "Binghatti Tulip", "Harbour Views Tower 1",
  "Harbour Views Tower 2", "Dunya Tower", "Binghatti Gateway", "Myrtle", "Safeer Tower 1",
  "Merano", "Marina Star T2", "Damac Heights", "VIDA Residences Dubai Marina", "Torch Tower",
  "Claren Tower 2", "Zada Tower", "Victoria Residency", "The Nook 1-1", "Celestia A",
  "Al Jawhara Tower", "The Residence at Marina Gate 2", "Marina Heights", "Burj Crown",
  "Mudon Views 4", "The Dubai Creek Residences South Tower 1", "Gemz by Danube",
  "Golf Promenade 2A", "Nad Al Shiba Third", "Binghatti Stars", "Alvorada 4", "Golf Views A",
  "Jumeirah Golf Estates", "The Palm Tower", "Dubai Gate-2", "Lake City Tower", "Le Pont 1",
  "Sadaf 6", "The One JBR", "Adhara Star", "Lincoln Park A", "Mediterranean", "Downtowns Views 1",
  "The Signature",
].map((name) => ({ name, emirate: "Dubai", notes: "" }));

const EMIRATE_OPTIONS = ["Dubai", "Fujairah"];

const STATUS_OPTIONS = [
  "Vacant", "Occupied - GC", "Check-in", "Checkout", "B2B",
  "Onboarding", "Owner-Prep", "Handover", "Property-Blocked", "Other",
];
const PRIORITY_OPTIONS = ["PRI-1", "PRI-2", "PRI-3", "PRI-4"];
const PRIORITY_LABEL = {
  "PRI-1": "PRI-1 · Safety / urgent",
  "PRI-2": "PRI-2 · Active defect, guest or water risk",
  "PRI-3": "PRI-3 · Needs attention, no immediate risk",
  "PRI-4": "PRI-4 · Routine / cosmetic",
};
const PRIORITY_COLORS = {
  "PRI-1": { bg: "bg-red-50", border: "border-red-300", text: "text-red-700", dot: "bg-red-500" },
  "PRI-2": { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-700", dot: "bg-orange-500" },
  "PRI-3": { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-700", dot: "bg-amber-500" },
  "PRI-4": { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700", dot: "bg-emerald-500" },
};
const SHIFT_OPTIONS = ["08:00-17:00", "09:00-18:00", "10:00-19:00", "12:00-21:00", "14:00-23:00", "Custom"];

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDaysISO = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* ---------------------------------------------------------------------- *
 * Import: send the raw pasted schedule text to a Vercel serverless
 * function (/api/parse-schedule), which holds the Anthropic API key
 * server-side and makes the actual call. The old Claude-artifact version
 * called api.anthropic.com directly from the browser with no key — that
 * only works inside Claude.ai's sandbox, not on a public Vercel deploy.
 * ---------------------------------------------------------------------- */
const FIELD_MAP = { sh: "shift", tm: "team", pr: "property", un: "unit", st: "status", fc: "faultCode", ds: "description", pi: "priority", nt: "notes" };

export default function App() {
  /* The sign-in gate.
   *
   * `authRequired` is read from the database rather than compiled in, so
   * it can be switched off again from the Roster tab or with one SQL
   * statement if email delivery breaks. A login screen nobody can get past
   * would take the whole department's day with it, and a redeploy is not
   * an acceptable recovery path for that. */
  const [authRequired, setAuthRequired] = useState(null);
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [required, sess] = await Promise.all([isAuthRequired(), currentSession()]);
      if (cancelled) return;
      setAuthRequired(required);
      setSession(sess);
      setAuthChecked(true);
    })();
    const off = onAuthChange((s) => setSession(s));
    return () => { cancelled = true; off(); };
  }, []);

  const [loading, setLoading] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [faultMaster, setFaultMaster] = useState([]);
  const [propertyMaster, setPropertyMaster] = useState([]);
  const [selectedDate, setSelectedDate] = useState(addDaysISO(todayISO(), 1));
  const [jobsByDate, setJobsByDate] = useState({});
  const [knownDates, setKnownDates] = useState([]);
  const [activeTab, setActiveTab] = useState("live");
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, kind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let master = await storageGet("fault-master");
      if (master === null) {
        master = JSON.stringify(FAULT_MASTER_SEED);
        const wrote = await storageSet("fault-master", master);
        if (wrote === null) setStorageOk(false);
      }
      try {
        setFaultMaster(JSON.parse(master));
      } catch {
        setFaultMaster(FAULT_MASTER_SEED);
      }

      let propMaster = await storageGet("property-master");
      if (propMaster === null) {
        propMaster = JSON.stringify(PROPERTY_MASTER_SEED);
        const wrote = await storageSet("property-master", propMaster);
        if (wrote === null) setStorageOk(false);
      }
      try {
        setPropertyMaster(JSON.parse(propMaster));
      } catch {
        setPropertyMaster(PROPERTY_MASTER_SEED);
      }

      const keys = await storageList("schedule:");
      const dates = keys
        .map((k) => k.replace("schedule:", ""))
        .sort((a, b) => (a < b ? 1 : -1));
      setKnownDates(dates);

      const toLoad = Array.from(new Set([selectedDate, ...dates.slice(0, 14)]));
      const entries = await Promise.all(
        toLoad.map(async (d) => {
          const v = await storageGet(`schedule:${d}`);
          let arr = [];
          try { arr = v ? JSON.parse(v) : []; } catch { arr = []; }
          return [d, arr];
        })
      );
      const map = {};
      entries.forEach(([d, arr]) => { map[d] = arr; });
      setJobsByDate(map);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (jobsByDate[selectedDate] !== undefined) return;
    (async () => {
      const v = await storageGet(`schedule:${selectedDate}`);
      let arr = [];
      try { arr = v ? JSON.parse(v) : []; } catch { arr = []; }
      setJobsByDate((prev) => ({ ...prev, [selectedDate]: arr }));
    })();
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Tombstones are the records a day keeps when a job leaves it. They live
     in the same array as the jobs, so every legacy view has to filter them
     out or it will try to render a move record as a job card. */
  const jobs = useMemo(
    () => (jobsByDate[selectedDate] || []).filter((r) => !r || !r._tomb),
    [jobsByDate, selectedDate]
  );

  /* Outcomes are clicked fast — thirty jobs in a couple of minutes.
     Each save reads the job list from a render closure, and two clicks
     landing inside one render would make the second overwrite the first.
     This ref always holds the latest list, so a save is never built on a
     stale copy. */
  const jobsByDateRef = useRef(jobsByDate);
  useEffect(() => { jobsByDateRef.current = jobsByDate; }, [jobsByDate]);

  const faultByCode = useMemo(() => {
    const m = {};
    faultMaster.forEach((f) => { m[f.code] = f; });
    return m;
  }, [faultMaster]);

  const knownTeams = useMemo(() => {
    const set = new Set(["Adi, Albert, Khaled, Nizar", "Vitalis", "Shafiq & Resty", "Abdul Fazal", "Bright", "Imtiaz", "Anthony", "Abdul Riyaz"]);
    Object.values(jobsByDate).forEach((arr) => arr.forEach((j) => j.team && set.add(j.team)));
    return Array.from(set).sort();
  }, [jobsByDate]);

  const findDuplicates = useCallback((job, excludeId) => {
    return jobs.filter(
      (j) =>
        j.id !== excludeId &&
        norm(j.property) === norm(job.property) &&
        norm(j.unit) === norm(job.unit) &&
        j.faultCode === job.faultCode
    );
  }, [jobs]);

  const findCarryover = useCallback((job) => {
    const priorDates = Object.keys(jobsByDate).filter((d) => d < selectedDate).sort((a, b) => (a < b ? 1 : -1));
    for (const d of priorDates) {
      const match = (jobsByDate[d] || []).find(
        (j) =>
          norm(j.property) === norm(job.property) &&
          norm(j.unit) === norm(job.unit) &&
          j.faultCode === job.faultCode &&
          j.jobStatus !== "Completed"
      );
      if (match) return { sinceDate: d, sourceJob: match };
    }
    return null;
  }, [jobsByDate, selectedDate]);

  /* The legacy views hand back the live jobs only — they filter tombstones
     out on the way in and know nothing about them. Writing that array
     straight back would erase every record of a job having left the day,
     which is the one thing this whole design exists to preserve. So the
     write goes through the guarded mutator and re-attaches whatever
     tombstones the stored day is currently carrying. */
  async function persistJobs(date, updatedJobs) {
    const written = await mutateDay(date, (cur) => [
      ...cur.filter((r) => r && r._tomb),
      ...updatedJobs,
    ]);
    setJobsByDate((prev) => ({ ...prev, [date]: written }));
    if (!knownDates.includes(date)) {
      setKnownDates((prev) => [date, ...prev].sort((a, b) => (a < b ? 1 : -1)));
    }
  }

  async function handleSaveJob(formValue) {
    const fault = faultByCode[formValue.faultCode];
    const createdAt = formValue.createdAt || Date.now();
    const job = {
      ...formValue,
      id: formValue.id || uid(),
      tools: (formValue.tools && formValue.tools.trim()) || (fault ? fault.tools : "Fault code not found - check spelling or add to Fault Codes tab"),
      materials: (formValue.materials && formValue.materials.trim()) || (fault ? fault.materials : "Fault code not found - check spelling or add to Fault Codes tab"),
      jobStatus: formValue.jobStatus || "Open",
      createdAt,
      slaDeadline: formValue.slaApplies ? (formValue.slaDeadline || createdAt + 48 * 3600000) : null,
    };

    const dup = findDuplicates(job, job.id);
    const carry = findCarryover(job);
    job.dupFlag = dup.length > 0 ? `Duplicate: also listed for ${dup.map((d) => d.team).join(", ")} today` : "";
    job.carryFlag = carry ? `Carryover: open since ${carry.sinceDate} (${carry.sourceJob.team})` : "";

    const current = jobsByDate[selectedDate] || [];
    const idx = current.findIndex((j) => j.id === job.id);

    /* Once the day is posted, record what moved. This is what makes the
       churn number computed rather than self-reported — the equivalent
       column in the workbook is filled on 4% of rows, which measures
       nothing. Only the fields that change the field team's day are
       tracked; a typo fixed in the notes is not churn. */
    if (idx >= 0) {
      const before = current[idx];
      if (before.postedAt) {
        const WATCHED = ["team", "shift", "property", "unit", "description", "estimatedTime", "priority", "timeOfVisit"];
        const changes = WATCHED
          .filter((f) => squash(before[f]) !== squash(job[f]))
          .map((f) => ({ at: Date.now(), kind: "edited", field: f, from: squash(before[f]), to: squash(job[f]) }));
        if (changes.length) job.changeLog = [...(before.changeLog || []), ...changes];
      }
    } else {
      // Added to a day that was already posted — an addition, not an edit.
      const dayPosted = current.find((j) => j.postedAt);
      if (dayPosted) {
        job.addedAfterPost = true;
        job.postedAt = dayPosted.postedAt;
        job.changeLog = [{ at: Date.now(), kind: "added", field: "", from: "", to: "" }];
      }
    }

    const updated = idx >= 0 ? current.map((j) => (j.id === job.id ? job : j)) : [...current, job];
    await persistJobs(selectedDate, updated);
    setShowForm(false);
    setEditingJob(null);
    if (job.dupFlag) showToast(job.dupFlag, "warn");
    else if (job.carryFlag) showToast(job.carryFlag, "warn");
    else showToast("Job saved.", "ok");
  }

  /* Hard delete is gone.
   *
   * A job that has been logged is a record of what the department planned
   * or did, and removing it takes the answer to "where did that go" with
   * it — which is the failure this whole system was built to end. Anything
   * that should not have been scheduled is cancelled with a reason and
   * stays visible; anything moved leaves a tombstone on the day it left.
   * There is deliberately no route in the app that erases either. */


  async function addFaultCode(entry) {
    const next = [...faultMaster, entry];
    setFaultMaster(next);
    await storageSet("fault-master", JSON.stringify(next));
    showToast(`Added fault code ${entry.code}`, "ok");
  }

  async function addProperty(entry) {
    const next = [...propertyMaster, entry];
    setPropertyMaster(next);
    await storageSet("property-master", JSON.stringify(next));
    showToast(`Added property ${entry.name}`, "ok");
  }

  /* The standalone verification pass and the "post schedule" stamp both
     lived here. Both are gone, and neither was replaced by an equivalent
     elsewhere — they were the double-entry.

     Outcomes are now advanced on the job card itself by whoever is looking
     at it, so there is no second pass in a second tab the following day.
     Schedule churn no longer needs a posting stamp either: every edit,
     move and cancellation is an event on the job, so the movement figures
     are read off the log rather than off a button somebody remembered to
     press. See views/LiveBoard.jsx and lib/job.js. */

  /* ------------------------------------------------------------------ *
   * Bulk import from the pasted workbook.
   * ------------------------------------------------------------------ */

  const openCarryovers = useMemo(() => {
    const out = [];
    jobs.forEach((j) => { if (j.carryFlag) out.push(j); });
    return out;
  }, [jobs]);

  const dupFlags = useMemo(() => jobs.filter((j) => j.dupFlag), [jobs]);
  const blockedJobs = useMemo(() => jobs.filter((j) => j.jobStatus === "Blocked"), [jobs]);
  const slaBreaches = useMemo(
    () => jobs.filter((j) => j.slaDeadline && j.jobStatus !== "Completed" && Date.now() > j.slaDeadline),
    [jobs]
  );

  const priorityCounts = useMemo(() => {
    const c = { "PRI-1": 0, "PRI-2": 0, "PRI-3": 0, "PRI-4": 0 };
    jobs.forEach((j) => { if (c[j.priority] !== undefined) c[j.priority]++; });
    return c;
  }, [jobs]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="animate-spin" size={20} />
          <span className="text-sm">Loading job board…</span>
        </div>
      </div>
    );
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (authRequired && !session) {
    return <SignIn onSignedIn={(s) => setSession(s)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        knownDates={knownDates}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onNewJob={() => { setEditingJob(null); setShowForm(true); }}
        session={session}
      />

      {!storageOk && (
        <div className="max-w-6xl mx-auto px-4 pt-3">
          <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
            Database error — check that VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set correctly and the
            schema from supabase/schema.sql has been run. Entries this session may not be saved.
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-5">
        {activeTab === "insights" && (
          <InsightsView
            carryovers={openCarryovers}
            duplicates={dupFlags}
            blocked={blockedJobs}
            slaBreaches={slaBreaches}
            priorityCounts={priorityCounts}
            selectedDate={selectedDate}
          />
        )}
        {activeTab === "faultcodes" && (
          <FaultCodesView faultMaster={faultMaster} onAdd={addFaultCode} />
        )}
        {activeTab === "properties" && (
          <PropertiesView propertyMaster={propertyMaster} onAdd={addProperty} />
        )}
        {activeTab === "roster" && (
          <Roster
            selectedDate={selectedDate} setSelectedDate={setSelectedDate}
            showToast={showToast}
            authRequired={authRequired} setAuthRequired={setAuthRequired}
            session={session}
          />
        )}
        {activeTab === "dashboard" && (
          <Dashboard
            selectedDate={selectedDate}
            knownDates={knownDates}
            onOpenDate={(d) => { setSelectedDate(d); setActiveTab("board"); }}
          />
        )}
        {activeTab === "live" && (
          <LiveBoard
            session={session}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            propertyMaster={propertyMaster}
            knownTeams={knownTeams}
            showToast={showToast}
            onEditFull={(job) => { setEditingJob(job); setShowForm(true); }}
          />
        )}
        {activeTab === "backlog" && (
          <Backlog
            knownDates={knownDates}
            selectedDate={selectedDate} setSelectedDate={setSelectedDate}
            setActiveTab={setActiveTab} showToast={showToast}
          />
        )}
        {activeTab === "jobcards" && <Projects knownDates={knownDates} showToast={showToast} />}
      </main>

      {showForm && (
        <JobFormModal
          initial={editingJob}
          faultMaster={faultMaster}
          propertyMaster={propertyMaster}
          knownTeams={knownTeams}
          onCancel={() => { setShowForm(false); setEditingJob(null); }}
          onSave={handleSaveJob}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-5 right-5 max-w-sm rounded-md px-4 py-3 text-sm shadow-lg border ${
            toast.kind === "warn" ? "bg-amber-50 border-amber-300 text-amber-800" : "bg-emerald-50 border-emerald-300 text-emerald-800"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Header({ selectedDate, setSelectedDate, knownDates, activeTab, setActiveTab, onNewJob, session }) {
  /* Tab order follows the daily cycle: build the schedule, post it, verify
     yesterday, then read the numbers. */
  /* The Live Board is the day. Everything else is a lens on it or a
     reference table, so it leads and the rest follow. */
  const tabs = [
    { id: "live", label: "Live Board", icon: Radio },
    { id: "backlog", label: "Queue", icon: Inbox },
    { id: "roster", label: "Roster", icon: Users },
    { id: "dashboard", label: "Dashboard", icon: TrendingUp },
    { id: "jobcards", label: "Projects", icon: Briefcase },
    { id: "insights", label: "Insights (today)", icon: BarChart3 },
    { id: "faultcodes", label: "Fault Codes", icon: Database },
    { id: "properties", label: "Properties", icon: Building2 },
  ];
  return (
    <div className="bg-slate-900 text-slate-100 sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={20} className="text-slate-400" />
          <span className="font-semibold tracking-tight">DHH Job Intake</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedDate(addDaysISO(selectedDate, -1))}
            title="Previous day"
            className="p-1.5 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
          />
          <button
            onClick={() => setSelectedDate(addDaysISO(selectedDate, 1))}
            title="Next day"
            className="p-1.5 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300"
          >
            <ChevronRight size={16} />
          </button>
          {selectedDate !== todayISO() && (
            <button
              onClick={() => setSelectedDate(todayISO())}
              className="text-xs px-2 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
              title="Jump back to today"
            >
              {selectedDate < todayISO() ? "Viewing a past date" : "Viewing a future date"} · Today
            </button>
          )}
          {session && (
            <button
              onClick={async () => { await signOut(); window.location.reload(); }}
              title={session.user?.email}
              className="text-xs px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
            >
              Sign out
            </button>
          )}
          <button
            onClick={onNewJob}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
          >
            <Plus size={16} /> New Job
          </button>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 flex gap-1 border-t border-slate-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 text-sm px-3 py-2 border-b-2 transition-colors ${
                active ? "border-emerald-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InsightsView({ carryovers, duplicates, blocked, slaBreaches, priorityCounts, selectedDate }) {
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-4 gap-3">
        {Object.entries(priorityCounts).map(([p, c]) => (
          <div key={p} className={`rounded-lg border ${PRIORITY_COLORS[p].border} ${PRIORITY_COLORS[p].bg} p-4`}>
            <div className={`text-2xl font-semibold ${PRIORITY_COLORS[p].text}`}>{c}</div>
            <div className="text-xs text-slate-500 mt-1">{PRIORITY_LABEL[p]}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-500" /> Duplicate dispatch flags — {selectedDate}
        </h2>
        {duplicates.length === 0 ? (
          <p className="text-sm text-slate-400">None detected for this date.</p>
        ) : (
          <div className="space-y-2">
            {duplicates.map((j) => (
              <div key={j.id} className="text-sm bg-red-50 border border-red-200 rounded-md px-3 py-2">
                <span className="font-medium">{j.property}{j.unit ? ` · ${j.unit}` : ""}</span> — {j.dupFlag}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
          <RefreshCw size={14} className="text-orange-500" /> Carried-over jobs — still open from a prior day
        </h2>
        {carryovers.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing carried over into this date.</p>
        ) : (
          <div className="space-y-2">
            {carryovers.map((j) => (
              <div key={j.id} className="text-sm bg-orange-50 border border-orange-200 rounded-md px-3 py-2">
                <span className="font-medium">{j.property}{j.unit ? ` · ${j.unit}` : ""}</span> — {j.carryFlag}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-500" /> Blocked jobs — {selectedDate}
        </h2>
        {(!blocked || blocked.length === 0) ? (
          <p className="text-sm text-slate-400">Nothing blocked for this date.</p>
        ) : (
          <div className="space-y-2">
            {blocked.map((j) => (
              <div key={j.id} className="text-sm bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <span className="font-medium">{j.property}{j.unit ? ` · ${j.unit}` : ""}</span> — {j.blockReason || "reason not set"}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
          <Clock size={14} className="text-red-600" /> External SLA breaches (48h landlord-facing reply) — {selectedDate}
        </h2>
        {(!slaBreaches || slaBreaches.length === 0) ? (
          <p className="text-sm text-slate-400">No SLA breaches for this date.</p>
        ) : (
          <div className="space-y-2">
            {slaBreaches.map((j) => (
              <div key={j.id} className="text-sm bg-red-50 border border-red-300 rounded-md px-3 py-2">
                <span className="font-medium">{j.property}{j.unit ? ` · ${j.unit}` : ""}</span> — deadline was {new Date(j.slaDeadline).toLocaleString()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FaultCodesView({ faultMaster, onAdd }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ code: "", description: "", tools: "", materials: "", category: "", defaultOwnerTeam: "Maintenance" });

  function submit() {
    if (!form.code.trim() || !form.description.trim()) return;
    onAdd({ ...form, code: form.code.trim().toUpperCase() });
    setForm({ code: "", description: "", tools: "", materials: "", category: "", defaultOwnerTeam: "Maintenance" });
    setShowAdd(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold">Fault Code Master ({faultMaster.length})</h1>
        <button onClick={() => setShowAdd((s) => !s)} className="flex items-center gap-1.5 text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">
          <Plus size={14} /> Add fault code
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-3">
        "Owner team" reflects the Jul-13 coordination decisions — e.g. safe box batteries and small
        appliance swaps route to Guest Relations/Housekeeping, not a Maintenance technician. Coordinators
        see this the moment they pick a fault code, so the new triage rules apply at entry, not by memory.
      </p>

      {showAdd && (
        <div className="bg-white border border-slate-300 rounded-lg p-4 mb-4 grid sm:grid-cols-2 gap-3">
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="e.g. HVAC-COMPRESSOR" />
          <Field label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder="e.g. AC" />
          <label className="block text-xs">
            <span className="text-slate-500">Owner team</span>
            <select value={form.defaultOwnerTeam} onChange={(e) => setForm({ ...form, defaultOwnerTeam: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {OWNER_TEAM_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} full />
          <Field label="Standard tools" value={form.tools} onChange={(v) => setForm({ ...form, tools: v })} full />
          <Field label="Standard materials" value={form.materials} onChange={(v) => setForm({ ...form, materials: v })} full />
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="text-sm px-3 py-1.5 rounded-md border border-slate-300">Cancel</button>
            <button onClick={submit} className="text-sm px-3 py-1.5 rounded-md bg-emerald-600 text-white">Save code</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg divide-y">
        {faultMaster.map((f) => (
          <div key={f.code} className="p-3 text-sm grid sm:grid-cols-12 gap-2">
            <div className="sm:col-span-2 font-mono text-xs font-semibold text-slate-700">{f.code}</div>
            <div className="sm:col-span-3 text-slate-600">{f.description}</div>
            <div className="sm:col-span-3 text-slate-500 text-xs">{f.tools}</div>
            <div className="sm:col-span-2 text-slate-500 text-xs">{f.materials}</div>
            <div className="sm:col-span-1 text-xs text-slate-400">{f.category}</div>
            <div className="sm:col-span-1">
              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${OWNER_TEAM_COLORS[f.defaultOwnerTeam] || OWNER_TEAM_COLORS["Maintenance"]}`}>
                {f.defaultOwnerTeam || "Maintenance"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, full }) {
  return (
    <label className={`block text-xs ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function PropertiesView({ propertyMaster, onAdd }) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [emirateFilter, setEmirateFilter] = useState("All");
  const [form, setForm] = useState({ name: "", emirate: "Dubai", notes: "" });

  function submit() {
    if (!form.name.trim()) return;
    if (propertyMaster.some((p) => norm(p.name) === norm(form.name))) {
      window.alert("That property name already exists in the master — check spelling before adding a near-duplicate.");
      return;
    }
    onAdd({ ...form, name: form.name.trim() });
    setForm({ name: "", emirate: "Dubai", notes: "" });
    setShowAdd(false);
  }

  const filtered = propertyMaster
    .filter((p) => emirateFilter === "All" || p.emirate === emirateFilter)
    .filter((p) => !search.trim() || norm(p.name).includes(norm(search)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const dubaiCount = propertyMaster.filter((p) => p.emirate === "Dubai").length;
  const fujairahCount = propertyMaster.filter((p) => p.emirate === "Fujairah").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold">Property Master ({propertyMaster.length})</h1>
        <button onClick={() => setShowAdd((s) => !s)} className="flex items-center gap-1.5 text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md">
          <Plus size={14} /> Add property
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-3">
        Building/community level, not per-unit — the specific unit or villa number still goes in the
        job's Unit field. <span className="font-medium">This is a starter list seeded from prior
        schedules, not the full 850-property portfolio</span> — Dubai: {dubaiCount} entries, Fujairah:
        {" "}{fujairahCount} entries. Add the rest here as they come up; keeping naming consistent (same
        spelling every time) is what keeps the recurring-property and building-pattern reports accurate.
      </p>

      {showAdd && (
        <div className="bg-white border border-slate-300 rounded-lg p-4 mb-4 grid sm:grid-cols-2 gap-3">
          <Field label="Property name (building/community)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Bayz Tower" full />
          <label className="block text-xs">
            <span className="text-slate-500">Emirate</span>
            <select value={form.emirate} onChange={(e) => setForm({ ...form, emirate: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {EMIRATE_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <Field label="Notes (optional)" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="e.g. community name, landlord contact" />
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="text-sm px-3 py-1.5 rounded-md border border-slate-300">Cancel</button>
            <button onClick={submit} className="text-sm px-3 py-1.5 rounded-md bg-emerald-600 text-white">Save property</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search properties…"
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1 min-w-[200px]"
        />
        <select value={emirateFilter} onChange={(e) => setEmirateFilter(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="All">All emirates</option>
          {EMIRATE_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y max-h-[600px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No properties match.</div>
        ) : (
          filtered.map((p) => (
            <div key={p.name} className="p-3 text-sm grid sm:grid-cols-12 gap-2">
              <div className="sm:col-span-6 font-medium text-slate-700">{p.name}</div>
              <div className="sm:col-span-2">
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${p.emirate === "Dubai" ? "bg-sky-50 text-sky-700 border-sky-300" : "bg-emerald-50 text-emerald-700 border-emerald-300"}`}>
                  {p.emirate}
                </span>
              </div>
              <div className="sm:col-span-4 text-slate-500 text-xs">{p.notes}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function JobFormModal({ initial, faultMaster, propertyMaster, knownTeams, onCancel, onSave }) {
  const [emirateFilter, setEmirateFilter] = useState("All");
  const [form, setForm] = useState(
    initial || {
      shift: SHIFT_OPTIONS[0],
      customShift: "",
      team: "",
      property: "",
      unit: "",
      status: STATUS_OPTIONS[0],
      faultCode: "",
      tools: "",
      materials: "",
      description: "",
      priority: "PRI-4",
      notes: "",
      ownerTeam: "Maintenance",
      jobStatus: "Open",
      blockReason: "",
      warehousePickup: "N",
      skuRef: "",
      vehicle: "",
      costCenter: "",
      quotationRef: "",
      estimatedCompletionDate: "",
      scheduledTime: "",
      slaApplies: false,
      /* Intake fields — these are what the coordinator already writes in
         the workbook, and between them they drive every Tier A metric on
         the dashboard: capacity, access risk, van readiness and backlog. */
      estimatedTime: "1 hr",
      timeOfVisit: "",
      guestConfirmed: "",
      parking: "",
      materialNeeded: "N",
      materialDetails: "",
      materialCost: "",
      pending: "N",
      pendingDetails: "",
    }
  );

  const fault = faultMaster.find((f) => f.code === form.faultCode);
  const canSave = form.property.trim() && form.faultCode && form.team.trim();
  const isProjectType = form.faultCode === "WORKS-QUOTED" || form.faultCode === "INSPECTION-ONB";
  const visibleProperties = emirateFilter === "All" ? propertyMaster : propertyMaster.filter((p) => p.emirate === emirateFilter);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function handleFaultCodeChange(code) {
    const f = faultMaster.find((x) => x.code === code);
    setForm((prev) => ({
      ...prev,
      faultCode: code,
      ownerTeam: f ? f.defaultOwnerTeam : prev.ownerTeam,
      tools: f ? f.tools : prev.tools,
      materials: f ? f.materials : prev.materials,
    }));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="font-semibold">{initial ? "Edit job" : "New job"}</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 pb-24 grid sm:grid-cols-2 gap-3 overflow-y-auto flex-1 min-h-0">
          <label className="block text-xs">
            <span className="text-slate-500">Shift</span>
            <select value={form.shift} onChange={(e) => update("shift", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {SHIFT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {form.shift === "Custom" && (
            <Field label="Custom shift (e.g. 07:00-16:00)" value={form.customShift} onChange={(v) => update("customShift", v)} />
          )}
          <label className="block text-xs">
            <span className="text-slate-500">Team</span>
            <input list="teams" value={form.team} onChange={(e) => update("team", e.target.value)} placeholder="Select or type a team"
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <datalist id="teams">{knownTeams.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          <label className="block text-xs">
            <span className="text-slate-500">Emirate (filters the list below)</span>
            <select value={emirateFilter} onChange={(e) => setEmirateFilter(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="All">All</option>
              {EMIRATE_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-slate-500">Property (building/community — not found? add it in the Properties tab first)</span>
            <select value={form.property} onChange={(e) => update("property", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">Select property…</option>
              {visibleProperties.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.emirate})</option>)}
            </select>
          </label>
          <Field label="Unit / Villa No." value={form.unit} onChange={(v) => update("unit", v)} />
          <label className="block text-xs">
            <span className="text-slate-500">Status</span>
            <select value={form.status} onChange={(e) => update("status", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block text-xs sm:col-span-2">
            <span className="text-slate-500">Fault code</span>
            <select value={form.faultCode} onChange={(e) => handleFaultCodeChange(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">Select the fault type…</option>
              {faultMaster.map((f) => <option key={f.code} value={f.code}>{f.code} — {f.description}</option>)}
            </select>
          </label>
          {fault && (
            <>
              <label className="block text-xs sm:col-span-2">
                <span className="text-slate-500">
                  Tools required — pre-filled from the fault code, edit for this specific job
                </span>
                <textarea
                  value={form.tools}
                  onChange={(e) => update("tools", e.target.value)}
                  rows={2}
                  className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs sm:col-span-2">
                <span className="text-slate-500">
                  Materials needed — pre-filled from the fault code, edit with the actual quantities/specs
                  for this job (this is what prints on the Job Card, so specificity here matters)
                </span>
                <textarea
                  value={form.materials}
                  onChange={(e) => update("materials", e.target.value)}
                  rows={2}
                  className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                />
              </label>
            </>
          )}
          <label className="block text-xs">
            <span className="text-slate-500">Owner team (auto-set from fault code, override if needed)</span>
            <select value={form.ownerTeam} onChange={(e) => update("ownerTeam", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {OWNER_TEAM_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-slate-500">Priority</span>
            <select value={form.priority} onChange={(e) => update("priority", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-slate-500">Job status</span>
            <select value={form.jobStatus} onChange={(e) => update("jobStatus", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {JOB_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {form.jobStatus === "Blocked" && (
            <label className="block text-xs">
              <span className="text-slate-500">Block reason</span>
              <select value={form.blockReason || BLOCK_REASON_OPTIONS[0]} onChange={(e) => update("blockReason", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
                {BLOCK_REASON_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
          <label className="block text-xs">
            <span className="text-slate-500">Scheduled time (HH:MM, optional — enables schedule-variance tracking)</span>
            <input type="time" value={form.scheduledTime} onChange={(e) => update("scheduledTime", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            <input type="checkbox" checked={form.slaApplies} onChange={(e) => update("slaApplies", e.target.checked)} />
            <span>External SLA applies (48h landlord-facing reply — leak/DLP-type faults). Deadline is set automatically from creation time.</span>
          </label>
          {isProjectType && (
            <>
              <Field label="Quotation ref" value={form.quotationRef} onChange={(v) => update("quotationRef", v)} placeholder="e.g. PC-2026-07-11" />
              <label className="block text-xs">
                <span className="text-slate-500">Estimated completion date — required for Job Card</span>
                <input type="date" value={form.estimatedCompletionDate} onChange={(e) => update("estimatedCompletionDate", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </label>
            </>
          )}
          <label className="block text-xs">
            <span className="text-slate-500">Warehouse pickup?</span>
            <select value={form.warehousePickup} onChange={(e) => update("warehousePickup", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </select>
          </label>
          <Field label="Description (exact quantities/specs here — see best-practice example in Fault Codes tab)" value={form.description} onChange={(v) => update("description", v)} full />

          {/* ---- Intake block ----------------------------------------- *
             * Short, and every field here earns its place by feeding a
             * metric. Estimated time drives capacity; guest confirmation
             * drives access risk; the material list decides whether the van
             * can be loaded. A blank is never read as a "no" — the
             * dashboard counts unanswered separately and shows the fill
             * rate, so leaving one empty costs coverage, not accuracy.
             * ---------------------------------------------------------- */}
          <div className="col-span-2 mt-2 pt-3 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-700">Intake — what the dashboard measures</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              These five fields carry the capacity, access-risk and readiness numbers. Blank is
              honest — it counts as "not answered", never as "no".
            </p>
          </div>

          <label className="block text-xs">
            <span className="text-slate-500">Estimated time <span className="text-slate-400">— drives the capacity check</span></span>
            <input
              list="est-time-options"
              value={form.estimatedTime}
              onChange={(e) => update("estimatedTime", e.target.value)}
              placeholder="1 hr · 30 mins · 2 hr"
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
            <datalist id="est-time-options">
              {["30 mins", "45 mins", "1 hr", "1 hr 30 mins", "2 hr", "3 hr", "4 hr"].map((t) => <option key={t} value={t} />)}
            </datalist>
          </label>

          <label className="block text-xs">
            <span className="text-slate-500">Time of visit</span>
            <input
              value={form.timeOfVisit}
              onChange={(e) => update("timeOfVisit", e.target.value)}
              placeholder="e.g. 15:00-16:00, or leave blank"
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
          </label>

          <label className="block text-xs">
            <span className="text-slate-500">
              Guest confirmed?
              {needsGuestConfirmation(form.status) && (
                <span className="text-amber-700 font-medium"> — this unit is occupied</span>
              )}
            </span>
            <select value={form.guestConfirmed} onChange={(e) => update("guestConfirmed", e.target.value)}
                    className={`mt-1 w-full border rounded-md px-2 py-1.5 text-sm ${
                      needsGuestConfirmation(form.status) && form.guestConfirmed !== "Y"
                        ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}>
              <option value="">Not asked yet</option>
              <option value="Y">Yes — guest agreed to the visit</option>
              <option value="N">No — not confirmed</option>
            </select>
          </label>

          <Field label="Parking bay" value={form.parking} onChange={(v) => update("parking", v)} />

          <label className="block text-xs">
            <span className="text-slate-500">Material needed?</span>
            <select value={form.materialNeeded} onChange={(e) => update("materialNeeded", e.target.value)}
                    className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">Not answered</option>
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-slate-500">Material cost (optional)</span>
            <input type="number" min="0" step="any" value={form.materialCost}
                   onChange={(e) => update("materialCost", e.target.value)}
                   placeholder="AED — leave blank if unknown"
                   className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>

          {form.materialNeeded === "Y" && (
            <label className="block text-xs col-span-2">
              <span className="text-slate-500">
                Material details — item and quantity.{" "}
                <span className="text-amber-700">"Basic materials" counts as not ready on the dashboard.</span>
              </span>
              <input value={form.materialDetails} onChange={(e) => update("materialDetails", e.target.value)}
                     placeholder="e.g. Shower door hinges ×2, silicone ×1"
                     className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            </label>
          )}

          <label className="block text-xs">
            <span className="text-slate-500">Pending from a previous visit?</span>
            <select value={form.pending} onChange={(e) => update("pending", e.target.value)}
                    className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">Not answered</option>
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </select>
          </label>

          {form.pending === "Y" && (
            <Field label="What is pending" value={form.pendingDetails} onChange={(v) => update("pendingDetails", v)} />
          )}

          <Field label="Notes" value={form.notes} onChange={(v) => update("notes", v)} full />
          <Field label="SKU ref (if known)" value={form.skuRef} onChange={(v) => update("skuRef", v)} />
          <Field label="Vehicle assigned" value={form.vehicle} onChange={(v) => update("vehicle", v)} />
          <Field label="Cost center" value={form.costCenter} onChange={(v) => update("costCenter", v)} />
        </div>
      </div>
      <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-2xl mx-4 mb-4 bg-white border border-slate-200 rounded-xl shadow-2xl flex items-center justify-end gap-2 px-5 py-3">
          <button onClick={onCancel} className="text-sm px-4 py-2 rounded-md border border-slate-300">Cancel</button>
          <button
            disabled={!canSave}
            onClick={() => onSave({ ...form, shift: form.shift === "Custom" ? form.customShift : form.shift })}
            className={`text-sm px-4 py-2 rounded-md text-white ${canSave ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-300 cursor-not-allowed"}`}
          >
            Save job
          </button>
        </div>
      </div>
    </div>
  );
}
