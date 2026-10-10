// Closing a category — the ONE place where a league stops being played
// and its results are paid out.
//
// There used to be three: the double-elimination bracket closed itself
// from the score route, King of the Beach closed itself from the score
// route, and americanka closed from an admin button — and only the last
// of those paid anything out. So a Double Elim or a King ran to its
// final, went «done», and left every participant with no tournament
// counted, no win recorded and no partner history. Anything keyed to the
// result (AVP season points next) would have inherited exactly that hole,
// which is why this exists before the points do.
//
// Everything downstream of a result belongs here:
//   • players.tournaments_played / tournaments_won
//   • partner_stats (who played with whom, and how it went)
//   • the category's own status / finished_at / winner
//   • the EVENT's status, once its last league is done
//
// Elo is deliberately NOT touched: `players.elo` is admin-set (see
// lib/elo.ts) and stays a statement about a player's strength, not a
// running tally of results.

import { placementsFor } from '@/lib/formats/placements';
import { teamAWon } from '@/lib/formats/sets';
import { recalcAvpForCategory, type RecalcAvpResult } from '@/lib/server/avpAward';
import type { SupabaseAdmin } from './types';
import type { Match, PlacementRow } from '@/lib/types';
import { sendResultsNotice } from '@/lib/server/resultsNotice';
import { publicSiteUrl } from '@/lib/server/siteUrl';

export interface FinishCategoryResult {
  ok: boolean;
  error?: string;
  alreadyDone?: boolean;
  winnerPlayerId?: string | null;
  placements?: PlacementRow[];
  avp?: RecalcAvpResult;
}

export interface RecalcPlacementsResult {
  ok: boolean;
  error?: string;
  placements?: number;
}

/**
 * Recompute and store tournament_placements for a category directly
 * from its matches — independent of finishCategory, so it can backfill
 * a category that finished before this table existed, or correct one
 * whose rows were never written for any other reason. Safe to call
 * repeatedly: recordPlacements rewrites the category's rows from
 * scratch every time, same as recalcAvpForCategory.
 */
export async function recalcPlacementsForCategory(supabaseAdmin: SupabaseAdmin, categoryId: string): Promise<RecalcPlacementsResult> {
  const [{ data: matches }, { data: tps }, { data: teams }] = await Promise.all([
    supabaseAdmin.from('tournament_matches').select('*').eq('category_id', categoryId),
    supabaseAdmin
      .from('tournament_players')
      .select('user_id, users(full_name)')
      .eq('category_id', categoryId),
    supabaseAdmin
      .from('tournament_teams')
      .select('user1_id, user2_id')
      .eq('category_id', categoryId),
  ]);

  const typedTps = (tps || []) as unknown as { user_id: string; users: { full_name: string | null } | null }[];
  const players = typedTps.map((tp) => ({ id: tp.user_id, full_name: tp.users?.full_name }));
  const placements = placementsFor({ matches: (matches as Match[]) || [], teams: teams || [], players });

  await recordPlacements(supabaseAdmin, categoryId, placements);
  return { ok: true, placements: placements.length };
}

export interface RefreshFinishedResult {
  ok: boolean;
  error?: string;
}

/**
 * A FINISHED category whose games were corrected afterwards (admin edit):
 * recompute everything that was paid out from its results — places,
 * the winner, players' tournament counters, AVP season points, and the
 * partner statistics when a game's winner changed. Every step is a
 * rewrite from the matches, never an increment, so running it again is
 * harmless.
 */
