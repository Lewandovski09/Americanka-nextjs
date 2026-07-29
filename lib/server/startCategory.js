// Starting a category = generating its matches from the seeding and
// flipping it to «live». Split in two halves on purpose:
//
//   prepareCategoryStart() — reads the roster and BUILDS the games, or
//     throws with a message the admin can act on. Writes nothing.
//   commitCategoryStart()  — writes what prepare produced.
//
// The split is what lets «Запустити» start the whole event at once: every
// league is prepared first, and only if they all build does anything get
// written — one league missing its seeding can't leave the event half
// started.

import { getFormat, getBracketSystem } from '@/lib/formats';
import { buildAmericanoMatches } from '@/lib/formats/americano';
import { buildKingRound1, buildKingPlaceholders } from '@/lib/formats/kingOfBeach';
import { buildTwoGroupStage, buildFourGroupStage } from '@/lib/formats/brackets';
import { buildDoubleElimination, isPowerOfTwo } from '@/lib/formats/doubleElim';
import { pointsTargetForStage } from '@/lib/formats/scoring';
import { assignScheduledTimes } from '@/lib/schedule';

/**
 * @returns {Promise<{category: object, rows: object[]}>}
 * @throws {Error} with a message meant for the admin
 */
export async function prepareCategoryStart(supabaseAdmin, categoryId) {
  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('*, tournament_events(id, format_kind, status, points_to_win, points_mode, final_points_to_win)')
    .eq('id', categoryId)
    .single();
  if (!category) throw new Error('Категорію не знайдено');
  if (category.status !== 'scheduled') throw new Error('Категорію вже розпочато');

  const event = category.tournament_events;
  const format = getFormat(event?.format_kind);
  if (!format) throw new Error('Невідомий формат');

  const courts = category.courts?.length ? category.courts : [1];

  let matchRows;
  if (format.kind === 'americanka') {
    matchRows = await buildAmericankaMatches(supabaseAdmin, categoryId, courts);
  } else if (format.kind === 'king_of_beach') {
    matchRows = await buildKingMatches(supabaseAdmin, categoryId, category, courts);
  } else {
    matchRows = await buildPairMatches(supabaseAdmin, categoryId, category, courts);
  }

  // Times are stamped in the same pass that handed out the courts, so
  // each court's queue starts at the category time and every game holds
  // its court for a slot. An admin can move a single game afterwards.
  const rows = withScheduledTimes(matchRows, category, format).map((m) => ({
    ...m,
    tournament_id: categoryId,
  }));
  return { category, rows };
}

/**
 * @returns {Promise<{error?: string, matches?: number}>}
 */
export async function commitCategoryStart(supabaseAdmin, category, rows) {
  const { error: insErr } = await supabaseAdmin.from('matches').insert(rows);
  if (insErr) {
    console.error('[start] matches insert:', insErr.message);
    return { error: 'Не вдалося створити матчі' };
  }

  await supabaseAdmin
    .from('tournaments')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', category.id);

  // Starting any category closes the event's registration and moves the
  // event "live" the first time (so it surfaces under Активні).
  const event = category.tournament_events;
  if (event?.id) {
    const eventUpdate = { registration_open: false };
    if (event.status === 'scheduled') {
      eventUpdate.status = 'live';
      eventUpdate.started_at = new Date().toISOString();
    }
    await supabaseAdmin.from('tournament_events').update(eventUpdate).eq('id', event.id);
  }

  return { matches: rows.length };
}

// Planned start time for every generated game. A long game (до 21, or
// американка's sum-to-31) blocks its court for 45 min, a short one (до
// 15) for 30 — so the slot length follows the same points target the
// score dialog validates against.
function withScheduledTimes(matchRows, category, format) {
  const event = category.tournament_events;
  const isSum = format.scoring === 'sum31';
  const scoring = {
    points_to_win: category.points_to_win ?? event?.points_to_win ?? 21,
    points_mode: event?.points_mode,
    final_points_to_win: event?.final_points_to_win,
  };
  return assignScheduledTimes(matchRows, {
    startAt: category.scheduled_at,
    targetFor: (m) => (isSum ? 31 : pointsTargetForStage(scoring, m.stage)),
  });
}

// Seed order the bracket is built from: the places the admin arranged on
// «Посів» first, and whoever they never got to after them, in the order
// their applications were distributed. So an event can be started
// without touching the seeding at all — same rule the «Посів» tab shows.
function bySeed(a, b) {
  const as = a.slot_index ?? Infinity;
  const bs = b.slot_index ?? Infinity;
  if (as !== bs) return as - bs;
  const ac = a.created_at || '';
  const bc = b.created_at || '';
  if (ac !== bc) return ac < bc ? -1 : 1;
  return String(a.player_id || a.id).localeCompare(String(b.player_id || b.id));
}

async function buildAmericankaMatches(supabaseAdmin, categoryId, courts) {
  const { data: tps } = await supabaseAdmin
    .from('tournament_players')
    .select('player_id, slot_index, created_at')
    .eq('tournament_id', categoryId);

  if (!tps || tps.length !== 8) {
    throw new Error(`Для американки потрібно рівно 8 гравців (зараз ${tps?.length || 0})`);
  }
  const playerIds = [...tps].sort(bySeed).map((t) => t.player_id);
  return buildAmericanoMatches(playerIds, courts);
}

async function buildKingMatches(supabaseAdmin, categoryId, category, courts) {
  const { data: tps } = await supabaseAdmin
    .from('tournament_players')
    .select('player_id, slot_index, created_at')
    .eq('tournament_id', categoryId);

  const registered = tps?.length || 0;
  const cap = category.max_participants || registered;
  const usable = Math.min(registered, cap) - (Math.min(registered, cap) % 4); // floor to /4
  if (usable < 4) {
    throw new Error(`Замало гравців: потрібно щонайменше 4 (кратно 4), зараз ${registered}`);
  }
  const playerIds = [...tps].sort(bySeed).slice(0, usable).map((t) => t.player_id);
  const { matches } = buildKingRound1(playerIds, courts);
  // The whole tournament skeleton up front: later rounds are created as
  // placeholders (empty team slots) and filled automatically as each
  // round completes — no manual "advance" step.
  return [...matches, ...buildKingPlaceholders(playerIds.length, courts)];
}

async function buildPairMatches(supabaseAdmin, categoryId, category, courts) {
  const { data: teams } = await supabaseAdmin
    .from('tournament_teams')
    .select('id, player1_id, player2_id, slot_index, created_at')
    .eq('tournament_id', categoryId);

  // Seed order = seed 1, 2, 3, … top-down. Pairs still looking for a
  // partner hold a place on the «Посів» tab but cannot play, so they
  // drop out here.
  const mapped = (teams || [])
    .filter((t) => t.player1_id && t.player2_id)
    .sort(bySeed)
    .map((t) => ({ id: t.id, players: [t.player1_id, t.player2_id] }));

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
