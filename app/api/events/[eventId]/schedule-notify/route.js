import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { sendScheduleNotice } from '@/lib/server/scheduleNotice';
import { isTestEvent, TEST_SKIP } from '@/lib/server/testEvent';

// «✅ Розклад готовий — опублікувати»: the schedule stops being a draft
// (schedule_published_at, migration 071) — players see it — and goes to
// the channel and every participant (lib/server/scheduleNotice, once;
// never for a test tournament). Admin only.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  const supabaseAdmin = createAdminClient();
  const { data: me } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!me?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  // Published first — what players see doesn't wait for Telegram.
  const { error: pubErr } = await supabaseAdmin
    .from('tournament_events')
    .update({ schedule_published_at: new Date().toISOString() })
    .eq('id', params.eventId)
    .is('schedule_published_at', null);
  if (pubErr) return Response.json({ success: false, error: 'Не вдалося опублікувати (чи виконано SQL 071?)' }, { status: 500 });

  if (await isTestEvent(supabaseAdmin, params.eventId)) return Response.json({ ...TEST_SKIP, published: true });
  if (!process.env.TELEGRAM_BOT_TOKEN) return Response.json({ success: true, skipped: 'no bot token' });

  const site = publicSiteUrl(request);
  if (!site) return Response.json({ success: false, error: 'Невідома адреса сайту' }, { status: 400 });
  const r = await sendScheduleNotice(supabaseAdmin, params.eventId, { siteUrl: site });
  if (r.error) return Response.json({ success: false, error: r.error }, { status: 400 });
  return Response.json({ success: true, ...r });
}
