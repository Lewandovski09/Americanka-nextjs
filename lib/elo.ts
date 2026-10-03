// Elo rating math — pure functions, no side effects.
//
// Three things move `users.elo`: an admin setting it (approval /
// edit-elo), the americanka auto-Ело in the score route, and the
// rollback when an event is deleted. Only the middle one is automatic,
// and its math lives here — see teamElo/pairDeltas below.

/**
 * Expected score (win probability) for player A against player B,
 * based on the standard Elo logistic formula. Used only to show a
 * head-to-head chance on the profile/player pages.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface SkillCategory {
  id: 'D' | 'C' | 'B' | 'A';
  label: string;
  sub: string;
  range: [number, number];
  color: string;
}

// Skill category boundaries — used to derive a player's category
// label from their numeric Elo rating. Only 4 categories exist:
// D (beginner) through A (advanced) — no "Open"/pro tier.
export const SKILL_CATEGORIES: SkillCategory[] = [
  { id: 'D', label: 'Кат. D', sub: 'Новачки', range: [800, 1100], color: '#aab8d9' },
  { id: 'C', label: 'Кат. C', sub: 'Любителі', range: [1100, 1400], color: '#7690c4' },
  { id: 'B', label: 'Кат. B', sub: 'Досвідчені', range: [1400, 1700], color: '#3f5a9e' },
  { id: 'A', label: 'Кат. A', sub: 'Просунуті', range: [1700, 2000], color: '#0d2347' },
];

// Default starting Elo when an admin approves a new player — picking
// a category letter (D/C/B/A) sets exactly this Elo, no manual
// number entry needed.
export const CATEGORY_STARTING_ELO: Record<SkillCategory['id'], number> = {
  D: 950,
  C: 1250,
  B: 1550,
  A: 1850,
};

export function categoryForElo(elo: number | null | undefined): SkillCategory | null {
  if (elo === null || elo === undefined) return null;
  if (elo >= 1700) return SKILL_CATEGORIES[3];
  if (elo >= 1400) return SKILL_CATEGORIES[2];
  if (elo >= 1100) return SKILL_CATEGORIES[1];
  return SKILL_CATEGORIES[0];
}

// ────────────────────────────────────────────────
// AUTOMATIC Ело FOR 2v2 (americanka)
// ────────────────────────────────────────────────

/** K-factor for the automatic payout. It applies to the TEAM's delta,
 *  which the two partners then split — so a player in an even pair
 *  moves by about K/2. Raised from 32 to 55: most games are between
 *  neighbouring categories (rating gaps up to ~400), where 32 moved a
 *  player through a 300-point category too slowly. */
export const AUTO_K = 55;

/** Widest split allowed inside a pair. The share is clamped to
 *  [1 - MAX, MAX]; the two shares always sum to 1, so clamping one end
 *  clamps both. */
export const MAX_PAIR_SHARE = 0.75;

/** The rating a pair plays at: the average of its two members. */
export function teamElo(eloA: number, eloB: number): number {
  return (eloA + eloB) / 2;
}

/**
 * How much of a pair's Ело change is owed to its weaker member.
 *
 * Base is an even 50/50. The gap inside the pair, measured as a
 * fraction of the pair's own average rating, is halved and moved from
 * one side to the other:
 *
 *     shift = (|gap| / average) / 2
 *
 * The direction always favours the weaker player: they take the larger
 * share of a win and the SMALLER share of a loss. That is the point of
 * the rule — a newcomer carried by a strong partner should not be
 * punished as hard for the pair's defeat as the partner is.
 *
 * Worked example from the spec — partners 1800 and 1200:
 *   average 1500, gap 600 → 600/1500 = 40% → shift 20%
 *   win  → weak 70%, strong 30%
 *   loss → weak 30%, strong 70%
 *
 * The shares always sum to 1, so a pair's two deltas add up to the team
 * delta and the four players of a match still sum to zero. But note it
 * is a deliberate TRANSFER from the stronger side to the weaker one: a
 * player who always outranks their partner drifts down over a season
 * even when playing exactly to their rating, and the bottom of the
 * table drifts up. MAX_PAIR_SHARE bounds how fast.
 *
 * Measuring the gap against the pair's own average (rather than a fixed
 * scale) is deliberate too: it means the same gap counts for less as
 * the club's ratings grow.
 */
