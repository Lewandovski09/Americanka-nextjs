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
import { buildDoubleElimination, isPowerOfTwo, type SeedTeam } from '@/lib/formats/doubleElim';
import { placeIntoSlots } from '@/lib/formats/seedSlots';
import { pointsTargetForStage, type PointsConfig } from '@/lib/formats/scoring';
import { assignScheduledTimes } from '@/lib/schedule';
import type { SupabaseAdmin } from './types';
import type { Match } from '@/lib/types';

interface EventJoined {
  id: string;
  format_kind: string;
  status: string;
  points_to_win?: number;
  points_mode?: string;
  final_points_to_win?: number | null;
}

interface CategoryRow {
  id: string;
  status: string;
  courts?: number[] | null;
  points_to_win?: number | null;
  scheduled_at?: string | null;
  max_participants?: number | null;
  bracket_system?: string | null;
  tournament_events: EventJoined | null;
  [key: string]: unknown;
}

export interface PrepareResult {
  category: CategoryRow;
  rows: Match[];
}

export async function prepareCategoryStart(supabaseAdmin: SupabaseAdmin, categoryId: string): Promise<PrepareResult> {
  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select('*, tournament_events(id, format_kind, status, points_to_win, points_mode, final_points_to_win)')
    .eq('id', categoryId)
    .single();
  if (!category) throw new Error('Категорію не знайдено');
  if (category.status !== 'scheduled') throw new Error('Категорію вже розпочато');

  // Cast through `unknown` first: without generated Database types, the
  // client infers embedded joins as arrays (it can't see this is a
  // to-one foreign key) — the real value at runtime is a single row or
  // null. `select('*', ...)` sometimes lets this slide as `any` instead
  // of erroring, but the cast stays defensive either way.
  const event = category.tournament_events as unknown as EventJoined | null;
  const format = getFormat(event?.format_kind);
  if (!format) throw new Error('Невідомий формат');

  const courts: number[] = category.courts?.length ? category.courts : [1];

  let matchRows: Match[];
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
    category_id: categoryId,
  }));
  return { category, rows };
}

export interface CommitResult {
  error?: string;
  matches?: number;
}

