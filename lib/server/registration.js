// Server-side helper: place a participant into a category
// (`tournaments` row). Used by admin distribution — the single place
// where capacity/uniqueness rules live. Solo formats write
// `tournament_players`; pair formats write `tournament_teams`.

/**
 * Everyone an event has already taken: a live application (their own, or
 * one that names them as the partner) or a place in one of its rosters.
 * One person = one application per event, so this is the set both the
 * self-service registration and the admin's manual entry check against.
 *
 * @param {object} supabaseAdmin - service-role client (bypasses RLS)
 * @param {string} eventId
 * @returns {Promise<Set<string>>} player ids
 */
export async function eventParticipantIds(supabaseAdmin, eventId) {
  const ids = new Set();

  const { data: apps } = await supabaseAdmin
    .from('tournament_applications')
    .select('player_id, partner_id')
    .eq('event_id', eventId)
    .not('status', 'in', '(withdrawn,rejected)');
  (apps || []).forEach((a) => {
    if (a.player_id) ids.add(a.player_id);
    if (a.partner_id) ids.add(a.partner_id);
  });

  // Rosters too: a manually entered player or one distributed long ago
  // must not be offered again even if the application rows drifted.
  const { data: cats } = await supabaseAdmin.from('tournaments').select('id').eq('event_id', eventId);
  const catIds = (cats || []).map((c) => c.id);
  if (catIds.length > 0) {
    const [{ data: solos }, { data: teams }] = await Promise.all([
      supabaseAdmin.from('tournament_players').select('player_id').in('tournament_id', catIds),
      supabaseAdmin.from('tournament_teams').select('player1_id, player2_id').in('tournament_id', catIds),
    ]);
    (solos || []).forEach((r) => ids.add(r.player_id));
    (teams || []).forEach((t) => {
      if (t.player1_id) ids.add(t.player1_id);
      if (t.player2_id) ids.add(t.player2_id);
    });
  }

  return ids;
}

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
