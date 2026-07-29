// Server-side helper: what may the caller do on this event?
//
// Three roles overlap on the judging routes — admin, head judge and
// ordinary judge — and every route needs the same answer, so the lookup
// lives here instead of being re-typed in each of them.

/**
 * @param {object} supabaseAdmin - service-role client (bypasses RLS)
 * @param {string} playerId - the authenticated caller
 * @param {string|null} eventId - event the action belongs to (null for
 *   legacy categories that predate events: nobody is a judge there)
 * @returns {Promise<{isAdmin: boolean, isJudge: boolean, isHeadJudge: boolean}>}
 */
export async function getJudgeRole(supabaseAdmin, playerId, eventId) {
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

/**
 * The event a match belongs to, plus the bits every judging route
 * checks. Categories created before events exist have event_id = null.
 * @returns {Promise<{match: object, eventId: string|null}|null>} null when there is no such match
 */
export async function loadMatchContext(supabaseAdmin, matchId) {
  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('id, tournament_id, court, judge_id, tournaments(status, courts, event_id)')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return null;
  return { match, eventId: match.tournaments?.event_id || null };
}
