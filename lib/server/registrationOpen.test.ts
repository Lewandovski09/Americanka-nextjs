import { describe, it, expect } from 'vitest';
import { dueOpenings, runOpenAnnouncements } from './registrationOpen';
import { fakeSupabase } from '../testing/fakeSupabase';

const SITE = 'https://americanka.test';
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

function world(eventExtra: any = {}, players = 3) {
  return {
    tournament_events: [
      {
        id: 'e1', name: 'Кубок', format_kind: 'americanka', avp_tier: null, location: 'beach13',
        scheduled_at: '2026-10-10T07:00:00.000Z', status: 'scheduled', registration_open: true,
        registration_opens_at: iso(NOW - 5 * 60_000), entry_fee: 300,
        announced_at: iso(NOW - 24 * 3600_000), announce_done_at: iso(NOW - 24 * 3600_000), announce_sent: players,
        open_announced_at: null, open_announce_cursor: null, open_announce_sent: 0, open_announce_done_at: null,
        open_announce_photo_id: null, open_announce_channel_ok: null,
        ...eventExtra,
      },
    ],
    tournament_categories: [
      { id: 'c1', event_id: 'e1', status: 'scheduled', category_label: 'Light', gender: 'M', max_participants: 8, scheduled_at: '2026-10-10T07:00:00.000Z' },
    ],
    tournament_players: [],
    tournament_teams: [],
    venues: [{ code: 'beach13', name: 'Пляж 13' }],
    users: Array.from({ length: players }, (_, i) => ({
      id: `u${i}`, approval_status: 'approved', telegram_user_id: 100 + i, telegram_linked_at: '2026-01-01', gender: 'M',
    })),
  };
}

function tg() {
  const log: any[] = [];
  return {
    log,
    fetchCardPng: async (url: string) => (log.push({ kind: 'draw', url }), { bytes: new Uint8Array([1]) }),
    trySendTelegramPhotoFile: async (chat: any, _b: any, caption: string, kb: any) => (log.push({ kind: 'upload', chat, caption, kb }), { ok: true, photoId: 'P1' }),
    trySendTelegramPhoto: async (chat: any, _p: any, caption: string, kb: any) => (log.push({ kind: 'photo', chat, caption, kb }), { ok: true, photoId: 'P1' }),
    trySendTelegramMessageWithButtons: async (chat: any) => (log.push({ kind: 'text', chat }), { ok: true }),
    broadcastPause: async () => {},
  };
}

describe('dueOpenings', () => {
  it('finds an announced tournament whose opening has come', async () => {
    const sb: any = fakeSupabase(world());
    expect((await dueOpenings(sb, NOW)).map((e: any) => e.id)).toEqual(['e1']);
  });
  it('not before the opening', async () => {
    const sb: any = fakeSupabase(world({ registration_opens_at: iso(NOW + 60_000) }));
    expect(await dueOpenings(sb, NOW)).toEqual([]);
  });
  it('not when it was announced only after the opening (it already said «відкрита»)', async () => {
    const sb: any = fakeSupabase(world({ announced_at: iso(NOW - 60_000) }));
    expect(await dueOpenings(sb, NOW)).toEqual([]);
  });
  it('also when never announced (069) — after 90 s of grace', async () => {
    let sb: any = fakeSupabase(world({ announced_at: null }));
    expect((await dueOpenings(sb, NOW)).map((e: any) => e.id)).toEqual(['e1']);
    sb = fakeSupabase(world({ announced_at: null, registration_opens_at: iso(NOW - 30_000) }));
    expect(await dueOpenings(sb, NOW)).toEqual([]);
  });
  it('not when closed by the admin or by time, or already done', async () => {
    for (const extra of [{ registration_open: false }, { open_announce_done_at: iso(NOW) }, { registration_closes_at: iso(NOW - 1000) }]) {
      const sb: any = fakeSupabase(world(extra));
      expect(await dueOpenings(sb, NOW)).toEqual([]);
    }
  });
});

describe('runOpenAnnouncements', () => {
  it('«Заявки приймаються» goes to the channel and every player, once', async () => {
    const sb: any = fakeSupabase(world());
    const t = tg();
    const r1 = await runOpenAnnouncements(sb, { siteUrl: SITE, telegram: t, now: NOW });
    expect(r1[0].done).toBe(true);
    expect(r1[0].sent).toBe(3);
    const chats = t.log.filter((x) => x.chat != null).map((x) => x.chat);
    expect(chats.filter((c) => String(c).startsWith('@'))).toHaveLength(1);
    expect(new Set(chats.filter((c) => !String(c).startsWith('@'))).size).toBe(3);
    const first = t.log.find((x) => x.caption);
    expect(first.caption.includes('Заявки приймаються')).toBe(true);
    expect(first.caption.includes('300 грн з гравця')).toBe(true);
    expect(first.kb.inline_keyboard[0][0].text).toBe('📝 Записатися');
    // the poster, not the small card
    expect(t.log.find((x) => x.kind === 'draw').url.includes('/api/og/poster/e1')).toBe(true);
    // the first announcement's bookkeeping is untouched
    expect(sb.db.tournament_events[0].announce_sent).toBe(3);

    const before = t.log.length;
    const r2 = await runOpenAnnouncements(sb, { siteUrl: SITE, telegram: t, now: NOW });
    expect(r2).toEqual([]);
    expect(t.log.length).toBe(before);
  });
});

describe('test tournaments (070)', () => {
  it('never get «Заявки приймаються»', async () => {
    const sb: any = fakeSupabase(world({ is_test: true }));
    expect(await dueOpenings(sb, NOW)).toEqual([]);
  });
});
