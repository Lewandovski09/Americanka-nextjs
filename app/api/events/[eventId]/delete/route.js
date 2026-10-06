import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addRating } from '@/lib/server/ratings';
import { PRIMARY_SPORT_ID } from '@/lib/sports';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

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

  const supabase = createClient();
  const supabaseAdmin = createAdminClient();
  // Everything that doesn't depend on something else is read at once —
  // the steps used to wait for each other, and the button felt stuck.
  const [body, { data: authUser }, { data: event }, { data: categories }] = await Promise.all([
    request.json().catch(() => ({})),
    getAuthUser(supabase),
    supabaseAdmin
      .from('tournament_events')
      .select('id, name, format_kind, scheduled_at, status')
      .eq('id', eventId)
      .maybeSingle(),
    supabaseAdmin.from('tournament_categories').select('id').eq('event_id', eventId),
  ]);
  const { dryRun, confirmRatingRollback } = body || {};
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може видаляти турніри' }, { status: 403 });
  }
  if (!event) {
    return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  }
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
  if (archErr?.code === '23505') {
    // A second tap while the first delete is running (migration 056 keeps
    // one archive entry per event): stop here, or the Ело would come off
    // twice.
    return Response.json({ success: false, error: 'Турнір уже видаляється — оновіть сторінку' }, { status: 409 });
  }
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
  // Each change is an atomic add in the database (add_elo). If one fails,
  // the ones already done are put back, so a retry starts from where the
  // ratings were — nothing is subtracted twice.
  const done = [];
  const undo = () => Promise.all(done.map((d) => addRating(supabaseAdmin, d.userId, d.sportId, d.delta)));
  // All players at once (each change is its own atomic add).
  const changes = [];
  for (const [sportId, deltaByUser] of deltaBySport) {
    for (const [userId, delta] of deltaByUser) if (delta) changes.push({ userId, sportId, delta });
  }
  const results = await Promise.all(
    changes.map(async (c) => {
      const { error: updErr } = await addRating(supabaseAdmin, c.userId, c.sportId, -c.delta);
      if (!updErr) done.push(c);
      return updErr;
    })
  );
  const failed = results.find(Boolean);
  if (failed) {
    console.error('[event delete] elo rollback:', failed);
    await undo();
    await dropArchive();
    return Response.json(
      { success: false, error: 'Не вдалося скасувати нараховане Ело — турнір не видалено' },
      { status: 500 }
    );
  }

  // elo_history needs no explicit step any more: since migration 042 it
  // hangs off the match with ON DELETE CASCADE, so it goes down the same
  // chain as everything else — event → category → match → history. Same
  // for avp_points, and the standings view recomputes itself from what
  // is left.
  const { error } = await supabaseAdmin.from('tournament_events').delete().eq('id', eventId);
  if (error) {
    console.error('[event delete] error:', error.message);
    await undo();
    await dropArchive();
    return Response.json({ success: false, error: 'Не вдалося видалити турнір' }, { status: 500 });
  }

  return Response.json({ success: true, undone: willUndo });
}
