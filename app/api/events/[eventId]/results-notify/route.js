import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { sendResultsNotice } from '@/lib/server/resultsNotice';
import { TEST_SKIP } from '@/lib/server/testEvent';

// «🏁 Надіслати результати в Telegram» — admin, for a finished tournament.
// Normally it goes by itself when the last category ends; this is for a
// tournament finished before that existed, or to send it again.
// body: { force?: boolean } — send even if it went out already.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  const supabaseAdmin = createAdminClient();
  const { data: me } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!me?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  const { data: ev } = await supabaseAdmin.from('tournament_events').select('id, status').eq('id', params.eventId).maybeSingle();
  if (!ev) return Response.json({ success: false, error: 'Турнір не знайдено' }, { status: 404 });
  if (ev.status !== 'done') return Response.json({ success: false, error: 'Турнір ще не завершено' }, { status: 400 });
  if (!process.env.TELEGRAM_BOT_TOKEN) return Response.json({ success: false, error: 'Бот не налаштований' }, { status: 400 });

  const { force } = await request.json().catch(() => ({}));
  const r = await sendResultsNotice(supabaseAdmin, params.eventId, { siteUrl: publicSiteUrl(request), force: !!force });
  if (r.skipped === 'test') return Response.json(TEST_SKIP);
  if (r.error) return Response.json({ success: false, error: r.error }, { status: 400 });
  if (r.already) return Response.json({ success: true, already: true });
  return Response.json({ success: true, ...r });
}
