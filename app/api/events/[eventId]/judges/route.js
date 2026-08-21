import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// The judging crew of an event: add a judge, remove one, or hand the
// «головний суддя» badge to somebody. Any number of ordinary judges,
// at most one head (the DB enforces that with a partial unique index).
//
// Managing the crew is an admin action — the head judge runs the day
// (scores, courts, who judges which game), but not the roster.
//
// body: { playerId, action: 'add' | 'remove' | 'set_head' | 'clear_head' }
const ACTIONS = ['add', 'remove', 'set_head', 'clear_head'];

export async function POST(request, { params }) {
  const { eventId } = params;

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

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  }

  const { playerId, action } = await request.json();
  if (!ACTIONS.includes(action)) {
    return Response.json({ success: false, error: 'Невідома дія' }, { status: 400 });
  }

  if (action === 'clear_head') {
    const { error } = await supabaseAdmin
      .from('tournament_judges')
      .update({ is_head: false })
      .eq('event_id', eventId)
      .eq('is_head', true);
    if (error) {
      console.error('[judges clear_head]:', error.message);
      return Response.json({ success: false, error: 'Не вдалося зберегти' }, { status: 500 });
    }
    return Response.json({ success: true });
  }

  if (!playerId) {
    return Response.json({ success: false, error: 'Оберіть гравця' }, { status: 400 });
  }

  const { data: judgePlayer } = await supabaseAdmin
    .from('users')
    .select('id, approval_status')
    .eq('id', playerId)
    .maybeSingle();
  if (!judgePlayer) {
    return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });
  }

  if (action === 'remove') {
    const { error } = await supabaseAdmin
      .from('tournament_judges')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', playerId);
    if (error) {
      console.error('[judges remove]:', error.message);
      return Response.json({ success: false, error: 'Не вдалося видалити суддю' }, { status: 500 });
    }
    // The games they were assigned to lose their judge; the crew still
    // covers them, so this is a blank cell, not an error. Only this
    // event's games — the same person may judge another day.
    const { data: cats } = await supabaseAdmin.from('tournament_categories').select('id').eq('event_id', eventId);
    const categoryIds = (cats || []).map((c) => c.id);
    if (categoryIds.length > 0) {
      const { error: unassign } = await supabaseAdmin
        .from('tournament_matches')
        .update({ judge_id: null })
        .eq('judge_id', playerId)
        .in('category_id', categoryIds);
      if (unassign) console.error('[judges remove] unassign:', unassign.message);
    }
    return Response.json({ success: true });
  }

  if (action === 'add') {
    const { error } = await supabaseAdmin
      .from('tournament_judges')
      .insert({ event_id: eventId, user_id: playerId });
    if (error) {
      if (error.code === '23505') {
        return Response.json({ success: false, error: 'Цей суддя вже у списку' }, { status: 400 });
      }
      console.error('[judges add]:', error.message);
      return Response.json({ success: false, error: 'Не вдалося додати суддю' }, { status: 500 });
    }
    return Response.json({ success: true });
  }

  // set_head — demote the current head first (one per event), then
  // promote this one, adding them to the crew if they aren't in it yet.
  const { error: demote } = await supabaseAdmin
    .from('tournament_judges')
    .update({ is_head: false })
    .eq('event_id', eventId)
    .eq('is_head', true);
  if (demote) {
    console.error('[judges demote]:', demote.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти' }, { status: 500 });
  }

  const { error } = await supabaseAdmin
    .from('tournament_judges')
    .upsert({ event_id: eventId, user_id: playerId, is_head: true }, { onConflict: 'event_id,user_id' });
  if (error) {
    console.error('[judges set_head]:', error.message);
    return Response.json({ success: false, error: 'Не вдалося призначити головного суддю' }, { status: 500 });
  }

  return Response.json({ success: true });
}
