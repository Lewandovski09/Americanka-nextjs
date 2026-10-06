// Removing one category (league) of a tournament — «Видалити категорію»
// in the settings, and the leagues left out when a tournament is started
// with only some of them full (start route, { partial: true }).
//
// Like deleting a whole event (app/api/events/[eventId]/delete): the
// category's rows (roster, teams, matches, AVP points, invitations, …)
// go by ON DELETE CASCADE, and Ело already given for its games is put
// back on the players first — users.elo is a running number the cascade
// can't undo. Applications that were placed into it go back to the queue
// while the tournament takes applications, and are closed once it has
// started.

import { addRating } from '@/lib/server/ratings';
import { PRIMARY_SPORT_ID } from '@/lib/sports';

/** What deleting would undo: { eloRows, eloPlayers, avpRows, avpPoints, matches }. */
export async function categoryRatingImpact(supabaseAdmin, categoryId) {
  const [{ data: matchRows }, { data: ap }] = await Promise.all([
    supabaseAdmin.from('tournament_matches').select('id').eq('category_id', categoryId),
    supabaseAdmin.from('avp_points').select('id, points').eq('category_id', categoryId),
  ]);
  const matchIds = (matchRows || []).map((m) => m.id);
  const { data: eh } = matchIds.length
    ? await supabaseAdmin.from('elo_history').select('user_id, delta, sport_id').in('match_id', matchIds)
    : { data: [] };
  const eloRows = eh || [];
  return {
    eloRows,
    avpRows: ap || [],
    summary: {
      matches: matchIds.length,
      eloRows: eloRows.length,
      eloPlayers: new Set(eloRows.map((r) => r.user_id).filter(Boolean)).size,
      avpRows: (ap || []).length,
      avpPoints: (ap || []).reduce((s, r) => s + (r.points || 0), 0),
    },
  };
}

/**
 * Removes the category. `eventStarted` decides what happens to the
 * applications placed in it (back to «pending», or «rejected»).
 * Returns { ok: true, undone } or { error }.
 * @param {any} supabaseAdmin
 * @param {string} categoryId
 * @param {{ eventStarted?: boolean }} [opts]
 * @returns {Promise<any>}
 */
export async function removeCategory(supabaseAdmin, categoryId, { eventStarted = false } = {}) {
  const impact = await categoryRatingImpact(supabaseAdmin, categoryId);

  // Ело back, per player and sport; on a failure the done part is undone.
  const bySportUser = new Map();
  for (const r of impact.eloRows) {
    if (!r.user_id || !r.delta) continue;
    const key = `${r.sport_id || PRIMARY_SPORT_ID}|${r.user_id}`;
    bySportUser.set(key, (bySportUser.get(key) || 0) + r.delta);
  }
  const done = [];
  for (const [key, delta] of bySportUser) {
    if (!delta) continue;
    const [sportId, userId] = key.split('|');
    const { error } = await addRating(supabaseAdmin, userId, sportId, -delta);
    if (error) {
      await Promise.all(done.map((d) => addRating(supabaseAdmin, d.userId, d.sportId, d.delta)));
      return { error: 'Не вдалося скасувати нараховане Ело — категорію не видалено' };
    }
    done.push({ userId, sportId, delta });
  }

  // The applications placed into it.
  await supabaseAdmin
    .from('tournament_applications')
    .update(eventStarted ? { status: 'rejected' } : { status: 'pending', assigned_category_id: null })
    .eq('assigned_category_id', categoryId)
    .in('status', ['assigned', 'reserve']);

  const { error: delErr } = await supabaseAdmin.from('tournament_categories').delete().eq('id', categoryId);
  if (delErr) {
    console.error('[remove category]', delErr.message);
    await Promise.all(done.map((d) => addRating(supabaseAdmin, d.userId, d.sportId, d.delta)));
    return { error: 'Не вдалося видалити категорію' };
  }
  return { ok: true, undone: impact.summary };
}
