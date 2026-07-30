import { createAdminClient } from '@/lib/supabase/admin';

// Polled by the "connect your Telegram" screen after registration.
// The nonce itself is the credential — it's a freshly generated UUID
// that only this browser and (once tapped) Telegram have seen, so no
// session is required and nothing about other players is exposed.
export async function GET(request) {
  const nonce = request.nextUrl.searchParams.get('nonce');

  if (!nonce) {
    return Response.json({ success: false, error: 'Відсутній nonce' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: link, error } = await supabaseAdmin
    .from('telegram_links')
    .select('linked_at, expires_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) {
    console.error('[telegram-link-status] error:', error.message);
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
