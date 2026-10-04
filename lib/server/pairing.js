// Pairing helpers shared by the application route and the pair
// invitations (migration 058).

// Deletes the «Шукаю пару» notices (migration 051) of these players in
// every category of the event. Best-effort: a missing table (migration
// not run yet) must not break the application itself.
export async function dropPartnerAds(supabaseAdmin, eventId, userIds) {
  const { data: cats } = await supabaseAdmin.from('tournament_categories').select('id').eq('event_id', eventId);
  const ids = (cats || []).map((c) => c.id);
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin.from('partner_ads').delete().in('category_id', ids).in('user_id', userIds);
  if (error) console.error('[apply] partner_ads cleanup:', error.message);
}

// `seekerId` applied alone, looking for a partner; `playerId` joins them.
// Their application gets the partner; if the admin has already placed
// them into a category (a half-filled pair), the empty seat is filled.
//
// Both writes are conditional (only an application still without a
// partner, only a seat still empty): two players accepted at the same
// moment used to both pass the check and both «join» one seeker. Now
// one wins, the other gets an error and nothing of theirs is written.
export async function joinSeeker(supabaseAdmin, eventId, seekerId, playerId) {
  const { data: app } = await supabaseAdmin
    .from('tournament_applications')
    .select('id, status, partner_id, seeking_partner, assigned_category_id')
    .eq('event_id', eventId)
    .eq('user_id', seekerId)
    .not('status', 'in', '(withdrawn,rejected)')
    .maybeSingle();
  if (!app || app.partner_id || !app.seeking_partner) {
    return { error: 'Напарник вже заявлений на цю подію' };
  }

  // Which team seat to fill, if the seeker is already placed.
  let team = null;
  if (app.status === 'assigned' && app.assigned_category_id) {
    const { data: cat } = await supabaseAdmin
      .from('tournament_categories')
      .select('status')
      .eq('id', app.assigned_category_id)
      .maybeSingle();
    if (cat?.status !== 'scheduled') return { error: 'Цю лігу вже розпочато' };
    const { data: t } = await supabaseAdmin
      .from('tournament_teams')
      .select('id, user1_id, user2_id')
      .eq('category_id', app.assigned_category_id)
      .or(`user1_id.eq.${seekerId},user2_id.eq.${seekerId}`)
      .maybeSingle();
    if (t) {
      if (t.user1_id && t.user2_id) return { error: 'У напарника вже є пара' };
      team = t;
    }
  }

  // 1. claim the application
  const { data: claimed, error } = await supabaseAdmin
    .from('tournament_applications')
    .update({ partner_id: playerId, seeking_partner: false })
    .eq('id', app.id)
    .is('partner_id', null)
    .select('id');
  if (error) {
    // migration 063: the joiner is already someone's partner in this event
    if (error.code === '23505') return { error: 'Гравець уже в парі з іншим напарником' };
    console.error('[apply] join application:', error.message);
    return { error: 'Не вдалося приєднатися до заявки' };
  }
  if ((claimed || []).length !== 1) return { error: 'Напарник щойно знайшов іншу пару' };

  // 2. fill the empty seat, if there is a team
  if (team) {
    const col = team.user1_id ? 'user2_id' : 'user1_id';
    const { data: seated, error: e2 } = await supabaseAdmin
      .from('tournament_teams')
      .update({ [col]: playerId })
      .eq('id', team.id)
      .is(col, null)
      .select('id');
    if (e2 || (seated || []).length !== 1) {
      if (e2) console.error('[apply] join team:', e2.message);
      await supabaseAdmin
        .from('tournament_applications')
        .update({ partner_id: null, seeking_partner: true })
        .eq('id', app.id)
        .eq('partner_id', playerId);
      return { error: 'Не вдалося приєднатися до пари' };
    }
  }
  return {};
}
