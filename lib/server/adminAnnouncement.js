// The admin's «Надіслати оголошення» (admin panel → Сервіс) as Telegram
// shows it — the same text in the club's channel and in every bot chat.
// Admin-typed text goes through escapeHtml: a stray «<» would otherwise
// make Telegram reject every send with a 400.

import { escapeHtml } from '@/lib/telegram';

/**
 * @param {string} title
 * @param {string} body
 * @returns {string}
 */
export function announcementText(title, body) {
  return `📢 <b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`;
}
