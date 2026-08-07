// Scoring rules for tournament matches.
//
// Two different rules exist in this app:
//
//  1. Americanka — "sum to N": both teams' scores must add up to a
//     fixed total (31). e.g. 10:21, 14:17. No ties.
//
//  2. Everyone else — "first to N, win by 2": a team wins by reaching
//     the target (15 or 21) with at least a 2-point lead. If it is
//     level at target-1 (14:14 / 20:20) play continues until someone
//     leads by 2, so the final score can go above the target but the
//     margin is then exactly 2 (16:14, 22:20, ...).
//
// Each rule returns { valid: boolean, error?: string }.

import type { SetScore } from '../types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface SetsValidationResult extends ValidationResult {
  winsA?: number;
  winsB?: number;
}

/** Points-based event config, as read from `tournament_events`. */
export interface PointsConfig {
  points_mode?: string | null;
  final_points_to_win?: number | null;
  points_to_win: number;
}

// The deciding (third) set is short — always to 15, win by 2 — whatever
// the first two are played to. Standard beach rule: 21/21/15.
export const DECIDER_POINTS_TO_WIN = 15;

/**
 * Points target of one set of a best-of-3 match.
 * @param target - what the regular sets are played to
 * @param setIndex - 0-based
 */
export function targetForSet(target: number, setIndex: number): number {
  // min(), not a flat 15: a format played to fewer than 15 points would
  // otherwise get a LONGER decider than its own sets.
  return setIndex === 2 ? Math.min(target, DECIDER_POINTS_TO_WIN) : target;
}

export function validateSumTo(scoreA: number, scoreB: number, total: number): ValidationResult {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
    return { valid: false, error: 'Рахунок має бути числом' };
  }
  if (scoreA < 0 || scoreB < 0) {
    return { valid: false, error: 'Рахунок не може бути відʼємним' };
  }
  if (scoreA === scoreB) {
    return { valid: false, error: 'Рахунок не може бути рівним' };
  }
  if (scoreA + scoreB !== total) {
    return { valid: false, error: `Сума рахунку має дорівнювати ${total}` };
  }
  return { valid: true };
}

export function validateFirstToWinBy2(
  scoreA: number,
  scoreB: number,
  target: number
): ValidationResult {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
    return { valid: false, error: 'Рахунок має бути числом' };
  }
  if (scoreA < 0 || scoreB < 0) {
    return { valid: false, error: 'Рахунок не може бути відʼємним' };
  }
  if (scoreA === scoreB) {
    return { valid: false, error: 'Рахунок не може бути рівним' };
  }

  const max = Math.max(scoreA, scoreB);
  const min = Math.min(scoreA, scoreB);

  if (max < target) {
    return { valid: false, error: `Переможець має набрати щонайменше ${target}` };
  }
  if (max === target) {
    // Finished exactly at the target — must have led by at least 2.
    if (max - min < 2) {
      return { valid: false, error: 'Різниця має бути щонайменше 2 очки' };
    }
    return { valid: true };
  }
  // Went past the target (deuce continued) — margin must be exactly 2.
  if (max - min !== 2) {
    return { valid: false, error: `Понад ${target} гру завершують з різницею рівно 2 очки` };
  }
  return { valid: true };
}

// Validate a first-to match entered as 1–3 sets ([[a,b], ...]). One set
// is a normal single-set match; with more sets the match must produce a
// clean best-of-3: 2:0 after two sets (third must be absent) or 1:1
// after two sets (third decides). Every set follows first-to-win-by-2,
// the deciding third one against the shorter target (15).
export function validateSetsFirstTo(sets: SetScore[], target: number): SetsValidationResult {
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > 3) {
    return { valid: false, error: 'Введіть від 1 до 3 партій' };
  }
  let winsA = 0;
  let winsB = 0;
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (!Array.isArray(s) || s.length !== 2) {
      return { valid: false, error: `Партія ${i + 1}: некоректний рахунок` };
    }
    const check = validateFirstToWinBy2(s[0], s[1], targetForSet(target, i));
    if (!check.valid) {
      return { valid: false, error: `Партія ${i + 1}: ${check.error}` };
    }
    if (s[0] > s[1]) winsA++;
    else winsB++;
  }
  if (sets.length === 2 && winsA === 1) {
    return { valid: false, error: 'Рахунок партій 1:1 — введіть третю партію' };
  }
  // The third set only exists after 1:1 in the first two.
  if (sets.length === 3 && sets[0][0] > sets[0][1] === (sets[1][0] > sets[1][1])) {
    return { valid: false, error: 'Третя партія зайва — матч завершився 2:0' };
  }
  return { valid: true, winsA, winsB };
}

// Which points target applies to a given match, honouring the
// "different score from the semifinal" option. Recognises both the old
// (semifinal/final) and the crosses/DE stage names (sf/final/p3_4/gf) —
// the 3rd-place match is played after the semifinals, so it counts too.
export function pointsTargetForStage(event: PointsConfig, stage: string): number {
  if (event.points_mode === 'from_semifinal' && event.final_points_to_win) {
    if (['semifinal', 'final', 'sf', 'p3_4', 'gf'].includes(stage)) return event.final_points_to_win;
  }
  return event.points_to_win;
}
