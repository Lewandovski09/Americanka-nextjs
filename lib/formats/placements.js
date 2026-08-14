// WHO finished WHERE — the single source of truth for a category's final
// placement. Read by the «Результати» view, by the admin panels, and (the
// reason it exists as a module at all) by the server-side payout:
// tournament counters, partner stats and AVP season points all follow the
// place, so the place has to be computed the same way everywhere.
//
// It used to live inside two client components. That is how a live
// double-elimination bracket came to report its first four eliminated
// pairs as 9th instead of 13-16 — nothing on the server could reuse the
// logic, so nothing tested it either.
//
// ── THE INVARIANT every branch below obeys ──
// A place BLOCK belongs to the round that decides it, and is reserved
// whether or not those games have been played yet. Places therefore never
// shift as a category progresses: 13-16 is 13-16 from the moment the
// round is dealt. The payout depends on it (points follow the place), and
// so does the eye — a place that renumbered itself mid-tournament reads
// as a bug even when the final table ends up right.
//
// Ties report the block's FIRST place: the four pairs out in the 13-16
// block are all `place: 13`. A caller that wants to print «13-16» derives
// the range from how many rows share the number.
//
// Only decided placements are listed. Someone still in the running simply
// has no row yet — their place is reserved, not guessed.
//
// Kept free of `crypto` (so: no ./brackets, no ./doubleElim imports) —
// this module ships in the client bundle.

import { teamAWon } from './sets';
import { rankGroupDetailed } from './kingOfBeach';
import { computeStandings, placeStandings } from '../tournamentEngine';

const winnerLoser = (m) => {
  const aWon = teamAWon(m);
  return {
    w: aWon ? m.team_a_players : m.team_b_players,
    l: aWon ? m.team_b_players : m.team_a_players,
  };
};

const teamKey = (ids) => [...(ids || [])].filter(Boolean).map(String).sort().join('|');

/**
 * Final placement of a category, whatever format it runs.
 *
 * @param {object[]} matches - rows from `matches` (the whole category)
 * @param {object[]} [teams] - rows from `tournament_teams`
 *   ({ player1_id, player2_id }); pair formats only
 * @param {object[]} [players] - [{ id, full_name }]; solo formats only
 * @returns {{place: number, playerIds: string[]}[]} ascending by place
 */
export function placementsFor({ matches, teams, players }) {
  const ms = matches || [];
  if (ms.length === 0) return [];

  // Americanka: a round-robin where nobody is ever knocked out, so no
  // place is decided until every game is in — then the standings ARE the
  // placement. Players still level on point differential, points scored
  // AND wins share the place (see placeStandings) — the same "next
  // distinct place skips ahead" rule every other tie block here uses.
  if (!ms.some((m) => m.stage)) {
    if (ms.some((m) => !m.played)) return [];
    const byPlace = new Map();
    placeStandings(computeStandings(players || [], ms)).forEach((r) => {
      if (!byPlace.has(r.place)) byPlace.set(r.place, []);
      byPlace.get(r.place).push(r.player.id);
    });
    return [...byPlace.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([place, playerIds]) => ({ place, playerIds }));
  }
  if (ms.some((m) => /^kr\d+$/.test(m.stage || ''))) return kingResults(ms);
  if (ms.some((m) => m.stage === 'gf' || /^(wb|lb)\d+$/.test(m.stage || ''))) return deResults(ms);
  return computePlaces(ms, teams || []);
}

// Group-and-crosses systems. Two shapes:
//   • File format (groups_top1_bye_top23_crosses) — has play-in/qf stages:
//     placement by elimination round WITH TIES (5-8, 9-12, 13-16 each
//     share a place). Only 1-2 and 3-4 are played out.
//   • Full-placement crosses (groups_crosses_1_2) — every 'final'/'pX_Y'
//     match awards unique places X (winner) and Y (loser).
export function computePlaces(matches, teams) {
  const played = (matches || []).filter((m) => m.played);
  const isFileFormat = played.some((m) => m.stage === 'play_in' || m.stage === 'qf');
  const out = [];

  if (isFileFormat) {
    const finalM = played.find((m) => m.stage === 'final');
    if (finalM) {
      const { w, l } = winnerLoser(finalM);
      if (w?.length) out.push({ place: 1, playerIds: w });
      if (l?.length) out.push({ place: 2, playerIds: l });
    }
    const bronze = played.find((m) => /^p3_4$/.test(m.stage || ''));
    if (bronze) {
      const { w, l } = winnerLoser(bronze);
      if (w?.length) out.push({ place: 3, playerIds: w });
      if (l?.length) out.push({ place: 4, playerIds: l });
    }
    // QF losers tie 5th, play-in losers tie 9th (blocks, like the file).
    played
      .filter((m) => m.stage === 'qf')
      .forEach((m) => winnerLoser(m).l?.length && out.push({ place: 5, playerIds: winnerLoser(m).l }));
    played
      .filter((m) => m.stage === 'play_in')
      .forEach((m) => winnerLoser(m).l?.length && out.push({ place: 9, playerIds: winnerLoser(m).l }));
    // Group 4th = teams that never reached the play-in/qf → tie 13th.
    // Count every dealt play-in/qf pairing (not just the played ones), so
    // a team whose quarterfinal is still ahead isn't listed as knocked out.
    const advanced = new Set();
    (matches || [])
      .filter((m) => m.stage === 'play_in' || m.stage === 'qf')
      .forEach((m) => {
        advanced.add(teamKey(m.team_a_players));
        advanced.add(teamKey(m.team_b_players));
      });
    (teams || []).forEach((t) => {
      const key = teamKey([t.player1_id, t.player2_id]);
      if (key && !advanced.has(key)) out.push({ place: 13, playerIds: [t.player1_id, t.player2_id] });
    });
    return out.sort((a, b) => a.place - b.place);
  }

  for (const m of played) {
    let hi;
    let lo;
    if (m.stage === 'final') {
      hi = 1;
      lo = 2;
    } else {
      const g = /^p(\d+)_(\d+)$/.exec(m.stage || '');
      if (!g) continue;
      hi = Number(g[1]);
      lo = Number(g[2]);
    }
    const { w, l } = winnerLoser(m);
    if (w?.length) out.push({ place: hi, playerIds: w });
    if (l?.length) out.push({ place: lo, playerIds: l });
  }
  return out.sort((a, b) => a.place - b.place);
}

