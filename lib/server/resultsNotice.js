// «🏁 Турнір завершено» — when the last category of a tournament is
// finished, the results go to the club's channel and, through the bot, to
// every participant: the winners of each category (places 1–3) and a
// button per category to its results. Like «Щойно завершився» on the home
// page. With a picture: the tournament's photo if one was added, else the
// results card (/api/og/event?kind=results).
//
// Sent once per tournament (results_announced_at, migration 074); the
// admin can send it again by hand («Надіслати результати»). Never for a
// test tournament (070). Never throws.

import { escapeHtml, trySendTelegramMessageWithButtons, trySendTelegramPhoto, broadcastPause } from '@/lib/telegram';
import { loadEventCardData } from '@/lib/server/eventCardData';
import { channelId } from '@/lib/server/eventAnnouncement';
import { appLink } from '@/lib/server/openInApp';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const G = { M: 'Ч · ', F: 'Ж · ' };
const catName = (c) => `${G[c.gender] || ''}${c.label || 'Категорія'}`;
const link = (url) => url.replace(/^https:/, 'http:'); // opens in the browser (lib/server/openInApp)
const CAPTION = 1024;

/**
 * The message (HTML). Pure (see resultsNotice.test).
 * @param {any} data — lib/server/eventCardData with { results: true }
 * @returns {string}
 */
export function resultsText(data) {
  const place = [data?.venue, data?.city].filter(Boolean).join(', ');
  const cats = (data?.categories || []).map((c) => {
    const podium = (c.podium || []).map((p) => `${MEDALS[p.place] || `${p.place}.`} ${escapeHtml(p.name)}`);
    return [`<b>${escapeHtml(catName(c))}</b>`, ...(podium.length ? podium : ['результати — у застосунку'])].join('\n');
  });
  return [
    '🏁 <b>Турнір завершено!</b>',
    `🏐 <b>${escapeHtml(data?.title || 'Турнір')}</b>${data?.name ? ` · ${escapeHtml(data.name)}` : ''}`,
    data?.dateLabel ? `📅 ${escapeHtml(data.dateLabel)}` : null,
    place ? `📍 ${escapeHtml(place)}` : null,
    '',
    cats.join('\n\n'),
    '',
    'Дякуємо всім за гру! 👏',
    '👇 Усі результати кожної категорії — кнопки нижче',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** One button per category → its results page. */
export function resultsKeyboard(data, siteUrl) {
  return {
    inline_keyboard: (data?.categories || [])
      .slice(0, 10)
      .map((c) => [{ text: `🏆 ${catName(c)} — результати`, url: link(appLink(siteUrl, `/tournaments/${c.id}`)) }]),
  };
}

/**
 * @param {any} supabaseAdmin
 * @param {string} eventId
 * @param {{ siteUrl: string | null, force?: boolean, telegram?: any }} opts
 *   force — the admin's «Надіслати ще раз» (sends even if it went out already)
 * @returns {Promise<{ skipped?: string, already?: boolean, error?: string, channel?: any, sent?: number, total?: number }>}
 */
export async function sendResultsNotice(supabaseAdmin, eventId, { siteUrl, force = false, telegram = null } = { siteUrl: null }) {
  try {
    const tg = telegram || { trySendTelegramMessageWithButtons, trySendTelegramPhoto, broadcastPause };
    if (!siteUrl) return { error: 'Невідома адреса сайту' };

    const { data: ev } = await supabaseAdmin.from('tournament_events').select('*').eq('id', eventId).maybeSingle();
    if (!ev) return { error: 'Турнір не знайдено' };
    if (ev.is_test) return { skipped: 'test' };
    if (!('results_announced_at' in ev)) return { error: 'Спершу виконайте SQL 074 у Supabase' };

    // claim — once per tournament (unless the admin sends it again)
    let claim = supabaseAdmin.from('tournament_events').update({ results_announced_at: new Date().toISOString() }).eq('id', eventId);
    if (!force) claim = claim.is('results_announced_at', null);
    const { data: claimed, error: claimError } = await claim.select('id');
    if (claimError) return { error: 'Не вдалося позначити розсилку (чи виконано SQL 074?)' };
    if (!claimed || claimed.length !== 1) return { already: true };

    const data = await loadEventCardData(supabaseAdmin, eventId, { results: true });
    if (!data || !data.categories?.length) return { channel: null, sent: 0, total: 0 };

    const text = resultsText(data);
    const keyboard = resultsKeyboard(data, siteUrl);
    const pic = { url: ev.photo_url || `${siteUrl}/api/og/event/${eventId}?kind=results&v=${Date.now()}`, id: null, failed: !tg.trySendTelegramPhoto };
    async function send(chatId) {
      if (!pic.failed && text.length <= CAPTION) {
        const r = await tg.trySendTelegramPhoto(chatId, pic.id || pic.url, text, keyboard);
        if (r?.ok) {
          if (r.photoId) pic.id = r.photoId;
          return r;
        }
        if (r?.blocked) return r;
        pic.failed = true; // the rest go as text
      }
      return tg.trySendTelegramMessageWithButtons(chatId, text, keyboard);
    }

    // 1. the channel
    let channel = null;
    const chat = channelId();
    if (chat) {
      const r = await send(chat);
      channel = { ok: !!r?.ok, error: r?.ok ? undefined : r?.error };
    }

    // 2. everyone who played (once each)
    const catIds = data.categories.map((c) => c.id);
    const [{ data: solos }, { data: teams }] = await Promise.all([
      supabaseAdmin.from('tournament_players').select('user_id').in('category_id', catIds),
      supabaseAdmin.from('tournament_teams').select('user1_id, user2_id').in('category_id', catIds),
    ]);
    const ids = [
      ...new Set([...(solos || []).map((p) => p.user_id), ...(teams || []).flatMap((t) => [t.user1_id, t.user2_id])].filter(Boolean)),
    ];
    const { data: users } = ids.length
      ? await supabaseAdmin.from('users').select('id, telegram_user_id, telegram_linked_at').in('id', ids)
      : { data: [] };
    let sent = 0;
    for (const u of users || []) {
      if (!u.telegram_user_id || !u.telegram_linked_at) continue;
      const r = await send(u.telegram_user_id);
      if (r?.ok) sent++;
      await tg.broadcastPause();
    }
    return { channel, sent, total: ids.length };
  } catch (e) {
    console.error('[results-notice]', e?.message || e);
    return { error: 'Не вдалося надіслати результати' };
  }
}
