// Browser-side Supabase client.
// Uses the public anon key — all access is governed by Row Level
// Security policies in the database, so this key is safe to expose
// to the browser (it cannot bypass RLS).

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  // Non-null assertion, not a stricter check: these are required at
  // runtime today too — a missing env var already makes supabase-js
  // throw immediately on the old .js client. This just satisfies
  // strict null checks without changing that behavior.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
