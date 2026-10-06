// Where Telegram delivers the bot's updates (registration, password
// reset). Admin-only.
//
//   GET  — what Telegram currently has: the webhook URL, pending updates,
//          the last delivery error.
//   POST — point the bot at THIS site: https://<the host the admin is on>/api/telegram/webhook,
//          with TELEGRAM_WEBHOOK_SECRET as the secret token.
//
// Exists so moving hosts (Railway → Vercel) or changing the domain is a
// button in the admin panel, not a hand-built URL with the bot token in it.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { telegramApi } from '@/lib/telegram';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

async function requireAdmin() {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return 'Не авторизовано';
  const { data: me } = await adminRow(createAdminClient(), authUser.user.id);
  return me?.is_admin ? null : 'Тільки для адміністраторів';
}

function siteOrigin(request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : null;
}

async function webhookInfo() {
  const res = await telegramApi('getWebhookInfo');
  if (!res.ok) return { error: res.error || 'Telegram не відповідає' };
  const info = res.result || {};
  return {
    url: info.url || '',
    pendingUpdates: info.pending_update_count ?? 0,
    lastError: info.last_error_message || null,
    lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
  };
}

export async function GET(request) {
  const denied = await requireAdmin();
  if (denied) return Response.json({ success: false, error: denied }, { status: 403 });

  const info = await webhookInfo();
  if (info.error) return Response.json({ success: false, error: info.error }, { status: 502 });
  const expected = `${siteOrigin(request)}/api/telegram/webhook`;
  return Response.json({ success: true, ...info, expected, matches: info.url === expected });
}

export async function POST(request) {
  const denied = await requireAdmin();
  if (denied) return Response.json({ success: false, error: denied }, { status: 403 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { success: false, error: 'TELEGRAM_WEBHOOK_SECRET не задано у змінних Vercel — спершу додайте його' },
      { status: 400 }
    );
  }
  const origin = siteOrigin(request);
  if (!origin || !origin.startsWith('https://')) {
    return Response.json({ success: false, error: 'Підключати бота можна лише з https-адреси сайту' }, { status: 400 });
  }

  const url = `${origin}/api/telegram/webhook`;
  const res = await telegramApi('setWebhook', { url, secret_token: secret });
  if (!res.ok) {
    return Response.json({ success: false, error: res.error || 'Telegram відхилив запит' }, { status: 502 });
  }
  const info = await webhookInfo();
  return Response.json({ success: true, ...info, expected: url, matches: info.url === url });
}
