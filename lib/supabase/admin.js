// Admin Supabase client using the SERVICE ROLE key.
// This key bypasses Row Level Security entirely — it must NEVER be
// exposed to the browser, and must only be used inside Route
// Handlers / Server Actions that run exclusively on the server.
//
// Used for: creating player profiles during registration (before
// the user technically "exists" to RLS), approving ratings, and
// any other action that legitimately needs to act on behalf of
// the whole system rather than a single authenticated user.

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
