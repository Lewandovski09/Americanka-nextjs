// AVP season points — how a place in a category turns into points.
//
// The club's own payout table (set by the organiser, October 2026). It
// pays by PLACE, because every format we run — Double Elimination,
// groups with crosses, King of the Beach, an eight-player americanka —
// ends with a place, while they share no common notion of "a round".
//
// Places are paid in BLOCKS. Single places for the podium and 4th, then
// pairs and fours:
//
//   place      1    2    3    4   5-6  7-8  9-12  13-16   17+
//   AVP 250   250  200  175  150  125  100   75    50      0
//   AVP 500   500  400  350  300  275  250  150   100      0
//   AVP 1000  ×2 of AVP 500
//   AVP 2000  ×4 of AVP 500
//
// A tie is reported as the first place of its block (placements.ts: four
// pairs out together in 13-16 are all `place: 13`), so tied players get
// that place's points — e.g. two pairs sharing 3-4 both get 3rd-place
// points. The tier is the only scaling knob; draw size is deliberately
// NOT part of the formula.

export type AvpTierId = 250 | 500 | 1000 | 2000;

/** One payout block: every place from `from` to `to` (inclusive) earns `points`. */
export interface AvpBlock {
  from: number;
  to: number;
  points: number;
}

export interface AvpTier {
  id: AvpTierId;
  label: string;
  blocks: AvpBlock[];
}

/** The place ranges every tier pays, top to bottom. */
const PLACE_BLOCKS: Array<[number, number]> = [
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 6],
  [7, 8],
  [9, 12],
  [13, 16],
];

function tier(id: AvpTierId, points: number[]): AvpTier {
  return {
    id,
    label: `AVP ${id}`,
    blocks: PLACE_BLOCKS.map(([from, to], i) => ({ from, to, points: points[i] })),
  };
}

const AVP_500_POINTS = [500, 400, 350, 300, 275, 250, 150, 100];

export const AVP_TIERS: Record<AvpTierId, AvpTier> = {
  250: tier(250, [250, 200, 175, 150, 125, 100, 75, 50]),
  500: tier(500, AVP_500_POINTS),
  1000: tier(1000, AVP_500_POINTS.map((p) => p * 2)),
  2000: tier(2000, AVP_500_POINTS.map((p) => p * 4)),
};

/** Tier ids, ascending — for pickers. */
export const AVP_TIER_IDS: AvpTierId[] = [250, 500, 1000, 2000];

export function getTier(tier: AvpTierId | number | string | null | undefined): AvpTier | null {
  return AVP_TIERS[Number(tier) as AvpTierId] || null;
}

/** The payout block a place falls into, or null past the table (17th and lower). */
export function blockForPlace(
  tier: AvpTierId | number | string | null | undefined,
  place: number
): AvpBlock | null {
  const t = getTier(tier);
  if (!t || !Number.isFinite(place) || place < 1) return null;
  return t.blocks.find((b) => place >= b.from && place <= b.to) || null;
}

/**
 * Points a place is worth at a tier. Unknown tier, or a place past the
 * table's last block, is worth nothing.
 *
 * @param tier - 250 | 500 | 1000 | 2000
 * @param place - 1-based finishing place
 */
export function pointsForPlace(
  tier: AvpTierId | number | string | null | undefined,
  place: number
): number {
  return blockForPlace(tier, place)?.points ?? 0;
}

export interface AvpTierable {
  avp_tier?: number | null;
}

/**
 * The tier a category actually runs at: its own override, else the
 * event's. NULL at both levels = outside the rating.
 */
export function effectiveTier(
  category?: AvpTierable | null,
  event?: AvpTierable | null
): number | null {
  return category?.avp_tier ?? event?.avp_tier ?? null;
}

export interface TierBreakdownRow {
  from: number;
  to: number;
  label: string;
  points: number;
}

/**
 * The whole payout table of a tier, as blocks — for showing an admin (or
 * a player) what an event is worth before it is played.
 */
export function tierBreakdown(
  tier: AvpTierId | number | string | null | undefined
): TierBreakdownRow[] {
  const t = getTier(tier);
  if (!t) return [];
  return t.blocks.map(({ from, to, points }) => ({
    from,
    to,
    label: from === to ? `${from}` : `${from}-${to}`,
    points,
  }));
}
