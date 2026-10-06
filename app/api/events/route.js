import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat, FIRST_TO_OPTIONS } from '@/lib/formats';
import {
  validateCategory,
  categoryRow,
  resolveScoring,
  resolveAvpTier,
  resolveVenue,
  resolveSport,
} from '@/lib/server/eventConfig';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { parseEntryFee, parseRegistrationOpens } from '@/lib/registrationWindow';

// Create an EVENT (tournament_events) plus its CATEGORIES (one
// `tournaments` row each). Categories start empty and open for
// applications — players are placed later (self-register or admin
// distribution), and matches/brackets are generated once registration
// closes.
export async function POST(request) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може створювати турніри' }, { status: 403 });
  }

  const body = await request.json();
  const { formatKind, name, location, courts, scheduledAt, categories } = body;

  const format = getFormat(formatKind);
  if (!format) {
    return Response.json({ success: false, error: 'Невідомий формат турніру' }, { status: 400 });
  }
  if (!scheduledAt) {
    return Response.json({ success: false, error: 'Вкажіть дату та час' }, { status: 400 });
  }
  if (!Array.isArray(courts) || courts.length === 0) {
    return Response.json({ success: false, error: 'Виберіть щонайменше один корт' }, { status: 400 });
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return Response.json({ success: false, error: 'Додайте щонайменше одну категорію' }, { status: 400 });
  }

  // Sport first (it decides which formats and divisions are valid), then
  // the venue against the `venues` table: exists, hosts this sport, has
  // these courts. Replaces the old hardcoded beach13 / dynamo_sc list.
  const sport = resolveSport(body.sportId, format.kind);
  if (sport.error) {
    return Response.json({ success: false, error: sport.error }, { status: 400 });
  }
  const venueCheck = await resolveVenue(supabaseAdmin, location, sport.sportId, courts);
  if (venueCheck.error) {
    return Response.json({ success: false, error: venueCheck.error }, { status: 400 });
  }

  const scoring = resolveScoring(format, body, FIRST_TO_OPTIONS);
  if (scoring.error) {
    return Response.json({ success: false, error: scoring.error }, { status: 400 });
  }

  const avp = resolveAvpTier(body.avpTier);
  if (avp.error) {
    return Response.json({ success: false, error: avp.error }, { status: 400 });
  }

  // The fee per player (asked at creation; 0 = free) and when applications
  // open (empty = at once) — migration 066.
  const fee = parseEntryFee(body.entryFee, { required: true });
  if (fee.error) return Response.json({ success: false, error: fee.error }, { status: 400 });
  const opens = parseRegistrationOpens(body.registrationOpensAt, scheduledAt);
  if (opens.error) return Response.json({ success: false, error: opens.error }, { status: 400 });

  // Validate every category against the format's rules before writing
  // anything, so a bad category can't leave a half-created event.
  const seen = new Set();
  for (const c of categories) {
    const err = validateCategory(format, c, sport.sportId);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });

    const key = `${c.gender || 'X'}:${c.categoryLabel}`;
    if (seen.has(key)) {
      return Response.json(
        { success: false, error: `Категорія «${c.categoryLabel}» повторюється` },
        { status: 400 }
      );
    }
    seen.add(key);
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('tournament_events')
    .insert({
      name: name?.trim() || format.displayName,
      format_kind: format.kind,
      sport_id: sport.sportId,
      location: venueCheck.venue.code,
      courts,
      scheduled_at: scheduledAt,
      points_to_win: scoring.points,
      points_mode: scoring.mode,
      final_points_to_win: scoring.finalPoints,
      avp_tier: avp.tier,
      entry_fee: fee.fee,
      registration_opens_at: opens.opensAt,
      status: 'scheduled',
      created_by: authUser.user.id,
    })
    .select()
    .single();

  if (eventError) {
    console.error('[create-event] event error:', eventError.message);
    const missing = /entry_fee|registration_opens_at/.test(eventError.message || '');
    return Response.json(
      { success: false, error: missing ? 'Не вдалося створити подію — виконайте SQL 066 у Supabase' : 'Не вдалося створити подію' },
      { status: 500 }
    );
  }

  const categoryRows = categories.map((c) => ({
    ...categoryRow(format, event, c),
    status: 'scheduled',
    created_by: authUser.user.id,
  }));

  const { error: catError } = await supabaseAdmin.from('tournament_categories').insert(categoryRows);
  if (catError) {
    console.error('[create-event] categories error:', catError.message);
    // Roll back the event so we don't leave an event with no categories.
    await supabaseAdmin.from('tournament_events').delete().eq('id', event.id);
    return Response.json({ success: false, error: 'Не вдалося створити категорії' }, { status: 500 });
  }

  return Response.json({ success: true, event });
}
