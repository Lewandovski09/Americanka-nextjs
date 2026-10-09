// Shared validation/derivation for event create + update APIs.

import { getBracketSystem, type FormatKind } from '@/lib/formats';
import { AMERICANKA_SIZES, americankaPlanFor, americankaSum } from '@/lib/formats/americano';
import { AVP_TIER_IDS } from '@/lib/avp/tiers';
import { divisionsFor, getSport, sportOffersFormat, PRIMARY_SPORT_ID } from '@/lib/sports';
import type { SupabaseAdmin } from './types';

/** A category as submitted by the create/update event form — loosely
 * typed since it's raw request-body JSON; only the fields these
 * functions actually branch on are named. */
export interface CategoryInput {
  categoryLabel?: string;
  gender?: 'M' | 'F' | null;
  bracketSystem?: string | null;
  maxParticipants?: number | null;
  /** americanka with 6 players: 9 or 6 games */
  gamesCount?: number | null;
  [key: string]: unknown;
}

/** The event row (existing or being created) these derivations read from. */
export interface EventInput {
  id: string;
  name: string;
  points_to_win?: number;
  final_points_to_win?: number | null;
  location?: string | null;
  sport_id?: string | null;
  courts?: number[];
  scheduled_at?: string | null;
  [key: string]: unknown;
}

export interface VenueRow {
  id: string;
  code: string;
  name: string;
  courts: number[];
  is_active: boolean;
  city_id: string;
  venue_sports?: { sport_id: string }[] | null;
}

export type VenueCheck = { venue: VenueRow; error?: undefined } | { error: string; venue?: undefined };

/**
 * The venue an event is being put at, checked against the `venues` table
 * (migration 043) instead of a hardcoded list: it must exist, be active
 * for new events, host the event's sport, and actually have the courts
 * asked for. `courts` may be omitted when only the venue changes and the
 * caller checks the event's existing courts itself.
 */
export async function resolveVenue(
  supabaseAdmin: SupabaseAdmin,
  code: unknown,
  sportId: string | null | undefined,
  courts?: unknown,
  { allowInactive = false }: { allowInactive?: boolean } = {}
): Promise<VenueCheck> {
  if (typeof code !== 'string' || !code) return { error: 'Виберіть місце проведення' };
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, code, name, courts, is_active, city_id, venue_sports(sport_id)')
    .eq('code', code)
    .maybeSingle();
  const venue = data as unknown as VenueRow | null;
  if (!venue) return { error: 'Невідоме місце проведення' };
  if (!venue.is_active && !allowInactive) return { error: `«${venue.name}» зараз не приймає турніри` };

  const sport = sportId || PRIMARY_SPORT_ID;
  const hosted = (venue.venue_sports || []).map((s) => s.sport_id);
  if (hosted.length > 0 && !hosted.includes(sport)) {
    return { error: `На «${venue.name}» не проводяться турніри з цього виду спорту` };
  }

  if (courts !== undefined) {
    if (!Array.isArray(courts) || courts.length === 0) return { error: 'Виберіть щонайменше один корт' };
    const missing = courts.filter((c) => !venue.courts.includes(Number(c)));
    if (missing.length > 0) {
      return { error: `На «${venue.name}» немає корту ${missing.join(', ')}` };
    }
  }
  return { venue };
}

/** The sport an event is created in: known to the registry, offering the format. */
export function resolveSport(sportId: unknown, formatKind: string): { sportId: string; error?: undefined } | { error: string; sportId?: undefined } {
  const id = typeof sportId === 'string' && sportId ? sportId : PRIMARY_SPORT_ID;
  if (!getSport(id)) return { error: 'Невідомий вид спорту' };
  if (!sportOffersFormat(id, formatKind)) return { error: 'Цей формат недоступний для обраного виду спорту' };
  return { sportId: id };
}

// What the event is worth in the season rating. Null (or an omitted
// field) means the event is outside it — a friendly, a practice day —
// and that is the default, so an event only ever awards points because
// somebody said it should.
export function resolveAvpTier(avpTier: unknown): { tier: number | null; error?: undefined } | { error: string; tier?: undefined } {
  if (avpTier === undefined || avpTier === null || avpTier === '') return { tier: null };
  const tier = Number(avpTier);
  if (!AVP_TIER_IDS.includes(tier as (typeof AVP_TIER_IDS)[number])) {
    return { error: `Рівень AVP має бути одним з: ${AVP_TIER_IDS.join(', ')}` };
  }
  return { tier };
}

