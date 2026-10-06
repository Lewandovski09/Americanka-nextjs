// «📋 Розклад готовий» — when the admin starts the tournament
// («Запустити»), the schedule goes to the club's channel and, through the
// bot, to every participant: their league and their first game. Sent
// once per tournament (schedule_announced_at, migration 068).

import { escapeHtml, trySendTelegramMessageWithButtons, broadcastPause } from '@/lib/telegram';
import { loadEventCardData } from '@/lib/server/eventCardData';
import { channelId } from '@/lib/server/eventAnnouncement';
import { appLink } from '@/lib/server/openInApp';
import { CLUB_TZ } from '@/lib/dates';

const G = { M: 'Ч · ', F: 'Ж · ' };
const catName = (c) => `${G[c.gender] || ''}${c.category_label || c.name || 'Категорія'}`;
const nameOf = (u) => [u?.first_name || u?.full_name, u?.first_name ? u?.last_name : null].filter(Boolean).join(' ') || '?';

const link = (url) => url.replace(/^https:/, 'http:'); // opens in the browser (lib/server/openInApp)

/** The first game of `userId` among `matches` (already sorted), or null. */
export function firstGameOf(matches, userId) {
  return (
    matches.find((m) => (m.team_a_players || []).includes(userId) || (m.team_b_players || []).includes(userId)) || null
  );
}

