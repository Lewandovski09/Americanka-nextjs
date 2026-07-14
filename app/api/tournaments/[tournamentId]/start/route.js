import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat, getBracketSystem } from '@/lib/formats';
import { buildAmericanoMatches } from '@/lib/formats/americano';
import { buildKingRound1, buildKingPlaceholders } from '@/lib/formats/kingOfBeach';
import { buildTwoGroupStage, buildFourGroupStage } from '@/lib/formats/brackets';
import { buildDoubleElimination, isPowerOfTwo } from '@/lib/formats/doubleElim';

// Admin closes registration for a CATEGORY and generates its matches.
export async function POST(request, { params }) {
  const { tournamentId } = params; // category id
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
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('*, tournament_events(id, format_kind, status)')
    .eq('id', tournamentId)
    .single();
  if (!category) return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 404 });
  if (category.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Категорію вже розпочато' }, { status: 400 });
  }

  const event = category.tournament_events;
  const format = getFormat(event?.format_kind);
  if (!format) return Response.json({ success: false, error: 'Невідомий формат' }, { status: 400 });

  const courts = category.courts?.length ? category.courts : [1];

  let matchRows;
  try {
    if (format.kind === 'americanka') {
      matchRows = await buildAmericankaMatches(supabaseAdmin, tournamentId, courts);
    } else if (format.kind === 'king_of_beach') {
      matchRows = await buildKingMatches(supabaseAdmin, tournamentId, category, courts);
    } else {
      matchRows = await buildPairMatches(supabaseAdmin, tournamentId, category, courts);
    }
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 400 });
  }

  const rows = matchRows.map((m) => ({ ...m, tournament_id: tournamentId }));
  const { error: insErr } = await supabaseAdmin.from('matches').insert(rows);
  if (insErr) {
    console.error('[start] matches insert:', insErr.message);
    return Response.json({ success: false, error: 'Не вдалося створити матчі' }, { status: 500 });
  }

  await supabaseAdmin
    .from('tournaments')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', tournamentId);

  // Starting any category closes the event's registration and moves the
  // event "live" the first time (so it surfaces under Активні).
  if (event?.id) {
    const eventUpdate = { registration_open: false };
    if (event.status === 'scheduled') {
      eventUpdate.status = 'live';
      eventUpdate.started_at = new Date().toISOString();
    }
    await supabaseAdmin.from('tournament_events').update(eventUpdate).eq('id', event.id);
  }

  return Response.json({ success: true, matches: rows.length });
}

async function buildAmericankaMatches(supabaseAdmin, categoryId, courts) {
  const { data: tps } = await supabaseAdmin
    .from('tournament_players')
    .select('player_id, slot_index')
    .eq('tournament_id', categoryId)
    .order('slot_index', { ascending: true });

  if (!tps || tps.length !== 8) {
    throw new Error(`Для американки потрібно рівно 8 гравців (зараз ${tps?.length || 0})`);
  }
  const playerIds = tps.map((t) => t.player_id);
  return buildAmericanoMatches(playerIds, courts);
}

async function buildKingMatches(supabaseAdmin, categoryId, category, courts) {
  const { data: tps } = await supabaseAdmin
    .from('tournament_players')
    .select('player_id, slot_index')
    .eq('tournament_id', categoryId)
    .order('slot_index', { ascending: true });

  const registered = tps?.length || 0;
  const cap = category.max_participants || registered;
  const usable = Math.min(registered, cap) - (Math.min(registered, cap) % 4); // floor to /4
  if (usable < 4) {
    throw new Error(`Замало гравців: потрібно щонайменше 4 (кратно 4), зараз ${registered}`);
  }
  const playerIds = tps.slice(0, usable).map((t) => t.player_id);
  const { matches } = buildKingRound1(playerIds, courts);
  // The whole tournament skeleton up front: later rounds are created as
  // placeholders (empty team slots) and filled automatically as each
  // round completes — no manual "advance" step.
  return [...matches, ...buildKingPlaceholders(playerIds.length, courts)];
}

async function buildPairMatches(supabaseAdmin, categoryId, category, courts) {
  const { data: teams } = await supabaseAdmin
    .from('tournament_teams')
    .select(
      `id, player1_id, player2_id,
       p1:players!tournament_teams_player1_id_fkey(elo),
       p2:players!tournament_teams_player2_id_fkey(elo)`
    )
    .eq('tournament_id', categoryId);

  // Seed strongest-first by combined Elo so double-elim byes land on the
  // top seeds and group snaking stays balanced.
  const mapped = (teams || [])
    .filter((t) => t.player1_id && t.player2_id)
    .map((t) => ({
      id: t.id,
      players: [t.player1_id, t.player2_id],
      strength: (t.p1?.elo || 0) + (t.p2?.elo || 0),
    }))
    .sort((a, b) => b.strength - a.strength);

  if (category.bracket_system === 'double_elimination') {
    const bracketSize = category.max_participants; // 16 or 32
    if (!isPowerOfTwo(bracketSize)) {
      throw new Error(`Double Elimination потребує розміру сітки 16 або 32`);
    }
    if (mapped.length < 2) {
      throw new Error(`Замало повних пар (зараз ${mapped.length})`);
    }
    if (mapped.length > bracketSize) {
      throw new Error(
        `Пар більше за розмір сітки (${mapped.length} > ${bracketSize}) — зайвих перенесіть у резерв`
      );
    }
    // Fewer than the bracket size ⇒ strongest seeds get round-1 byes.
    return buildDoubleElimination(mapped, courts, bracketSize);
  }

  const sys = getBracketSystem(category.bracket_system);
  if (!sys) throw new Error('Невідома система турніру');

  // Format 3 — 1:1 with the ЧУ Masters file: exactly 16 pairs, 4 groups of 4.
  if (category.bracket_system === 'groups_top1_bye_top23_crosses') {
    if (mapped.length !== 16) {
      throw new Error(
        `Цей формат потребує рівно 16 пар (зараз ${mapped.length}) — зайвих перенесіть у резерв`
      );
    }
    return buildFourGroupStage(mapped, courts);
  }

  // groups_crosses_1_2: exactly 2 groups, count within the system's range.
  const lo = sys.participantOptions[0];
  const hi = sys.participantOptions[sys.participantOptions.length - 1];
  if (mapped.length < lo) {
    throw new Error(`Для групового формату потрібно щонайменше ${lo} пар (зараз ${mapped.length})`);
  }
  if (mapped.length > hi) {
    throw new Error(`Забагато пар для групового формату (максимум ${hi}, зараз ${mapped.length})`);
  }
  return buildTwoGroupStage(mapped, courts);
}