// Stored capacity: fixed formats use their fixed count; double-elim uses
// the chosen bracket size; group systems use their 6–12 cap (12).
export function capacityFor(format: FormatKind, c: CategoryInput): number | null {
  if (format.fixedParticipants) return format.fixedParticipants;
  // americanka: 8 or 6 (an old client that sends nothing — 8)
  if (format.kind === 'americanka') {
    return (AMERICANKA_SIZES as readonly number[]).includes(Number(c.maxParticipants)) ? Number(c.maxParticipants) : 8;
  }
  if (format.needsBracketSystem) {
    const sys = getBracketSystem(c.bracketSystem);
    return sys ? (sys.sizeChoice ? c.maxParticipants ?? null : sys.cap) : null;
  }
  return c.maxParticipants || null;
}

export function validateCategory(format: FormatKind, c: CategoryInput, sportId?: string | null): string | null {
  if (!c || !divisionsFor(sportId).includes(c.categoryLabel as string)) {
    return 'Невідома категорія';
  }
  if (format.hasGender && c.gender !== 'M' && c.gender !== 'F') {
    return 'Вкажіть стать категорії';
  }
  if (format.needsBracketSystem) {
    const sys = getBracketSystem(c.bracketSystem);
    if (!sys) return 'Виберіть систему турніру для кожної категорії';
    // Only size-choice systems (double-elim) validate the number; group
    // systems always take 6–12 and are normalized to their cap on insert.
    if (sys.sizeChoice && !sys.participantOptions.includes(c.maxParticipants as number)) {
      return `Розмір сітки: ${sys.participantOptions.join(' або ')}`;
    }
  } else if (format.participantOptions && !(format.kind === 'americanka' && c.maxParticipants == null)) {
    if (!format.participantOptions.includes(c.maxParticipants as number)) {
      return `Кількість учасників має бути однією з: ${format.participantOptions.join(', ')}`;
    }
    if (format.kind === 'king_of_beach' && (c.maxParticipants as number) % 4 !== 0) {
      return 'Кількість учасників має бути кратною 4';
    }
  }
  return null;
}

// Row for `tournament_categories` from a validated category config.
// The venue is NOT copied onto the category any more (043/044): it is
// the event's, and a copy only drifted when the event moved.
export function categoryRow(format: FormatKind, event: EventInput, c: CategoryInput): Record<string, unknown> {
  return {
    event_id: event.id,
    name: `${event.name} · ${c.categoryLabel}${c.gender ? (c.gender === 'M' ? ' (Ч)' : ' (Ж)') : ''}`,
    category_label: c.categoryLabel,
    gender: format.hasGender ? c.gender : null,
    // americanka on 6: the plan (9 or 6 games) — lib/formats/americano
    bracket_system: format.needsBracketSystem
      ? c.bracketSystem
      : format.kind === 'americanka'
      ? americankaPlanFor(capacityFor(format, c), c.gamesCount)
      : null,
    max_participants: capacityFor(format, c),
    points_to_win: format.scoring === 'first_to' ? event.points_to_win : americankaSum(event.points_to_win),
    final_points_to_win: event.final_points_to_win,
    courts: event.courts,
    scheduled_at: event.scheduled_at,
  };
}

export interface ScoringInput {
  pointsToWin?: number;
  pointsMode?: string;
  finalPointsToWin?: number;
}

export type ScoringResult =
  | { error: string; points?: undefined; mode?: undefined; finalPoints?: undefined }
  | { points: number; mode: 'whole' | 'from_semifinal'; finalPoints: number | null; error?: undefined };

// Scoring config from the request body. Americanka: the sum a game goes
// to — 29, 31 (default) or 35 (lib/formats/americano).
export function resolveScoring(format: FormatKind, { pointsToWin, pointsMode, finalPointsToWin }: ScoringInput, FIRST_TO_OPTIONS: number[]): ScoringResult {
  let points = format.scoring === 'sum31' ? americankaSum(pointsToWin) : 31;
  let mode: 'whole' | 'from_semifinal' = 'whole';
  let finalPoints: number | null = null;
  if (format.scoring === 'first_to') {
    if (!FIRST_TO_OPTIONS.includes(pointsToWin as number)) {
      return { error: 'Партії до 15 або 21' };
    }
    points = pointsToWin as number;
    mode = pointsMode === 'from_semifinal' ? 'from_semifinal' : 'whole';
    if (mode === 'from_semifinal') {
      if (!FIRST_TO_OPTIONS.includes(finalPointsToWin as number)) {
        return { error: 'Рахунок з півфіналу — 15 або 21' };
      }
      finalPoints = finalPointsToWin as number;
    }
  }
  return { points, mode, finalPoints };
}
