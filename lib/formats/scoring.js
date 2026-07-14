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

export function validateSumTo(scoreA, scoreB, total) {
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

export function validateFirstToWinBy2(scoreA, scoreB, target) {
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
// after two sets (third decides). Every set follows first-to-win-by-2.
export function validateSetsFirstTo(sets, target) {
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
    const check = validateFirstToWinBy2(s[0], s[1], target);
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
  if (sets.length === 3 && (sets[0][0] > sets[0][1]) === (sets[1][0] > sets[1][1])) {
    return { valid: false, error: 'Третя партія зайва — матч завершився 2:0' };
  }
  return { valid: true, winsA, winsB };
}

// Which points target applies to a given match, honouring the
// "different score from the semifinal" option. Recognises both the old
// (semifinal/final) and the crosses/DE stage names (sf/final/gf).
export function pointsTargetForStage(event, stage) {
  if (event.points_mode === 'from_semifinal' && event.final_points_to_win) {
    if (['semifinal', 'final', 'sf', 'gf'].includes(stage)) return event.final_points_to_win;
  }
  return event.points_to_win;
}
