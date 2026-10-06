import { describe, it, expect } from 'vitest';
import { removeCategory } from './removeCategory';
import { fakeSupabase } from '../testing/fakeSupabase';

function world() {
  return {
    tournament_categories: [{ id: 'c1', event_id: 'e1' }, { id: 'c2', event_id: 'e1' }],
    tournament_matches: [],
    avp_points: [],
    elo_history: [],
    tournament_applications: [
      { id: 'a1', assigned_category_id: 'c1', status: 'assigned' },
      { id: 'a2', assigned_category_id: 'c2', status: 'assigned' },
      { id: 'a3', assigned_category_id: 'c1', status: 'withdrawn' },
    ],
  };
}

describe('removeCategory', () => {
  it('before the start: the category goes, its applications back to the queue', async () => {
    const sb: any = fakeSupabase(world());
    const r: any = await removeCategory(sb, 'c1', { eventStarted: false });
    expect(r.ok).toBe(true);
    expect(sb.db.tournament_categories.map((c: any) => c.id)).toEqual(['c2']);
    const a1 = sb.db.tournament_applications.find((a: any) => a.id === 'a1');
    expect(a1.status).toBe('pending');
    expect(a1.assigned_category_id).toBe(null);
    expect(sb.db.tournament_applications.find((a: any) => a.id === 'a3').status).toBe('withdrawn');
    expect(sb.db.tournament_applications.find((a: any) => a.id === 'a2').status).toBe('assigned');
  });
  it('after the start: its applications are closed', async () => {
    const sb: any = fakeSupabase(world());
    await removeCategory(sb, 'c1', { eventStarted: true });
    expect(sb.db.tournament_applications.find((a: any) => a.id === 'a1').status).toBe('rejected');
  });
});
