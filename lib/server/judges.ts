// Server-side helper: what may the caller do on this event?
//
// Three roles overlap on the judging routes — admin, head judge and
// ordinary judge — and every route needs the same answer, so the lookup
// lives here instead of being re-typed in each of them.

import type { SupabaseAdmin, JudgeRole } from './types';

/**
 * @param eventId - event the action belongs to (null for legacy
 *   categories that predate events: nobody is a judge there)
 */
export async function getJudgeRole(
  supabaseAdmin: SupabaseAdmin,
  playerId: string,
  eventId: string | null
): Promise<JudgeRole> {
  const { data: caller } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  const isAdmin = !!caller?.is_admin;

  if (!eventId) return { isAdmin, isJudge: false, isHeadJudge: false };

  const { data: judge } = await supabaseAdmin
    .from('tournament_judges')
    .select('is_head')
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .maybeSingle();

  return { isAdmin, isJudge: !!judge, isHeadJudge: !!judge?.is_head };
}

export interface MatchContext {
  match: {
    id: string;
    tournament_id: string | null;
    court: number | null;
    judge_id: string | null;
    tournaments: { status: string; courts: number[]; event_id: string | null } | null;
    [key: string]: unknown;
  };
  eventId: string | null;
}

/**
 * The event a match belongs to, plus the bits every judging route
 * checks. Categories created before events exist have event_id = null.
 * @returns null when there is no such match
 */
export async function loadMatchContext(supabaseAdmin: SupabaseAdmin, matchId: string): Promise<MatchContext | null> {
  const { data: rawMatch } = await supabaseAdmin
    .from('matches')
    .select('id, tournament_id, court, judge_id, tournaments(status, courts, event_id)')
    .eq('id', matchId)
    .maybeSingle();
  if (!rawMatch) return null;
  // Cast through `unknown` first: without generated Database types, the
  // client infers the embedded `tournaments` join as an array (it can't
  // see this is a to-one foreign key) — the real value at runtime is a
  // single row or null.
  const match = rawMatch as unknown as MatchContext['match'];
  return { match, eventId: match.tournaments?.event_id || null };
}
