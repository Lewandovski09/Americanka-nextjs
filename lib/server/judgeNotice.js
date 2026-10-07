// «⚖️ Вас призначено суддею» — a personal bot message to a player when the
// admin adds them to the judging crew of a tournament, makes them the head
// judge, or the head judge hands a fresh face a game (they join the crew).
// Everything they need for the day: the tournament, date, place,
// categories, scoring, who else judges, what the role does, whom to ask.
// Never for a test tournament (070). Never throws.

import { escapeHtml, trySendTelegramMessageWithButtons } from '@/lib/telegram';
import { loadEventCardData } from '@/lib/server/eventCardData';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { appLink, browserButton } from '@/lib/server/openInApp';

/**
 * The note's text (HTML). Pure (see judgeNotice.test).
 * @param {{ data: any, isHead?: boolean, headName?: string | null, otherJudges?: string[] }} info
 * @returns {string}
 */
export function judgeNoticeText({ data, isHead = false, headName = null, otherJudges = [] }) {
  const place = [data?.venue, data?.city].filter(Boolean);
  const cats = (data?.categories || []).map((c) => {
    const tags = [c.genderLabel, c.bracketLabel].filter(Boolean);
    return `▫️ <b>${escapeHtml(c.label)}</b>${tags.length ? ` · ${escapeHtml(tags.join(' · '))}` : ''}`;
  });
  const org = data?.organizer || {};
  const contact = [org.telegram ? `✈️ ${escapeHtml(org.telegram)}` : null, org.phone ? `📞 ${escapeHtml(org.phone)}` : null].filter(Boolean);
  const crew = [
    !isHead && headName ? `🎖 Головний суддя: ${escapeHtml(headName)}` : null,
    otherJudges.length ? `👥 ${isHead ? 'Судді' : 'Також судять'}: ${escapeHtml(otherJudges.join(', '))}` : null,
  ].filter(Boolean);
  const duty = isHead
    ? 'Ви вводите рахунок, переносите ігри на інші корти і призначаєте суддю на кожну гру.'
    : 'Ви вводите рахунок ігор турніру. Яку гру судити — підкаже головний суддя або організатор.';

  return [
    isHead ? '🎖 <b>Вас призначено головним суддею!</b>' : '⚖️ <b>Вас призначено суддею турніру!</b>',
    '',
    `🏐 <b>${escapeHtml(data?.title || 'Турнір')}</b>`,
    data?.name ? `<b>${escapeHtml(data.name)}</b>` : null,
    data?.dateLabel ? `📅 ${escapeHtml(data.dateLabel)}` : null,
    place.length ? `📍 Локація: ${escapeHtml(place.join(', '))}` : null,
    data?.scoring ? `🎯 ${escapeHtml(data.scoring)}` : null,
    data?.scheduleLabel ? `📋 Розклад — ${escapeHtml(data.scheduleLabel)}` : null,
    cats.length ? '' : null,
    cats.length ? '<b>Категорії:</b>' : null,
    ...cats,
    crew.length ? '' : null,
    ...crew,
    '',
    `📝 ${duty}`,
    'У день турніру відкрийте його в застосунку — там усі ігри, корти і кнопка введення рахунку.',
    contact.length ? `\n❓ Питання до організатора: ${contact.join(' · ')}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * @param {any} supabaseAdmin
 * @param {Request} request
 * @param {{ eventId: string, userId: string }} info
 * @returns {Promise<boolean>} whether the message went out
 */
export async function notifyJudge(supabaseAdmin, request, { eventId, userId }) {
  try {
    if (!eventId || !userId) return false;
    const [data, { data: crew }, { data: user }] = await Promise.all([
      loadEventCardData(supabaseAdmin, eventId),
      supabaseAdmin.from('tournament_judges').select('user_id, is_head, users(full_name)').eq('event_id', eventId),
      supabaseAdmin.from('users').select('id, telegram_user_id, telegram_linked_at').eq('id', userId).maybeSingle(),
    ]);
    if (!data || data.isTest) return false;
    if (!user?.telegram_user_id || !user.telegram_linked_at) return false;
    const me = (crew || []).find((j) => j.user_id === userId);
    const head = (crew || []).find((j) => j.is_head && j.user_id !== userId);
    const others = (crew || [])
      .filter((j) => j.user_id !== userId && !j.is_head)
      .map((j) => j.users?.full_name)
      .filter(Boolean);
    const site = publicSiteUrl(request);
    const keyboard = site ? browserButton('🏐 Відкрити турнір', appLink(site, `/events/register/${eventId}`)) : undefined;
    const r = await trySendTelegramMessageWithButtons(
      user.telegram_user_id,
      judgeNoticeText({ data, isHead: !!me?.is_head, headName: head?.users?.full_name || null, otherJudges: others }),
      keyboard
    );
    return !!r?.ok;
  } catch (e) {
    console.error('[judge-notice]', e?.message || e);
    return false;
  }
}
