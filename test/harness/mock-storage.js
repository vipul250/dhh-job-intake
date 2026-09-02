/* Local stand-in for the Supabase-backed kv_store, used only to drive the
   app in tests. Mirrors the real module's contract, including the
   version-guarded write, so the concurrency path is genuinely exercised. */
const KEY = "__dhh_mock_kv__";
const VKEY = "__dhh_mock_v__";
function load(k) { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; } }
function save(k, m) { localStorage.setItem(k, JSON.stringify(m)); }

export async function storageGet(k) { const m = load(KEY); return k in m ? m[k] : null; }
export async function storageSet(k, v) {
  const m = load(KEY); m[k] = v; save(KEY, m);
  const vs = load(VKEY); vs[k] = new Date().toISOString() + Math.random(); save(VKEY, vs);
  return { key: k, value: v };
}
export async function storageList(p) { return Object.keys(load(KEY)).filter((k) => k.startsWith(p)); }

export async function storageGetVersioned(k) {
  const m = load(KEY), vs = load(VKEY);
  // A seeded key has no recorded version; the real table always has an
  // updated_at, so give it a stable stand-in rather than null (null means
  // "row absent" to the caller).
  return k in m ? { value: m[k], version: vs[k] ?? "seed", failed: false }
                : { value: null, version: null, failed: false };
}

/* The real store does its compare-and-set as one conditional SQL UPDATE,
   which is atomic. localStorage read-modify-write is not, so two tabs can
   interleave and lose a write that the real database would have rejected as
   a conflict. Holding a Web Lock — shared across same-origin tabs — makes
   the stub match the guarantee the app is written against, so a two-tab
   test measures the app rather than this file. */
const withLock = (fn) =>
  (typeof navigator !== "undefined" && navigator.locks)
    ? navigator.locks.request("dhh-mock-kv", fn)
    : Promise.resolve().then(fn);

export function storageCompareAndSet(k, v, expected) {
  return withLock(() => casNow(k, v, expected));
}

function casNow(k, v, expected) {
  const m = load(KEY), vs = load(VKEY);
  const actual = k in m ? (vs[k] ?? "seed") : null;
  if (expected === null || expected === undefined) {
    if (k in m) return { ok: false, conflict: true };
  } else if (actual !== expected) {
    return { ok: false, conflict: true };
  }
  const next = new Date().toISOString() + Math.random();
  m[k] = v; vs[k] = next; save(KEY, m); save(VKEY, vs);
  return { ok: true, version: next };
}
