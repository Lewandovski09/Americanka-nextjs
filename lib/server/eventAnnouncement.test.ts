import { describe, it, expect } from 'vitest';
import { announceBatch, announcementCaption } from './eventAnnouncement';
import { eventDateLabel } from './eventCardData';
import { fakeSupabase } from '../testing/fakeSupabase';

const SITE = 'https://americanka.test';

function world(players: number, extra: any = {}) {
  const users = Array.from({ length: players }, (_, i) => ({
    id: `u${String(i).padStart(3, '0')}`,
    approval_status: 'approved',
    telegram_user_id: 1000 + i,
    telegram_linked_at: '2026-01-01',
    gender: i % 2 ? 'F' : 'M',
  }));
  return {
    tournament_events: [
      {
        id: 'e1', name: 'Осінній кубок', format_kind: 'americanka', avp_tier: null, location: 'beach13',
        scheduled_at: '2026-10-10T07:00:00Z', status: 'scheduled',
        announced_at: null, announce_cursor: null, announce_sent: 0, announce_done_at: null,
        announce_photo_id: null, announce_channel_ok: null, ...extra.event,
      },
    ],
    tournament_categories: extra.categories || [
      { id: 'c1', event_id: 'e1', status: 'scheduled', category_label: 'Light', gender: 'M', max_participants: 8, scheduled_at: '2026-10-10T07:00:00Z' },
      { id: 'c2', event_id: 'e1', status: 'scheduled', category_label: 'Light', gender: 'F', max_participants: 8, scheduled_at: '2026-10-10T07:00:00Z' },
    ],
    tournament_players: [],
    tournament_teams: [],
    venues: [{ code: 'beach13', name: 'Пляж 13' }],
    users,
  };
}

function fakeTelegram({ photoFails = false, channelFails = false } = {}) {
  const log: any[] = [];
  return {
    log,
    trySendTelegramPhoto: async (chat: any, photo: string) => {
      log.push({ kind: 'photo', chat, photo });
      if (photoFails || (channelFails && String(chat).startsWith('@'))) return { ok: false, blocked: false, error: 'bad photo' };
      return { ok: true, blocked: false, photoId: 'FILE123' };
    },
    trySendTelegramMessageWithButtons: async (chat: any) => {
      log.push({ kind: 'text', chat });
      if (channelFails && String(chat).startsWith('@')) return { ok: false, blocked: false, error: 'not admin' };
      return { ok: true, blocked: false };
    },
    broadcastPause: async () => {},
  };
}

describe('eventDateLabel', () => {
  it('shows Kyiv time, capitalised', () => {
    const s = eventDateLabel('2026-10-10T07:00:00Z');
    expect(s.includes('10:00')).toBe(true);
    expect(s.charAt(0)).toBe(s.charAt(0).toUpperCase());
  });
});

describe('announcementCaption', () => {
  const data: any = {
    title: 'Americanka', name: 'Кубок <1>', statusLabel: 'Реєстрація відкрита', dateLabel: 'Субота',
    venue: 'Пляж 13', avpTier: 300,
    categories: [{ id: 'c', label: 'Light', genderLabel: 'Чоловіки', taken: 0, total: 8, left: 8, unit: 'гравців' }],
  };
  it('escapes names and lists the leagues', () => {
    const c = announcementCaption(data, `${SITE}/events/register/e`);
    expect(c.includes('Кубок &lt;1&gt;')).toBe(true);
    expect(c.includes('Light')).toBe(true);
    expect(c.includes('0/8 гравців, 8 вільно')).toBe(true);
  });
  it('keeps a caption under Telegram’s 1024 characters', () => {
    const many = { ...data, categories: Array.from({ length: 40 }, (_, i) => ({ ...data.categories[0], id: String(i) })) };
    expect(announcementCaption(many, SITE).length <= 1024).toBe(true);
  });
  it('the text version carries the link', () => {
    expect(announcementCaption(data, `${SITE}/r`, { withLink: true }).includes(`href="${SITE}/r"`)).toBe(true);
  });
});

