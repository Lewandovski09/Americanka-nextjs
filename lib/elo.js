// Elo rating math — pure functions, no side effects.
// K=32 is the volatility constant: higher K means ratings move
// faster after each result. 32 is a common choice for amateur
// leagues where players play relatively few games.

const K_FACTOR = 32;

/**
 * Expected score (win probability) for player A against player B,
 * based on the standard Elo logistic formula.
 */
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Elo delta for a single result.
 * @param {number} ratingA - player/team A's rating before the match
 * @param {number} ratingB - opponent's rating before the match
 * @param {number} actualScore - 1 for a win, 0 for a loss (no draws in this app)
 */
export function eloDelta(ratingA, ratingB, actualScore) {
  const expected = expectedScore(ratingA, ratingB);
  return Math.round(K_FACTOR * (actualScore - expected));
}

// Skill category boundaries — used to derive a player's category
// label from their numeric Elo rating. Only 4 categories exist:
// D (beginner) through A (advanced) — no "Open"/pro tier.
export const SKILL_CATEGORIES = [
  { id: 'D', label: 'Кат. D', sub: 'Новачки', range: [800, 1100], color: '#5DCAA5' },
  { id: 'C', label: 'Кат. C', sub: 'Любителі', range: [1100, 1400], color: '#1D9E75' },
  { id: 'B', label: 'Кат. B', sub: 'Досвідчені', range: [1400, 1700], color: '#0F6E56' },
  { id: 'A', label: 'Кат. A', sub: 'Просунуті', range: [1700, 2000], color: '#085041' },
];

// Default starting Elo when an admin approves a new player — picking
// a category letter (D/C/B/A) sets exactly this Elo, no manual
// number entry needed.
export const CATEGORY_STARTING_ELO = {
  D: 950,
  C: 1250,
  B: 1550,
  A: 1850,
};

export function categoryForElo(elo) {
  if (elo === null || elo === undefined) return null;
  if (elo >= 1700) return SKILL_CATEGORIES[3];
  if (elo >= 1400) return SKILL_CATEGORIES[2];
  if (elo >= 1100) return SKILL_CATEGORIES[1];
  return SKILL_CATEGORIES[0];
}
