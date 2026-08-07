// Double Elimination — skeleton builder (event-driven / pointer-based),
// 1:1 with the club's paper brackets (сетка16пар.xlsx / сетка24пар.xlsx).
//
// Both paper files are ONE universal 32-slot template — «сетка16пар» is
// that template with 16 byes (the real games start at its round II) and
// «сетка24пар» is it with 8 byes. So this builder ALWAYS constructs the
// 32-slot template, seeds the real field into it (byes go opposite the
// strongest seeds), and lets `resolveByes` fold the empty slots away —
// every field size then reproduces the paper bracket exactly (16 pairs
// → 30 matches, 24 → 46, 32 → 62).
//
// The whole bracket is created up front as empty placeholder matches
// wired together: each match knows where its winner goes and where its
// loser goes. As scores come in, teams flow into the next slots (see
// the score route's propagation), so no manual "advance" is needed.
//
// Winners bracket (WB) plays down to TWO undefeated semifinal winners —
// there is no WB final. Losers of WB drop into the losers bracket (LB),
// which alternates "minor" rounds (LB survivors pair up) and "major"
// rounds (LB survivors meet the next WB round's losers). The template's
// drop pattern (from its formulas) keeps a team from replaying whoever
// beat it in the previous WB round:
//   • major fed by WB round II — the loser row is fully REVERSED
//     (за17-24: W(lb1)[j] × L(II)[last−j]);
//   • every later major — adjacent pairs swap (за9-12 takes L(III) as
//     rows 2,1,4,3; за5-6 takes the semi losers as 2,1).
// Once the LB is down to two, the four survivors play crossed
// semifinals (SF j = WB semi j winner × the LB survivor whose match
// held the OTHER semi's loser), then the final and a 3rd-place match.
// There is NO grand final or bracket reset — an undefeated team can
// still finish 3rd.
//
// The losers of each LB round are out and SHARE a place (13-16, 9-12,
// 7-8, 5-6 for a 16-pair field); only 1-2 and 3-4 are played out.

import { randomUUID } from 'crypto';
import { stageWeight } from './stages';
import type { Match } from '../types';

export function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

// Seeding order of the paper sheet: seed numbers top-to-bottom in the
// first round, so #1 and #2 can only meet in the final. Built by the
// usual doubling rule (each seed s spawns the pair s / n+1-s), but — as
// the club's sheets are written — every SECOND pair is put down the
// other way round, so the stronger seed heads the odd games and trails
// the even ones. That reproduces the sheet's column exactly:
//   P=8  → [1,8,5,4,3,6,7,2]
//   P=16 → [1,16,9,8,5,12,13,4,3,14,11,6,7,10,15,2]
function seedOrder(P: number): number[] {
  let arr = [1, 2];
  while (arr.length < P) {
    const n = arr.length * 2;
    const next: number[] = [];
    arr.forEach((s, i) => {
      const hi = s;
      const lo = n + 1 - s;
      next.push(...(i % 2 === 0 ? [hi, lo] : [lo, hi]));
    });
    arr = next;
  }
  return arr;
}

/** A registered pair as it sits on the seed column. */
export interface SeedTeam {
  id: string;
  players: string[];
  [key: string]: unknown;
}

/**
 * A WB/LB bracket slot: a concrete seeded team, a permanent bye, a
 * real-but-not-yet-known occupant, or still empty (null). Kept as one
 * loose shape — rather than a discriminated union — so the sentinel
 * checks below (`.bye`, `.pending`, `.players`) stay simple; this
 * mirrors the original JS's duck typing rather than fighting it.
 */
interface SlotShape {
  bye?: true;
  pending?: true;
  id?: string;
  players?: string[];
}
type SlotValue = SlotShape | null;

interface Pointer {
  id: string;
  slot: 'a' | 'b';
}

