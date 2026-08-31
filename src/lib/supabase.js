import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!supabaseConfigured) {
  console.error(
    "Missing Supabase env vars: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set."
  );
}

/* ---------------------------------------------------------------------- *
 * A misconfigured deployment must not take the whole page down.
 *
 * createClient() throws if the URL is undefined, and because this module is
 * imported at the top of the app that throw happened before React rendered
 * anything — a blank white page with the explanation only in the console.
 * The app already knows how to show "check your environment variables", so
 * it needs to survive long enough to say it.
 *
 * When the keys are missing every call resolves to the same shape a failed
 * request produces, which the storage layer already handles.
 * ---------------------------------------------------------------------- */
const notConfigured = { message: "Supabase is not configured on this deployment." };

function stubQuery() {
  const result = Promise.resolve({ data: null, error: notConfigured });
  const chain = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => chain,
    delete: () => chain,
    eq: () => chain,
    like: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => result,
    single: () => result,
    then: (...a) => result.then(...a),
    catch: (...a) => result.catch(...a),
    finally: (...a) => result.finally(...a),
  };
  return chain;
}

const stub = {
  from: () => stubQuery(),
  auth: {
    signInWithOtp: async () => ({ data: null, error: notConfigured }),
    verifyOtp: async () => ({ data: null, error: notConfigured }),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
};

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : stub;
