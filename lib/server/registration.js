// Server-side helper: place a participant into a category
// (`tournaments` row). Used by admin distribution — the single place
// where capacity/uniqueness rules live. Solo formats write
// `tournament_players`; pair formats write `tournament_teams`.

/**
 * @param {object} supabaseAdmin - service-role client (bypasses RLS)
 * @param {object} category - the tournaments row (id, max_participants, ...)
 * @param {object} format - the format descriptor from lib/formats
 * @param {object} applicant - { playerId, partnerId, seekingPartner }
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

  // No slot_index here on purpose — the seed is set by hand on the
  // «Посів» tab, exactly like for pairs, and the category refuses to
  // start until every row has one.
  const { error } = await supabaseAdmin.from('tournament_players').insert({
    tournament_id: category.id,
    player_id: applicant.playerId,
  });
  if (error) {
    if (error.code === '23505') return { error: 'Ви вже у цій категорії' };
    console.error('[placeMember] player insert:', error.message);
    return { error: 'Не вдалося зареєструватися' };
  }
  return {};
}
