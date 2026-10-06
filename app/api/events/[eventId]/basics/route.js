import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAvpTier, resolveVenue } from '@/lib/server/eventConfig';
import { recalcAvpForCategory } from '@/lib/server/avpAward';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// Basic settings of a RUNNING event: name, date/time, venue, AVP tier.
// Unlike /update (the pre-start form) this touches nothing that the
// generated matches depend on — format, courts, scoring and the category
// list are baked in once a category starts, so they are not editable
// here. The tier belongs on this list precisely because it changes
// nothing about how the event is played: an event that started before
// anyone decided what it was worth can still be put into the rating.
//
// The venue is checked against the `venues` table (migration 043). The
// event's courts are already baked into its matches, so a move is only
// allowed to a venue that has every one of those courts.
export async function POST(request, { params }) {
  const { eventId } = params;

  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id, name, location, sport_id, courts')
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
  if (location !== undefined && location !== event.location) {
    const venueCheck = await resolveVenue(supabaseAdmin, location, event.sport_id, event.courts || []);
    if (venueCheck.error) {
      return Response.json({ success: false, error: venueCheck.error }, { status: 400 });
    }
    patch.location = venueCheck.venue.code;
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

  // Changing the tier (or the date / venue, which pick the season)
  // changes what every finished category of this event was worth. Repay
  // them straight away instead of leaving the standings stale until
  // somebody notices — recalcAvpForCategory rewrites from scratch, so
  // this is safe to run over categories that never earned anything.
  // A venue move can change the CITY, and a city may run its own season.
  if ('avpTier' in body || scheduledAt !== undefined || patch.location !== undefined) {
    const { data: finished } = await supabaseAdmin
      .from('tournament_categories')
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
