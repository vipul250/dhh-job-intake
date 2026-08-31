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

/* ---------------------------------------------------------------------- *
 * Optimistic concurrency.
 *
 * Added because a plain read-modify-write loses data with two people on
 * the same day, and that is not a theoretical risk here — it is the whole
 * point of the app. Measured with two browser tabs writing at once: the
 * coordinator adding a job and the admin marking another one done, a
 * fraction of a second apart, and the admin's outcome silently
 * disappeared. That is precisely the failure the department is trying to
 * escape, so shipping it inside the replacement was not an option.
 *
 * `kv_store.updated_at` is the version. A write only lands if the row
 * still carries the timestamp the caller read; otherwise it is rejected
 * and the caller re-reads, re-applies its change and tries again. Postgres
 * evaluates the WHERE clause and the UPDATE as one statement, so there is
 * no window between the check and the write.
 * ---------------------------------------------------------------------- */

/** Read a key along with the version needed to write it back safely. */
export async function storageGetVersioned(key) {
  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("value, updated_at")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      console.error("storageGetVersioned error", key, error);
      return { value: null, version: null, failed: true };
    }
    return data
      ? { value: data.value, version: data.updated_at, failed: false }
      : { value: null, version: null, failed: false };
  } catch (e) {
    console.error("storageGetVersioned threw", key, e);
    return { value: null, version: null, failed: true };
  }
}

/**
 * Write only if the stored row still has `expectedVersion`.
 * @param {string} key
 * @param {string} value
 * @param {string|null} expectedVersion  null means "this key should not exist yet"
 * @returns {Promise<{ok: boolean, version?: string, conflict?: boolean, error?: string}>}
 */
export async function storageCompareAndSet(key, value, expectedVersion) {
  const nextVersion = new Date().toISOString();
  try {
    if (expectedVersion === null || expectedVersion === undefined) {
      // The key should not exist. A duplicate-key error means somebody
      // created it first — a conflict, not a failure.
      const { data, error } = await supabase
        .from("kv_store")
        .insert({ key, value, updated_at: nextVersion })
        .select("updated_at");
      if (error) {
        if (error.code === "23505") return { ok: false, conflict: true };
        console.error("storageCompareAndSet insert error", key, error);
        return { ok: false, error: error.message };
      }
      return { ok: true, version: (data && data[0] && data[0].updated_at) || nextVersion };
    }

    const { data, error } = await supabase
      .from("kv_store")
      .update({ value, updated_at: nextVersion })
      .eq("key", key)
      .eq("updated_at", expectedVersion)
      .select("updated_at");
    if (error) {
      console.error("storageCompareAndSet update error", key, error);
      return { ok: false, error: error.message };
    }
    // No rows matched: the version moved on under us.
    if (!data || data.length === 0) return { ok: false, conflict: true };
    return { ok: true, version: data[0].updated_at || nextVersion };
  } catch (e) {
    console.error("storageCompareAndSet threw", key, e);
    return { ok: false, error: String(e) };
  }
}
