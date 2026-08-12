import { createAdminClient } from '@/lib/supabase/admin';

// Same pattern as ../../telegram/link/watch/route.js — see that file
// for why this is a push connection instead of client-side polling,
// and why it's a service-role poll rather than Supabase Realtime.
export const runtime = 'nodejs';

const POLL_MS = 1000;
const MAX_LIFETIME_MS = 10 * 60 * 1000; // matches nonce expiry in start/route.js

async function fetchStatus(supabaseAdmin, nonce) {
  const { data: reset, error } = await supabaseAdmin
    .from('password_resets')
    .select('confirmed_at, expires_at, no_account_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) return { success: false, error: 'Помилка сервера' };
  if (!reset) return { success: false, error: 'Посилання не знайдено' };

  return {
    success: true,
    confirmed: !!reset.confirmed_at,
    noAccount: !!reset.no_account_at,
    expired: !reset.confirmed_at && !reset.no_account_at && new Date(reset.expires_at) < new Date(),
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
        if (!status.success || status.confirmed || status.expired || status.noAccount) close();
      };

      await tick();
      intervalId = setInterval(tick, POLL_MS);
      timeoutId = setTimeout(() => {
        send({ success: true, confirmed: false, expired: true });
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
