import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { seedCapacity } from '@/lib/formats/seedSlots';

// Save the manual seeding of a category: the admin sends the roster in
// the order they arranged it, and every row gets its position as
// `slot_index` (0-based). The seed is what the bracket builder reads at
// start, so it can only be changed while the category has not started.
//
// A Double Elimination grid may be sent with HOLES (null entries): the
// field is shorter than the bracket and the admin chose where the empty
// places sit, so `slot_index` is simply left with gaps and the builder
// turns each gap into a round-1 bye. Any other system plays exactly its
// roster, so its payload must be dense.
export async function POST(request, { params }) {
  const { categoryId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select('id, status, bracket_system, max_participants, tournament_events(format_kind)')
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

  // Places, in order: a key or null for an empty one.
  const places = order.map((k) => (k === null || k === undefined || k === '' ? null : String(k)));
  const capacity = seedCapacity(category);
  if (!capacity && places.some((k) => k === null)) {
    return Response.json(
      { success: false, error: 'Порожні місця можливі лише в сітці Double Elimination' },
      { status: 400 }
    );
  }

  const table = isPair ? 'tournament_teams' : 'tournament_players';
  const key = isPair ? 'id' : 'user_id';

  const { data: roster } = await supabaseAdmin
    .from(table)
    .select(key)
    .eq('category_id', categoryId);

  // The payload must cover exactly the current roster — no extras, no
  // missing rows, no duplicates — otherwise a stale tab could half-seed
  // the category. Empty places are the only thing allowed on top of it,
  // and only up to the bracket size (an over-full roster keeps its own
  // length: `Запустити` is where that gets rejected, with a message).
  const rosterKeys = new Set((roster || []).map((r) => r[key]));
  const sent = places.filter((k) => k !== null);
  const sentKeys = new Set(sent);
  if (sentKeys.size !== sent.length) {
    return Response.json({ success: false, error: 'Дублікати у посіві' }, { status: 400 });
  }
  if (sentKeys.size !== rosterKeys.size || [...sentKeys].some((k) => !rosterKeys.has(k))) {
    return Response.json(
      { success: false, error: 'Склад змінився — оновіть сторінку і повторіть' },
      { status: 409 }
    );
  }
  if (capacity && places.length > Math.max(capacity, rosterKeys.size)) {
    return Response.json(
      { success: false, error: `Місць більше за розмір сітки (${capacity})` },
      { status: 400 }
    );
  }

  // Two passes: the target slots overlap the current ones, and
  // (category_id, slot_index) is unique — so park everything on
  // negative slots first, then write the real positions.
  const writes = places
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => k !== null);

  for (let n = 0; n < writes.length; n++) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({ slot_index: -1 - n })
      .eq('category_id', categoryId)
      .eq(key, writes[n].k);
    if (error) {
      console.error('[seeding] park error:', error.message);
      return Response.json({ success: false, error: 'Не вдалося зберегти посів' }, { status: 500 });
    }
  }
  for (const { k, i } of writes) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({ slot_index: i })
      .eq('category_id', categoryId)
      .eq(key, k);
    if (error) {
      console.error('[seeding] write error:', error.message);
      return Response.json({ success: false, error: 'Не вдалося зберегти посів' }, { status: 500 });
    }
  }

  return Response.json({ success: true, seeded: writes.length });
}
