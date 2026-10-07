import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { getFormat } from '@/lib/formats';
import { planAmericankaCourts } from '@/lib/schedule';

// «⏱ Розставити корти й час» — for a started Americanka whose schedule is
// still a draft: one category — one court (the event's courts in turn),
// the first game at the category's start, every next one 15 minutes later
// (lib/schedule). Admin only. Courts and times set by hand are replaced.
export async function POST(request, { params }) {
  const { eventId } = params;
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  const supabaseAdmin = createAdminClient();
  const { data: me } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!me?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  const [{ data: event }, { data: cats }] = await Promise.all([
    supabaseAdmin.from('tournament_events').select('id, format_kind, scheduled_at, courts').eq('id', eventId).maybeSingle(),
    supabaseAdmin
      .from('tournament_categories')
      .select('id, scheduled_at, status, gender, category_label')
      .eq('event_id', eventId)
      .eq('status', 'live')
      .order('gender', { ascending: true })
      .order('category_label', { ascending: true }),
  ]);
  if (!event) return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  if (getFormat(event.format_kind)?.scoring !== 'sum31') {
    return Response.json({ success: false, error: 'Лише для Americanka' }, { status: 400 });
  }

  const groups = [];
  for (const c of cats || []) {
    const { data: ms } = await supabaseAdmin
      .from('tournament_matches')
      .select('id, court, round_number, order_index')
      .eq('category_id', c.id);
    groups.push({ rows: ms || [], startAt: c.scheduled_at || event.scheduled_at });
  }
  const planned = planAmericankaCourts(groups, event.courts?.length ? event.courts : [1]);
  let updated = 0;
  for (const m of planned.flat()) {
    const { error } = await supabaseAdmin
      .from('tournament_matches')
      .update({ court: m.court, scheduled_at: m.scheduled_at })
      .eq('id', m.id);
    if (!error) updated++;
  }
  return Response.json({ success: true, updated });
}
