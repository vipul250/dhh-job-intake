import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // This will show up in the browser console if env vars are missing on
  // Vercel (Project Settings -> Environment Variables) or in your local .env.
  console.error(
    "Missing Supabase env vars: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
