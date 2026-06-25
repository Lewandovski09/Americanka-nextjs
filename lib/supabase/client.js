// Browser-side Supabase client.
// Uses the public anon key — all access is governed by Row Level
// Security policies in the database, so this key is safe to expose
// to the browser (it cannot bypass RLS).

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
