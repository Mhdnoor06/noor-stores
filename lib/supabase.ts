import { createClient } from "@supabase/supabase-js";

// Browser Supabase client. Uses the public anon key (safe to expose) — the
// database is guarded by Row Level Security. NEVER import the secret key here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced early in dev if env vars are misnamed (must be NEXT_PUBLIC_*).
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env"
  );
}

export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: { persistSession: false },
});
