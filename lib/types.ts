// Shared types for lib/. Deliberately loose rather than a strict mirror
// of the Supabase schema: callers are still plain .js files (not
// type-checked — see tsconfig.json's checkJs: false), so the value
// here is catching mistakes *within* the .ts modules, not enforcing
// exact DB shapes end to end. Tighten these once app/ and components/
// migrate too.

/** A single set's points: [pointsForTeamA, pointsForTeamB]. */
export type SetScore = [number, number];

/** The set columns shared by anything that stores a match result. */
export interface MatchSets {
  set1?: SetScore | null;
  set2?: SetScore | null;
  set3?: SetScore | null;
}

/** A `matches` table row, as read by the tournament engine. */
export interface Match extends MatchSets {
  id?: string;
  round_number?: number;
  court?: number;
  team_a_players: string[];
  team_b_players: string[];
  played: boolean;
  group_number?: number | null;
  group_index?: number | null;
  stage?: string | null;
  scheduled_at?: string | null;
  [key: string]: unknown;
}

/** A `players` table row, trimmed to the fields lib/ actually reads. */
export interface Player {
  id: string;
  full_name?: string | null;
  login?: string | null;
  elo?: number | null;
  photo_url?: string | null;
  gender?: string | null;
  tournaments_played?: number | null;
  approval_status?: string | null;
  [key: string]: unknown;
}

/** A `tournament_teams` table row — a registered pair. */
export interface Team {
  id?: string;
  player1_id: string;
  player2_id: string;
  [key: string]: unknown;
}

/** One decided placement: a block of `place` shared by every id tied there. */
export interface PlacementRow {
  place: number;
  playerIds: string[];
}

/** One round of a format's schedule: which slots play which. */
export interface ScheduleMatchDef {
  teamA: number[];
  teamB: number[];
}

export interface ScheduleRoundDef {
  round: number;
  matches: ScheduleMatchDef[];
}
