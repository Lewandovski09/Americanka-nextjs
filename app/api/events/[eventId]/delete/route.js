import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { categoryForElo } from '@/lib/elo';

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
// references the category with no cascade, so Postgres blocked the
// delete and the route turned that into «вже нараховано рейтинг». The
// refusal was honest but terminal — an americanka started by mistake
// could never be removed through the UI at all.
//
// Now it rolls back instead, behind an explicit confirmation:
//   { dryRun: true }               → what would be undone, changes nothing
//   { confirmRatingRollback: true } → do it
// A call with rating at stake and no flag is still refused, so the
// rollback can never happen by accident or by a stray API call.
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
    .select('id')
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
  let eloRows = [];
  let avpRows = [];
  if (categoryIds.length > 0) {
    const [{ data: eh }, { data: ap }] = await Promise.all([
      supabaseAdmin.from('elo_history').select('id, user_id, delta').in('category_id', categoryIds),
      supabaseAdmin.from('avp_points').select('id, points').in('category_id', categoryIds),
    ]);
    eloRows = eh || [];
    avpRows = ap || [];
  }

  // Sum per player: Ело is additive, so one subtraction per player
  // restores them. (Not a perfect reconstruction of history — later
  // games were computed against ratings these deltas had already moved
  // — but it is the same approximation the score route already accepts
  // when a score is corrected, and it returns the club's ratings to
  // where they stood before this event.)
  const deltaByUser = new Map();
  for (const r of eloRows) {
    if (!r.user_id) continue;
    deltaByUser.set(r.user_id, (deltaByUser.get(r.user_id) || 0) + (r.delta || 0));
  }

  const willUndo = {
    eloRows: eloRows.length,
    eloPlayers: deltaByUser.size,
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

  // ── Roll Ело back, player by player ──
  // Before the rows are deleted: if an update fails we stop with the
  // history intact, so the event stays deletable and nothing is left
  // half-undone.
  if (deltaByUser.size > 0) {
    const { data: affected } = await supabaseAdmin
      .from('users')
      .select('id, elo')
      .in('id', [...deltaByUser.keys()]);

    for (const u of affected || []) {
      // 1200 mirrors the default the score route itself assumed when it
      // moved a player who had no rating yet.
      const restored = (u.elo ?? 1200) - deltaByUser.get(u.id);
      const { error: updErr } = await supabaseAdmin
        .from('users')
        .update({ elo: restored, category: categoryForElo(restored)?.id })
        .eq('id', u.id);
      if (updErr) {
        console.error('[event delete] elo rollback:', updErr.message);
        return Response.json(
          { success: false, error: 'Не вдалося скасувати нараховане Ело — турнір не видалено' },
          { status: 500 }
        );
      }
    }
  }

  // The history goes explicitly — it has no cascade, and leaving it
  // would block the delete below.
  if (eloRows.length > 0) {
    const { error: histErr } = await supabaseAdmin
      .from('elo_history')
      .delete()
      .in('category_id', categoryIds);
    if (histErr) {
      console.error('[event delete] elo_history:', histErr.message);
      return Response.json({ success: false, error: 'Не вдалося очистити історію Ело' }, { status: 500 });
    }
  }

  // avp_points needs no such step — it cascades, and the standings view
  // recomputes itself from what is left.
  const { error } = await supabaseAdmin.from('tournament_events').delete().eq('id', eventId);
  if (error) {
    console.error('[event delete] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося видалити турнір' }, { status: 500 });
  }

  return Response.json({ success: true, undone: willUndo });
}