export async function refreshFinishedCategory(
  supabaseAdmin: SupabaseAdmin,
  categoryId: string,
  { winnerChanged = false }: { winnerChanged?: boolean } = {}
): Promise<RefreshFinishedResult> {
  const [{ data: matches }, { data: tps }, { data: teams }] = await Promise.all([
    supabaseAdmin.from('tournament_matches').select('*').eq('category_id', categoryId),
    supabaseAdmin.from('tournament_players').select('user_id, users(full_name)').eq('category_id', categoryId),
    supabaseAdmin.from('tournament_teams').select('user1_id, user2_id').eq('category_id', categoryId),
  ]);
  const typedTps = (tps || []) as unknown as { user_id: string; users: { full_name: string | null } | null }[];
  const players = typedTps.map((tp) => ({ id: tp.user_id, full_name: tp.users?.full_name }));
  const placements = placementsFor({ matches: (matches as Match[]) || [], teams: teams || [], players });
  const participants = [
    ...new Set((matches || []).flatMap((m: Match) => [...(m.team_a_players || []), ...(m.team_b_players || [])])),
  ].filter(Boolean) as string[];

  await recordPlacements(supabaseAdmin, categoryId, placements);
  const winnerPlayerId = placements.find((p) => p.place === 1)?.playerIds?.[0] || null;

  const [, { error: winnerError }, avp, partners] = await Promise.all([
    syncTournamentCounters(supabaseAdmin, participants),
    supabaseAdmin.from('tournament_categories').update({ winner_user_id: winnerPlayerId }).eq('id', categoryId),
    recalcAvpForCategory(supabaseAdmin, categoryId),
    winnerChanged ? recalcAllPartnerStats(supabaseAdmin) : Promise.resolve({ ok: true } as RecalcPartnerStatsResult),
  ]);
  if (winnerError) return { ok: false, error: winnerError.message };
  if (!avp.ok && !avp.skipped) return { ok: false, error: avp.error };
  if (!partners.ok) return { ok: false, error: partners.error };
  return { ok: true };
}

/**
 * Close a category and pay out its results. Safe to call from anywhere
 * that decides a league is over; the `status === 'done'` guard makes a
 * second call a no-op rather than a double payout.
 */
export async function finishCategory(supabaseAdmin: SupabaseAdmin, categoryId: string): Promise<FinishCategoryResult> {
  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select('id, status, event_id')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return { ok: false, error: 'Категорію не знайдено' };
  if (category.status === 'done') return { ok: false, alreadyDone: true, error: 'Категорію вже завершено' };

  const [{ data: matches }, { data: tps }, { data: teams }] = await Promise.all([
    supabaseAdmin.from('tournament_matches').select('*').eq('category_id', categoryId),
    supabaseAdmin
      .from('tournament_players')
      .select('user_id, users(full_name)')
      .eq('category_id', categoryId),
    supabaseAdmin
      .from('tournament_teams')
      .select('user1_id, user2_id')
      .eq('category_id', categoryId),
  ]);

  // Cast through `unknown` first: without generated Database types, the
  // client infers every embedded join as an array (it can't see this is
  // a to-one foreign key) — the real value at runtime is a single row
  // or null. Casting the whole array once lets .map() below infer its
  // callback parameter correctly instead of colliding with it.
  const typedTps = (tps || []) as unknown as { user_id: string; users: { full_name: string | null } | null }[];
  const players = typedTps.map((tp) => ({
    id: tp.user_id,
    full_name: tp.users?.full_name,
  }));
  const placements = placementsFor({ matches: (matches as Match[]) || [], teams: teams || [], players });

  // Everyone who actually took part = everyone the draw put into a game,
  // which is not the same as everyone on the roster:
  //   • King of the Beach rounds the field DOWN to a multiple of 4, so a
  //     19th registered player stays in tournament_players having never
  //     played;
  //   • a pair still looking for a partner holds a seeding place but is
  //     dropped by buildPairMatches;
  //   • a pair that walked round 1 on a bye IS in its round-2 game from
  //     the moment the bracket is built, so byes count — as they should.
  // Reading it off the matches gets all three right for every format.
  const participants = [
    ...new Set((matches || []).flatMap((m: Match) => [...(m.team_a_players || []), ...(m.team_b_players || [])])),
  ].filter(Boolean) as string[];

  await recordPlacements(supabaseAdmin, categoryId, placements);
  // After the places are written: the counters are re-derived from them.
  await syncTournamentCounters(supabaseAdmin, participants);

  const winnerPlayerId = placements.find((p) => p.place === 1)?.playerIds?.[0] || null;

  const { error } = await supabaseAdmin
    .from('tournament_categories')
    .update({
      status: 'done',
      finished_at: new Date().toISOString(),
      winner_user_id: winnerPlayerId,
    })
    .eq('id', categoryId);
  if (error) {
    console.error('[finishCategory] status update:', error.message);
    return { ok: false, error: 'Не вдалося завершити категорію' };
  }

  // Season points last, and non-fatally: the category IS finished by
  // now, and a missing season or a tier nobody set must not undo that.
  // It is a standalone recalculation precisely so it can be run again
  // later — see recalcAvpForCategory and the admin recalc route.
  //
  // Partner stats are rebuilt from every finished game (a handful of
  // requests in total) rather than bumped pair by pair — the old
  // increment made ~4 requests per game one after another, which is what
  // made the last score of a tournament hang, and it double-counted
  // whenever a category was finished twice.
  const [avp, partners] = await Promise.all([
    recalcAvpForCategory(supabaseAdmin, categoryId),
    recalcAllPartnerStats(supabaseAdmin),
    finishEventIfLastCategory(supabaseAdmin, category.event_id),
  ]);
  if (!avp.ok) console.error('[finishCategory] avp:', avp.error);
  if (!partners.ok) console.error('[finishCategory] partner stats:', partners.error);

  return { ok: true, winnerPlayerId, placements, avp };
}

