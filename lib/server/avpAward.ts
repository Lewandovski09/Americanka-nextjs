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
// written again, and `avp_points.unique (category_id, user_id)`
// makes a partial re-run impossible to leave behind duplicates.

import { placementsFor } from '@/lib/formats/placements';
import { effectiveTier, pointsForPlace } from '@/lib/avp/tiers';
import type { SupabaseAdmin } from './types';

export interface RecalcAvpResult {
  ok: boolean;
  skipped?: 'no-tier' | 'no-season';
  error?: string;
  awarded?: number;
  tier?: number;
  seasonId?: string;
}

/** (Re)compute this category's contribution to the season rating. */
export async function recalcAvpForCategory(supabaseAdmin: SupabaseAdmin, categoryId: string): Promise<RecalcAvpResult> {
  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select('id, event_id, avp_tier, tournament_events(id, avp_tier, scheduled_at)')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return { ok: false, error: 'Категорію не знайдено' };

  // Cast through `unknown` first: without generated Database types, the
  // Supabase client's own inference treats every embedded join as an
  // array (it can't see this is a to-one foreign key), even though the
  // real value at runtime is a single row or null — same reason every
  // other `as unknown as ...` in this file exists.
  const event = category.tournament_events as unknown as { id: string; avp_tier: number | null; scheduled_at: string | null } | null;
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
    supabaseAdmin.from('tournament_matches').select('*').eq('category_id', categoryId),
    supabaseAdmin
      .from('tournament_players')
      .select('user_id, users(full_name)')
      .eq('category_id', categoryId),
    supabaseAdmin.from('tournament_teams').select('user1_id, user2_id').eq('category_id', categoryId),
  ]);

  // Same array-vs-object join-typing note as above: cast the whole
  // fetched array once, through `unknown`, to the shape it actually has
  // at runtime — that's what lets the .map() callback below infer its
  // parameter type correctly instead of colliding with it.
  const typedTps = (tps || []) as unknown as { user_id: string; players: { full_name: string | null } | null }[];
  const players = typedTps.map((tp) => ({
    id: tp.user_id,
    full_name: tp.users?.full_name,
  }));
  const placements = placementsFor({ matches: matches || [], teams: teams || [], players });

  // Both halves of a pair get the full points, as in ATP doubles — a
  // place belongs to the team, and neither player played half of it.
  //
  // Zero-point places are written too. A row saying «13-16 місце — 0»
  // is a fact worth keeping: it tells the player their result was
  // recorded and simply wasn't worth anything, which an absent row
  // cannot distinguish from a result that was never entered.
  const rows: Array<{
    season_id: string;
    user_id: string;
    category_id: string;
    event_id: unknown;
    tier: number;
    place: number;
    points: number;
  }> = [];
  const seen = new Set<string>();
  for (const { place, playerIds } of placements) {
    for (const playerId of playerIds || []) {
      if (!playerId || seen.has(playerId)) continue;
      seen.add(playerId);
      rows.push({
        season_id: season.id,
        user_id: playerId,
        category_id: categoryId,
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

async function clearCategory(supabaseAdmin: SupabaseAdmin, categoryId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('avp_points').delete().eq('category_id', categoryId);
  if (error) console.error('[avp] clear:', error.message);
}
