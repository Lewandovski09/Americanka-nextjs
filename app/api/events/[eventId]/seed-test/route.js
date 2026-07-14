import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';

// Admin helper: fill the application queue with the seeded test players
// (login test1…test48). Solo formats get one application per player;
// pair formats get one application per pair — same-gender pairs for
// single_gender, man+woman for mix. Test players that already have a
// live application on this event are left untouched.
export async function POST(request, { params }) {
  const { eventId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();
  if (!caller?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id, status, format_kind')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  if (event.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Турнір вже розпочато' }, { status: 400 });
  }

  const format = getFormat(event.format_kind);
  if (!format) return Response.json({ success: false, error: 'Невідомий формат' }, { status: 400 });
  const isPair = format.registrationType === 'pair' || format.registrationType === 'mix_pair';
  const isMix = format.registrationType === 'mix_pair';

  const { data: testPlayers } = await supabaseAdmin
    .from('players')
    .select('id, login, gender, elo')
    .like('login', 'test%')
    .eq('approval_status', 'approved');
  if (!testPlayers?.length) {
    return Response.json({ success: false, error: 'Тестових гравців немає — запустіть seed_test_users.sql' }, { status: 400 });
  }
  // test1, test2, … in numeric order so the pairs are stable run-to-run.
  testPlayers.sort((a, b) => Number(a.login.slice(4)) - Number(b.login.slice(4)));

  // Existing applications: live ones make the player unavailable; stale
  // (withdrawn/rejected) rows are cleared so the insert doesn't hit the
  // unique (event_id, player_id) constraint.
  const testIds = testPlayers.map((p) => p.id);
  const { data: apps } = await supabaseAdmin
    .from('tournament_applications')
    .select('id, player_id, partner_id, status')
    .eq('event_id', eventId);
  const activeIds = new Set(
    (apps || [])
      .filter((a) => a.status !== 'withdrawn' && a.status !== 'rejected')
      .flatMap((a) => [a.player_id, a.partner_id])
      .filter(Boolean)
  );
  const staleIds = (apps || [])
    .filter((a) => (a.status === 'withdrawn' || a.status === 'rejected') && testIds.includes(a.player_id))
    .map((a) => a.id);
  if (staleIds.length > 0) {
    await supabaseAdmin.from('tournament_applications').delete().in('id', staleIds);
  }

  const pool = testPlayers.filter((p) => !activeIds.has(p.id));
  if (pool.length === 0) {
    return Response.json({ success: false, error: 'Всі тестові гравці вже заявлені' }, { status: 400 });
  }

  const rows = [];
  const baseRow = (player, partner) => ({
    event_id: eventId,
    player_id: player.id,
    partner_id: partner?.id || null,
    seeking_partner: false,
    requested_category: null,
    status: 'pending',
    assigned_tournament_id: null,
  });

  if (!isPair) {
    // Solo (americanka, king of the beach): everyone applies alone.
    pool.forEach((p) => rows.push(baseRow(p, null)));
  } else if (isMix) {
    // Mix: man + woman.
    const men = pool.filter((p) => p.gender === 'M');
    const women = pool.filter((p) => p.gender === 'F');
    for (let i = 0; i < Math.min(men.length, women.length); i++) {
      rows.push(baseRow(men[i], women[i]));
    }
  } else {
    // single_gender: pairs within the same gender.
    for (const gender of ['M', 'F']) {
      const g = pool.filter((p) => p.gender === gender);
      for (let i = 0; i + 1 < g.length; i += 2) {
        rows.push(baseRow(g[i], g[i + 1]));
      }
    }
  }

  if (rows.length === 0) {
    return Response.json({ success: false, error: 'Немає кого заявити — не вистачає вільних тестових гравців' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('tournament_applications').insert(rows);
  if (error) {
    console.error('[seed-test] insert:', error.message);
    return Response.json({ success: false, error: 'Не вдалося створити заявки' }, { status: 500 });
  }

  return Response.json({ success: true, applications: rows.length });
}
