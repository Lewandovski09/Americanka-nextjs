import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/clientCache', () => ({ memoize: (_k: string, _t: number, f: () => unknown) => f() }));

import { partnerStatsFrom } from './playerGames';

describe('partnerStatsFrom', () => {
  it('counts games and wins per partner, most games first', () => {
    const games = [
      { won: true, partners: ['a'] },
      { won: false, partners: ['a'] },
      { won: true, partners: ['b'] },
      { won: true, partners: ['a'] },
    ];
    const people = { a: { id: 'a', full_name: 'A' }, b: { id: 'b', full_name: 'B' } };
    const rows = partnerStatsFrom(games as never, people);
    expect(rows.map((r: { partner_id: string }) => r.partner_id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ games_together: 3, wins_together: 2 });
    expect(rows[1]).toMatchObject({ games_together: 1, wins_together: 1 });
  });
});
