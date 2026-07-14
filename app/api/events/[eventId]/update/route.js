import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat, FIRST_TO_OPTIONS } from '@/lib/formats';
import {
  validateCategory,
  computeEloBands,
  categoryRow,
  resolveScoring,
} from '@/lib/server/eventConfig';

// Update a scheduled event's secondary settings (name, date, venue,
// courts, scoring) and reconcile its category list. The format itself is
// fixed at creation. Categories may be added freely; a category can only
// be removed while nobody is assigned to it (roster or reserve).
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
    return Response.json({ success: false, error: 'Тільки адмін може змінювати турніри' }, { status: 403 });
  }

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  }
  if (event.status !== 'scheduled') {
    return Response.json(
      { success: false, error: 'Налаштування можна змінювати лише до старту турніру' },
      { status: 400 }
    );
  }

  const format = getFormat(event.format_kind);
  if (!format) {
    return Response.json({ success: false, error: 'Невідомий формат турніру' }, { status: 400 });
  }

  const body = await request.json();
  const { name, location, courts, scheduledAt, categories } = body;

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

  // Reconcile against the existing categories: rows whose id is still in
  // the payload are updated, payload entries without an id are inserted,
  // and existing rows missing from the payload are deleted — but only
  // when nobody is assigned to them yet.
  const { data: existing } = await supabaseAdmin
    .from('tournaments')
    .select('id, category_label, gender, tournament_players(count), tournament_teams(count)')
    .eq('event_id', eventId);

  const keptIds = new Set(categories.filter((c) => c.id).map((c) => c.id));
  const removed = (existing || []).filter((row) => !keptIds.has(row.id));

  for (const row of removed) {
    const members =
      (row.tournament_players?.[0]?.count || 0) + (row.tournament_teams?.[0]?.count || 0);
    if (members > 0) {
      return Response.json(
        {
          success: false,
          error: `У категорії «${row.category_label}» вже є учасники — спочатку перенесіть або приберіть їх`,
        },
        { status: 400 }
      );
    }
  }
  if (removed.length > 0) {
    const removedIds = removed.map((r) => r.id);
    const { count: parked } = await supabaseAdmin
      .from('tournament_applications')
      .select('id', { count: 'exact', head: true })
      .in('assigned_tournament_id', removedIds)
      .in('status', ['assigned', 'reserve']);
    if (parked > 0) {
      return Response.json(
        { success: false, error: 'У категорії, яку ви прибираєте, є заявки (склад або резерв)' },
        { status: 400 }
      );
    }
  }

  const bandByKey = await computeEloBands(supabaseAdmin, format, categories);

  const { data: updatedEvent, error: eventError } = await supabaseAdmin
    .from('tournament_events')
    .update({
      name: name?.trim() || format.displayName,
      location,
      courts,
      scheduled_at: scheduledAt,
      points_to_win: scoring.points,
      points_mode: scoring.mode,
      final_points_to_win: scoring.finalPoints,
    })
    .eq('id', eventId)
    .select()
    .single();

  if (eventError) {
    console.error('[update-event] event error:', eventError.message);
    return Response.json({ success: false, error: 'Не вдалося оновити подію' }, { status: 500 });
  }

  if (removed.length > 0) {
    const { error: delError } = await supabaseAdmin
      .from('tournaments')
      .delete()
      .in('id', removed.map((r) => r.id));
    if (delError) {
      console.error('[update-event] delete error:', delError.message);
      return Response.json({ success: false, error: 'Не вдалося прибрати категорію' }, { status: 500 });
    }
  }

  for (const c of categories) {
    const row = categoryRow(format, updatedEvent, c, bandByKey);
    const { error: catError } = c.id
      ? await supabaseAdmin.from('tournaments').update(row).eq('id', c.id).eq('event_id', eventId)
      : await supabaseAdmin
          .from('tournaments')
          .insert({ ...row, status: 'scheduled', created_by: authUser.user.id });
    if (catError) {
      console.error('[update-event] category error:', catError.message);
      return Response.json({ success: false, error: 'Не вдалося оновити категорії' }, { status: 500 });
    }
  }

  return Response.json({ success: true, event: updatedEvent });
}
