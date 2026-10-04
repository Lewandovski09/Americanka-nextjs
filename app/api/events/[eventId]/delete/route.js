import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { readRatings, writeRating } from '@/lib/server/ratings';
import { PRIMARY_SPORT_ID } from '@/lib/sports';

// Delete a whole event with everything under it: categories, matches,
// rosters, teams and applications all go via ON DELETE CASCADE.
//
// AWARDED RATING IS THE HARD PART, and the two ratings behave nothing
// alike:
//
//   AVP  — a ledger. avp_points cascades with the event and
//          avp_standings is a view summing that ledger, so deleting the
//          rows IS a complete, exact rollback. Nothing to do by hand.
//   Ело  — a running number on the player. users.elo was already moved,
//          game by game, by the americanka auto-Ело in the score route;
//          elo_history only RECORDS those moves. Deleting the history
//          would leave every player's rating permanently carrying games
//          that no longer exist — so the deltas have to be subtracted
//          back before the rows go.
//
// That asymmetry is why this used to refuse outright: elo_history
// referenced the category with no cascade, so Postgres blocked the
// delete and the route turned that into «вже нараховано рейтинг». The
// refusal was honest but terminal — an americanka started by mistake
// could never be removed through the UI at all. Migration 042 moved
// that reference onto the match with ON DELETE CASCADE, so the rows now
// clear themselves; what stays here is the part a cascade cannot do —
// putting the numbers back on the players.
//
// Now it rolls back instead, behind an explicit confirmation:
//   { dryRun: true }               → what would be undone, changes nothing
//   { confirmRatingRollback: true } → do it
// A call with rating at stake and no flag is still refused, so the
// rollback can never happen by accident or by a stray API call.
//
// Since migration 052 nothing is lost: before the delete, the event is
// copied into the archive (deleted_events) and can be restored from
// there — /api/admin/events/archive/[archiveId]/restore.
export async function POST(request, { params }) {
  const { eventId } = params;

  const body = await request.json().catch(() => ({}));
  const { dryRun, confirmRatingRollback } = body || {};

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може видаляти турніри' }, { status: 403 });
  }

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id, name, format_kind, scheduled_at, status')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  }

  const { data: categories } = await supabaseAdmin
    .from('tournament_categories')
    .select('id')
    .eq('event_id', eventId);
  const categoryIds = (categories || []).map((c) => c.id);

  // What this event has paid out. Both lists are read in full rather
  // than counted: the Ело rollback needs the deltas themselves, and the
  // dry run quotes real numbers so the confirmation is not a guess.
  //
  // Ело history is reached through the matches (migration 042): a row
  // names the GAME it came from, and the category only through it.
  let eloRows = [];
  let avpRows = [];
  if (categoryIds.length > 0) {
    const [{ data: matchRows }, { data: ap }] = await Promise.all([
      supabaseAdmin.from('tournament_matches').select('id').in('category_id', categoryIds),
      supabaseAdmin.from('avp_points').select('id, points').in('category_id', categoryIds),
    ]);
    avpRows = ap || [];

    const matchIds = (matchRows || []).map((m) => m.id);
    if (matchIds.length > 0) {
      const { data: eh } = await supabaseAdmin
        .from('elo_history')
        .select('id, user_id, delta, sport_id')
        .in('match_id', matchIds);
      eloRows = eh || [];
    }
  }

  // Sum per player: Ело is additive, so one subtraction per player
  // restores them. (Not a perfect reconstruction of history — later
  // games were computed against ratings these deltas had already moved
  // — but it is the same approximation the score route already accepts
  // when a score is corrected, and it returns the club's ratings to
  // where they stood before this event.)
  //
  // Keyed per SPORT as well (migration 043): each sport's Ело is a
  // separate number, so each is rolled back on its own.
  const deltaBySport = new Map(); // sportId -> Map(userId -> delta)
  const players = new Set();
  for (const r of eloRows) {
    if (!r.user_id) continue;
    const sport = r.sport_id || PRIMARY_SPORT_ID;
    if (!deltaBySport.has(sport)) deltaBySport.set(sport, new Map());
    const m = deltaBySport.get(sport);
    m.set(r.user_id, (m.get(r.user_id) || 0) + (r.delta || 0));
    players.add(r.user_id);
  }

  const willUndo = {
    eloRows: eloRows.length,
    eloPlayers: players.size,
    avpRows: avpRows.length,
    avpPoints: avpRows.reduce((sum, r) => sum + (r.points || 0), 0),
  };

  if (dryRun) return Response.json({ success: true, willUndo });

  const hasRating = eloRows.length > 0 || avpRows.length > 0;
  if (hasRating && !confirmRatingRollback) {
    const what =
      eloRows.length > 0 && avpRows.length > 0 ? 'Ело та очки AVP' : eloRows.length > 0 ? 'Ело' : 'очки AVP';
    return Response.json(
      {
        success: false,
        requiresConfirm: true,
        willUndo,
        error: `За турнір вже нараховано ${what} — підтвердіть скасування рейтингу, щоб видалити`,
      },
      { status: 400 }
    );
  }

  // ── Archive first (migration 052) ──
  // The whole event is copied into deleted_events before anything is
  // touched, so «Відновити» can put it back. No archive — no delete:
  // a tournament is never lost for good by this button.
  const { data: snapshot, error: snapErr } = await supabaseAdmin.rpc('archive_event_snapshot', { p_event: eventId });
  if (snapErr || !snapshot) {
    console.error('[event delete] archive snapshot:', snapErr?.message);
    return Response.json(
      { success: false, error: 'Не вдалося зберегти турнір в архів — його не видалено. Чи виконано SQL міграції 052?' },
      { status: 500 }
    );
  }
  const { data: archived, error: archErr } = await supabaseAdmin
    .from('deleted_events')
    .insert({
      event_id: eventId,
      name: event.name,
      format_kind: event.format_kind,
      scheduled_at: event.scheduled_at,
      event_status: event.status,
      categories_count: (snapshot.tournament_categories || []).length,
      matches_count: (snapshot.tournament_matches || []).length,
      deleted_by: authUser.user.id,
      snapshot,
    })
    .select('id')
    .single();
  if (archErr || !archived) {
    console.error('[event delete] archive insert:', archErr?.message);
    return Response.json(
      { success: false, error: 'Не вдалося зберегти турнір в архів — його не видалено' },
      { status: 500 }
    );
  }
  // If the delete below fails, the archive entry must not stay behind
  // (the tournament would then exist twice).
  const dropArchive = () => supabaseAdmin.from('deleted_events').delete().eq('id', archived.id);

  // ── Roll Ело back, player by player ──
  // Before the rows are deleted: if an update fails we stop with the
  // history intact, so the event stays deletable and nothing is left
  // half-undone.
  for (const [sportId, deltaByUser] of deltaBySport) {
    // readRatings falls back to the same start value the score route
    // assumed when it moved a player who had no rating yet.
    const current = await readRatings(supabaseAdmin, [...deltaByUser.keys()], sportId);
    for (const [userId, delta] of deltaByUser) {
      const restored = current.get(userId) - delta;
      const updErr = await writeRating(supabaseAdmin, userId, sportId, restored);
      if (updErr) {
        console.error('[event delete] elo rollback:', updErr);
        await dropArchive();
        return Response.json(
          { success: false, error: 'Не вдалося скасувати нараховане Ело — турнір не видалено' },
          { status: 500 }
        );
      }
    }
  }

  // elo_history needs no explicit step any more: since migration 042 it
  // hangs off the match with ON DELETE CASCADE, so it goes down the same
  // chain as everything else — event → category → match → history. Same
  // for avp_points, and the standings view recomputes itself from what
  // is left.
  const { error } = await supabaseAdmin.from('tournament_events').delete().eq('id', eventId);
  if (error) {
    console.error('[event delete] error:', error.message);
    await dropArchive();
    return Response.json({ success: false, error: 'Не вдалося видалити турнір' }, { status: 500 });
  }

  return Response.json({ success: true, undone: willUndo });
}