interface BracketNode {
  id: string;
  stage: string;
  round: number;
  a: SlotValue;
  b: SlotValue;
  winnerTo: Pointer | null;
  loserTo: Pointer | null;
  isFinal: boolean;
  resolved?: boolean;
}

const BYE: SlotValue = { bye: true }; // permanently-empty slot
const PENDING: SlotValue = { pending: true }; // will hold a real team at runtime

// Picking 'a' vs 'b' off an index shows up a dozen times below; a named
// helper (rather than an inline `i % 2 === 0 ? 'a' : 'b'` ternary at
// each call site) keeps every one of them pinned to the literal union
// type Pointer['slot'] expects, instead of relying on TS to infer it
// from context each time.
const sideOf = (i: number): 'a' | 'b' => (i % 2 === 0 ? 'a' : 'b');

/**
 * @param teams - the seed column, best-first: [{ id, players:[p1,p2] }]
 *   at each place. May be SPARSE — a null/missing entry is a place the
 *   admin left empty on «Посів», and becomes a bye for whoever the sheet
 *   puts opposite it. A short dense array behaves as before: the places
 *   past its end are empty, so the byes fall to the top seeds.
 * @param courts
 * @param bracketSize - power-of-two bracket size (chosen 16/32);
 *   defaults to teams.length.
 * @returns skeleton match rows (with ids + winner/loser pointers)
 */
