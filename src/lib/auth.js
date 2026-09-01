/* ---------------------------------------------------------------------- *
 * auth.js — signing in with an email and a one-time code.
 *
 * Until now identity was a name typed into a box and kept in localStorage.
 * That was honest about what it was — attribution, not authentication —
 * and it was enough while the only question was "who moved this job". It
 * is not enough once the board is deciding whether a coordinator's call
 * was sound, because anybody can type anybody's name.
 *
 * Supabase Auth already does email one-time codes, so this is a thin layer
 * over `signInWithOtp` / `verifyOtp` rather than anything invented here.
 *
 * IT SHIPS SWITCHED OFF, and that is deliberate. Turning a login screen on
 * before the email delivery is known to work locks the entire department
 * out of a tool they run their day on, and the only way back would be a
 * redeploy. So the gate reads a stored setting, the setting starts false,
 * and the screen that turns it on will not let you until you have received
 * a real code yourself. See docs/ACCESS.md for what has to be configured
 * in Supabase first.
 * ---------------------------------------------------------------------- */

import { supabase } from "./supabase.js";
import { storageGet, storageSet } from "./storage.js";
import { squash, canonKey } from "./normalize.js";

export const AUTH_FLAG_KEY = "auth-required";

/** Is the login gate switched on? Reads public, so it works before sign-in. */
export async function isAuthRequired() {
  const v = await storageGet(AUTH_FLAG_KEY);
  return squash(v) === "true";
}

export async function setAuthRequired(on) {
  await storageSet(AUTH_FLAG_KEY, on ? "true" : "false");
}

/**
 * Send a one-time code.
 *
 * `shouldCreateUser: false` is the allowlist: only people already invited
 * in Supabase can receive a code. Without it, anyone who found the URL
 * could sign themselves in with any email address.
 */
export async function sendCode(email) {
  const addr = squash(email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
    return { ok: false, error: "That does not look like an email address." };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: addr,
    options: { shouldCreateUser: false },
  });
  if (error) {
    const msg = String(error.message || error);
    if (/signups? not allowed|not found|invalid/i.test(msg)) {
      return {
        ok: false,
        error: "That address is not set up for this app. An administrator has to add it in Supabase first.",
      };
    }
    if (/rate|too many/i.test(msg)) {
      return { ok: false, error: "Too many codes requested. Wait a minute and try again." };
    }
    return { ok: false, error: `Could not send the code: ${msg}` };
  }
  return { ok: true };
}

export async function verifyCode(email, token) {
  const addr = squash(email).toLowerCase();
  const code = squash(token).replace(/\s/g, "");
  const { data, error } = await supabase.auth.verifyOtp({ email: addr, token: code, type: "email" });
  if (error) {
    const msg = String(error.message || error);
    if (/expired/i.test(msg)) return { ok: false, error: "That code has expired. Send a new one." };
    if (/invalid/i.test(msg)) return { ok: false, error: "That code is not right. Check it and try again." };
    return { ok: false, error: msg };
  }
  return { ok: true, session: data.session, user: data.user };
}

export async function currentSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data ? data.session : null;
  } catch {
    return null;
  }
}

export function onAuthChange(cb) {
  try {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
    return () => data?.subscription?.unsubscribe?.();
  } catch {
    return () => {};
  }
}

export async function signOut() {
  try { await supabase.auth.signOut(); } catch { /* already gone */ }
}

/* ---------------------------------------------------------------------- *
 * Who the signed-in person is, in the department's terms.
 *
 * A session gives an email. The board wants a name that matches the one on
 * jobs and the roster, so the staff list is consulted first — matching on
 * a recorded email, then on the local part of the address. Falling back to
 * the local part means an unmatched sign-in still gets a sensible name
 * rather than an address in every history line.
 * ---------------------------------------------------------------------- */
export function identityFor(session, staff) {
  if (!session || !session.user) return null;
  const email = squash(session.user.email).toLowerCase();
  const local = email.split("@")[0] || email;

  const list = staff || [];
  const byEmail = list.find((s) => canonKey(s.email) === canonKey(email));
  const byName = list.find((s) => canonKey(s.name) === canonKey(local.replace(/[._-]+/g, " ")));
  const rec = byEmail || byName || null;

  return {
    email,
    name: rec ? rec.name : titleish(local),
    /* Whether the name came from the team list or was guessed at from the
       address. A guessed name still works, but it will not match the name
       on the schedules, so the team list should carry the address. */
    matched: byEmail ? "email" : byName ? "name" : "guessed",
    role: rec && rec.trade === "manager" ? "admin"
        : rec && rec.trade === "coordinator" ? "coordinator"
        : "field",
    /* Explicitly flagged on the team list, not inferred from a trade. The
       one thing it controls is switching sign-in back off. */
    admin: !!(rec && rec.admin),
    staff: rec || null,
    // True identity, not a typed-in name.
    verified: true,
  };
}

function titleish(s) {
  return squash(String(s).replace(/[._-]+/g, " "))
    .replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
