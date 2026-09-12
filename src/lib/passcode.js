/* ---------------------------------------------------------------------- *
 * The door.
 *
 * 12 September: the old link was opened on a different device and showed
 * everything. Both URLs serve the same deployment, so a gate in the app is
 * a gate on both — which is why this is here rather than in Vercel.
 *
 * WHAT THIS STOPS, exactly: somebody who has the link and opens it. That
 * is the whole of the reported problem and the whole of the promise.
 *
 * WHAT IT DOES NOT STOP, and nobody should be told otherwise: anyone
 * willing to read the JavaScript bundle. The Supabase anon key is in there
 * and reaches the database directly, with or without this screen. Only Row
 * Level Security closes that, and RLS needs the Supabase dashboard — see
 * docs/ACCESS.md. This is a lock on the front door of a building whose
 * windows are still open. It is worth having; it is not the fix.
 *
 * The passcode itself is never stored — only the SHA-256 of it, so reading
 * the bundle does not hand the code over. Changing it is one line.
 * ---------------------------------------------------------------------- */

const PASSCODE_SHA256 =
  "64756b4dfa7153176262cfd52067772f0ac179a2fc506b832973b7eb74d1fa5f";

const KEY = "dhh-unlocked";

/* Long enough that the coordinator is not retyping it every morning, short
   enough that a device that leaves the department stops working inside a
   month. Per device: localStorage never leaves the browser it is in. */
const DAYS = 30;

async function sha256(text) {
  /* Sub-resource crypto is https-only. On plain http (a local preview) it
     is absent, and an app that crashed there would be harder to test than
     it is worth protecting. */
  if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkPasscode(input) {
  const got = await sha256(String(input || "").trim());
  return got != null && got === PASSCODE_SHA256;
}

export function isUnlocked() {
  try {
    const until = Number(localStorage.getItem(KEY) || 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    /* Private window, blocked storage: ask for the code every time rather
       than failing open. */
    return false;
  }
}

export function unlock() {
  try {
    localStorage.setItem(KEY, String(Date.now() + DAYS * 24 * 60 * 60 * 1000));
  } catch { /* they will be asked again next load; that is the safe way round */ }
}

export function lock() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
}

export const UNLOCK_DAYS = DAYS;