export async function commitCategoryStart(supabaseAdmin: SupabaseAdmin, category: CategoryRow, rows: Match[]): Promise<CommitResult> {
  const { error: insErr } = await supabaseAdmin.from('tournament_matches').insert(rows);
  if (insErr) {
    console.error('[start] matches insert:', insErr.message);
    return { error: 'Не вдалося створити матчі' };
  }

  await supabaseAdmin
    .from('tournament_categories')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', category.id);

  // Starting any category closes the event's registration and moves the
  // event "live" the first time (so it surfaces under Активні).
  const event = category.tournament_events;
  if (event?.id) {
    const eventUpdate: { registration_open: boolean; status?: string; started_at?: string } = {
      registration_open: false,
    };
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
function withScheduledTimes(matchRows: Match[], category: CategoryRow, format: { scoring: string }): Match[] {
  const event = category.tournament_events;
  const isSum = format.scoring === 'sum31';
  const scoring: PointsConfig = {
    points_to_win: category.points_to_win ?? event?.points_to_win ?? 21,
    points_mode: event?.points_mode,
    final_points_to_win: event?.final_points_to_win,
  };
  return assignScheduledTimes(matchRows, {
    startAt: category.scheduled_at,
    targetFor: (m) => (isSum ? 31 : pointsTargetForStage(scoring, (m.stage as string) || '')),
  });
}

interface Seedable {
  slot_index?: number | null;
  created_at?: string | null;
  user_id?: string;
  id?: string;
}

// Seed order the bracket is built from: the places the admin arranged on
// «Посів» first, and whoever they never got to after them, in the order
// their applications were distributed. So an event can be started
// without touching the seeding at all — same rule the «Посів» tab shows.
function bySeed(a: Seedable, b: Seedable): number {
  const as = a.slot_index ?? Infinity;
  const bs = b.slot_index ?? Infinity;
  if (as !== bs) return as - bs;
  const ac = a.created_at || '';
  const bc = b.created_at || '';
  if (ac !== bc) return ac < bc ? -1 : 1;
  return String(a.user_id || a.id).localeCompare(String(b.user_id || b.id));
}

async function buildAmericankaMatches(supabaseAdmin: SupabaseAdmin, categoryId: string, courts: number[]): Promise<Match[]> {
  const { data: tps } = await supabaseAdmin
    .from('tournament_players')
    .select('user_id, slot_index, created_at')
    .eq('category_id', categoryId);

  if (!tps || tps.length !== 8) {
    throw new Error(`Для американки потрібно рівно 8 гравців (зараз ${tps?.length || 0})`);
  }
  const playerIds = ([...tps] as Seedable[]).sort(bySeed).map((t) => t.user_id as string);
  return buildAmericanoMatches(playerIds, courts);
}

async function buildKingMatches(supabaseAdmin: SupabaseAdmin, categoryId: string, category: CategoryRow, courts: number[]): Promise<Match[]> {
  const { data: tps } = await supabaseAdmin
    .from('tournament_players')
    .select('user_id, slot_index, created_at')
    .eq('category_id', categoryId);

  const registered = tps?.length || 0;
  const cap = category.max_participants || registered;
  const usable = Math.min(registered, cap) - (Math.min(registered, cap) % 4); // floor to /4
  if (usable < 4) {
    throw new Error(`Замало гравців: потрібно щонайменше 4 (кратно 4), зараз ${registered}`);
  }
  const playerIds = ([...(tps || [])] as Seedable[])
    .sort(bySeed)
    .slice(0, usable)
    .map((t) => t.user_id as string);
  const { matches } = buildKingRound1(playerIds, courts);
  // The whole tournament skeleton up front: later rounds are created as
  // placeholders (empty team slots) and filled automatically as each
  // round completes — no manual "advance" step.
  return [...matches, ...buildKingPlaceholders(playerIds.length, courts)];
}

async function buildPairMatches(supabaseAdmin: SupabaseAdmin, categoryId: string, category: CategoryRow, courts: number[]): Promise<Match[]> {
  const { data: teams } = await supabaseAdmin
    .from('tournament_teams')
    .select('id, user1_id, user2_id, slot_index, created_at')
    .eq('category_id', categoryId);

  // Seed order = seed 1, 2, 3, … top-down. Pairs still looking for a
  // partner hold a place on the «Посів» tab but cannot play, so they
  // drop out here.
  //
  // Typed as SeedTeam & { slotIndex } rather than plain SeedTeam[]: the
  // objects below really do carry slotIndex (placeIntoSlots needs it),
  // and a narrower annotation here would hide that from the type
  // checker even though the runtime object has it.
  const mapped: (SeedTeam & { slotIndex: number | null })[] = (
    (teams || []) as (Seedable & { user1_id: string | null; user2_id: string | null })[]
  )
    .filter((t) => t.user1_id && t.user2_id)
    .sort(bySeed)
    .map((t) => ({ id: t.id as string, slotIndex: t.slot_index ?? null, players: [t.user1_id as string, t.user2_id as string] }));

  if (category.bracket_system === 'double_elimination') {
    const bracketSize = category.max_participants as number; // 16 or 32
    if (!isPowerOfTwo(bracketSize)) {
      throw new Error(`Double Elimination потребує розміру сітки 16 або 32`);
    }
    if (mapped.length < 2) {
      throw new Error(`Замало повних пар (зараз ${mapped.length})`);
    }
    if (mapped.length > bracketSize) {
      throw new Error(`Пар більше за розмір сітки (${mapped.length} > ${bracketSize}) — зайвих перенесіть у резерв`);
    }
    // Fewer pairs than the bracket size ⇒ the grid keeps its holes where
    // «Посів» put them (byes default to the strongest seeds only while
    // the seeding has never been saved — an unseeded roster fills the
    // places top-down and the empty ones are left at the bottom).
    return buildDoubleElimination(placeIntoSlots(mapped, bracketSize), courts, bracketSize);
  }

  const sys = getBracketSystem(category.bracket_system);
  if (!sys) throw new Error('Невідома система турніру');

  // Format 3 — 1:1 with the ЧУ Masters file: exactly 16 pairs, 4 groups of 4.
  if (category.bracket_system === 'groups_top1_bye_top23_crosses') {
    if (mapped.length !== 16) {
      throw new Error(`Цей формат потребує рівно 16 пар (зараз ${mapped.length}) — зайвих перенесіть у резерв`);
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
