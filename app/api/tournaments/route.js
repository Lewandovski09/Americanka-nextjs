import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildMatchesForTournament } from '@/lib/tournamentEngine';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(request) {
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const {
    name,
    formatCode, // e.g. 'americano_2v2_8p' — looked up dynamically, not hardcoded
    category,
    gender,
    location,
    courts,
    scheduledAt,
    playerIds, // ordered array, playerIds[i] = player for slot i
  } = await request.json();

  const supabaseAdmin = createAdminClient();

  const { data: format, error: formatError } = await supabaseAdmin
    .from('tournament_formats')
    .select('*')
    .eq('code', formatCode)
    .eq('is_active', true)
    .single();

  if (formatError || !format) {
    return Response.json({ success: false, error: 'Невідомий формат турніру' }, { status: 400 });
  }

  if (!Array.isArray(playerIds) || playerIds.length !== format.player_count) {
    return Response.json(
      { success: false, error: `Потрібно рівно ${format.player_count} гравців для цього формату` },
      { status: 400 }
    );
  }

  // Fetch current Elo for the snapshot (elo_at_start)
  const { data: players } = await supabaseAdmin
    .from('players')
    .select('id, elo')
    .in('id', playerIds);

  const eloByPlayerId = Object.fromEntries((players || []).map((p) => [p.id, p.elo]));

  const { data: tournament, error: tError } = await supabaseAdmin
    .from('tournaments')
    .insert({
      name,
      format_id: format.id,
      category,
      gender,
      location,
      courts,
      scheduled_at: scheduledAt,
      status: 'live',
      started_at: new Date().toISOString(),
      created_by: authUser.user.id,
    })
    .select()
    .single();

  if (tError) {
    console.error('[create-tournament] error:', tError.message);
    return Response.json({ success: false, error: 'Не вдалося створити турнір' }, { status: 500 });
  }

  // Insert tournament_players with their slot index + elo snapshot
  const tournamentPlayersRows = playerIds.map((pid, idx) => ({
    tournament_id: tournament.id,
    player_id: pid,
    slot_index: idx,
    elo_at_start: eloByPlayerId[pid] ?? 1200,
  }));

  await supabaseAdmin.from('tournament_players').insert(tournamentPlayersRows);

  // Build and insert the concrete matches from the format's schedule
  const matchRows = buildMatchesForTournament(format.schedule, playerIds, courts).map((m) => ({
    ...m,
    tournament_id: tournament.id,
  }));

  await supabaseAdmin.from('matches').insert(matchRows);

  // Notify the invited players in Telegram, best-effort — failures
  // here don't fail the tournament creation itself.
  const { data: invitedPlayers } = await supabaseAdmin
    .from('players')
    .select('telegram_chat_id, full_name')
    .in('id', playerIds)
    .not('telegram_chat_id', 'is', null);

  const text =
    `🏆 <b>Новий турнір!</b>\n\n` +
    `<b>${name}</b>\n` +
    `${new Date(scheduledAt).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })}\n` +
    `${location === 'beach13' ? 'Beach 13' : 'Dynamo SC'}\n\n` +
    `Ви запрошені! Заходьте в застосунок, щоб переглянути деталі.`;

  await Promise.allSettled(
    (invitedPlayers || []).map((p) => sendTelegramMessage(p.telegram_chat_id, text))
  );

  return Response.json({ success: true, tournament });
}