// King of the Beach: everyone is ranked by the last round they reached,
// and inside it by their performance (wins, then point differential). The
// final four take 1-4 by the final-round ranking, those knocked out a
// round earlier take 5+, and so on. A round whose fate isn't settled yet
// still reserves its block (see the invariant at the top).
export function kingResults(matches) {
  const lastRound = {};
  for (const m of matches) {
    const kr = /^kr(\d+)$/.exec(m.stage || '');
    if (!kr) continue;
    const r = Number(kr[1]);
    for (const pid of [...(m.team_a_players || []), ...(m.team_b_players || [])]) {
      lastRound[pid] = Math.max(lastRound[pid] || 0, r);
    }
  }
  const rounds = [...new Set(Object.values(lastRound))].sort((a, b) => b - a);

  const out = [];
  let place = 1;
  for (const r of rounds) {
    const rm = matches.filter((m) => m.stage === `kr${r}`);
    const stayedIds = Object.keys(lastRound).filter((pid) => lastRound[pid] === r);

    // Placements of this round are decided only once it's fully played
    // AND its stayers are really out: either this was the final (a single
    // group of 4) or the next round has been dealt without them.
    const complete = rm.length > 0 && rm.every((m) => m.played);
    const isFinal = new Set(rm.map((m) => m.group_index ?? 0)).size === 1;
    const nextDealt = matches.some((m) => m.stage === `kr${r + 1}` && m.team_a_players?.length > 0);
    if (!complete || !(isFinal || nextDealt)) {
      place += stayedIds.length; // keep their places reserved
      continue;
    }

    // Rank each group of the round, then merge the stayers across groups.
    const stats = [];
    for (const gi of [...new Set(rm.map((m) => m.group_index ?? 0))]) {
      const gm = rm.filter((m) => (m.group_index ?? 0) === gi);
      const ids = [...new Set(gm.flatMap((m) => [...(m.team_a_players || []), ...(m.team_b_players || [])]))];
      stats.push(...rankGroupDetailed(ids, gm));
    }
    const ranked = stats
      .filter((s) => stayedIds.includes(s.id))
      .sort((a, b) => b.wins - a.wins || b.diff - a.diff);
    for (const s of ranked) out.push({ place: place++, playerIds: [s.id] });
  }
  return out;
}

// Double elimination: the final decides 1-2 and the bronze match 3-4 (the
// crossed-semifinal losers), then the losers of each lower-bracket round
// share a place, last round first — 5-6, 7-8, 9-12, 13-16 for a 16-pair
// field. Legacy grand-final brackets ('gf') have no bronze match, so
// their shared blocks start at 3.
export function deResults(matches) {
  const out = [];
  const legacy = matches.some((m) => m.stage === 'gf');
  const playedOut = legacy
    ? [['gf', 1, 2]]
    : [
        ['final', 1, 2],
        ['p3_4', 3, 4],
      ];
  for (const [stage, hi, lo] of playedOut) {
    const m = matches.find((x) => x.stage === stage && x.played);
    if (!m) continue;
    const { w, l } = winnerLoser(m);
    if (w?.length) out.push({ place: hi, playerIds: w });
    if (l?.length) out.push({ place: lo, playerIds: l });
  }
  let place = legacy ? 3 : 5;
  const lbRounds = [
    ...new Set(
      matches.filter((m) => /^lb\d+$/.test(m.stage || '')).map((m) => Number(m.stage.slice(2)))
    ),
  ].sort((a, b) => b - a);
  for (const r of lbRounds) {
    const roundMatches = matches.filter((m) => m.stage === `lb${r}`);
    for (const m of roundMatches) {
      if (!m.played) continue;
      const { l } = winnerLoser(m);
      if (l?.length) out.push({ place, playerIds: l });
    }
    // The block a round owns is as big as the round is — one game, one
    // team out — and it is reserved whether or not those games have been
    // played. Advancing by the PLAYED ones instead let every earlier
    // round slide up into the gap left by the rounds still ahead: in a
    // live 16-pair bracket the first four out (13-16) came up as 9.
    place += roundMatches.length;
  }
  return out;
}
