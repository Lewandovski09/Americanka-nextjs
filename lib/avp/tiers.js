// AVP season points — how a place in a category turns into points.
//
// Modelled on the ATP ranking, with one deliberate translation. ATP pays
// for the ROUND a player reached, because every ATP draw is a single
// elimination bracket. Ours are not: a Double Elimination, a group stage
// with crosses, a King of the Beach and an eight-player americanka have
// no common notion of "the quarterfinal" — but every one of them ends
// with a place. So the tables below are indexed by PLACE, and the
// correspondence to the ATP round table is exact, because in a single
// elimination draw "lost in the quarterfinal" and "finished 5th-8th" are
// the same statement:
//
//   step 0 → place 1        winner
//   step 1 → place 2        finalist
//   step 2 → places 3-4     semifinal
//   step 3 → places 5-8     quarterfinal
//   step 4 → places 9-16    1/8
//   step 5 → places 17-32   1/16
//   step 6 → places 33-64   1/32
//   past the end → 0        early exit
//
// The tier is the only scaling knob and it is the admin's to turn: an
// eight-player league can be run as a 2000 if the club wants those eight
// places to be worth that. Draw size is deliberately NOT part of the
// formula — a rule that quietly paid less for the same place would be
// impossible to explain to the player it happened to.
//
// Our brackets report places more finely than the steps do (a Double
// Elimination separates 5-6 from 7-8), which costs nothing: both land in
// step 3 and are paid the same. Coarsening only goes this way.

export const AVP_TIERS = {
  250: { id: 250, label: 'AVP 250', steps: [250, 165, 100, 50, 25, 13] },
  500: { id: 500, label: 'AVP 500', steps: [500, 330, 200, 100, 50] },
  1000: { id: 1000, label: 'AVP 1000', steps: [1000, 650, 400, 200, 100, 50] },
  2000: { id: 2000, label: 'AVP 2000', steps: [2000, 1300, 800, 400, 200, 100, 50] },
};

/** Tier ids, ascending — for pickers. */
export const AVP_TIER_IDS = [250, 500, 1000, 2000];

export function getTier(tier) {
  return AVP_TIERS[Number(tier)] || null;
}

/**
 * Which step (0-based) a place falls into: 1 → 0, 2 → 1, 3-4 → 2,
 * 5-8 → 3, 9-16 → 4, …  The block a place belongs to is the round of a
 * single-elimination draw it would have gone out in, so the boundary is
 * the smallest power of two that is not below the place — NOT
 * floor(log2), which lands 3rd place in the finalist's block.
 *
 * Counted rather than derived from a logarithm: the inputs are tiny
 * (a place is at most a couple of dozen) and this cannot drift on a
 * float that comes back as 2.9999999999999996.
 */
export function stepForPlace(place) {
  if (!Number.isFinite(place) || place < 1) return -1;
  let step = 0;
  while (2 ** step < place) step++;
  return step;
}

/**
 * Points a place is worth at a tier. Unknown tier, or a place past the
 * table's last step, is worth nothing.
 *
 * @param {number|string|null} tier - 250 | 500 | 1000 | 2000
 * @param {number} place - 1-based finishing place
 */
export function pointsForPlace(tier, place) {
  const t = getTier(tier);
  if (!t) return 0;
  const step = stepForPlace(place);
  if (step < 0) return 0;
  return t.steps[step] ?? 0;
}

/**
 * The tier a category actually runs at: its own override, else the
 * event's. NULL at both levels = outside the rating.
 *
 * @param {{avp_tier?: number|null}} category
 * @param {{avp_tier?: number|null}} [event]
 */
export function effectiveTier(category, event) {
  return category?.avp_tier ?? event?.avp_tier ?? null;
}

/**
 * The whole payout table of a tier, as blocks — for showing an admin (or
 * a player) what an event is worth before it is played.
 *
 * @returns {{from: number, to: number, label: string, points: number}[]}
 */
export function tierBreakdown(tier) {
  const t = getTier(tier);
  if (!t) return [];
  return t.steps.map((points, step) => {
    // Step 0 is the winner alone; every later step spans from just past
    // the previous power of two up to its own.
    const from = step === 0 ? 1 : 2 ** (step - 1) + 1;
    const to = 2 ** step;
    return { from, to, label: from === to ? `${from}` : `${from}-${to}`, points };
  });
}
