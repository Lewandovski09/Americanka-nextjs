import { describe, it, expect } from 'vitest';
import { saveScore } from './matchScore';
import { fakeSupabase } from '../testing/fakeSupabase';

const newSets = { set1: [21, 15], set2: null, set3: null };

describe('saveScore — with save_match_score (migration 062)', () => {
  it('reports a first entry', async () => {
    const sb: any = fakeSupabase({}, {
      rpc: { save_match_score: () => ({ data: [{ saved: true, was_played: false, old_set1: null, old_set2: null, old_set3: null }], error: null }) },
    });
    const r: any = await saveScore(sb, { id: 'm1', played: false }, newSets, false);
    expect(r).toEqual({ saved: true, wasPlayed: false, prev: { set1: null, set2: null, set3: null } });
  });

  it('reports the score it replaced on a correction', async () => {
    const sb: any = fakeSupabase({}, {
      rpc: { save_match_score: () => ({ data: [{ saved: true, was_played: true, old_set1: [10, 21], old_set2: null, old_set3: null }], error: null }) },
    });
    const r: any = await saveScore(sb, { id: 'm1', played: false }, newSets, true);
    expect(r.wasPlayed).toBe(true);
    expect(r.prev.set1).toEqual([10, 21]);
  });

  it('passes on whether a correction is allowed', async () => {
    let seen: any = null;
    const sb: any = fakeSupabase({}, {
      rpc: { save_match_score: (args: any) => ((seen = args), { data: [{ saved: false, was_played: true }], error: null }) },
    });
    const r: any = await saveScore(sb, { id: 'm1', played: false }, newSets, false);
    expect(seen.p_allow_correction).toBe(false);
    expect(r.saved).toBe(false);
  });

  it('returns a real database error', async () => {
    const sb: any = fakeSupabase({}, {
      rpc: { save_match_score: () => ({ data: null, error: { code: '23514', message: 'check failed' } }) },
    });
    const r: any = await saveScore(sb, { id: 'm1' }, newSets, true);
    expect(r.error).toBe('check failed');
  });
});

describe('saveScore — fallback before migration 062', () => {
  it('claims the first entry', async () => {
    const sb: any = fakeSupabase({ tournament_matches: [{ id: 'm1', played: false, set1: null }] });
    const r: any = await saveScore(sb, { id: 'm1', played: false }, newSets, false);
    expect(r.saved).toBe(true);
    expect(r.wasPlayed).toBe(false);
    expect(sb.db.tournament_matches[0].played).toBe(true);
    expect(sb.db.tournament_matches[0].set1).toEqual([21, 15]);
  });

  it('a judge who lost the race to another judge saves nothing', async () => {
    // the row read earlier said «not played», but someone saved meanwhile
    const sb: any = fakeSupabase({ tournament_matches: [{ id: 'm1', played: true, set1: [10, 21] }] });
    const r: any = await saveScore(sb, { id: 'm1', played: false }, newSets, false);
    expect(r.saved).toBe(false);
    expect(sb.db.tournament_matches[0].set1).toEqual([10, 21]);
  });

  it('an admin who lost the race corrects, knowing the fresh score', async () => {
    const sb: any = fakeSupabase({ tournament_matches: [{ id: 'm1', played: true, set1: [10, 21], set2: null, set3: null }] });
    const r: any = await saveScore(sb, { id: 'm1', played: false }, newSets, true);
    expect(r.saved).toBe(true);
    expect(r.wasPlayed).toBe(true);
    expect(r.prev.set1).toEqual([10, 21]);
    expect(sb.db.tournament_matches[0].set1).toEqual([21, 15]);
  });
});
