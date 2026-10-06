// Personal Telegram notes to the app's owners (app_owners, migration 053):
// a new player registered, the schedule went out, … Never throws — a
// note that can't be sent must not break what triggered it.

import { escapeHtml, trySendTelegramMessageWithButtons } from '@/lib/telegram';

/** Sends `text` (HTML) to every owner who has the bot connected. */
export async function notifyOwners(supabaseAdmin, text, keyboard) {
  try {
    const { data: owners } = await supabaseAdmin.from('app_owners').select('user_id');
    const ids = (owners || []).map((o) => o.user_id).filter(Boolean);
    if (ids.length === 0) return 0;
    const { data: chats } = await supabaseAdmin.from('users').select('telegram_user_id, telegram_linked_at').in('id', ids);
    const targets = (chats || []).filter((c) => c.telegram_user_id && c.telegram_linked_at);
    const res = await Promise.all(targets.map((c) => trySendTelegramMessageWithButtons(c.telegram_user_id, text, keyboard)));
    return res.filter((r) => r?.ok).length;
  } catch (e) {
    console.error('[owner-notify]', e?.message || e);
    return 0;
  }
}

const GENDER = { M: 'Чоловік', F: 'Жінка' };

/** «🆕 Новий гравець» — the note's text (HTML). Pure (see ownerNotify.test). */
export function newPlayerNoticeText(p) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.login || 'Без імені';
  return [
    '🆕 <b>Новий гравець зареєструвався</b>',
    '',
    `👤 <b>${escapeHtml(name)}</b>${p.telegram_username ? ` · @${escapeHtml(p.telegram_username)}` : ''}`,
    `🔑 Логін: ${escapeHtml(p.login || '—')}`,
    [GENDER[p.gender], p.city].filter(Boolean).length ? `📍 ${escapeHtml([GENDER[p.gender], p.city].filter(Boolean).join(' · '))}` : null,
    p.requested_category ? `🎯 Бажана категорія: <b>${escapeHtml(p.requested_category)}</b>` : null,
    '',
    '⏳ Чекає підтвердження рейтингу в адмін-панелі.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}
