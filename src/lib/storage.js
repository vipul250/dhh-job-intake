import { supabase } from "./supabase";

/* ---------------------------------------------------------------------- *
 * Drop-in replacement for the Claude-artifact `window.storage` API the
 * app was originally built against. Same three functions, same call
 * signatures (App.jsx is unchanged apart from importing these instead
 * of defining local window.storage wrappers).
 *
 * Backing store: a single Postgres table `kv_store` (key, value, updated_at)
 * in Supabase. The original app only ever called storage with shared=true,
 * i.e. there was no per-user data — everyone editing the board was editing
 * the same shared state. This adapter preserves that: one global table,
 * no per-user partitioning. See supabase/schema.sql for the table + RLS
 * policies, and the README for what that means for who can read/write it.
 * ---------------------------------------------------------------------- */

export async function storageGet(key) {
  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      console.error("storageGet error", key, error);
      return null;
    }
    return data ? data.value : null;
  } catch (e) {
    console.error("storageGet threw", key, e);
    return null;
  }
}

export async function storageSet(key, value) {
  try {
    const { error } = await supabase
      .from("kv_store")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) {
      console.error("storageSet error", key, error);
      return null;
    }
    return { key, value };
  } catch (e) {
    console.error("storageSet threw", key, e);
    return null;
  }
}

export async function storageList(prefix) {
  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("key")
      .like("key", `${prefix}%`);
    if (error) {
      console.error("storageList error", prefix, error);
      return [];
    }
    return data.map((r) => r.key);
  } catch (e) {
    console.error("storageList threw", prefix, e);
    return [];
  }
}