// users.tournaments_played / tournaments_won, RE-DERIVED from
// tournament_placements for this roster — never incremented. A +1 here
// used to be bumped again whenever a category was finished twice (a
// re-entered final score, a retry), which is how 50 players' counters
// had drifted by 2026-10. Recounting is idempotent: finishing the same
// category any number of times leaves the same numbers.
async function syncTournamentCounters(supabaseAdmin: SupabaseAdmin, participants: string[]): Promise<void> {
  if (participants.length === 0) return;

  const { data: places } = await supabaseAdmin
    .from('tournament_placements')
    .select('user_id, place')
    .in('user_id', participants);

  const played = new Map<string, number>();
  const won = new Map<string, number>();
  for (const p of (places || []) as { user_id: string; place: number }[]) {
    played.set(p.user_id, (played.get(p.user_id) || 0) + 1);
    if (p.place === 1) won.set(p.user_id, (won.get(p.user_id) || 0) + 1);
  }

  // All at once — one small update per player, none waits for another.
  await Promise.all(
    participants.map(async (id) => {
      const { error } = await supabaseAdmin
        .from('users')
        .update({ tournaments_played: played.get(id) || 0, tournaments_won: won.get(id) || 0 })
        .eq('id', id);
      if (error) console.error('[finishCategory] counters:', error.message);
    })
  )
}

export interface RecalcPartnerStatsResult {
  ok: boolean;
  tournaments?: number;
  error?: string;
}

/**
 * Rebuild partner_stats from scratch across every finished tournament.
 * partner_stats is an accumulating counter (each finishCategory call
 * adds to whatever was already there), which means any past bug in how
 * it was incremented — or in what fed it — leaves permanently wrong
 * numbers behind that normal operation can never self-correct.
 *
 * Replaced the old per-pair increment (removed), which did one
 * read-then-write round trip PER PAIR PER MATCH, which is fine
 * for a single just-finished tournament (a handful of games) but does
 * not scale to every tournament the club has ever played — with 76
 * games that's on the order of 300 sequential database round trips,
 * comfortably past a serverless function's execution limit (this is
 * exactly what made the button hang). This version fetches every
 * finished tournament's matches in one query, tallies everything in
 * memory, and writes the totals back in a small number of batched
 * inserts — a handful of round trips total, regardless of how many
 * games the club has played.
 */
