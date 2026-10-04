import { describe, it, expect } from 'vitest';
import { joinSeeker } from './pairing';
import { fakeSupabase } from '../testing/fakeSupabase';

const base = () => ({
  tournament_applications: [
    { id: 'a1', event_id: 'e1', user_id: 'seeker', partner_id: null, seeking_partner: true, status: 'pending', assigned_category_id: null },
  ],
  tournament_categories: [{ id: 'c1', event_id: 'e1', status: 'scheduled' }],
  tournament_teams: [] as any[],
});

describe('joinSeeker', () => {
  it('fills the application of a player looking for a partner', async () => {
    const sb: any = fakeSupabase(base());
    const r: any = await joinSeeker(sb, 'e1', 'seeker', 'joiner');
    expect(r).toEqual({});
    expect(sb.db.tournament_applications[0]).toMatchObject({ partner_id: 'joiner', seeking_partner: false });
  });

  it('two players at once: only the first one joins', async () => {
    const sb: any = fakeSupabase(base());
    const [r1, r2]: any[] = await Promise.all([
      joinSeeker(sb, 'e1', 'seeker', 'p1'),
      joinSeeker(sb, 'e1', 'seeker', 'p2'),
    ]);
    const ok = [r1, r2].filter((r) => !r.error);
    expect(ok).toHaveLength(1);
    expect(['p1', 'p2']).toContain(sb.db.tournament_applications[0].partner_id);
  });

  it('fills the empty seat of a placed half-pair', async () => {
    const t = base();
    t.tournament_applications[0].status = 'assigned';
    t.tournament_applications[0].assigned_category_id = 'c1' as any;
    t.tournament_teams.push({ id: 't1', category_id: 'c1', user1_id: 'seeker', user2_id: null });
    const sb: any = fakeSupabase(t);
    const r: any = await joinSeeker(sb, 'e1', 'seeker', 'joiner');
    expect(r).toEqual({});
    expect(sb.db.tournament_teams[0].user2_id).toBe('joiner');
  });

  it('undoes the application if the seat cannot be filled', async () => {
    const t = base();
    t.tournament_applications[0].status = 'assigned';
    t.tournament_applications[0].assigned_category_id = 'c1' as any;
    t.tournament_teams.push({ id: 't1', category_id: 'c1', user1_id: 'seeker', user2_id: null });
    const sb: any = fakeSupabase(t, { failOn: { 'tournament_teams.update': { message: 'boom' } } });
    const r: any = await joinSeeker(sb, 'e1', 'seeker', 'joiner');
    expect(r.error).toBeTruthy();
    expect(sb.db.tournament_applications[0]).toMatchObject({ partner_id: null, seeking_partner: true });
  });

  it('refuses a started league', async () => {
    const t = base();
    t.tournament_applications[0].status = 'assigned';
    t.tournament_applications[0].assigned_category_id = 'c1' as any;
    t.tournament_categories[0].status = 'live';
    const sb: any = fakeSupabase(t);
    const r: any = await joinSeeker(sb, 'e1', 'seeker', 'joiner');
    expect(r.error).toBe('Цю лігу вже розпочато');
  });

  it('a player already partnered elsewhere (migration 063) gets a clear message', async () => {
    const sb: any = fakeSupabase(base(), {
      failOn: { 'tournament_applications.update': { code: '23505', message: 'duplicate key' } },
    });
    const r: any = await joinSeeker(sb, 'e1', 'seeker', 'joiner');
    expect(r.error).toBe('Гравець уже в парі з іншим напарником');
  });
});
