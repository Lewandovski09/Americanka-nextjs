// Double Elimination — skeleton builder (event-driven / pointer-based).
//
// The whole bracket is created up front as empty placeholder matches
// wired together: each match knows where its winner goes and where its
// loser goes. As scores come in, teams flow into the next slots (see
// the score route's propagation), so no manual "advance" is needed.
//
// Winners bracket (WB) is a single elimination. Losers of WB drop into
// the losers bracket (LB), which alternates "minor" rounds (LB
// survivors play each other) and "major" rounds (LB survivors meet the
// next WB round's losers). The LB champion meets the WB champion in the
// grand final (no bracket reset).
//
// The bracket is always sized to a power of two (the chosen 16 or 32).
// When fewer pairs actually start, the difference is filled with BYES
// given to the STRONGEST seeds: their round-1 slots have no opponent, so
// they advance for free. `resolveByes` then folds those byes through the
// whole skeleton — collapsing walkovers and removing matches that end up
// with no real teams — so the runtime propagation only ever sees real
// games.

import { randomUUID } from 'crypto';

export function isPowerOfTwo(n) {
  return n >= 2 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard bracket seeding order: seed numbers in slot order so #1 and
// #2 can only meet in the final. e.g. P=8 → [1,8,4,5,2,7,3,6].
function seedOrder(P) {
  let arr = [1, 2];
  while (arr.length < P) {
    const n = arr.length * 2;
    const next = [];
    for (const s of arr) {
      next.push(s);
      next.push(n + 1 - s);
    }
    arr = next;
  }
  return arr;
}

const BYE = { bye: true }; // permanently-empty slot
const PENDING = { pending: true }; // will hold a real team at runtime

/**
 * @param {Array} teams - seeded teams [{ id, players:[p1,p2] }] best-first
 * @param {number[]} courts
 * @param {number} [bracketSize] - power-of-two bracket size (chosen 16/32);
 *   defaults to teams.length. Extra slots become byes for the top seeds.
 * @returns {Array} skeleton match rows (with ids + winner/loser pointers)
 */
export function buildDoubleElimination(teams, courts, bracketSize) {
  const P = bracketSize || teams.length;
  if (!isPowerOfTwo(P)) {
    throw new Error(`Розмір сітки має бути 4, 8, 16 або 32 (зараз ${P})`);
  }
  if (teams.length < 2 || teams.length > P) {
    throw new Error(`Невірна кількість пар для сітки на ${P}`);
  }
  const k = Math.log2(P);
  const order = seedOrder(P);

  const mk = (stage, round) => ({
    id: randomUUID(),
    stage,
    round,
    a: null,
    b: null,
    winnerTo: null,
    loserTo: null,
    isFinal: false,
  });

  // ── Winners bracket ──
  const wb = [];
  for (let r = 0; r < k; r++) {
    const count = P >> (r + 1);
    wb.push(Array.from({ length: count }, () => mk('wb' + (r + 1), r + 1)));
  }
  for (let r = 0; r < k - 1; r++) {
    wb[r].forEach((m, i) => {
      m.winnerTo = { id: wb[r + 1][i >> 1].id, slot: i % 2 === 0 ? 'a' : 'b' };
    });
  }

  // ── Losers bracket ──
  const lb = [];
  const lb0 = Array.from({ length: P >> 2 }, () => mk('lb1', 1)); // WB1 losers
  lb.push(lb0);
  wb[0].forEach((m, i) => {
    m.loserTo = { id: lb0[i >> 1].id, slot: i % 2 === 0 ? 'a' : 'b' };
  });

  let survivors = lb0;
  let wbIdx = 1; // next WB round (0-based) whose losers drop into a major round
  let phase = 'major';
  let lbRoundNo = 2;
  while (wbIdx < wb.length || survivors.length > 1) {
    if (phase === 'major') {
      const round = Array.from({ length: survivors.length }, () => mk('lb' + lbRoundNo, lbRoundNo));
      lb.push(round);
      survivors.forEach((s, i) => {
        s.winnerTo = { id: round[i].id, slot: 'a' };
      });
      wb[wbIdx].forEach((m, i) => {
        m.loserTo = { id: round[i].id, slot: 'b' };
      });
      wbIdx++;
      phase = 'minor';
      survivors = round;
    } else {
      const round = Array.from({ length: survivors.length >> 1 }, () => mk('lb' + lbRoundNo, lbRoundNo));
      lb.push(round);
      survivors.forEach((s, i) => {
        s.winnerTo = { id: round[i >> 1].id, slot: i % 2 === 0 ? 'a' : 'b' };
      });
      phase = 'major';
      survivors = round;
    }
    lbRoundNo++;
  }
  const lbChamp = survivors[0];

  // ── Grand final ──
  const gf = mk('gf', 1);
  gf.isFinal = true;
  wb[k - 1][0].winnerTo = { id: gf.id, slot: 'a' };
  lbChamp.winnerTo = { id: gf.id, slot: 'b' };

  // Seed WB round 1 — a slot whose seed number exceeds the real field is
  // a BYE (the phantom high seeds sit opposite the strongest real ones).
  wb[0].forEach((m, i) => {
    const sa = order[2 * i];
    const sb = order[2 * i + 1];
    m.a = sa <= teams.length ? teams[sa - 1] : BYE;
    m.b = sb <= teams.length ? teams[sb - 1] : BYE;
  });

  const all = [...wb.flat(), ...lb.flat(), gf];
  return serialize(resolveByes(all, gf.id), courts);
}

// Fold byes through the skeleton. A bye counts as a team that loses every
// game; two byes make a bye. Walkovers (real vs bye) are pre-played, and
// any match left with no real team is removed and its slots redirected,
// so only genuine games remain.
function resolveByes(nodes, gfId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const alive = new Set(nodes.map((n) => n.id));

  // Reverse index: "targetId:slot" -> { srcId, edge } so we can re-point
  // a feeder when the match it feeds collapses.
  const feeders = new Map();
  const indexFeeder = (src, ptr, edge) => {
    if (ptr) feeders.set(`${ptr.id}:${ptr.slot}`, { srcId: src.id, edge });
  };
  for (const n of nodes) {
    indexFeeder(n, n.winnerTo, 'winner');
    indexFeeder(n, n.loserTo, 'loser');
  }

  const isDecided = (v) => v !== null && v !== undefined;
  const isReal = (v) => v && !v.bye && !v.pending; // concrete known team
  const setSlot = (targetPtr, val) => {
    if (!targetPtr) return;
    const t = byId.get(targetPtr.id);
    if (t) t[targetPtr.slot] = val;
  };

  // Repoint the feeder of `pendingPtr` (a real-but-unknown team flowing
  // through a collapsing match) straight to `newTarget`.
  const repoint = (pendingSlotKey, newTarget) => {
    const f = feeders.get(pendingSlotKey);
    if (!f) return;
    const src = byId.get(f.srcId);
    if (!src) return;
    src[f.edge === 'winner' ? 'winnerTo' : 'loserTo'] = newTarget;
    if (newTarget) feeders.set(`${newTarget.id}:${newTarget.slot}`, { srcId: src.id, edge: f.edge });
  };

  let changed = true;
  let guard = 0;
  while (changed && guard++ < nodes.length * 4) {
    changed = false;
    for (const n of nodes) {
      if (!alive.has(n.id) || n.resolved) continue;
      if (!isDecided(n.a) || !isDecided(n.b)) continue; // wait for both slots

      const aReal = isReal(n.a);
      const bReal = isReal(n.b);
      const aBye = n.a?.bye;
      const bBye = n.b?.bye;

      // Two byes → dead match. Everything downstream also byes.
      if (aBye && bBye) {
        setSlot(n.winnerTo, BYE);
        setSlot(n.loserTo, BYE);
        alive.delete(n.id);
        n.resolved = true;
        changed = true;
        continue;
      }

      // Real (known or pending) vs bye → walkover / pass-through.
      if (aBye || bBye) {
        const realVal = aBye ? n.b : n.a;
        const realSlot = aBye ? 'b' : 'a';
        if (isReal(realVal)) {
          // Known team gets a free pass: pre-play it as a walkover.
          n.a = realVal;
          n.b = BYE;
          n.walkover = true;
          setSlot(n.winnerTo, realVal);
          setSlot(n.loserTo, BYE);
        } else {
          // A real-but-unknown team is passing through: drop this match and
          // send its feeder straight where the winner would have gone.
          setSlot(n.winnerTo, PENDING);
          setSlot(n.loserTo, BYE);
          repoint(`${n.id}:${realSlot}`, n.winnerTo);
          alive.delete(n.id);
        }
        n.resolved = true;
        changed = true;
        continue;
      }

      // Two real teams → a genuine game. Its winner/loser are real but
      // unknown until played; mark downstream slots pending.
      setSlot(n.winnerTo, PENDING);
      setSlot(n.loserTo, PENDING);
      n.resolved = true;
      changed = true;
    }
  }

  return nodes.filter((n) => alive.has(n.id));
}

function serialize(nodes, courts) {
  const now = new Date().toISOString();
  let court = 0;
  return nodes.map((node) => {
    const aReal = node.a && !node.a.bye && !node.a.pending;
    const bReal = node.b && !node.b.bye && !node.b.pending;
    return {
      id: node.id,
      stage: node.stage,
      round_number: node.round,
      court: courts[court++ % courts.length],
      team_a_players: aReal ? node.a.players : [],
      team_b_players: bReal ? node.b.players : [],
      winner_to_match_id: node.winnerTo?.id || null,
      winner_to_slot: node.winnerTo?.slot || null,
      loser_to_match_id: node.loserTo?.id || null,
      loser_to_slot: node.loserTo?.slot || null,
      is_final: node.isFinal,
      set1: node.walkover ? [1, 0] : null,
      played: !!node.walkover,
      ...(node.walkover ? { played_at: now } : {}),
    };
  });
}
