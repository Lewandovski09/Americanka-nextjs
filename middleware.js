import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// Wrap any promise with a timeout so a slow/hanging Supabase call
// can never block the entire site from loading. If Supabase is
// slow to respond, we'd rather serve the page (possibly with a
// stale session) than hang forever.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
  ]);
}

export async function middleware(request) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          get(name) {
            return request.cookies.get(name)?.value;
          },
          set(name, value, options) {
            response.cookies.set({ name, value, ...options });
          },
          remove(name, options) {
            response.cookies.set({ name, value: '', ...options });
          },
        },
      }
    );

    // Refresh session if expired — required for Server Components
    // to read a valid session. Capped at 5 seconds so a slow
    // Supabase response can never hang the whole site.
    const result = await withTimeout(supabase.auth.getUser(), 5000);
    if (result?.timedOut) {
      console.error('[middleware] supabase.auth.getUser() timed out after 5s');
    }
  } catch (err) {
    // Never let an auth refresh failure break the entire site —
    // worst case, the user sees a logged-out state, which is
    // recoverable, instead of an infinitely hanging page.
    console.error('[middleware] Unexpected error:', err.message);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
