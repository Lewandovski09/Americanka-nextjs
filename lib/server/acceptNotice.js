// «✅ Вашу заявку прийнято» — a personal bot message to a player (and
// their partner) when the admin places their application into a league
// (or into its reserve), and when the admin enters them by hand. Never
// for a test tournament (070). Never throws.

import { escapeHtml, trySendTelegramMessageWithButtons } from '@/lib/telegram';
import { eventDateLabel } from '@/lib/server/eventCardData';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { appLink, browserButton } from '@/lib/server/openInApp';

const G = { M: 'Ч · ', F: 'Ж · ' };

/**
 * The note's text (HTML). Pure (see acceptNotice.test).
 * @param {{ event: any, category: any, reserve?: boolean, partnerName?: string | null }} info
 * @returns {string}
 */
export function acceptNoticeText({ event, category, reserve = false, partnerName = null }) {
  const cat = `${G[category?.gender] || ''}${category?.category_label || category?.name || 'Категорія'}`;
  return [
    reserve ? '🟡 <b>Вашу заявку прийнято — поки в резерв</b>' : '✅ <b>Вашу заявку прийнято!</b>',
    '',
    `🏐 Турнір: <b>${escapeHtml(event?.name || 'Турнір')}</b>`,
    event?.scheduled_at ? `📅 ${escapeHtml(eventDateLabel(event.scheduled_at))}` : null,
    `🏷 Категорія: <b>${escapeHtml(cat)}</b>`,
    partnerName ? `🤝 Напарник: ${escapeHtml(partnerName)}` : null,
    reserve ? '\nЯкщо в категорії звільниться місце, вас переведуть до складу — прийде повідомлення.' : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * @param {any} supabaseAdmin
 * @param {Request} request
 * @param {{ eventId: string, categoryId: string, userIds: string[], reserve?: boolean }} info
 */
export async function notifyAccepted(supabaseAdmin, request, { eventId, categoryId, userIds, reserve = false }) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (ids.length === 0) return 0;
    const [{ data: event }, { data: category }, { data: people }] = await Promise.all([
      supabaseAdmin.from('tournament_events').select('*').eq('id', eventId).maybeSingle(),
      supabaseAdmin.from('tournament_categories').select('id, name, category_label, gender').eq('id', categoryId).maybeSingle(),
      supabaseAdmin.from('users').select('id, full_name, telegram_user_id, telegram_linked_at').in('id', ids),
    ]);
    if (!event || event.is_test) return 0;
    const site = publicSiteUrl(request);
    const keyboard = site ? browserButton('🏐 Відкрити турнір', appLink(site, `/events/register/${eventId}`)) : undefined;
    let sent = 0;
    for (const u of people || []) {
      if (!u.telegram_user_id || !u.telegram_linked_at) continue;
      const partner = (people || []).find((x) => x.id !== u.id);
      const r = await trySendTelegramMessageWithButtons(
        u.telegram_user_id,
        acceptNoticeText({ event, category, reserve, partnerName: partner?.full_name || null }),
        keyboard
      );
      if (r?.ok) sent++;
    }
    return sent;
  } catch (e) {
    console.error('[accept-notice]', e?.message || e);
    return 0;
  }
}
