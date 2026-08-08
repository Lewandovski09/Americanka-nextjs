// Telegram Bot API transport layer.
//
// Everything that talks to api.telegram.org goes through callTelegram()
// below, so timeouts, retries and rate-limit handling exist in exactly
// one place. Callers pick between two styles:
//
//   sendTelegramMessage()    — throws on failure (use when the caller
//                              wants to react to the error)
//   trySendTelegramMessage() — never throws, reports {ok, blocked}
//                              (use for best-effort notifications)
//
// A "blocked" result means the link to that chat is dead — the user
// blocked the bot, deleted the account, or never pressed Start. The
// caller should clear the stored chat_id, otherwise every future
// broadcast keeps hammering a chat that can never receive anything.

const TELEGRAM_API_BASE = 'https://api.telegram.org';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

// Telegram tolerates roughly 30 messages/second to *different* users
// before it starts replying 429. 40ms between sends keeps us at ~25/s,
// comfortably under the limit while still pushing 1500 messages/minute.
const BROADCAST_INTERVAL_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
  }
  return token;
}

/**
 * Escape text for parse_mode: 'HTML'.
 *
 * This is not cosmetic: an unescaped "<" or "&" anywhere in the message
 * makes Telegram reject the whole call with 400, so a single admin
 * announcement containing "<" would silently reach nobody. Every value
 * interpolated into a message must go through this.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Does this Telegram error mean "this chat is permanently unreachable"?
 * 403 covers a blocked bot, a deactivated account and a kicked bot;
 * "chat not found" (400) covers a chat_id that never started the bot.
 */
function isDeadChatError(errorCode: number, description = ''): boolean {
  if (errorCode === 403) return true;
  return errorCode === 400 && /chat not found/i.test(description);
}

interface TelegramCallResult {
  ok: boolean;
  result?: unknown;
  blocked?: boolean;
  error?: string;
  errorCode?: number;
  retryAfter?: number;
}

/**
 * Single entry point for Bot API calls.
 *
 * Retries on 429 (honouring Telegram's own retry_after) and on 5xx,
 * never on other 4xx — a malformed request will stay malformed. Always
 * resolves; it does not throw, so every caller must check `.ok`.
 */
async function callTelegram(method: string, payload: Record<string, unknown>): Promise<TelegramCallResult> {
  const url = `${TELEGRAM_API_BASE}/bot${getBotToken()}/${method}`;
  let lastError = 'Unknown Telegram error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Without an explicit timeout a hanging connection would occupy the
    // serverless function until the platform's own (much longer) limit.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await response.json();

      if (data.ok) {
        return { ok: true, result: data.result };
      }

      lastError = data.description || `HTTP ${response.status}`;
      const errorCode: number = data.error_code ?? response.status;

      if (isDeadChatError(errorCode, lastError)) {
        return { ok: false, blocked: true, error: lastError, errorCode };
      }

      if (errorCode === 429) {
        // Telegram tells us exactly how long to wait — respect it
        // instead of guessing, or we just earn another 429.
        const retryAfter = data.parameters?.retry_after ?? 1;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(retryAfter * 1000);
          continue;
        }
        return { ok: false, error: lastError, errorCode, retryAfter };
      }

      if (errorCode >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 500); // linear backoff: 500ms, 1000ms
        continue;
      }

      return { ok: false, error: lastError, errorCode };
    } catch (err) {
      // Network failure or our own abort — both worth one more try.
      const e = err as { name?: string; message?: string };
      lastError = e.name === 'AbortError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : e.message || lastError;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 500);
        continue;
      }
      return { ok: false, error: lastError };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, error: lastError };
}

/**
 * Send a message, throwing on failure.
 * `text` must already be escaped by the caller where it contains
 * user- or admin-supplied values.
 */
export async function sendTelegramMessage(chatId: string | number, text: string): Promise<unknown> {
  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });

  if (!result.ok) {
    console.error('[Telegram] sendMessage failed:', chatId, result.error);
    throw new Error(result.error || 'Не вдалося надіслати повідомлення в Telegram');
  }

  return result.result;
}

export interface TrySendResult {
  ok: boolean;
  blocked: boolean;
  error?: string;
}

/**
 * Best-effort send: never throws. Returns { ok, blocked, error } so the
 * caller can clear a dead chat_id without wrapping everything in
 * try/catch.
 */
export async function trySendTelegramMessage(chatId: string | number, text: string): Promise<TrySendResult> {
  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });

  if (!result.ok) {
    console.error('[Telegram] sendMessage failed:', chatId, result.error);
  }

  return { ok: result.ok, blocked: !!result.blocked, error: result.error };
}

export interface BroadcastResult {
  sent: number;
  failed: number;
  deadChatIds: (string | number)[];
}

/**
 * Send the same message to many chats, sequentially and throttled.
 *
 * Deliberately NOT Promise.all: firing hundreds of sends at once trips
 * Telegram's rate limit, and the failures come back as 429s that get
 * logged and lost. Sequential + throttled is slower in wall-clock terms
 * but actually delivers.
 *
 * Returns { sent, failed, deadChatIds } — feed deadChatIds back into
 * the database to unlink those players.
 */
export async function broadcastTelegramMessage(chatIds: (string | number)[], text: string): Promise<BroadcastResult> {
  const deadChatIds: (string | number)[] = [];
  let sent = 0;
  let failed = 0;

  for (const chatId of chatIds) {
    const { ok, blocked } = await trySendTelegramMessage(chatId, text);

    if (ok) {
      sent++;
    } else {
      failed++;
      if (blocked) deadChatIds.push(chatId);
    }

    await sleep(BROADCAST_INTERVAL_MS);
  }

  return { sent, failed, deadChatIds };
}
