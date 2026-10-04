import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { readRatings, writeRating } from '@/lib/server/ratings';
import { PRIMARY_SPORT_ID } from '@/lib/sports';

// «Відновити» — puts a deleted tournament back from the archive
// (migration 052): every row of the snapshot returns with its own id,
// then the Ело its games had moved — rolled back at the delete — is
// applied to the players again. AVP points and places come back as rows,
// and the standings recompute from them by themselves.
export async function POST(request, { params }) {
  const { archiveId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }
  const supabaseAdmin = createAdminClient();
  const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', authUser.user.id).maybeSingle();
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може відновлювати турніри' }, { status: 403 });
  }

  const { data: entry } = await supabaseAdmin
    .from('deleted_events')
    .select('id, event_id, name, snapshot')
    .eq('id', archiveId)
    .maybeSingle();
  if (!entry) return Response.json({ success: false, error: 'Запис архіву не знайдено' }, { status: 404 });

  const { data: exists } = await supabaseAdmin
    .from('tournament_events')
    .select('id')
    .eq('id', entry.event_id)
    .maybeSingle();
  if (exists) {
    return Response.json({ success: false, error: 'Цей турнір уже відновлено' }, { status: 400 });
  }

  // All rows at once, in one database transaction: either the whole
  // tournament comes back or nothing does.
  const { error: restoreErr } = await supabaseAdmin.rpc('restore_event_snapshot', { p_snapshot: entry.snapshot });
  if (restoreErr) {
    console.error('[archive restore]', restoreErr.message);
    const gone = /foreign key/i.test(restoreErr.message);
    return Response.json(
      {
        success: false,
        error: gone
          ? 'Не вдалося відновити: когось із гравців або майданчик турніру вже видалено'
          : 'Не вдалося відновити турнір',
      },
      { status: 500 }
    );
  }

  // Ело back on the players: the same per-player, per-sport sums the
  // delete subtracted.
  const deltaBySport = new Map();
  for (const r of entry.snapshot?.elo_history || []) {
    if (!r.user_id) continue;
    const sport = r.sport_id || PRIMARY_SPORT_ID;
    if (!deltaBySport.has(sport)) deltaBySport.set(sport, new Map());
    const m = deltaBySport.get(sport);
    m.set(r.user_id, (m.get(r.user_id) || 0) + (r.delta || 0));
  }
  let eloFailed = 0;
  for (const [sportId, deltaByUser] of deltaBySport) {
    const current = await readRatings(supabaseAdmin, [...deltaByUser.keys()], sportId);
    for (const [userId, delta] of deltaByUser) {
      const err = await writeRating(supabaseAdmin, userId, sportId, current.get(userId) + delta);
      if (err) {
        console.error('[archive restore] elo:', err);
        eloFailed += 1;
      }
    }
  }

  await supabaseAdmin.from('deleted_events').delete().eq('id', entry.id);

  return Response.json({
    success: true,
    eventId: entry.event_id,
    warning: eloFailed > 0 ? `Турнір відновлено, але Ело не вдалося повернути ${eloFailed} гравцям` : null,
  });
}
