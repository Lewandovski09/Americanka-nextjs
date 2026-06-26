import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// Wrap any promise with a timeout so a slow/hanging Supabase call
// can never block the entire site from loading.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
  ]);
}

export async function middleware(request) {
  // IMPORTANT: response must be re-created any time cookies are
  // set, and built from the (possibly updated) request — otherwise
  // a refreshed session token never actually reaches the browser,
  // which causes the exact symptom we're fixing: the user IS
  // logged in (their old cookie is valid), but every page load
  // looks logged-out because the refreshed session cookie silently
  // gets dropped. This mirrors Supabase's official Next.js
  // middleware recipe exactly.
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request: { headers: request.headers } });
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
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
    console.error('[middleware] Unexpected error:', err.message);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
