// Telegram-based verification — completely free, no per-message
// cost, and no sender-name approval process like TurboSMS requires.
//
// How it works:
// 1. User enters their Telegram @username during registration.
// 2. We can't message a user who hasn't started a conversation with
//    our bot first (Telegram API restriction) — so the UI must
//    instruct them to open the bot and press "Start" first.
// 3. Once they've pressed Start, Telegram sends us an update
//    containing their chat_id, which we store. After that, we can
//    push messages (including verification codes) to that chat_id
//    at any time, for free.

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Extracts a clean, lowercase Telegram username from any of the
 * formats a user might paste in: "username", "@username",
 * "https://t.me/username", or "t.me/username".
 */
export function extractTelegramUsername(input) {
  if (!input) return '';
  let value = input.trim();

  // Strip a full or partial t.me URL down to just the username part.
  const tmeMatch = value.match(/t\.me\/([a-zA-Z0-9_]+)/i);
  if (tmeMatch) {
    value = tmeMatch[1];
  }

  // Strip a leading @ if present.
  value = value.replace(/^@/, '');

  return value.toLowerCase();
}

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
  }
  return token;
}

/**
 * Send a plain text message to a Telegram chat_id.
 */
export async function sendTelegramMessage(chatId, text) {
  const token = getBotToken();
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    console.error('[Telegram] sendMessage failed:', JSON.stringify(data));
    throw new Error(data.description || 'Не вдалося надіслати повідомлення в Telegram');
  }

  return data;
}

/**
 * Send a 4-digit verification code via Telegram, styled like an SMS.
 */
export async function sendTelegramVerificationCode(chatId, code) {
  const text =
    `★ <b>AMERICANKA</b> ★\n` +
    `Пляж 13 · Станція Фонтана · Одеса\n\n` +
    `Ваш код підтвердження: <b>${code}</b>\n\n` +
    `Код дійсний 5 хвилин. Якщо ви не реєструвалися — ігноруйте це повідомлення.`;

  return sendTelegramMessage(chatId, text);
}

/**
 * Look up a player's Telegram chat_id by their @username.
 * This relies on the chat_id having been captured previously via
 * the bot's webhook (see app/api/telegram/webhook/route.js) — we
 * cannot resolve a chat_id from a username through the Bot API
 * directly without that prior interaction.
 */
export async function findChatIdByUsername(supabaseAdmin, telegramUsername) {
  const normalized = extractTelegramUsername(telegramUsername);

  const { data, error } = await supabaseAdmin
    .from('players')
    .select('telegram_chat_id')
    .eq('telegram_username', normalized)
    .maybeSingle();

  if (error) throw error;
  return data?.telegram_chat_id ?? null;
}
