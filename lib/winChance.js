// «Шанс на перемогу» — each participant's chance to win the category,
// computed like the sports «supercomputer» forecasts: the rest of the
// tournament is played out thousands of times with random results that
// follow each side's strength, and the share of runs a participant ends
// first in is their chance.
//
// Strength (per player) — the Ело rating, nudged by:
//   • the record of previous tournaments (titles per tournament played,
//     shrunk towards the average for players with few tournaments);
//   • AVP points relative to the others in this category.
// A side's strength is the average of its players. One game:
//   P(A beats B) = 1 / (1 + 10^((B − A) / 400))      (the Ело formula)
//
// What is already played stays as it was. How the rest is played out:
//   • Americanka (no stages) — every remaining game, with points that sum
//     to the category's sum (29 / 31 / 35), then ranked exactly like the table (lib/tournamentEngine);
//   • brackets — game by game along the bracket links (winner_to_match_id
//     / loser_to_match_id), the champion is who wins the last game;
//   • anything that can't be followed that way (group stages decided by
//     the server later) — a knockout among the sides still in it.
// Pure: no database, no React (see winChance.test).

import { computeStandings, placeStandings } from '@/lib/tournamentEngine';
import { teamAWon } from '@/lib/formats/sets';

export const SIMS = 4000;
// Randomness: a player's form on the day (in Ело points, drawn once per
// simulated tournament) and the spread of one game's score (in points).
export const FORM_SD = 110;
export const GAME_SD = 5;

/** A small seeded generator, so a page shows the same numbers on every render. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function gauss(rand) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const winP = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));

/**
 * Per-player strength. `players` — [{ id, elo, tournaments_played,
 * tournaments_won, avp }].
 */
export function strengths(players) {
  const avps = players.map((p) => Number(p.avp) || 0);
  const mean = avps.reduce((s, x) => s + x, 0) / Math.max(1, avps.length);
  const sd = Math.sqrt(avps.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, avps.length)) || 0;
  const out = new Map();
  for (const p of players) {
    const elo = Number(p.elo) || 1200;
    const played = Number(p.tournaments_played) || 0;
    const won = Number(p.tournaments_won) || 0;
    // titles beyond what an average player (1 in 8) wins, damped for small samples
    const record = Math.max(-60, Math.min(60, (120 * (won - played / 8)) / Math.sqrt(played + 4)));
    const avp = sd > 0 ? Math.max(-50, Math.min(50, (25 * ((Number(p.avp) || 0) - mean)) / sd)) : 0;
    out.set(p.id, elo + record + avp);
  }
  return out;
}

const sideKey = (ids) => [...(ids || [])].filter(Boolean).sort().join('+');
const avgOf = (ids, power) => {
  const xs = (ids || []).map((id) => power.get(id)).filter((x) => x != null);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 1200;
};

/** Americanka: remaining games with points summing to `total` (29 / 31 / 35), ranked like the table. */
function simAmericanka(players, matches, power, rand, total = 31) {
  const played = matches.map((m) => {
    if (m.played) return m;
    const p = winP(avgOf(m.team_a_players, power), avgOf(m.team_b_players, power));
    let a = Math.round(total * p + gauss(rand) * GAME_SD);
    a = Math.max(0, Math.min(total, a));
    if (a * 2 === total) a += rand() < p ? 1 : -1; // an even sum can't end level
    return { ...m, played: true, set1: [a, total - a], set2: null, set3: null };
  });
  const placed = placeStandings(computeStandings(players, played));
  const top = placed.filter((r) => r.place === 1).map((r) => r.player.id);
  return top.map((id) => [id]);
}

/** Brackets along their links. Returns the champion side, or null if it can't be followed. */
function simBracket(matches, power, rand) {
  const list = matches.map((m) => ({
    ...m,
    team_a_players: [...(m.team_a_players || [])],
    team_b_players: [...(m.team_b_players || [])],
  }));
  const byId = new Map(list.map((m) => [m.id, m]));
  list.sort((x, y) => (x.round_number || 0) - (y.round_number || 0) || (x.order_index || 0) - (y.order_index || 0));
  const put = (id, slot, side) => {
    const t = id && byId.get(id);
    if (!t || t.played) return;
    if (slot === 'b') t.team_b_players = side;
    else t.team_a_players = side;
  };
  for (let pass = 0; pass < 4; pass++) {
    let progressed = false;
    for (const m of list) {
      if (m._w) continue;
      const a = m.team_a_players;
      const b = m.team_b_players;
      let aWins;
      if (m.played) aWins = teamAWon(m);
      else {
        if (!a.length || !b.length) continue;
        aWins = rand() < winP(avgOf(a, power), avgOf(b, power));
      }
      m._w = aWins ? a : b;
      put(m.winner_to_match_id, m.winner_to_slot, m._w);
      put(m.loser_to_match_id, m.loser_to_slot, aWins ? b : a);
      progressed = true;
    }
    if (!progressed) break;
  }
  if (list.some((m) => !m._w)) return null; // e.g. crosses the server fills in after the groups
  const ends = list.filter((m) => !m.winner_to_match_id);
  const champ = ends.find((m) => m.is_final || m.stage === 'final' || m.stage === 'gf') || (ends.length === 1 ? ends[0] : null);
  return champ ? champ._w : null;
}

