import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat, FIRST_TO_OPTIONS } from '@/lib/formats';
import {
  validateCategory,
  computeEloBands,
  categoryRow,
  resolveScoring,
} from '@/lib/server/eventConfig';

// Create an EVENT (tournament_events) plus its CATEGORIES (one
// `tournaments` row each). Categories start empty and open for
// applications — players are placed later (self-register or admin
// distribution), and matches/brackets are generated once registration
// closes.
export async function POST(request) {
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

  const scoring = resolveScoring(format, body, FIRST_TO_OPTIONS);
  if (scoring.error) {
    return Response.json({ success: false, error: scoring.error }, { status: 400 });
  }

  // Validate every category against the format's rules before writing
  // anything, so a bad category can't leave a half-created event.
  const seen = new Set();
  for (const c of categories) {
    const err = validateCategory(format, c);
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

  // Auto-derive per-league Elo bands: split the real rating spread
  // (min→max across approved players) evenly among the selected leagues,
  // Light (lowest) → Pro (highest). Purely a guideline for the admin — no
  // manual entry. Falls back to no band when there's no usable spread.
  const bandByKey = await computeEloBands(supabaseAdmin, format, categories);

  const { data: event, error: eventError } = await supabaseAdmin
    .from('tournament_events')
    .insert({
      name: name?.trim() || format.displayName,
      format_kind: format.kind,
      location,
      courts,
      scheduled_at: scheduledAt,
      points_to_win: scoring.points,
      points_mode: scoring.mode,
      final_points_to_win: scoring.finalPoints,
      // Single registration flow: everyone applies to a chosen league and
      // the admin distributes. The column is kept for schema stability.
      registration_mode: 'admin_assign',
      status: 'scheduled',
      created_by: authUser.user.id,
    })
    .select()
    .single();

  if (eventError) {
    console.error('[create-event] event error:', eventError.message);
    return Response.json({ success: false, error: 'Не вдалося створити подію' }, { status: 500 });
  }

  const categoryRows = categories.map((c) => ({
    ...categoryRow(format, event, c, bandByKey),
    status: 'scheduled',
    created_by: authUser.user.id,
  }));

  const { error: catError } = await supabaseAdmin.from('tournaments').insert(categoryRows);
  if (catError) {
    console.error('[create-event] categories error:', catError.message);
    // Roll back the event so we don't leave an event with no categories.
    await supabaseAdmin.from('tournament_events').delete().eq('id', event.id);
    return Response.json({ success: false, error: 'Не вдалося створити категорії' }, { status: 500 });
  }

  return Response.json({ success: true, event });
}