export function buildDoubleElimination(
  teams: (SeedTeam | null | undefined)[],
  courts: number[],
  bracketSize?: number
): Match[] {
  const P = bracketSize || teams.length;
  if (!isPowerOfTwo(P) || P < 8) {
    throw new Error(`Розмір сітки має бути 8, 16 або 32 (зараз ${P})`);
  }
  if (teams.filter(Boolean).length < 2 || teams.length > P) {
    throw new Error(`Невірна кількість пар для сітки на ${P}`);
  }
  // The paper source is one universal 32-slot template — build it at
  // full size regardless of the chosen bracket; the unused slots become
  // byes and collapse. `P` only caps how many pairs may enter.
  const T = Math.max(32, P);
  const k = Math.log2(T);
  const order = seedOrder(T);

  const mk = (stage: string, round: number): BracketNode => ({
    id: randomUUID(),
    stage,
    round,
    a: null,
    b: null,
    winnerTo: null,
    loserTo: null,
    isFinal: false,
  });

  // ── Winners bracket: rounds 1..k-1, down to the two undefeated
  // semifinal winners (this format has no WB final).
  const wb: BracketNode[][] = [];
  for (let r = 0; r < k - 1; r++) {
    const count = T >> (r + 1);
    wb.push(Array.from({ length: count }, () => mk('wb' + (r + 1), r + 1)));
  }
  for (let r = 0; r < k - 2; r++) {
    wb[r].forEach((m, i) => {
      m.winnerTo = { id: wb[r + 1][i >> 1].id, slot: sideOf(i) };
    });
  }

  // ── Losers bracket ──
  const lb: BracketNode[][] = [];
  const lb0 = Array.from({ length: T >> 2 }, () => mk('lb1', 1)); // WB1 losers pair up
  lb.push(lb0);
  wb[0].forEach((m, i) => {
    m.loserTo = { id: lb0[i >> 1].id, slot: sideOf(i) };
  });

  let survivors: BracketNode[] = lb0;
  let lbRoundNo = 2;
  wb.slice(1).forEach((wbRound, t) => {
    // Major round: LB survivors meet this WB round's losers, using the
    // template's drop pattern (its formulas): the first major REVERSES
    // the loser row, every later one swaps adjacent pairs. Both keep a
    // team away from whoever beat it in the previous WB round.
    const major = Array.from({ length: survivors.length }, () => mk('lb' + lbRoundNo, lbRoundNo));
    lb.push(major);
    // The sheet writes the LB survivor on top everywhere except the last
    // major (the one fed by the WB semifinals), where the dropping semi
    // loser heads the box — keep the same top/bottom order.
    const last = t === wb.length - 2;
    const survivorSlot: 'a' | 'b' = last ? 'b' : 'a';
    const dropSlot: 'a' | 'b' = last ? 'a' : 'b';
    survivors.forEach((s, i) => {
      s.winnerTo = { id: major[i].id, slot: survivorSlot };
    });
    wbRound.forEach((m, i) => {
      m.loserTo = { id: major[t === 0 ? major.length - 1 - i : i ^ 1].id, slot: dropSlot };
    });
    survivors = major;
    lbRoundNo++;

    // Minor round: LB survivors pair up among themselves — except after
    // the last major (fed by the WB semis), where two LB survivors stay
    // for the crossed semifinals.
    if (t < wb.length - 2) {
      const minor = Array.from({ length: survivors.length >> 1 }, () => mk('lb' + lbRoundNo, lbRoundNo));
      lb.push(minor);
      survivors.forEach((s, i) => {
        s.winnerTo = { id: minor[i >> 1].id, slot: sideOf(i) };
      });
      survivors = minor;
      lbRoundNo++;
    }
  });

  // ── Crossed semifinals → final + 3rd place (no grand final) ──
  // The last major put L(semi j) into match j^1, so pairing SF j with
  // survivors[j] gives each WB semi winner the LB survivor whose match
  // held the OTHER semi's loser.
  const sf1 = mk('sf', 1);
  const sf2 = mk('sf', 2);
  wb[wb.length - 1][0].winnerTo = { id: sf1.id, slot: 'a' };
  survivors[0].winnerTo = { id: sf1.id, slot: 'b' };
  wb[wb.length - 1][1].winnerTo = { id: sf2.id, slot: 'a' };
  survivors[1].winnerTo = { id: sf2.id, slot: 'b' };

  const final = mk('final', 1);
  final.isFinal = true;
  const bronze = mk('p3_4', 1);
  sf1.winnerTo = { id: final.id, slot: 'a' };
  sf1.loserTo = { id: bronze.id, slot: 'a' };
  sf2.winnerTo = { id: final.id, slot: 'b' };
  sf2.loserTo = { id: bronze.id, slot: 'b' };

  // Seed WB round 1 — a slot is a BYE when its seed number is past the
  // chosen bracket (the template's phantom seeds) or when that place was
  // left empty on «Посів».
  const at = (seed: number): SlotValue => (seed <= P && teams[seed - 1] ? teams[seed - 1]! : BYE);
  wb[0].forEach((m, i) => {
    m.a = at(order[2 * i]);
    m.b = at(order[2 * i + 1]);
  });

  const all = [...wb.flat(), ...lb.flat(), sf1, sf2, final, bronze];
  return serialize(renumberRounds(resolveByes(all)), courts);
}

// After byes collapse whole template rounds (e.g. 16 pairs start at the
// template's round II), rename the surviving wb/lb rounds back to a
// dense 1..n so the app shows «Раунд 1» for the first real round.
function renumberRounds(nodes: BracketNode[]): BracketNode[] {
  for (const prefix of ['wb', 'lb']) {
    const re = new RegExp(`^${prefix}\\d+$`);
    const rounds = [...new Set(nodes.filter((n) => re.test(n.stage)).map((n) => n.round))].sort(
      (a, b) => a - b
    );
    const dense = new Map(rounds.map((r, i) => [r, i + 1]));
    nodes.forEach((n) => {
      if (re.test(n.stage)) {
        // Safe: `dense` was built from exactly the `.round` values of
        // this same filtered set, so every lookup here hits.
        n.round = dense.get(n.round)!;
        n.stage = prefix + n.round;
      }
    });
  }
  return nodes;
}

