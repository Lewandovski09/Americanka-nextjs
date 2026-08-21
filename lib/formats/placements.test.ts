import { describe, it, expect } from 'vitest';
import { placementsFor, computePlaces, kingResults, deResults } from './placements';
import type { Match, Player, Team } from '../types';

describe('placementsFor — dispatch by shape', () => {
  it('americanka (no stage on any match): standings-based, but only once every game is played', () => {
    const players: Player[] = [
      { id: 'a', full_name: 'Alice' },
      { id: 'b', full_name: 'Bob' },
    ];
    const inProgress: Match[] = [{ played: false, team_a_players: ['a'], team_b_players: ['b'], set1: null }];
    expect(placementsFor({ matches: inProgress, players })).toEqual([]);

    const done: Match[] = [{ played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 15] }];
    const result = placementsFor({ matches: done, players });
    expect(result[0]).toEqual({ place: 1, playerIds: ['a'] });
    expect(result[1]).toEqual({ place: 2, playerIds: ['b'] });
  });

  it('king of the beach (any kr-stage match present) delegates to kingResults', () => {
    const matches: Match[] = [
      { stage: 'kr1', played: true, group_index: 0, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], set1: [21, 10] },
      { stage: 'kr1', played: true, group_index: 0, team_a_players: ['a', 'c'], team_b_players: ['b', 'd'], set1: [21, 10] },
      { stage: 'kr1', played: true, group_index: 0, team_a_players: ['a', 'd'], team_b_players: ['b', 'c'], set1: [21, 10] },
    ];
    expect(placementsFor({ matches })).toEqual(kingResults(matches));
  });

  it('double elimination (wb/lb stage present) delegates to deResults', () => {
    const matches: Match[] = [{ stage: 'final', played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 10] }, { stage: 'wb1', played: true, team_a_players: ['a'], team_b_players: ['c'], set1: [21, 5] }];
    expect(placementsFor({ matches })).toEqual(deResults(matches));
  });

  it('anything else (group/crosses stages) delegates to computePlaces', () => {
    const teams: Team[] = [{ id: 't1', user1_id: 'a', user2_id: 'b' }];
    const matches: Match[] = [{ stage: 'final', played: true, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], set1: [21, 10] }];
    expect(placementsFor({ matches, teams })).toEqual(computePlaces(matches, teams));
  });

  it('is empty for no matches at all', () => {
    expect(placementsFor({ matches: [] })).toEqual([]);
  });
});

describe('computePlaces — full-placement crosses (groups_crosses_1_2 shape)', () => {
  it('every final/pX_Y match awards a unique place to winner and loser', () => {
    const matches: Match[] = [
      { stage: 'final', played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 15] },
      { stage: 'p3_4', played: true, team_a_players: ['c'], team_b_players: ['d'], set1: [15, 21] },
      { stage: 'p5_6', played: true, team_a_players: ['e'], team_b_players: ['f'], set1: [21, 10] },
    ];
    const places = computePlaces(matches, []);
    expect(places).toEqual([
      { place: 1, playerIds: ['a'] },
      { place: 2, playerIds: ['b'] },
      { place: 3, playerIds: ['d'] },
      { place: 4, playerIds: ['c'] },
      { place: 5, playerIds: ['e'] },
      { place: 6, playerIds: ['f'] },
    ]);
  });

  it('ignores unplayed matches entirely', () => {
    const matches: Match[] = [{ stage: 'final', played: false, team_a_players: ['a'], team_b_players: ['b'], set1: null }];
    expect(computePlaces(matches, [])).toEqual([]);
  });
});

