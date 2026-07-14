import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { placeMember } from '@/lib/server/registration';

// Admin moves a participant (solo player or pair) within an event.
// Targets:
//   • another league's roster (default) — places them there, with a
//     capacity check;
//   • a league's RESERVE (asReserve) — pulls them out of the roster and
//     parks them in that league's reserve (this league or another one).
// Only allowed while the categories involved are still open (not started).
export async function POST(request, { params }) {
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
  if (!caller?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  const { fromCategoryId, targetCategoryId, playerId, teamId, asReserve } = await request.json();
  // Roster→roster to the same league is a no-op; to the same league's
  // reserve is allowed (bench them within their league).
  if (!asReserve && fromCategoryId === targetCategoryId) {
    return Response.json({ success: false, error: 'Категорії збігаються' }, { status: 400 });
  }

  const { data: from } = await supabaseAdmin
    .from('tournaments')
    .select('id, event_id, status')
    .eq('id', fromCategoryId)
    .maybeSingle();
  const { data: target } = await supabaseAdmin
    .from('tournaments')
    .select('*, tournament_events(format_kind)')
    .eq('id', targetCategoryId)
    .maybeSingle();

  if (!from || !target) return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 404 });
  if (from.event_id !== target.event_id) {
    return Response.json({ success: false, error: 'Категорії з різних подій' }, { status: 400 });
  }
  if (from.status !== 'scheduled' || target.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Переносити можна лише до старту категорій' }, { status: 400 });
  }

  const format = getFormat(target.tournament_events?.format_kind);
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';

  // ── Move to a league's reserve (no roster placement) ──────────
  if (asReserve) {
    if (isPair) {
      if (!teamId) return Response.json({ success: false, error: 'Не вказано пару' }, { status: 400 });
      const { data: team } = await supabaseAdmin
        .from('tournament_teams')
        .select('player1_id, player2_id')
        .eq('id', teamId)
        .eq('tournament_id', fromCategoryId)
        .maybeSingle();
      if (!team) return Response.json({ success: false, error: 'Пару не знайдено' }, { status: 404 });

      await supabaseAdmin.from('tournament_teams').delete().eq('id', teamId).eq('tournament_id', fromCategoryId);
      await supabaseAdmin
        .from('tournament_applications')
        .update({ status: 'reserve', assigned_tournament_id: targetCategoryId })
        .eq('event_id', from.event_id)
        .in('player_id', [team.player1_id, team.player2_id].filter(Boolean));
      return Response.json({ success: true, reserved: true });
    }

    if (!playerId) return Response.json({ success: false, error: 'Не вказано гравця' }, { status: 400 });
    const { data: row } = await supabaseAdmin
      .from('tournament_players')
      .select('player_id')
      .eq('tournament_id', fromCategoryId)
      .eq('player_id', playerId)
      .maybeSingle();
    if (!row) return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });

    await supabaseAdmin
      .from('tournament_players')
      .delete()
      .eq('tournament_id', fromCategoryId)
      .eq('player_id', playerId);
    await supabaseAdmin
      .from('tournament_applications')
      .update({ status: 'reserve', assigned_tournament_id: targetCategoryId })
      .eq('event_id', from.event_id)
      .eq('player_id', playerId);
    return Response.json({ success: true, reserved: true });
  }

  if (isPair) {
    if (!teamId) return Response.json({ success: false, error: 'Не вказано пару' }, { status: 400 });

    const { data: team } = await supabaseAdmin
      .from('tournament_teams')
      .select('*')
      .eq('id', teamId)
      .eq('tournament_id', fromCategoryId)
      .maybeSingle();
    if (!team) return Response.json({ success: false, error: 'Пару не знайдено' }, { status: 404 });

    const { count } = await supabaseAdmin
      .from('tournament_teams')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', targetCategoryId);
    if (target.max_participants && count >= target.max_participants) {
      return Response.json({ success: false, error: 'У цільовій категорії немає місць' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('tournament_teams')
      .update({ tournament_id: targetCategoryId })
      .eq('id', teamId);
    if (error) {
      if (error.code === '23505') return Response.json({ success: false, error: 'Гравець вже у цільовій категорії' }, { status: 400 });
      return Response.json({ success: false, error: 'Не вдалося перенести пару' }, { status: 500 });
    }

    await supabaseAdmin
      .from('tournament_applications')
      .update({ assigned_tournament_id: targetCategoryId })
      .eq('event_id', from.event_id)
      .in('player_id', [team.player1_id, team.player2_id].filter(Boolean));

    return Response.json({ success: true });
  }

  // Solo
  if (!playerId) return Response.json({ success: false, error: 'Не вказано гравця' }, { status: 400 });

  const { data: row } = await supabaseAdmin
    .from('tournament_players')
    .select('elo_at_start')
    .eq('tournament_id', fromCategoryId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (!row) return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });

  // Place into target first (capacity/uniqueness checked there); only
  // remove from source if that succeeds.
  const placed = await placeMember(supabaseAdmin, target, format, {
    playerId,
    elo: row.elo_at_start,
  });
  if (placed.error) return Response.json({ success: false, error: placed.error }, { status: 400 });

  await supabaseAdmin
    .from('tournament_players')
    .delete()
    .eq('tournament_id', fromCategoryId)
    .eq('player_id', playerId);

  await supabaseAdmin
    .from('tournament_applications')
    .update({ assigned_tournament_id: targetCategoryId })
    .eq('event_id', from.event_id)
    .eq('player_id', playerId);

  return Response.json({ success: true });
}
