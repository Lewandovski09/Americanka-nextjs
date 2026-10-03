// Reading and writing a user's Ело IN A SPORT (migration 043).
//
// One rule hides behind these two functions, so callers never need to
// know it: the PRIMARY sport's rating is still stored in users.elo (and
// mirrored into user_ratings by a trigger — writing that mirror directly
// is refused by the database), every other sport lives in user_ratings
// only. When the readers have all moved to user_ratings, this file is
// the only place that changes.

import { categoryForElo } from '@/lib/elo';
import { PRIMARY_SPORT_ID } from '@/lib/sports';
import type { SupabaseAdmin } from './types';

/** Rating a player starts a sport at before their first result in it. */
export const DEFAULT_START_ELO = 1200;

/** Current Ело of each user in `sportId`; users without one get DEFAULT_START_ELO. */
export async function readRatings(
  supabaseAdmin: SupabaseAdmin,
  userIds: string[],
  sportId: string | null | undefined
): Promise<Map<string, number>> {
  const sport = sportId || PRIMARY_SPORT_ID;
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;

  if (sport === PRIMARY_SPORT_ID) {
    const { data } = await supabaseAdmin.from('users').select('id, elo').in('id', userIds);
    (data || []).forEach((u: { id: string; elo: number | null }) => out.set(u.id, u.elo ?? DEFAULT_START_ELO));
  } else {
    const { data } = await supabaseAdmin
      .from('user_ratings')
      .select('user_id, elo')
      .eq('sport_id', sport)
      .in('user_id', userIds);
    (data || []).forEach((r: { user_id: string; elo: number }) => out.set(r.user_id, r.elo));
  }
  userIds.forEach((id) => {
    if (!out.has(id)) out.set(id, DEFAULT_START_ELO);
  });
  return out;
}

/** Set a user's Ело in a sport. Returns an error message, or null. */
export async function writeRating(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
  sportId: string | null | undefined,
  elo: number
): Promise<string | null> {
  const sport = sportId || PRIMARY_SPORT_ID;
  if (sport === PRIMARY_SPORT_ID) {
    const { error } = await supabaseAdmin
      .from('users')
      .update({ elo, category: categoryForElo(elo)?.id })
      .eq('id', userId);
    return error ? error.message : null;
  }
  const { error } = await supabaseAdmin
    .from('user_ratings')
    .upsert({ user_id: userId, sport_id: sport, elo, updated_at: new Date().toISOString() }, { onConflict: 'user_id,sport_id' });
  return error ? error.message : null;
}
