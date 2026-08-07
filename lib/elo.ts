// Elo rating math — pure functions, no side effects.
// Ratings are NOT awarded for results: `players.elo` is set by an
// admin (approval / edit-elo) and only read — for the category
// letter, the rating table and seeding. The delta formula lives in
// git history if automatic payouts come back.

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
