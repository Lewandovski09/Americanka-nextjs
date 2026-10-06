import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addRating } from '@/lib/server/ratings';
import { PRIMARY_SPORT_ID } from '@/lib/sports';
import { getAuthUser } from '@/lib/server/authUser';

// «Відновити» — puts a deleted tournament back from the archive
// (migration 052): every row of the snapshot returns with its own id,
// then the Ело its games had moved — rolled back at the delete — is
// applied to the players again. AVP points and places come back as rows,
// and the standings recompute from them by themselves.
export async function POST(request, { params }) {
  const { archiveId } = params;

  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }
  const supabaseAdmin = createAdminClient();
  // The archive is the owner's only (migration 053).
  const [{ data: owner }, { data: entry }] = await Promise.all([
    supabaseAdmin.from('app_owners').select('user_id').eq('user_id', authUser.user.id).maybeSingle(),
    supabaseAdmin.from('deleted_events').select('id, event_id, name, snapshot').eq('id', archiveId).maybeSingle(),
  ]);
  if (!owner) {
    return Response.json({ success: false, error: 'Архів доступний лише власнику застосунку' }, { status: 403 });
  }

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
  // All players at once (each change is its own atomic add).
  const changes = [];
  for (const [sportId, deltaByUser] of deltaBySport) {
    for (const [userId, delta] of deltaByUser) if (delta) changes.push({ sportId, userId, delta });
  }
  const errors = await Promise.all(
    changes.map(async (c) => (await addRating(supabaseAdmin, c.userId, c.sportId, c.delta)).error)
  );
  const eloFailed = errors.filter(Boolean).length;
  errors.filter(Boolean).forEach((err) => console.error('[archive restore] elo:', err));

  // The archive entry goes only when everything came back — otherwise it
  // stays as the record of which ratings still need the admin's hand.
  if (eloFailed === 0) await supabaseAdmin.from('deleted_events').delete().eq('id', entry.id);

  return Response.json({
    success: true,
    eventId: entry.event_id,
    warning: eloFailed > 0 ? `Турнір відновлено, але Ело не вдалося повернути ${eloFailed} гравцям` : null,
  });
}
