import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { announceBatch } from '@/lib/server/eventAnnouncement';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { isTestEvent } from '@/lib/server/testEvent';

// «Оголосити в Telegram» — admin only. Each call posts to the channel (the
// first call only) and sends the card to the next batch of players; the
// page calls again until { done: true }. See lib/server/eventAnnouncement.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });

  const supabaseAdmin = createAdminClient();
  const { data: me } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!me?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  if (await isTestEvent(supabaseAdmin, params.eventId)) {
    return Response.json({ success: false, error: 'Це тестовий турнір — у Telegram нічого не надсилається' }, { status: 400 });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ success: false, error: 'Telegram-бот не налаштований (TELEGRAM_BOT_TOKEN)' }, { status: 400 });
  }
  const site = publicSiteUrl(request);
  if (!site || !site.startsWith('https://')) {
    return Response.json(
      { success: false, error: 'Оголошення надсилається лише з опублікованого сайту (https)' },
      { status: 400 }
    );
  }

  const { retryChannel } = await request.json().catch(() => ({}));
  const r = await announceBatch(supabaseAdmin, params.eventId, { siteUrl: site, retryChannel: !!retryChannel });
  if (r.error) return Response.json({ success: false, error: r.error }, { status: 400 });
  return Response.json({ success: true, ...r });
}
