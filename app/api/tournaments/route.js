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

  const body = await request.json();
  const { name, formatCode, location, courts, scheduledAt } = body;

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

  if (!scheduledAt) {
    return Response.json({ success: false, error: 'Вкажіть дату та час' }, { status: 400 });
  }

  if (format.format_type === 'americanka') {
    return createAmericankaTournament({ supabaseAdmin, authUser, format, body });
  }

  return createSelfRegistrationTournament({ supabaseAdmin, authUser, format, body });
}

// ── Americanka: unchanged from before — admin picks the exact 8
// players up front, the tournament starts immediately with matches
// already generated from the format's fixed round-robin schedule. ──
async function createAmericankaTournament({ supabaseAdmin, authUser, format, body }) {
  const { name, category, gender, location, courts, scheduledAt, playerIds } = body;

  if (!Array.isArray(playerIds) || playerIds.length !== format.player_count) {
    return Response.json(
      { success: false, error: `Потрібно рівно ${format.player_count} гравців для цього формату` },
      { status: 400 }
    );
  }

  const { data: players } = await supabaseAdmin.from('players').select('id, elo').in('id', playerIds);
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

  const tournamentPlayersRows = playerIds.map((pid, idx) => ({
    tournament_id: tournament.id,
    player_id: pid,
    slot_index: idx,
    elo_at_start: eloByPlayerId[pid] ?? 1200,
  }));

  await supabaseAdmin.from('tournament_players').insert(tournamentPlayersRows);

  const matchRows = buildMatchesForTournament(format.schedule, playerIds, courts).map((m) => ({
    ...m,
    tournament_id: tournament.id,
  }));

  await supabaseAdmin.from('matches').insert(matchRows);

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

  await Promise.allSettled((invitedPlayers || []).map((p) => sendTelegramMessage(p.telegram_chat_id, text)));

  return Response.json({ success: true, tournament });
}

// ── New formats (single_gender / mix / king_of_beach): create the
// tournament shell only. No players, no matches yet — players
// self-register (Stage 2) and brackets/groups are generated once
// registration closes (Stage 3). ──
async function createSelfRegistrationTournament({ supabaseAdmin, authUser, format, body }) {
  const {
    name,
    gender, // 'M' | 'F' for single_gender / king_of_beach; omitted/null for mix
    location,
    courts,
    scheduledAt,
    maxParticipants,
    bracketSystem, // only for single_gender / mix
    categoryText,
    pointsToWin,
    finalPointsToWin,
  } = body;

  if (!maxParticipants) {
    return Response.json({ success: false, error: 'Вкажіть максимальну кількість учасників' }, { status: 400 });
  }
  if (format.format_type === 'king_of_beach' && maxParticipants % 4 !== 0) {
    return Response.json({ success: false, error: 'Кількість учасників має бути кратною 4' }, { status: 400 });
  }
  if ((format.format_type === 'single_gender' || format.format_type === 'mix') && !bracketSystem) {
    return Response.json({ success: false, error: 'Виберіть систему турніру' }, { status: 400 });
  }

  const { data: tournament, error: tError } = await supabaseAdmin
    .from('tournaments')
    .insert({
      name,
      format_id: format.id,
      gender: format.format_type === 'mix' ? null : gender,
      location,
      courts,
      scheduled_at: scheduledAt,
      status: 'scheduled',
      created_by: authUser.user.id,
      max_participants: maxParticipants,
      bracket_system: bracketSystem || null,
      category_text: categoryText || null,
      points_to_win: pointsToWin || 21,
      final_points_to_win: finalPointsToWin || null,
    })
    .select()
    .single();

  if (tError) {
    console.error('[create-tournament] error:', tError.message);
    return Response.json({ success: false, error: 'Не вдалося створити турнір' }, { status: 500 });
  }

  return Response.json({ success: true, tournament });
}