export function weakerShare(eloWeak: number, eloStrong: number, won: boolean): number {
  const average = teamElo(eloWeak, eloStrong);
  // A pair averaging zero has no scale to measure the gap against.
  // Unreachable with real ratings; keeps the division total.
  const shift = average > 0 ? Math.abs(eloStrong - eloWeak) / average / 2 : 0;
  const share = won ? 0.5 + shift : 0.5 - shift;
  return Math.min(MAX_PAIR_SHARE, Math.max(1 - MAX_PAIR_SHARE, share));
}

/**
 * Split one pair's Ело delta between its two members, returned in the
 * order the players were given.
 *
 * `teamDelta` must already be whole: only the weaker player's share is
 * rounded and the stronger takes the remainder, so the two add back up
 * to `teamDelta` exactly. Rounding both independently would drift by
 * ±1 on odd deltas and break the zero-sum that the event-delete
 * rollback relies on.
 */
export function pairDeltas(elo1: number, elo2: number, teamDelta: number): [number, number] {
  const won = teamDelta > 0;
  // On a tie neither is "the weaker", and the split is even either way.
  const firstIsWeaker = elo1 <= elo2;
  const weak = firstIsWeaker ? elo1 : elo2;
  const strong = firstIsWeaker ? elo2 : elo1;

  // Half away from zero, as in matchDeltas, so a win and the mirrored
  // loss split the same way (Math.round sends 11.5 up but -11.5 up too).
  const rawWeak = teamDelta * weakerShare(weak, strong, won);
  const weakDelta = Math.sign(rawWeak) * Math.round(Math.abs(rawWeak));
  const strongDelta = teamDelta - weakDelta;
  return firstIsWeaker ? [weakDelta, strongDelta] : [strongDelta, weakDelta];
}

/**
 * The whole payout for one 2v2 game: what each of the four players
 * gains or loses. Deltas come back in the order
 * [teamA[0], teamA[1], teamB[0], teamB[1]] and always sum to zero.
 */
export function matchDeltas(
  teamAElos: [number, number],
  teamBElos: [number, number],
  teamAWon: boolean
): [number, number, number, number] {
  const ratingA = teamElo(teamAElos[0], teamAElos[1]);
  const ratingB = teamElo(teamBElos[0], teamBElos[1]);
  // Rounded half AWAY from zero: Math.round rounds -22.5 to -22 but 22.5
  // to 23, so with an odd K two equal teams would pay a different amount
  // depending only on which side was listed as team A.
  const raw = AUTO_K * ((teamAWon ? 1 : 0) - expectedScore(ratingA, ratingB));
  const deltaA = Math.sign(raw) * Math.round(Math.abs(raw));

  const [a1, a2] = pairDeltas(teamAElos[0], teamAElos[1], deltaA);
  const [b1, b2] = pairDeltas(teamBElos[0], teamBElos[1], -deltaA);
  return [a1, a2, b1, b2];
}

export interface EloForecast {
  /** Win probability of the player's pair, 0..1. */
  chance: number;
  /** The player's OWN Ело change for a win / a loss. */
  win: number;
  loss: number;
}

/**
 * What one americanka game would do to THIS player's Ело, for the
 * profile calculator: the player against a pair whose AVERAGE Ело is
 * `opponentsAverage`, partnered with someone of the player's own rating.
 *
 * Runs the exact payout the score route uses (matchDeltas — K, rounding,
 * the pair split), so the calculator can never disagree with what a real
 * game pays. With an equal partner the pair split is 50/50, so the
 * player's change is half of the team's.
 */
export function eloForecast(playerElo: number, opponentsAverage: number): EloForecast {
  const chance = expectedScore(playerElo, opponentsAverage);
  const win = matchDeltas([playerElo, playerElo], [opponentsAverage, opponentsAverage], true)[0];
  const loss = matchDeltas([playerElo, playerElo], [opponentsAverage, opponentsAverage], false)[0];
  return { chance, win, loss };
}