/** A knockout among the sides still in it — the fallback. */
function simKnockout(sides, power, rand) {
  let alive = [...sides];
  while (alive.length > 1) {
    for (let i = alive.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [alive[i], alive[j]] = [alive[j], alive[i]];
    }
    const next = [];
    for (let i = 0; i < alive.length; i += 2) {
      if (i + 1 >= alive.length) next.push(alive[i]);
      else next.push(rand() < winP(avgOf(alive[i], power), avgOf(alive[i + 1], power)) ? alive[i] : alive[i + 1]);
    }
    alive = next;
  }
  return alive[0] || null;
}

/**
 * @param {{ sides: string[][], players: any[], matches: any[], sims?: number, seed?: number, total?: number }} args
 *   sides — the participants: one id for a solo format, two for a pair;
 *   players — everyone in it with { id, elo, tournaments_played, tournaments_won, avp }.
 * @returns {Map<string, number>} side key (ids joined by «+», sorted) → chance 0…1
 */
export function winChances({ sides, players, matches, sims = SIMS, seed = 7, total = 31 }) {
  const result = new Map(sides.map((s) => [sideKey(s), 0]));
  if (!sides.length) return result;
  const power = strengths(players);
  const rand = rng(seed);
  const ms = matches || [];
  const isAmericanka = ms.length > 0 && !ms.some((m) => m.stage);
  const enginePlayers = players.map((p) => ({ id: p.id, full_name: p.full_name || '' }));

  // Eliminated for the fallback: lost a played knockout game with no way back.
  const out = new Set();
  for (const m of ms) {
    if (!m.played || !m.stage || m.group_index != null || m.loser_to_match_id) continue;
    const l = teamAWon(m) ? m.team_b_players : m.team_a_players;
    out.add(sideKey(l));
  }
  const alive = sides.filter((s) => !out.has(sideKey(s)));

  const add = (winners, weight = 1) => {
    if (!winners || winners.length === 0) return;
    const share = weight / winners.length;
    for (const w of winners) {
      const k = sideKey(w);
      if (result.has(k)) result.set(k, result.get(k) + share);
    }
  };

  for (let i = 0; i < sims; i++) {
    // the form of the day — nobody plays exactly at their rating
    const day = new Map();
    for (const [id, v] of power) day.set(id, v + gauss(rand) * FORM_SD);
    if (isAmericanka) {
      add(simAmericanka(enginePlayers, ms, day, rand, total));
      continue;
    }
    const champ = ms.length ? simBracket(ms, day, rand) : null;
    if (champ) add([champ]);
    else add([simKnockout(alive.length ? alive : sides, day, rand)]);
  }
  for (const [k, v] of result) result.set(k, v / sims);
  return result;
}

/** «34%», «<1%», «99%» — never a plain 0 or 100 while it's still being played. */
export function chanceLabel(p, { decided = false } = {}) {
  if (p == null || Number.isNaN(p)) return '—';
  if (decided) return `${Math.round(p * 100)}%`;
  if (p < 0.005) return '<1%';
  if (p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

export { sideKey };

// ── What the forecast knows ──────────────────────────────────────────
// «До старту» — none of the results; «Зараз» — only rounds (or bracket
// stages) that are fully played, so the number changes once per round,
// not with every game. A game whose result doesn't count is played out
// again, and the bracket places it fed (winner_to / loser_to) are
// emptied, so who reaches them is simulated too.

const roundKey = (m) => `${m.stage || ''}|${m.group_index ?? ''}|${m.round_number ?? ''}`;

/**
 * @param {any[]} matches
 * @param {'pre' | 'rounds'} mode
 * @returns {{ matches: any[], completedRounds: number }}
 */
export function forecastBasis(matches, mode) {
  const ms = (matches || []).map((m) => ({
    ...m,
    team_a_players: [...(m.team_a_players || [])],
    team_b_players: [...(m.team_b_players || [])],
  }));
  const complete = new Set();
  if (mode === 'rounds') {
    const byRound = new Map();
    for (const m of ms) {
      const k = roundKey(m);
      if (!byRound.has(k)) byRound.set(k, []);
      byRound.get(k).push(m);
    }
    for (const [k, list] of byRound) if (list.every((m) => m.played)) complete.add(k);
  }
  const byId = new Map(ms.map((m) => [m.id, m]));
  // links fed by results that don't count → empty those places
  const fed = (m) => {
    for (const [to, slot] of [
      [m.winner_to_match_id, m.winner_to_slot],
      [m.loser_to_match_id, m.loser_to_slot],
    ]) {
      const t = to && byId.get(to);
      if (!t) continue;
      if (slot === 'b') t.team_b_players = [];
      else t.team_a_players = [];
    }
  };
  // ordered so earlier rounds are handled first
  const ordered = [...ms].sort((x, y) => (x.round_number || 0) - (y.round_number || 0) || (x.order_index || 0) - (y.order_index || 0));
  for (const m of ordered) {
    if (complete.has(roundKey(m))) continue;
    if (m.played) {
      m.played = false;
      m.set1 = null;
      m.set2 = null;
      m.set3 = null;
    }
    fed(m);
  }
  // completed rounds in order of play (for the «after round N» caption)
  const roundsDone = mode === 'rounds' ? complete.size : 0;
  return { matches: ms, completedRounds: roundsDone };
}