describe('computePlaces — file format (play_in/qf present, tie blocks)', () => {
  const teams: Team[] = [
    { id: 't1', user1_id: 'a1', user2_id: 'a2' },
    { id: 't2', user1_id: 'b1', user2_id: 'b2' },
    { id: 't3', user1_id: 'c1', user2_id: 'c2' }, // never reaches play-in/qf -> ties 13th
  ];

  it('final and bronze award unique places 1-4; qf losers tie 5th; play-in losers tie 9th', () => {
    const matches: Match[] = [
      { stage: 'final', played: true, team_a_players: ['a1'], team_b_players: ['b1'], set1: [21, 15] },
      { stage: 'p3_4', played: true, team_a_players: ['x1'], team_b_players: ['y1'], set1: [21, 15] },
      { stage: 'qf', played: true, team_a_players: ['a1'], team_b_players: ['q1'], set1: [21, 5] }, // q1's team loses
      { stage: 'play_in', played: true, team_a_players: ['a1'], team_b_players: ['p1'], set1: [21, 5] }, // p1's team loses
    ];
    const places = computePlaces(matches, teams);
    expect(places.find((p) => p.place === 1)?.playerIds).toEqual(['a1']);
    expect(places.find((p) => p.place === 2)?.playerIds).toEqual(['b1']);
    expect(places.find((p) => p.place === 5)?.playerIds).toEqual(['q1']);
    expect(places.find((p) => p.place === 9)?.playerIds).toEqual(['p1']);
  });

  it('a team that never reached play-in or qf ties for 13th — the group-4th block', () => {
    // Team rosters must be the FULL pair here (both partner ids), not a
    // single player — the "did this team ever reach play-in/qf" check
    // matches on the whole team_a_players/team_b_players array, so a
    // single-id match row would never match a two-id team roster.
    const matches: Match[] = [
      { stage: 'play_in', played: true, team_a_players: ['a1', 'a2'], team_b_players: ['b1', 'b2'], set1: [21, 15] },
      { stage: 'qf', played: false, team_a_players: [], team_b_players: [], set1: null },
    ];
    const places = computePlaces(matches, teams);
    // b1/b2 lost the play-in (place 9) but DID reach it, so they are not
    // double-counted at 13th. c1/c2 never appeared anywhere.
    expect(places.find((p) => p.place === 9)?.playerIds).toEqual(['b1', 'b2']);
    expect(places.find((p) => p.place === 13)?.playerIds).toEqual(['c1', 'c2']);
    expect(places.filter((p) => p.place === 13)).toHaveLength(1);
  });

  it('a team whose quarterfinal is still ahead (dealt but not yet played) is NOT counted as eliminated', () => {
    const matches: Match[] = [
      // t1 is already assigned a qf pairing, just not played yet.
      { stage: 'qf', played: false, team_a_players: ['a1'], team_b_players: ['x1'], set1: null },
    ];
    const oneTeam: Team[] = [{ id: 't1', user1_id: 'a1', user2_id: 'a2' }];
    const places = computePlaces(matches, oneTeam);
    expect(places.some((p) => p.playerIds.includes('a1'))).toBe(false);
  });
});

describe('kingResults — reserves the block of an in-progress round instead of letting later players slide up', () => {
  const g4 = (ids: [string, string, string, string], group_index: number, stage: string, played: boolean): Match[] => [
    { stage, group_index, played, team_a_players: [ids[0]], team_b_players: [ids[1]], set1: played ? [21, 10] : null },
    { stage, group_index, played, team_a_players: [ids[0]], team_b_players: [ids[2]], set1: played ? [21, 10] : null },
    { stage, group_index, played, team_a_players: [ids[0]], team_b_players: [ids[3]], set1: played ? [21, 10] : null },
  ];

  it('a fully-played final round of 4 gets places 1-4 by wins then differential', () => {
    // a beats everyone (3 wins), b/c/d split the rest — a is clearly 1st.
    const matches: Match[] = [
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 5] },
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['a'], team_b_players: ['c'], set1: [21, 5] },
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['a'], team_b_players: ['d'], set1: [21, 5] },
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['b'], team_b_players: ['c'], set1: [21, 10] },
    ];
    const places = kingResults(matches);
    expect(places[0]).toEqual({ place: 1, playerIds: ['a'] });
    expect(places.map((p) => p.place)).toEqual([1, 2, 3, 4]);
  });

  it('an UNPLAYED later round still reserves its own place block, rather than leaving it to the earlier round', () => {
    // 8 players, two groups of 4 (kr1): a and b top group 0, e and f top
    // group 1 — a clean top-2 each, no ties. Round 2 (kr2, the final
    // four) has been DEALT with all four qualifiers but not yet played.
    // c, d, g, h (the two non-qualifiers per group) must land in 5-8 —
    // never in 1-4, which belongs to the four players still alive.
    const kr1Group0: Match[] = [
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 5] },
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['a'], team_b_players: ['c'], set1: [21, 5] },
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['b'], team_b_players: ['d'], set1: [21, 5] },
    ];
    const kr1Group1: Match[] = [
      { stage: 'kr1', group_index: 1, played: true, team_a_players: ['e'], team_b_players: ['f'], set1: [21, 5] },
      { stage: 'kr1', group_index: 1, played: true, team_a_players: ['e'], team_b_players: ['g'], set1: [21, 5] },
      { stage: 'kr1', group_index: 1, played: true, team_a_players: ['f'], team_b_players: ['h'], set1: [21, 5] },
    ];
    // kr2 is dealt with all four real qualifiers, but not yet played.
    const kr2: Match[] = [
      { stage: 'kr2', group_index: 0, played: false, team_a_players: ['a', 'e'], team_b_players: ['b', 'f'], set1: null },
    ];
    const places = kingResults([...kr1Group0, ...kr1Group1, ...kr2]);

    // Exactly the four non-qualifiers appear, all at 5 or worse — 1-4 is
    // reserved for a/b/e/f, still undecided.
    expect(places.map((p) => p.playerIds[0]).sort()).toEqual(['c', 'd', 'g', 'h']);
    places.forEach((p) => expect(p.place).toBeGreaterThanOrEqual(5));

    // The four still-alive players have no row at all yet — reserved,
    // not guessed.
    ['a', 'b', 'e', 'f'].forEach((id) => {
      expect(places.some((p) => p.playerIds[0] === id)).toBe(false);
    });
  });

  it('a round that is still being played (not every game in) reserves its block too', () => {
    const partial: Match[] = [
      { stage: 'kr1', group_index: 0, played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 5] },
      { stage: 'kr1', group_index: 0, played: false, team_a_players: ['a'], team_b_players: ['c'], set1: null }, // still to play
      { stage: 'kr1', group_index: 0, played: false, team_a_players: ['a'], team_b_players: ['d'], set1: null },
    ];
    expect(kingResults(partial)).toEqual([]);
  });
});