describe('announceBatch', () => {
  it('posts to the channel once and reaches every player in batches', async () => {
    const sb: any = fakeSupabase(world(5));
    const tg = fakeTelegram();
    const r1: any = await announceBatch(sb, 'e1', { siteUrl: SITE, batchSize: 2, telegram: tg });
    expect(r1.done).toBe(false);
    expect(r1.channel.ok).toBe(true);
    let r: any = r1;
    for (let i = 0; i < 5 && !r.done; i++) r = await announceBatch(sb, 'e1', { siteUrl: SITE, batchSize: 2, telegram: tg });
    expect(r.done).toBe(true);
    expect(r.sent).toBe(5);
    const channelPosts = tg.log.filter((x) => String(x.chat).startsWith('@'));
    expect(channelPosts).toHaveLength(1);
    const chats = tg.log.filter((x) => !String(x.chat).startsWith('@')).map((x) => x.chat);
    expect(new Set(chats).size).toBe(5); // nobody twice
    // after the first picture, everyone gets it by its Telegram id
    expect(tg.log.filter((x) => x.kind === 'photo' && x.photo === 'FILE123').length).toBe(5);
  });

  it('a second run after it is done sends nothing', async () => {
    const sb: any = fakeSupabase(world(3));
    const tg = fakeTelegram();
    let r: any = { done: false };
    while (!r.done) r = await announceBatch(sb, 'e1', { siteUrl: SITE, telegram: tg });
    const before = tg.log.length;
    r = await announceBatch(sb, 'e1', { siteUrl: SITE, telegram: tg });
    expect(r.done).toBe(true);
    expect(tg.log.length).toBe(before);
  });

  it('a men-only tournament goes to men only', async () => {
    const w = world(6, {
      categories: [{ id: 'c1', event_id: 'e1', status: 'scheduled', category_label: 'Pro', gender: 'M', max_participants: 8 }],
    });
    const sb: any = fakeSupabase(w);
    const tg = fakeTelegram();
    let r: any = { done: false };
    while (!r.done) r = await announceBatch(sb, 'e1', { siteUrl: SITE, telegram: tg });
    expect(r.sent).toBe(3);
  });

  it('falls back to text when the picture cannot be sent', async () => {
    const sb: any = fakeSupabase(world(3));
    const tg = fakeTelegram({ photoFails: true });
    let r: any = { done: false };
    while (!r.done) r = await announceBatch(sb, 'e1', { siteUrl: SITE, telegram: tg });
    expect(r.sent).toBe(3);
    // the picture is tried once (channel), then everyone gets text straight away
    expect(tg.log.filter((x) => x.kind === 'photo').length).toBe(1);
  });

  it('a failed channel post can be retried later', async () => {
    const sb: any = fakeSupabase(world(1));
    const tg = fakeTelegram({ channelFails: true });
    let r: any = { done: false };
    while (!r.done) r = await announceBatch(sb, 'e1', { siteUrl: SITE, telegram: tg });
    expect(r.channel.ok).toBe(false);
    expect(sb.db.tournament_events[0].announce_channel_ok).toBe(false);
    const tg2 = fakeTelegram();
    r = await announceBatch(sb, 'e1', { siteUrl: SITE, telegram: tg2, retryChannel: true });
    expect(r.channel.ok).toBe(true);
    expect(tg2.log.filter((x) => String(x.chat).startsWith('@'))).toHaveLength(1);
    expect(tg2.log.filter((x) => !String(x.chat).startsWith('@'))).toHaveLength(0); // players not again
  });

  it('two runs at once do not send a batch twice', async () => {
    const sb: any = fakeSupabase(world(4));
    const tg = fakeTelegram();
    await Promise.all([
      announceBatch(sb, 'e1', { siteUrl: SITE, batchSize: 4, telegram: tg }),
      announceBatch(sb, 'e1', { siteUrl: SITE, batchSize: 4, telegram: tg }),
    ]);
    const chats = tg.log.filter((x) => !String(x.chat).startsWith('@')).map((x) => x.chat);
    expect(chats.length).toBe(new Set(chats).size);
    expect(tg.log.filter((x) => String(x.chat).startsWith('@'))).toHaveLength(1);
  });
});
