import { createAdminClient } from '@/lib/supabase/admin';

// Same status check as ../status/route.js, but pushed over one
// long-lived connection (Server-Sent Events) instead of the client
// re-opening a new HTTP request every 2.5s. The registration screen
// used to poll — see app/register/page.js — this collapses that into
// a single connection per registration attempt.
//
// Deliberately NOT Supabase Realtime + client-side RLS: that would
// mean adding a public SELECT policy on pending_registrations /
// telegram_links so the anon key can subscribe, which is a bigger
// trust boundary than "the nonce is a bearer secret checked server
// side" — the model this app already uses everywhere else. Polling
// server-side with the service-role client and streaming the result
// keeps that same boundary; it just moves the poll off the network.
export const runtime = 'nodejs';

const POLL_MS = 1000;
const MAX_LIFETIME_MS = 10 * 60 * 1000; // matches nonce expiry elsewhere

async function fetchStatus(supabaseAdmin, nonce) {
  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('pending_registrations')
    .select('confirmed_at, expires_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (pendingError) return { success: false, error: 'Помилка сервера' };

  if (pending) {
    return {
      success: true,
      linked: !!pending.confirmed_at,
      expired: !pending.confirmed_at && new Date(pending.expires_at) < new Date(),
    };
  }

  const { data: link, error } = await supabaseAdmin
    .from('telegram_links')
    .select('linked_at, expires_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) return { success: false, error: 'Помилка сервера' };
  if (!link) return { success: false, error: 'Посилання не знайдено' };

  return {
    success: true,
    linked: !!link.linked_at,
    expired: !link.linked_at && new Date(link.expires_at) < new Date(),
  };
}

export async function GET(request) {
  const nonce = request.nextUrl.searchParams.get('nonce');
  if (!nonce) {
    return Response.json({ success: false, error: 'Відсутній nonce' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();
  const encoder = new TextEncoder();

  let intervalId;
  let timeoutId;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const close = () => {
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        try {
          controller.close();
        } catch {
          // Already closed (client disconnected) — nothing to do.
        }
      };

      const tick = async () => {
        const status = await fetchStatus(supabaseAdmin, nonce);
        send(status);
        if (!status.success || status.linked || status.expired) close();
      };

      await tick(); // send current status immediately, don't wait a full POLL_MS
      intervalId = setInterval(tick, POLL_MS);
      timeoutId = setTimeout(() => {
        send({ success: true, linked: false, expired: true });
        close();
      }, MAX_LIFETIME_MS);

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
