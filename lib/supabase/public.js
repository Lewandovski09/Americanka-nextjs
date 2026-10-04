// A plain anonymous Supabase client for server code that reads only
// public data and must not depend on the visitor's cookies — e.g. link
// previews (generateMetadata), which a Telegram/WhatsApp bot requests
// without any session.
import { createClient as createSupabase } from '@supabase/supabase-js';

export function createPublicClient() {
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
