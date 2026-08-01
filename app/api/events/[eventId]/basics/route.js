import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAvpTier } from '@/lib/server/eventConfig';
import { recalcAvpForCategory } from '@/lib/server/avpAward';

// Basic settings of a RUNNING event: name, date/time, venue, AVP tier.
// Unlike /update (the pre-start form) this touches nothing that the
// generated matches depend on — format, courts, scoring and the category
// list are baked in once a category starts, so they are not editable
// here. The tier belongs on this list precisely because it changes
// nothing about how the event is played: an event that started before
// anyone decided what it was worth can still be put into the rating.
const LOCATIONS = ['beach13', 'dynamo_sc'];

export async function POST(request, { params }) {
  const { eventId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id, name')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  }

  const body = await request.json();
  const { name, location, scheduledAt } = body;

  const patch = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return Response.json({ success: false, error: 'Вкажіть назву' }, { status: 400 });
    patch.name = trimmed;
  }
  if (location !== undefined) {
    if (!LOCATIONS.includes(location)) {
      return Response.json({ success: false, error: 'Невідоме місце проведення' }, { status: 400 });
    }
    patch.location = location;
  }
  if (scheduledAt !== undefined) {
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) {
      return Response.json({ success: false, error: 'Невірна дата' }, { status: 400 });
    }
    patch.scheduled_at = d.toISOString();
  }
  // `avpTier: null` is a real value here (it takes the event OUT of the
  // rating), so only an absent key means "leave it alone".
  if ('avpTier' in body) {
    const avp = resolveAvpTier(body.avpTier);
    if (avp.error) return Response.json({ success: false, error: avp.error }, { status: 400 });
    patch.avp_tier = avp.tier;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ success: false, error: 'Немає що зберігати' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('tournament_events').update(patch).eq('id', eventId);
  if (error) {
    console.error('[event basics] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти' }, { status: 500 });
  }

  // Changing the tier (or the date, which is what picks the season)
  // changes what every finished category of this event was worth. Repay
  // them straight away instead of leaving the standings stale until
  // somebody notices — recalcAvpForCategory rewrites from scratch, so
  // this is safe to run over categories that never earned anything.
  if ('avpTier' in body || scheduledAt !== undefined) {
    const { data: finished } = await supabaseAdmin
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId)
      .eq('status', 'done');
    for (const c of finished || []) {
      const res = await recalcAvpForCategory(supabaseAdmin, c.id);
      if (!res.ok) console.error('[event basics] avp recalc:', res.error);
    }
  }

  return Response.json({ success: true });
}
