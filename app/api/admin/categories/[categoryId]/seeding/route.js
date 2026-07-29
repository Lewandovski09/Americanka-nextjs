import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';

// Save the manual seeding of a category: the admin sends the roster in
// the order they arranged it, and every row gets its position as
// `slot_index` (0-based). The seed is what the bracket builder reads at
// start, so it can only be changed while the category has not started.
export async function POST(request, { params }) {
  const { categoryId } = params;

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

  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('id, status, tournament_events(format_kind)')
    .eq('id', categoryId)
    .maybeSingle();
  if (!category) {
    return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 404 });
  }
  if (category.status !== 'scheduled') {
    return Response.json(
      { success: false, error: 'Посів можна змінювати лише до старту категорії' },
      { status: 400 }
    );
  }

  const format = getFormat(category.tournament_events?.format_kind);
  if (!format) return Response.json({ success: false, error: 'Невідомий формат' }, { status: 400 });
  const isPair = format.registrationType === 'pair' || format.registrationType === 'mix_pair';

  const { order } = await request.json();
  if (!Array.isArray(order) || order.length === 0) {
    return Response.json({ success: false, error: 'Порожній посів' }, { status: 400 });
  }

  const table = isPair ? 'tournament_teams' : 'tournament_players';
  const key = isPair ? 'id' : 'player_id';

  const { data: roster } = await supabaseAdmin
    .from(table)
    .select(key)
    .eq('tournament_id', categoryId);

  // The payload must be exactly the current roster — no extras, no gaps,
  // no duplicates — otherwise a stale tab could half-seed the category.
  const rosterKeys = new Set((roster || []).map((r) => r[key]));
  const sentKeys = new Set(order.map(String));
  if (sentKeys.size !== order.length) {
    return Response.json({ success: false, error: 'Дублікати у посіві' }, { status: 400 });
  }
  if (sentKeys.size !== rosterKeys.size || [...sentKeys].some((k) => !rosterKeys.has(k))) {
    return Response.json(
      { success: false, error: 'Склад змінився — оновіть сторінку і повторіть' },
      { status: 409 }
    );
  }

  // Two passes: the target slots overlap the current ones, and
  // (tournament_id, slot_index) is unique — so park everything on
  // negative slots first, then write the real positions.
  for (let i = 0; i < order.length; i++) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({ slot_index: -1 - i })
      .eq('tournament_id', categoryId)
      .eq(key, order[i]);
    if (error) {
      console.error('[seeding] park error:', error.message);
      return Response.json({ success: false, error: 'Не вдалося зберегти посів' }, { status: 500 });
    }
  }
  for (let i = 0; i < order.length; i++) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({ slot_index: i })
      .eq('tournament_id', categoryId)
      .eq(key, order[i]);
    if (error) {
      console.error('[seeding] write error:', error.message);
      return Response.json({ success: false, error: 'Не вдалося зберегти посів' }, { status: 500 });
    }
  }

  return Response.json({ success: true, seeded: order.length });
}
