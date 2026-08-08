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

export interface FinishCategoryResult {
  ok: boolean;
  error?: string;
  alreadyDone?: boolean;
  winnerPlayerId?: string | null;
  placements?: PlacementRow[];
  avp?: RecalcAvpResult;
}

/**
 * Close a category and pay out its results. Safe to call from anywhere
 * that decides a league is over; the `status === 'done'` guard makes a
 * second call a no-op rather than a double payout.
 */
export async function finishCategory(supabaseAdmin: SupabaseAdmin, categoryId: string): Promise<FinishCategoryResult> {
  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('id, status, event_id')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return { ok: false, error: 'Категорію не знайдено' };
  if (category.status === 'done') return { ok: false, alreadyDone: true, error: 'Категорію вже завершено' };

  const [{ data: matches }, { data: tps }, { data: teams }] = await Promise.all([
    supabaseAdmin.from('matches').select('*').eq('tournament_id', categoryId),
    supabaseAdmin
      .from('tournament_players')
      .select('player_id, players(full_name)')
      .eq('tournament_id', categoryId),
    supabaseAdmin
      .from('tournament_teams')
      .select('player1_id, player2_id')
      .eq('tournament_id', categoryId),
  ]);

  // Cast through `unknown` first: without generated Database types, the
  // client infers every embedded join as an array (it can't see this is
  // a to-one foreign key) — the real value at runtime is a single row
  // or null. Casting the whole array once lets .map() below infer its
  // callback parameter correctly instead of colliding with it.
  const typedTps = (tps || []) as unknown as { player_id: string; players: { full_name: string | null } | null }[];
  const players = typedTps.map((tp) => ({
    id: tp.player_id,
    full_name: tp.players?.full_name,
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

  // A pair wins together: both halves get the win, as they do everywhere
  // else results are counted.
  const winners = new Set(placements.find((p) => p.place === 1)?.playerIds || []);

  await bumpTournamentCounters(supabaseAdmin, participants, winners);
  await updatePartnerStats(supabaseAdmin, (matches as Match[]) || []);

  const winnerPlayerId = placements.find((p) => p.place === 1)?.playerIds?.[0] || null;

  const { error } = await supabaseAdmin
    .from('tournaments')
    .update({
      status: 'done',
      finished_at: new Date().toISOString(),
      winner_player_id: winnerPlayerId,
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
  const avp = await recalcAvpForCategory(supabaseAdmin, categoryId);
  if (!avp.ok) console.error('[finishCategory] avp:', avp.error);

  await finishEventIfLastCategory(supabaseAdmin, category.event_id);

  return { ok: true, winnerPlayerId, placements, avp };
}

// tournaments_played for everyone, tournaments_won for the winners. One
// read for the whole roster, then a write each — Supabase has no bulk
// increment, and a category is at most 32 rows.
async function bumpTournamentCounters(supabaseAdmin: SupabaseAdmin, participants: string[], winners: Set<string>): Promise<void> {
  if (participants.length === 0) return;

  const { data: rows } = await supabaseAdmin
    .from('players')
    .select('id, tournaments_played, tournaments_won')
    .in('id', participants);

  for (const row of (rows || []) as { id: string; tournaments_played: number | null; tournaments_won: number | null }[]) {
    await supabaseAdmin
      .from('players')
      .update({
        tournaments_played: (row.tournaments_played || 0) + 1,
        tournaments_won: (row.tournaments_won || 0) + (winners.has(row.id) ? 1 : 0),
      })
      .eq('id', row.id);
  }
}

// Who played alongside whom, and how it went. Both directions are stored
// so either player's profile can read their side without a union.
async function updatePartnerStats(supabaseAdmin: SupabaseAdmin, matches: Match[]): Promise<void> {
  for (const match of matches.filter((m) => m.played)) {
    const aWon = teamAWon(match);
    await recordPartnerPair(supabaseAdmin, match.team_a_players, aWon);
    await recordPartnerPair(supabaseAdmin, match.team_b_players, !aWon);
  }
}

async function recordPartnerPair(supabaseAdmin: SupabaseAdmin, teamPlayerIds: string[], won: boolean): Promise<void> {
  if ((teamPlayerIds || []).length < 2) return;
  const [p1, p2] = teamPlayerIds;

  for (const [a, b] of [
    [p1, p2],
    [p2, p1],
  ]) {
    const { data: existing } = await supabaseAdmin
      .from('partner_stats')
      .select('games_together, wins_together')
      .eq('player_id', a)
      .eq('partner_id', b)
      .maybeSingle();

    await supabaseAdmin.from('partner_stats').upsert({
      player_id: a,
      partner_id: b,
      games_together: (existing?.games_together || 0) + 1,
      wins_together: (existing?.wins_together || 0) + (won ? 1 : 0),
      last_played_at: new Date().toISOString(),
    });
  }
}

// An event is over when its last league is. Nothing used to write this,
// so finished events stayed «Активні» forever and the «Завершені» tab —
// which filters on exactly this column — was permanently empty.
// Legacy categories with no event have nothing to roll up to.
async function finishEventIfLastCategory(supabaseAdmin: SupabaseAdmin, eventId: string | null): Promise<void> {
  if (!eventId) return;

  const { data: siblings } = await supabaseAdmin
    .from('tournaments')
    .select('status')
    .eq('event_id', eventId);

  if (!siblings?.length || siblings.some((s: { status: string }) => s.status !== 'done')) return;

  const { error } = await supabaseAdmin
    .from('tournament_events')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', eventId);
  if (error) console.error('[finishCategory] event rollup:', error.message);
}
