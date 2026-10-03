// Registry of SPORTS — the behaviour half of a sport. Its identity (the
// id that events, ratings and seasons point at) is a row in the `sports`
// table (migration 043); everything the app needs to know about how that
// sport is PLAYED lives here, keyed by the same id. Same split as
// lib/formats: the database stores data, the code stores rules.
//
// Adding a sport = one row in `sports` + one entry below (+ its formats
// in lib/formats if it needs new ones). No enum, no migration of
// existing rows.

import type { FormatKindId } from './formats';

export type SportId = 'beach_volleyball';

export interface Sport {
  id: SportId;
  displayName: string;
  /** Division names a category of this sport can be, weakest first. */
  divisions: string[];
  /** Which tournament formats this sport offers, in picker order. */
  formats: FormatKindId[];
}

/** The sport every pre-043 row belongs to; mirrors primary_sport_id() in SQL.
 *  Its rating is still stored in users.elo (user_ratings mirrors it). */
export const PRIMARY_SPORT_ID: SportId = 'beach_volleyball';

export const SPORTS: Record<SportId, Sport> = {
  beach_volleyball: {
    id: 'beach_volleyball',
    displayName: 'Пляжний волейбол',
    divisions: ['Light', 'Medium', 'Pro'],
    formats: ['americanka', 'single_gender', 'mix', 'king_of_beach'],
  },
};

export function getSport(id: string | null | undefined): Sport | null {
  return SPORTS[(id || PRIMARY_SPORT_ID) as SportId] || null;
}

export function listSports(): Sport[] {
  return Object.values(SPORTS);
}

/** Division names for a sport (falls back to the primary sport's). */
export function divisionsFor(sportId: string | null | undefined): string[] {
  return (getSport(sportId) || SPORTS[PRIMARY_SPORT_ID]).divisions;
}

export function sportOffersFormat(sportId: string | null | undefined, formatKind: string): boolean {
  const sport = getSport(sportId);
  return !!sport && (sport.formats as string[]).includes(formatKind);
}