/** The channel post (HTML). Pure. */
export function scheduleChannelText(data, cats) {
  return [
    '📋 <b>Розклад готовий!</b>',
    `🏐 <b>${escapeHtml(data.title)}</b>${data.name ? ` · ${escapeHtml(data.name)}` : ''}`,
    data.dateLabel ? `📅 ${escapeHtml(data.dateLabel)}` : null,
    data.venue ? `📍 Локація: ${escapeHtml([data.venue, data.city].filter(Boolean).join(', '))}` : null,
    '',
    ...cats.map((c) => `▫️ <b>${escapeHtml(catName(c))}</b> — ${c.count} ${c.isPair ? 'пар' : 'учасників'}`),
    '',
    '👇 Розклад кожної категорії — кнопки нижче',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** One participant's note (HTML). Pure. */
export function scheduleParticipantText(data, cat, game, people) {
  const lines = [
    '📋 <b>Розклад готовий!</b>',
    `🏐 ${escapeHtml(data.title)}${data.name ? ` · ${escapeHtml(data.name)}` : ''} — <b>${escapeHtml(catName(cat))}</b>`,
    data.dateLabel ? `📅 ${escapeHtml(data.dateLabel)}` : null,
    data.venue ? `📍 ${escapeHtml([data.venue, data.city].filter(Boolean).join(', '))}` : null,
  ];
  if (game) {
    const me = game.me;
    const mine = (game.team_a_players || []).includes(me) ? game.team_a_players : game.team_b_players;
    const theirs = mine === game.team_a_players ? game.team_b_players : game.team_a_players;
    const partner = (mine || []).filter((id) => id && id !== me).map((id) => nameOf(people.get(id)));
    const rivals = (theirs || []).filter(Boolean).map((id) => nameOf(people.get(id)));
    const when = game.scheduled_at
      ? new Date(game.scheduled_at).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit', timeZone: CLUB_TZ })
      : null;
    lines.push(
      '',
      `🎾 <b>Ваша перша гра:</b> ${[game.round_number ? `тур ${game.round_number}` : null, game.court ? `корт ${game.court}` : null, when ? `о ${when}` : null]
        .filter(Boolean)
        .join(' · ')}`,
      partner.length ? `🤝 У парі з: ${escapeHtml(partner.join(', '))}` : null,
      rivals.length ? `⚔️ Проти: ${escapeHtml(rivals.join(' / '))}` : null
    );
  }
  lines.push('', '👇 Увесь розклад — кнопка нижче');
  return lines.filter((l) => l !== null).join('\n');
}

/**
 * Sends it — once. Returns { already } | { channel, sent, total }.
 * `telegram` — only tests pass their own senders.
 * @param {any} supabaseAdmin
 * @param {string} eventId
 * @param {{ siteUrl: string, telegram?: any }} opts
 * @returns {Promise<any>}
 */
export async function sendScheduleNotice(supabaseAdmin, eventId, { siteUrl, telegram = null } = {}) {
  const tg = telegram || { trySendTelegramMessageWithButtons, broadcastPause };

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('tournament_events')
    .update({ schedule_announced_at: new Date().toISOString() })
    .eq('id', eventId)
    .is('schedule_announced_at', null)
    .select('id');
  if (claimError) return { error: 'Не вдалося позначити розсилку (чи виконано SQL 068?)' };
  if (!claimed || claimed.length !== 1) return { already: true };

  const [data, { data: cats }] = await Promise.all([
    loadEventCardData(supabaseAdmin, eventId),
    supabaseAdmin
      .from('tournament_categories')
      .select('id, name, category_label, gender, status')
      .eq('event_id', eventId)
      .in('status', ['live', 'done'])
      .order('gender', { ascending: true })
      .order('category_label', { ascending: true }),
  ]);
  if (!data || !cats || cats.length === 0) return { channel: null, sent: 0, total: 0 };
  const catIds = cats.map((c) => c.id);

  const [{ data: solos }, { data: teams }, { data: matches }] = await Promise.all([
    supabaseAdmin.from('tournament_players').select('category_id, user_id').in('category_id', catIds),
    supabaseAdmin.from('tournament_teams').select('category_id, user1_id, user2_id').in('category_id', catIds),
    supabaseAdmin
      .from('tournament_matches')
      .select('category_id, round_number, order_index, court, scheduled_at, team_a_players, team_b_players')
      .in('category_id', catIds)
      .order('round_number', { ascending: true })
      .order('order_index', { ascending: true }),
  ]);

  // who plays where
  const where = new Map(); // userId → categoryId
  const counts = new Map();
  (solos || []).forEach((p) => {
    if (!p.user_id) return;
    where.set(p.user_id, p.category_id);
    counts.set(p.category_id, (counts.get(p.category_id) || 0) + 1);
  });
  (teams || []).forEach((t) => {
    [t.user1_id, t.user2_id].filter(Boolean).forEach((id) => where.set(id, t.category_id));
    counts.set(t.category_id, (counts.get(t.category_id) || 0) + 1);
  });
  const isPair = !!data.isPair;
  const ids = [...where.keys()];
  const allIds = [...new Set([...ids, ...(matches || []).flatMap((m) => [...(m.team_a_players || []), ...(m.team_b_players || [])])])].filter(Boolean);
  const { data: users } = allIds.length
    ? await supabaseAdmin.from('users').select('id, first_name, last_name, full_name, telegram_user_id, telegram_linked_at').in('id', allIds)
    : { data: [] };
  const people = new Map((users || []).map((u) => [u.id, u]));

  // 1. the channel
  let channel = null;
  const chat = channelId();
  if (chat) {
    const rows = cats.slice(0, 8).map((c) => [{ text: `📋 ${catName(c)}`, url: link(appLink(siteUrl, `/tournaments/${c.id}`)) }]);
    const r = await tg.trySendTelegramMessageWithButtons(
      chat,
      scheduleChannelText(
        data,
        cats.map((c) => ({ ...c, count: counts.get(c.id) || 0, isPair }))
      ),
      { inline_keyboard: rows }
    );
    channel = { ok: !!r?.ok, error: r?.ok ? undefined : r?.error };
  }

  // 2. every participant, with their first game
  const byCat = new Map(cats.map((c) => [c.id, c]));
  let sent = 0;
  for (const userId of ids) {
    const u = people.get(userId);
    if (!u?.telegram_user_id || !u.telegram_linked_at) continue;
    const cat = byCat.get(where.get(userId));
    if (!cat) continue;
    const g = firstGameOf((matches || []).filter((m) => m.category_id === cat.id), userId);
    const text = scheduleParticipantText(data, cat, g ? { ...g, me: userId } : null, people);
    const kb = { inline_keyboard: [[{ text: '📋 Мій розклад', url: link(appLink(siteUrl, `/tournaments/${cat.id}`)) }]] };
    const r = await tg.trySendTelegramMessageWithButtons(u.telegram_user_id, text, kb);
    if (r?.ok) sent++;
    await tg.broadcastPause();
  }
  return { channel, sent, total: ids.length };
}
