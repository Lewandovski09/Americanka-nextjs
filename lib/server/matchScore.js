// Saving a game's score — used by app/api/matches/[matchId]/score.

// Writes the score and reports what it replaced:
// { saved, wasPlayed, prev: { set1, set2, set3 } } or { error }.
// Uses save_match_score (migration 062, row lock). Until that migration
// is run, falls back to the older claim: the first entry flips
// played → true atomically, a correction re-reads the row first.
export async function saveScore(supabaseAdmin, match, newSets, allowCorrection) {
  const { data, error } = await supabaseAdmin.rpc('save_match_score', {
    p_match: match.id,
    p_set1: newSets.set1,
    p_set2: newSets.set2,
    p_set3: newSets.set3,
    p_allow_correction: !!allowCorrection,
  });
  const missing =
    error && (error.code === 'PGRST202' || error.code === '42883' || /save_match_score/.test(error.message || ''));
  if (error && !missing) return { error: error.message };
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { error: 'match not found' };
    return {
      saved: !!row.saved,
      wasPlayed: !!row.was_played,
      prev: { set1: row.old_set1, set2: row.old_set2, set3: row.old_set3 },
    };
  }

  // ── fallback (before migration 062) ──
  if (!match.played) {
    const { data: claimed, error: e1 } = await supabaseAdmin
      .from('tournament_matches')
      .update({ ...newSets, played: true, played_at: new Date().toISOString() })
      .eq('id', match.id)
      .eq('played', false)
      .select('id');
    if (e1) return { error: e1.message };
    if ((claimed || []).length === 1) return { saved: true, wasPlayed: false, prev: {} };
    if (!allowCorrection) return { saved: false, wasPlayed: true, prev: {} };
  }
  const { data: fresh, error: e2 } = await supabaseAdmin
    .from('tournament_matches')
    .select('set1, set2, set3')
    .eq('id', match.id)
    .maybeSingle();
  if (e2) return { error: e2.message };
  const { error: e3 } = await supabaseAdmin
    .from('tournament_matches')
    .update({ ...newSets, played: true })
    .eq('id', match.id);
  if (e3) return { error: e3.message };
  return { saved: true, wasPlayed: true, prev: fresh || match };
}
