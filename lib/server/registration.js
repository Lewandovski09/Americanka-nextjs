// Server-side helper: place a participant into a category
// (`tournaments` row). Used by admin distribution — the single place
// where capacity/uniqueness rules live. Solo formats write
// `tournament_players`; pair formats write `tournament_teams`.

/**
 * @param {object} supabaseAdmin - service-role client (bypasses RLS)
 * @param {object} category - the tournaments row (id, max_participants, ...)
 * @param {object} format - the format descriptor from lib/formats
 * @param {object} applicant - { playerId, partnerId, seekingPartner, elo }
 * @returns {Promise<{error?: string}>}
 */
export async function placeMember(supabaseAdmin, category, format, applicant) {
  const isPair = format.registrationType === 'pair' || format.registrationType === 'mix_pair';

  if (isPair) {
    const { count } = await supabaseAdmin
      .from('tournament_teams')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', category.id);

    const capacity = category.max_participants; // pairs
    if (capacity && count >= capacity) return { error: 'У категорії немає вільних місць' };

    const { error } = await supabaseAdmin.from('tournament_teams').insert({
      tournament_id: category.id,
      player1_id: applicant.playerId,
      player2_id: applicant.seekingPartner ? null : applicant.partnerId || null,
    });
    if (error) {
      if (error.code === '23505') return { error: 'Ви або напарник вже у цій категорії' };
      console.error('[placeMember] team insert:', error.message);
      return { error: 'Не вдалося зареєструвати пару' };
    }
    return {};
  }

  // Solo (americanka / king_of_beach)
  const { count } = await supabaseAdmin
    .from('tournament_players')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', category.id);

  const capacity = category.max_participants || format.fixedParticipants || null;
  if (capacity && count >= capacity) return { error: 'У категорії немає вільних місць' };

  // Next slot = max(existing)+1 rather than the row count, so gaps left
  // by removals/moves can't collide with the unique(tournament_id,
  // slot_index) constraint.
  const { data: last } = await supabaseAdmin
    .from('tournament_players')
    .select('slot_index')
    .eq('tournament_id', category.id)
    .order('slot_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSlot = (last?.slot_index ?? -1) + 1;

  const { error } = await supabaseAdmin.from('tournament_players').insert({
    tournament_id: category.id,
    player_id: applicant.playerId,
    slot_index: nextSlot, // registration order → slot for the schedule
    elo_at_start: applicant.elo ?? 1200,
  });
  if (error) {
    if (error.code === '23505') return { error: 'Ви вже у цій категорії' };
    console.error('[placeMember] player insert:', error.message);
    return { error: 'Не вдалося зареєструватися' };
  }
  return {};
}
