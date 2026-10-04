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

  if (app.status === 'assigned' && app.assigned_category_id) {
    const { data: cat } = await supabaseAdmin
      .from('tournament_categories')
      .select('status')
      .eq('id', app.assigned_category_id)
      .maybeSingle();
    if (cat?.status !== 'scheduled') return { error: 'Цю лігу вже розпочато' };
    const { data: team } = await supabaseAdmin
      .from('tournament_teams')
      .select('id, user1_id, user2_id')
      .eq('category_id', app.assigned_category_id)
      .or(`user1_id.eq.${seekerId},user2_id.eq.${seekerId}`)
      .maybeSingle();
    if (team) {
      if (team.user1_id && team.user2_id) return { error: 'У напарника вже є пара' };
      const seat = team.user1_id ? { user2_id: playerId } : { user1_id: playerId };
      const { error } = await supabaseAdmin.from('tournament_teams').update(seat).eq('id', team.id);
      if (error) {
        console.error('[apply] join team:', error.message);
        return { error: 'Не вдалося приєднатися до пари' };
      }
    }
  }

  const { error } = await supabaseAdmin
    .from('tournament_applications')
    .update({ partner_id: playerId, seeking_partner: false })
    .eq('id', app.id);
  if (error) {
    console.error('[apply] join application:', error.message);
    return { error: 'Не вдалося приєднатися до заявки' };
  }
  return {};
}
