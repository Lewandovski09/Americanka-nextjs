import { describe, it, expect } from 'vitest';
import { paymentGroups } from './paymentGroups';

describe('paymentGroups', () => {
  it('solo leagues — one player per row, empty leagues dropped', () => {
    const g = paymentGroups(
      [
        { id: 'c1', gender: 'M', category_label: 'Pro', tournament_players: [{ user_id: 'a', users: { full_name: 'Андрій' } }] },
        { id: 'c2', gender: 'F', category_label: 'Light', tournament_players: [] },
      ],
      false
    );
    expect(g.length).toBe(1);
    expect(g[0].label).toBe('Ч · Pro');
    expect(g[0].units[0][0].id).toBe('a');
    expect(g[0].units[0][0].full_name).toBe('Андрій');
  });
  it('pairs — both halves, a lone half too', () => {
    const g = paymentGroups(
      [
        {
          id: 'c1',
          category_label: 'Mix',
          tournament_teams: [
            { user1_id: 'a', user2_id: 'b', p1: { full_name: 'A' }, p2: { full_name: 'B' } },
            { user1_id: 'c', user2_id: null, p1: { full_name: 'C' } },
          ],
        },
      ],
      true
    );
    expect(g[0].units.map((u) => u.map((p) => p.id).join('+'))).toEqual(['a+b', 'c']);
  });
});