// Fold byes through the skeleton. A bye counts as a team that loses every
// game; a match against a bye is not a game at all (the paper bracket
// numbers only real games) — the real side passes straight through, and
// any match left with no real team is removed and its slots redirected,
// so only genuine games remain.
function resolveByes(nodes: BracketNode[]): BracketNode[] {
  const byId = new Map<string, BracketNode>(nodes.map((n) => [n.id, n]));
  const alive = new Set<string>(nodes.map((n) => n.id));

  // Reverse index: "targetId:slot" -> { srcId, edge } so we can re-point
  // a feeder when the match it feeds collapses.
  const feeders = new Map<string, { srcId: string; edge: 'winner' | 'loser' }>();
  const indexFeeder = (src: BracketNode, ptr: Pointer | null, edge: 'winner' | 'loser') => {
    if (ptr) feeders.set(`${ptr.id}:${ptr.slot}`, { srcId: src.id, edge });
  };
  for (const n of nodes) {
    indexFeeder(n, n.winnerTo, 'winner');
    indexFeeder(n, n.loserTo, 'loser');
  }

  const isDecided = (v: SlotValue): boolean => v !== null && v !== undefined;
  const isReal = (v: SlotValue): boolean => !!v && !v.bye && !v.pending; // concrete known team
  const setSlot = (targetPtr: Pointer | null, val: SlotValue) => {
    if (!targetPtr) return;
    const t = byId.get(targetPtr.id);
    if (t) t[targetPtr.slot] = val;
  };

  // Repoint the feeder of `pendingPtr` (a real-but-unknown team flowing
  // through a collapsing match) straight to `newTarget`.
  const repoint = (pendingSlotKey: string, newTarget: Pointer | null) => {
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

      // Real (known or pending) vs bye → not a game: the real side
      // passes straight through and the match itself disappears.
      if (aBye || bBye) {
        const realVal = aBye ? n.b : n.a;
        const realSlot: 'a' | 'b' = aBye ? 'b' : 'a';
        setSlot(n.winnerTo, isReal(realVal) ? realVal : PENDING);
        setSlot(n.loserTo, BYE);
        // An unknown passer-through flows in from a feeder match — send
        // that feeder straight where this match's winner would have gone.
        if (!isReal(realVal)) repoint(`${n.id}:${realSlot}`, n.winnerTo);
        alive.delete(n.id);
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

// Emit the rows in PLAY order — the very order the app numbers the games
// in (stage weight first, then the slot order inside a stage), which is
// the sheet's 1…30 column. Two things hang off that:
//   • `round_number` stores the slot INDEX inside the stage (the round
//     itself already lives in the stage name, and storing it there left
//     every match of a round tied — so `.order('round_number')` returned
//     them in whatever order Postgres felt like, and entering a score
//     reshuffled the bracket). Slot indices make the order survive the
//     round-trip, and match how every other builder uses the column.
//   • courts are handed out along the play order, so each court's queue
//     advances in step and the projected times rise with the game number.
function serialize(nodes: BracketNode[], courts: number[]): Match[] {
  const ordered = [...nodes].sort((a, b) => stageWeight(a.stage) - stageWeight(b.stage));
  const slotOf = new Map<string, number>();
  return ordered.map((node, i) => {
    const slot = (slotOf.get(node.stage) || 0) + 1;
    slotOf.set(node.stage, slot);
    const aReal = !!node.a && !node.a.bye && !node.a.pending;
    const bReal = !!node.b && !node.b.bye && !node.b.pending;
    return {
      id: node.id,
      stage: node.stage,
      round_number: slot,
      court: courts[i % courts.length],
      team_a_players: aReal ? node.a?.players ?? [] : [],
      team_b_players: bReal ? node.b?.players ?? [] : [],
      winner_to_match_id: node.winnerTo?.id || null,
      winner_to_slot: node.winnerTo?.slot || null,
      loser_to_match_id: node.loserTo?.id || null,
      loser_to_slot: node.loserTo?.slot || null,
      is_final: node.isFinal,
      set1: null,
      played: false,
    };
  });
}
