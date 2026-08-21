// Shared validation/derivation for event create + update APIs.

import { CATEGORY_LABELS, getBracketSystem, type FormatKind } from '@/lib/formats';
import { AVP_TIER_IDS } from '@/lib/avp/tiers';
import type { SupabaseAdmin } from './types';

/** A category as submitted by the create/update event form — loosely
 * typed since it's raw request-body JSON; only the fields these
 * functions actually branch on are named. */
export interface CategoryInput {
  categoryLabel?: string;
  gender?: 'M' | 'F' | null;
  bracketSystem?: string | null;
  maxParticipants?: number | null;
  [key: string]: unknown;
}

/** The event row (existing or being created) these derivations read from. */
export interface EventInput {
  id: string;
  name: string;
  points_to_win?: number;
  final_points_to_win?: number | null;
  location?: string | null;
  courts?: number[];
  scheduled_at?: string | null;
  [key: string]: unknown;
}

export type EloBands = Record<string, { eloMin: number; eloMax: number }>;

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

// Group key: gendered formats split leagues by gender (Men Light and
// Women Light are independent bands); non-gendered formats share one.
export function bandKey(format: FormatKind, c: CategoryInput): string {
  const g = format.hasGender ? c.gender || 'X' : 'X';
  return `${g}:${c.categoryLabel}`;
}

// Evenly split [min, max] into one band per selected label, ordered
// Light → Pro. Returns { 'M:Pro': { eloMin, eloMax }, ... }.
export async function computeEloBands(
  supabaseAdmin: SupabaseAdmin,
  format: FormatKind,
  categories: CategoryInput[]
): Promise<EloBands> {
  const pick = (asc: boolean) =>
    supabaseAdmin
      .from('users')
      .select('elo')
      .eq('approval_status', 'approved')
      .not('elo', 'is', null)
      .order('elo', { ascending: asc })
      .limit(1)
      .maybeSingle();

  const [{ data: lo }, { data: hi }] = await Promise.all([pick(true), pick(false)]);
  const min = lo?.elo;
  const max = hi?.elo;
  if (min == null || max == null || max <= min) return {}; // no usable spread

  // Selected labels per gender group, in ascending tier order.
  const byGroup: Record<string, Set<string>> = {};
  for (const c of categories) {
    const g = format.hasGender ? c.gender || 'X' : 'X';
    (byGroup[g] ||= new Set()).add(c.categoryLabel as string);
  }

  const bands: EloBands = {};
  for (const [g, set] of Object.entries(byGroup)) {
    const labels = CATEGORY_LABELS.filter((l) => set.has(l));
    const n = labels.length;
    labels.forEach((label, i) => {
      bands[`${g}:${label}`] = {
        eloMin: Math.round(min + ((max - min) * i) / n),
        eloMax: Math.round(min + ((max - min) * (i + 1)) / n),
      };
    });
  }
  return bands;
}

// Stored capacity: fixed formats use their fixed count; double-elim uses
// the chosen bracket size; group systems use their 6–12 cap (12).
export function capacityFor(format: FormatKind, c: CategoryInput): number | null {
  if (format.fixedParticipants) return format.fixedParticipants;
  if (format.needsBracketSystem) {
    const sys = getBracketSystem(c.bracketSystem);
    return sys ? (sys.sizeChoice ? c.maxParticipants ?? null : sys.cap) : null;
  }
  return c.maxParticipants || null;
}

export function validateCategory(format: FormatKind, c: CategoryInput): string | null {
  if (!c || !CATEGORY_LABELS.includes(c.categoryLabel as string)) {
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
  } else if (format.participantOptions) {
    if (!format.participantOptions.includes(c.maxParticipants as number)) {
      return `Кількість учасників має бути однією з: ${format.participantOptions.join(', ')}`;
    }
    if (format.kind === 'king_of_beach' && (c.maxParticipants as number) % 4 !== 0) {
      return 'Кількість учасників має бути кратною 4';
    }
  }
  return null;
}

// Row for the `tournaments` table from a validated category config.
export function categoryRow(format: FormatKind, event: EventInput, c: CategoryInput, bandByKey: EloBands): Record<string, unknown> {
  return {
    event_id: event.id,
    name: `${event.name} · ${c.categoryLabel}${c.gender ? (c.gender === 'M' ? ' (Ч)' : ' (Ж)') : ''}`,
    category_label: c.categoryLabel,
    gender: format.hasGender ? c.gender : null,
    bracket_system: format.needsBracketSystem ? c.bracketSystem : null,
    max_participants: capacityFor(format, c),
    // Auto-computed guideline shown to the admin when distributing (not a gate).
    elo_min: bandByKey[bandKey(format, c)]?.eloMin ?? null,
    elo_max: bandByKey[bandKey(format, c)]?.eloMax ?? null,
    points_to_win: format.scoring === 'first_to' ? event.points_to_win : 31,
    final_points_to_win: event.final_points_to_win,
    location: event.location,
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

// Scoring config from the request body (americanka is always sum-to-31,
// handled in code — its event points fields are unused).
export function resolveScoring(format: FormatKind, { pointsToWin, pointsMode, finalPointsToWin }: ScoringInput, FIRST_TO_OPTIONS: number[]): ScoringResult {
  let points = 31;
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
