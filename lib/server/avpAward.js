// Awarding AVP season points for a finished category.
//
// Deliberately NOT folded into finishCategory(): it is a standalone,
// idempotent recalculation that can be run over a category at any time,
// including one that finished long ago. That is what makes it possible
// to switch a running (or already finished) event into the rating after
// the fact — places are derivable from `matches` forever, so the points
// are too. finishCategory() just happens to be the usual caller.
//
// Idempotency is by construction: the category's rows are deleted and
// written again, and `avp_points.unique (tournament_id, player_id)`
// makes a partial re-run impossible to leave behind duplicates.

import { placementsFor } from '@/lib/formats/placements';
import { effectiveTier, pointsForPlace } from '@/lib/avp/tiers';

/**
 * (Re)compute this category's contribution to the season rating.
 *
 * @returns {Promise<{ok: boolean, skipped?: string, error?: string,
 *   awarded?: number, tier?: number, seasonId?: string}>}
 */
export async function recalcAvpForCategory(supabaseAdmin, categoryId) {
  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('id, event_id, avp_tier, tournament_events(id, avp_tier, scheduled_at)')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return { ok: false, error: 'Категорію не знайдено' };

  const event = category.tournament_events;
  const tier = effectiveTier(category, event);

  // No tier at either level = the event is outside the rating. Clear
  // anything a previous tier left behind, so REMOVING a tier undoes its
  // points instead of freezing them.
  if (!tier) {
    await clearCategory(supabaseAdmin, categoryId);
    return { ok: true, skipped: 'no-tier' };
  }

  // The season an event belongs to is the one its DATE falls in — not
  // the one it was finished in. A result entered late (or corrected next
  // week) still counts where it was played.
  const playedOn = (event?.scheduled_at || '').slice(0, 10);
  if (!playedOn) return { ok: false, error: 'У події немає дати' };

  const { data: season } = await supabaseAdmin
    .from('avp_seasons')
    .select('id')
    .lte('starts_on', playedOn)
    .gte('ends_on', playedOn)
    .maybeSingle();

  if (!season) {
    await clearCategory(supabaseAdmin, categoryId);
    return { ok: true, skipped: 'no-season' };
  }

  const [{ data: matches }, { data: tps }, { data: teams }] = await Promise.all([
    supabaseAdmin.from('matches').select('*').eq('tournament_id', categoryId),
    supabaseAdmin
      .from('tournament_players')
      .select('player_id, players(full_name)')
      .eq('tournament_id', categoryId),
    supabaseAdmin.from('tournament_teams').select('player1_id, player2_id').eq('tournament_id', categoryId),
  ]);

  const players = (tps || []).map((tp) => ({ id: tp.player_id, full_name: tp.players?.full_name }));
  const placements = placementsFor({ matches: matches || [], teams: teams || [], players });

  // Both halves of a pair get the full points, as in ATP doubles — a
  // place belongs to the team, and neither player played half of it.
  //
  // Zero-point places are written too. A row saying «13-16 місце — 0»
  // is a fact worth keeping: it tells the player their result was
  // recorded and simply wasn't worth anything, which an absent row
  // cannot distinguish from a result that was never entered.
  const rows = [];
  const seen = new Set();
  for (const { place, playerIds } of placements) {
    for (const playerId of playerIds || []) {
      if (!playerId || seen.has(playerId)) continue;
      seen.add(playerId);
      rows.push({
        season_id: season.id,
        player_id: playerId,
        tournament_id: categoryId,
        event_id: category.event_id,
        tier,
        place,
        points: pointsForPlace(tier, place),
      });
    }
  }

  await clearCategory(supabaseAdmin, categoryId);

  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from('avp_points').insert(rows);
    if (error) {
      console.error('[avp] insert:', error.message);
      return { ok: false, error: 'Не вдалося нарахувати очки AVP' };
    }
  }

  return { ok: true, awarded: rows.length, tier, seasonId: season.id };
}

async function clearCategory(supabaseAdmin, categoryId) {
  const { error } = await supabaseAdmin.from('avp_points').delete().eq('tournament_id', categoryId);
  if (error) console.error('[avp] clear:', error.message);
}