describe('deResults — the exact regression this module was written to fix', () => {
  const players = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it('final and bronze award unique 1-4; LB round losers tie by round, later (higher) rounds get better places', () => {
    const matches: Match[] = [
      { stage: 'final', played: true, team_a_players: ['w1'], team_b_players: ['w2'], set1: [21, 15] },
      { stage: 'p3_4', played: true, team_a_players: ['w3'], team_b_players: ['w4'], set1: [21, 15] },
      // lb2 (the most recent LB round before the crossed semis) -> 5-6
      { stage: 'lb2', played: true, team_a_players: ['x1'], team_b_players: ['x2'], set1: [15, 21] },
      // lb1 (earliest LB round) -> a lower (worse) place block than lb2
      { stage: 'lb1', played: true, team_a_players: ['y1'], team_b_players: ['y2'], set1: [15, 21] },
      { stage: 'lb1', played: true, team_a_players: ['y3'], team_b_players: ['y4'], set1: [15, 21] },
    ];
    const places = deResults(matches);
    expect(places.find((p) => p.place === 1)?.playerIds).toEqual(['w1']);
    expect(places.find((p) => p.place === 2)?.playerIds).toEqual(['w2']);
    expect(places.find((p) => p.place === 3)?.playerIds).toEqual(['w3']); // winner of p3_4
    expect(places.find((p) => p.place === 4)?.playerIds).toEqual(['w4']); // loser of p3_4
    // lb2's loser (the more recent round) takes place 5.
    const lb2Place = places.find((p) => p.playerIds[0]?.startsWith('x'))?.place;
    // lb1's losers (the earlier round, twice as many games -> a wider block) start after lb2's block.
    const lb1Places = places.filter((p) => p.playerIds[0]?.startsWith('y')).map((p) => p.place);
    expect(lb1Places.every((p) => p > (lb2Place ?? 0))).toBe(true);
    // Both lb1 losers share the SAME place — it's a tie block, not two
    // consecutive places.
    expect(new Set(lb1Places).size).toBe(1);
  });

  it('THE BUG THIS MODULE FIXES: an unplayed later LB round must not let an earlier round\'s losers slide into a better block', () => {
    // A 16-pair double-elim bracket: lb4 (13-16, 4 games) hasn't been
    // played yet, but lb3 (9-12) already has. Advancing places by played
    // count alone (the old, buggy behaviour) would number lb3's losers
    // starting right after the final/bronze — i.e. as if lb4 didn't
    // exist — misreporting the first pairs knocked out as much better
    // placed than they are. The block lb4 OWNS (13-16, 4 wide) must be
    // skipped over regardless of whether it has been played.
    const matches: Match[] = [
      { stage: 'final', played: false, team_a_players: [], team_b_players: [], set1: null },
      { stage: 'p3_4', played: false, team_a_players: [], team_b_players: [], set1: null },
      // lb4: 4 games, NOT played (this is the round that must still
      // reserve a 4-wide block even though nothing here has a result).
      ...players(4, 'r4_').map((id, i) => ({
        stage: 'lb4',
        played: false,
        team_a_players: [id],
        team_b_players: [`r4b_${i}`],
        set1: null,
      } as Match)),
      // lb3: 2 games, played — these losers are OUT.
      { stage: 'lb3', played: true, team_a_players: ['s1'], team_b_players: ['s2'], set1: [15, 21] },
      { stage: 'lb3', played: true, team_a_players: ['s3'], team_b_players: ['s4'], set1: [21, 15] },
    ];
    const places = deResults(matches);
    const lb3Places = places.filter((p) => p.playerIds[0]?.startsWith('s')).map((p) => p.place);
    // lb4 is a 4-game round, so it owns 4 slots (place 5) before lb3's
    // block can start — lb3's losers must land at place 9, not 5.
    expect(new Set(lb3Places)).toEqual(new Set([9]));
  });

  it('a walkover-free empty bracket produces no rows', () => {
    expect(deResults([])).toEqual([]);
  });

  it('legacy grand-final ("gf") brackets start their shared blocks at 3, not 5', () => {
    const matches: Match[] = [
      { stage: 'gf', played: true, team_a_players: ['w1'], team_b_players: ['w2'], set1: [21, 15] },
      { stage: 'lb1', played: true, team_a_players: ['l1'], team_b_players: ['l2'], set1: [15, 21] },
    ];
    const places = deResults(matches);
    expect(places.find((p) => p.place === 1)?.playerIds).toEqual(['w1']);
    expect(places.find((p) => p.place === 2)?.playerIds).toEqual(['w2']);
    expect(places.find((p) => p.playerIds[0] === 'l1')?.place).toBe(3); // l1 is the loser (set1: [15,21])
  });
});
