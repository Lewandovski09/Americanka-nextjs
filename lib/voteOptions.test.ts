import { describe, it, expect } from 'vitest';
import { voteOptionsFrom } from './voteOptions';

describe('voteOptionsFrom', () => {
  it('builds one option per player in a solo format', () => {
    const opts = voteOptionsFrom({ isPair: false, players: [{ user_id: 'u1', users: { full_name: 'Іван Петренко' } }], teams: undefined });
    expect(opts).toEqual([{ id: 'u1', memberIds: ['u1'], people: [{ full_name: 'Іван Петренко' }], name: 'Іван Петренко' }]);
  });

  it('builds one option per pair, skipping teams without an id', () => {
    const opts = voteOptionsFrom({
      isPair: true,
      players: undefined,
      teams: [
        { id: 't1', user1_id: 'a', user2_id: 'b', p1: { full_name: 'Іван Петренко' }, p2: { full_name: 'Олег Коваль' } },
        { user1_id: 'c' },
      ],
    });
    expect(opts).toHaveLength(1);
    expect(opts[0].memberIds).toEqual(['a', 'b']);
    expect(opts[0].name.includes(' / ')).toBe(true);
  });
});