export async function recalcAllPartnerStats(supabaseAdmin: SupabaseAdmin): Promise<RecalcPartnerStatsResult> {
  const { error: clearError } = await supabaseAdmin.from('partner_stats').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');
  if (clearError) {
    console.error('[recalcAllPartnerStats] clear:', clearError.message);
    return { ok: false, error: 'Не вдалося очистити partner_stats' };
  }

  const { data: doneCategories } = await supabaseAdmin.from('tournament_categories').select('id').eq('status', 'done');
  const categoryIds = (doneCategories || []).map((c) => c.id);
  if (categoryIds.length === 0) return { ok: true, tournaments: 0 };

  const { data: allMatches, error: matchesError } = await supabaseAdmin
    .from('tournament_matches')
    .select('team_a_players, team_b_players, set1, set2, set3, played, played_at')
    .in('category_id', categoryIds)
    .eq('played', true);
  if (matchesError) {
    console.error('[recalcAllPartnerStats] matches fetch:', matchesError.message);
    return { ok: false, error: 'Не вдалося завантажити матчі' };
  }

  interface PartnerRow {
    user_id: string;
    partner_id: string;
    games_together: number;
    wins_together: number;
    last_played_at: string;
  }
  const totals = new Map<string, PartnerRow>();

  function addPair(teamPlayerIds: string[] | null | undefined, won: boolean, playedAt: string) {
    if (!teamPlayerIds || teamPlayerIds.length < 2) return;
    const [p1, p2] = teamPlayerIds;
    for (const [a, b] of [
      [p1, p2],
      [p2, p1],
    ]) {
      const key = `${a}::${b}`;
      const row = totals.get(key) || { user_id: a, partner_id: b, games_together: 0, wins_together: 0, last_played_at: playedAt };
      row.games_together += 1;
      if (won) row.wins_together += 1;
      if (playedAt > row.last_played_at) row.last_played_at = playedAt;
      totals.set(key, row);
    }
  }

  for (const match of (allMatches as Match[]) || []) {
    const playedAt = (match as unknown as { played_at?: string }).played_at || new Date().toISOString();
    const aWon = teamAWon(match);
    addPair(match.team_a_players, aWon, playedAt);
    addPair(match.team_b_players, !aWon, playedAt);
  }

  const rows = [...totals.values()];
  const CHUNK = 500; // defensive batching, not expected to matter at this club's size
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabaseAdmin.from('partner_stats').insert(rows.slice(i, i + CHUNK));
    if (error) {
      console.error('[recalcAllPartnerStats] insert:', error.message);
      return { ok: false, error: 'Не вдалося записати partner_stats' };
    }
  }

  return { ok: true, tournaments: categoryIds.length };
}

// One row per (tournament, player) with their actual finishing place —
// both halves of a pair get their own row here, unlike
// tournaments.winner_user_id which only ever held one id. Cleared
// and rewritten each call, same idempotency pattern as
// recalcAvpForCategory's clearCategory: a category can't be finished
// twice (finishCategory guards on status), but this keeps the function
// safe to call again if that guard is ever bypassed for a fix.
async function recordPlacements(supabaseAdmin: SupabaseAdmin, categoryId: string, placements: PlacementRow[]): Promise<void> {
  await supabaseAdmin.from('tournament_placements').delete().eq('category_id', categoryId);

  const rows: { category_id: string; user_id: string; place: number }[] = [];
  for (const { place, playerIds } of placements) {
    for (const playerId of playerIds || []) {
      if (playerId) rows.push({ category_id: categoryId, user_id: playerId, place });
    }
  }
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from('tournament_placements').insert(rows);
  if (error) console.error('[finishCategory] placements:', error.message);
}

// An event is over when its last league is. Nothing used to write this,
// so finished events stayed «Активні» forever and the «Завершені» tab —
// which filters on exactly this column — was permanently empty.
// Legacy categories with no event have nothing to roll up to.
async function finishEventIfLastCategory(supabaseAdmin: SupabaseAdmin, eventId: string | null): Promise<void> {
  if (!eventId) return;

  const { data: siblings } = await supabaseAdmin
    .from('tournament_categories')
    .select('status')
    .eq('event_id', eventId);

  if (!siblings?.length || siblings.some((s: { status: string }) => s.status !== 'done')) return;

  const { error } = await supabaseAdmin
    .from('tournament_events')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', eventId);
  if (error) {
    console.error('[finishCategory] event rollup:', error.message);
    return;
  }
  // «🏁 Турнір завершено» — the winners to the channel and every
  // participant, once (lib/server/resultsNotice). Never throws; a test
  // tournament or a missing bot just sends nothing.
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const r = await sendResultsNotice(supabaseAdmin, eventId, { siteUrl: publicSiteUrl(null) });
    if (r?.error) console.error('[finishCategory] results notice:', r.error);
  }
}
