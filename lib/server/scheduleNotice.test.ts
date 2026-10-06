import { describe, it, expect } from 'vitest';
import { sendScheduleNotice, firstGameOf, scheduleParticipantText } from './scheduleNotice';
import { fakeSupabase } from '../testing/fakeSupabase';

const SITE = 'https://americanka.test';

function world() {
  const users = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id, first_name: id.toUpperCase(), last_name: 'Тест', telegram_user_id: 100 + i, telegram_linked_at: i === 3 ? null : '2026-01-01',
  }));
  return {
    tournament_events: [{ id: 'e1', name: 'Кубок', format_kind: 'americanka', location: 'beach13', scheduled_at: '2026-10-10T07:00:00.000Z', status: 'live', schedule_announced_at: null }],
    tournament_categories: [{ id: 'c1', event_id: 'e1', status: 'live', category_label: 'Light', gender: 'M', max_participants: 8, scheduled_at: '2026-10-10T07:00:00.000Z' }],
    tournament_players: users.map((u) => ({ category_id: 'c1', user_id: u.id })),
    tournament_teams: [],
    tournament_matches: [
      { category_id: 'c1', round_number: 1, order_index: 0, court: 2, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'] },
      { category_id: 'c1', round_number: 2, order_index: 1, court: 1, team_a_players: ['a', 'c'], team_b_players: ['b', 'd'] },
    ],
    venues: [{ code: 'beach13', name: 'Пляж 13' }],
    users,
  };
}

function tg() {
  const log: any[] = [];
  return {
    log,
    trySendTelegramMessageWithButtons: async (chat: any, text: string, kb: any) => (log.push({ chat, text, kb }), { ok: true }),
    trySendTelegramPhoto: async (chat: any, photo: string, text: string, kb: any) => (log.push({ chat, photo, text, kb }), { ok: true, photoId: 'PH1' }),
    broadcastPause: async () => {},
  };
}

describe('sendScheduleNotice', () => {
  it('goes to the channel and every participant with Telegram — once', async () => {
    const sb: any = fakeSupabase(world());
    const t = tg();
    const r: any = await sendScheduleNotice(sb, 'e1', { siteUrl: SITE, telegram: t });
    expect(r.channel.ok).toBe(true);
    expect(r.sent).toBe(3); // d has no Telegram
    const ch = t.log.find((x) => String(x.chat).startsWith('@'));
    expect(ch.text.includes('Розклад готовий')).toBe(true);
    expect(ch.kb.inline_keyboard[0][0].url).toBe('http://americanka.test/open?to=%2Ftournaments%2Fc1');
    const a = t.log.find((x) => x.chat === 100);
    expect(a.text.includes('тур 1 · корт 2')).toBe(true);
    expect(a.text.includes('У парі з: B Тест')).toBe(true);
    expect(a.text.includes('Проти: C Тест / D Тест')).toBe(true);

    const again: any = await sendScheduleNotice(sb, 'e1', { siteUrl: SITE, telegram: t });
    expect(again.already).toBe(true);
    // with the app's picture: the card URL first, then its Telegram id
    expect(String(t.log[0].photo).includes('/api/og/event/e1')).toBe(true);
    expect(t.log.slice(1).every((x) => x.photo === 'PH1')).toBe(true);
    expect(t.log.length).toBe(4);
  });
});

describe('firstGameOf', () => {
  it('finds the first game a player is in', () => {
    const ms = world().tournament_matches;
    expect(firstGameOf(ms, 'c')?.round_number).toBe(1);
    expect(firstGameOf(ms, 'zz')).toBe(null);
  });
  it('a participant note without a game still reads well', () => {
    const t = scheduleParticipantText({ title: 'Americanka', name: null, dateLabel: 'Субота', venue: 'Пляж 13' }, { gender: 'F', category_label: 'Pro' }, null, new Map());
    expect(t.includes('Ж · Pro')).toBe(true);
  });
});
