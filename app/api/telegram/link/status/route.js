import { createAdminClient } from '@/lib/supabase/admin';

// Polled by the "connect your Telegram" screen. A nonce is either a
// registration waiting to be confirmed (no account yet) or a re-link for
// an existing account, so both tables are checked.
//
// The nonce itself is the credential — a freshly generated UUID that
// only this browser and (once tapped) Telegram have seen — so no session
// is required and nothing about other players is exposed.
export async function GET(request) {
  const nonce = request.nextUrl.searchParams.get('nonce');

  if (!nonce) {
    return Response.json({ success: false, error: 'Відсутній nonce' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('pending_registrations')
    .select('confirmed_at, expires_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (pendingError) {
    console.error('[telegram-link-status] pending error:', pendingError.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }

  if (pending) {
    return Response.json({
      success: true,
      linked: !!pending.confirmed_at,
      expired: !pending.confirmed_at && new Date(pending.expires_at) < new Date(),
    });
  }

  const { data: link, error } = await supabaseAdmin
    .from('telegram_links')
    .select('linked_at, expires_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) {
    console.error('[telegram-link-status] link error:', error.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }

  if (!link) {
    return Response.json({ success: false, error: 'Посилання не знайдено' }, { status: 404 });
  }

  return Response.json({
    success: true,
    linked: !!link.linked_at,
    expired: !link.linked_at && new Date(link.expires_at) < new Date(),
  });
}
