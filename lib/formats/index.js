// Registry of tournament FORMATS — the single source of truth that
// used to live in the `tournament_formats` DB table. Everything the
// UI and API need to know about a format is described here in code;
// the database only stores the events/categories/matches DATA.
//
// format_kind (stored on tournament_events) is the key into this map.

export const CATEGORY_LABELS = ['Light', 'Medium', 'Pro'];

// The three tournament systems the pair formats (single_gender / mix)
// can run. Each declares the participant counts it supports (PAIRS) and
// its structural shape, so the rest of the app derives everything from
// the chosen system rather than the format:
//   • double_elimination — 16 or 32 pairs. Over-capacity applicants go to
//     the reserve; if fewer pairs actually start, the strongest seeds get
//     round-1 byes.
//   • groups_crosses_1_2 — 6…12 pairs, exactly 2 groups, top-2 of each
//     cross over (A1×B2, B1×A2) into the playoff.
//   • groups_top1_bye_top23_crosses — 1:1 with the ЧУ Masters file:
//     exactly 16 pairs, 4 groups of 4, top-3 advance. Group winners get a
//     bye to the quarterfinals; 2nd/3rd cross in a play-in. Placement is by
//     elimination round with ties (5-8, 9-12, 13-16 each share a place).
// groups_crosses_1_2 is capped at 10 pairs (2 groups of up to 5).
const GROUP_PARTICIPANTS_1_2 = [6, 7, 8, 9, 10];

export const BRACKET_SYSTEMS = [
  {
    id: 'double_elimination',
    label: 'Double Elimination',
    shortLabel: 'Double Elim',
    // Admin picks the bracket size; extras → reserve, fewer → byes.
    sizeChoice: true,
    participantOptions: [16, 32], // PAIRS
    cap: 32,
    groupCount: 0,
    advancePerGroup: 0,
  },
  {
    id: 'groups_crosses_1_2',
    label: 'Групи + хрести (1-2 місця)',
    shortLabel: 'Групи · хрести 1-2',
    // 2 groups, no size choice; capped at 10 pairs (up to 5 per group).
    sizeChoice: false,
    participantOptions: GROUP_PARTICIPANTS_1_2,
    cap: 10,
    groupCount: 2,
    advancePerGroup: 2,
  },
  {
    id: 'groups_top1_bye_top23_crosses',
    label: 'Групи: 1-е — бай, 2-3 — хрести',
    shortLabel: 'Групи · 1 бай, 2-3 хрести',
    // Fixed to the ЧУ Masters file: exactly 16 pairs, 4 groups of 4.
    sizeChoice: false,
    participantOptions: [16],
    cap: 16,
    groupCount: 4,
    advancePerGroup: 3,
  },
];

export function getBracketSystem(id) {
  return BRACKET_SYSTEMS.find((b) => b.id === id) || null;
}

// Which participant counts are valid for a pair category — driven by the
// chosen bracket system (double-elim: 16/32, group systems: 6…12).
export function participantOptionsFor(bracketSystemId) {
  return getBracketSystem(bracketSystemId)?.participantOptions || [];
}

// The stored max_participants for a pair category. Double-elim uses the
// admin-chosen bracket size; group systems always use their fixed cap
// (12) since they simply accept 6–12 pairs.
export function defaultParticipantsFor(bracketSystemId) {
  const b = getBracketSystem(bracketSystemId);
  if (!b) return null;
  return b.sizeChoice ? b.participantOptions[0] : b.cap;
}

export const FORMAT_KINDS = {
  americanka: {
    kind: 'americanka',
    displayName: 'Американка',
    description:
      'Індивідуальна реєстрація, завжди 8 гравців у категорії. Кожен грає з кожним по 1 партії, рахунок до суми 31.',
    registrationType: 'solo', // one player per application
    hasGender: true, // categories are split into men / women
    fixedParticipants: 8, // always 8 per category
    participantOptions: null, // not chosen — fixed
    countsPairs: false,
    needsBracketSystem: false,
    scoring: 'sum31',
    maxSets: 1, // одна партія до суми 31
  },

  single_gender: {
    kind: 'single_gender',
    displayName: 'Чоловічі / Жіночі',
    description: 'Парний формат, окремо для чоловіків і жінок. Обирається система турніру, а кількість пар залежить від неї.',
    registrationType: 'pair', // two players of the same gender
    hasGender: true,
    fixedParticipants: null,
    participantOptions: null, // driven by the chosen bracket system
    countsPairs: true,
    needsBracketSystem: true,
    scoring: 'first_to',
    maxSets: 3, // до трьох партій (2-га/3-тя — за потреби)
  },

  mix: {
    kind: 'mix',
    displayName: 'Мікс',
    description: 'Змішані пари: один чоловік + одна жінка. Обирається система турніру, а кількість пар залежить від неї.',
    registrationType: 'mix_pair', // one man + one woman
    hasGender: false, // no gender split — every pair is mixed
    fixedParticipants: null,
    participantOptions: null, // driven by the chosen bracket system
    countsPairs: true,
    needsBracketSystem: true,
    scoring: 'first_to',
    maxSets: 3, // до трьох партій (2-га/3-тя — за потреби)
  },

  king_of_beach: {
    kind: 'king_of_beach',
    displayName: 'Король пляжу',
    description:
      'Індивідуальна реєстрація, групи по 4 гравці, топ-2 виходять далі, рекурсивно до фінальної четвірки.',
    registrationType: 'solo',
    hasGender: true,
    fixedParticipants: null,
    participantOptions: [16, 20, 24, 28, 32], // must be divisible by 4
    countsPairs: false,
    needsBracketSystem: false, // its progression is fixed by the format
    scoring: 'first_to',
    maxSets: 1, // кожен матч групи — одна партія
  },
};

export function getFormat(kind) {
  return FORMAT_KINDS[kind] || null;
}

export function listFormats() {
  return Object.values(FORMAT_KINDS);
}

// Whether a given points target (15 / 21) is valid for a format.
export const FIRST_TO_OPTIONS = [15, 21];
