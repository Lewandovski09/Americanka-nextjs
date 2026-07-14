// Shared validation/derivation for event create + update APIs.

import { CATEGORY_LABELS, getBracketSystem } from '@/lib/formats';

// Group key: gendered formats split leagues by gender (Men Light and
// Women Light are independent bands); non-gendered formats share one.
export function bandKey(format, c) {
  const g = format.hasGender ? c.gender || 'X' : 'X';
  return `${g}:${c.categoryLabel}`;
}

// Evenly split [min, max] into one band per selected label, ordered
// Light → Pro. Returns { 'M:Pro': { eloMin, eloMax }, ... }.
export async function computeEloBands(supabaseAdmin, format, categories) {
  const pick = (asc) =>
    supabaseAdmin
      .from('players')
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
  const byGroup = {};
  for (const c of categories) {
    const g = format.hasGender ? c.gender || 'X' : 'X';
    (byGroup[g] ||= new Set()).add(c.categoryLabel);
  }

  const bands = {};
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
export function capacityFor(format, c) {
  if (format.fixedParticipants) return format.fixedParticipants;
  if (format.needsBracketSystem) {
    const sys = getBracketSystem(c.bracketSystem);
    return sys ? (sys.sizeChoice ? c.maxParticipants : sys.cap) : null;
  }
  return c.maxParticipants || null;
}

export function validateCategory(format, c) {
  if (!c || !CATEGORY_LABELS.includes(c.categoryLabel)) {
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
    if (sys.sizeChoice && !sys.participantOptions.includes(c.maxParticipants)) {
      return `Розмір сітки: ${sys.participantOptions.join(' або ')}`;
    }
  } else if (format.participantOptions) {
    if (!format.participantOptions.includes(c.maxParticipants)) {
      return `Кількість учасників має бути однією з: ${format.participantOptions.join(', ')}`;
    }
    if (format.kind === 'king_of_beach' && c.maxParticipants % 4 !== 0) {
      return 'Кількість учасників має бути кратною 4';
    }
  }
  return null;
}

// Row for the `tournaments` table from a validated category config.
export function categoryRow(format, event, c, bandByKey) {
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

// Scoring config from the request body (americanka is always sum-to-31,
// handled in code — its event points fields are unused). Returns either
// { error } or { points, mode, finalPoints }.
export function resolveScoring(format, { pointsToWin, pointsMode, finalPointsToWin }, FIRST_TO_OPTIONS) {
  let points = 31;
  let mode = 'whole';
  let finalPoints = null;
  if (format.scoring === 'first_to') {
    if (!FIRST_TO_OPTIONS.includes(pointsToWin)) {
      return { error: 'Партії до 15 або 21' };
    }
    points = pointsToWin;
    mode = pointsMode === 'from_semifinal' ? 'from_semifinal' : 'whole';
    if (mode === 'from_semifinal') {
      if (!FIRST_TO_OPTIONS.includes(finalPointsToWin)) {
        return { error: 'Рахунок з півфіналу — 15 або 21' };
      }
      finalPoints = finalPointsToWin;
    }
  }
  return { points, mode, finalPoints };
}
