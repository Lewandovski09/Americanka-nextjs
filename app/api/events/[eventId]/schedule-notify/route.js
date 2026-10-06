import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { sendScheduleNotice } from '@/lib/server/scheduleNotice';
import { isTestEvent, TEST_SKIP } from '@/lib/server/testEvent';

// «📋 Розклад готовий» — called by the page right after «Запустити»
// (in the background). Admin only; sends once (lib/server/scheduleNotice).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  const supabaseAdmin = createAdminClient();
  const { data: me } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!me?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  if (await isTestEvent(supabaseAdmin, params.eventId)) return Response.json(TEST_SKIP);
  if (!process.env.TELEGRAM_BOT_TOKEN) return Response.json({ success: true, skipped: 'no bot token' });

  const site = publicSiteUrl(request);
  if (!site) return Response.json({ success: false, error: 'Невідома адреса сайту' }, { status: 400 });
  const r = await sendScheduleNotice(supabaseAdmin, params.eventId, { siteUrl: site });
  if (r.error) return Response.json({ success: false, error: r.error }, { status: 400 });
  return Response.json({ success: true, ...r });
}
