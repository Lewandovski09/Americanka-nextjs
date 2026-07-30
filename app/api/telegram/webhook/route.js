// Telegram webhook — the single place Telegram talks to us.
//
// It does three jobs:
//   1. Links a browser session to a Telegram account, via the one-time
//      nonce carried in t.me/<bot>?start=<nonce>.
//   2. Unlinks players who block the bot (my_chat_member).
//   3. Refreshes a known player's chat_id/username on any interaction.
//
// Identity comes from `from.id` (immutable), never from @username.

import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { trySendTelegramMessage, escapeHtml } from '@/lib/telegram';

const UNIQUE_VIOLATION = '23505';

// This URL is public, so "the request arrived here" proves nothing on
// its own. Telegram echoes back the secret_token we registered via
// setWebhook in a header on every single update — comparing it is the
// only thing that distinguishes a real update from a forged one.
function isFromTelegram(request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expected) {
    // Not configured (yet) — let the update through so a missing env
    // var can't take the bot down, but make the gap loud rather than
    // running an unauthenticated webhook silently.
    console.error(
      '[Telegram webhook] TELEGRAM_WEBHOOK_SECRET is not set — updates are NOT authenticated'
    );
    return true;
  }

  const received = Buffer.from(request.headers.get('x-telegram-bot-api-secret-token') || '');
  const secret = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch, so guard it first.
  return received.length === secret.length && timingSafeEqual(received, secret);
}

/**
 * Telegram re-delivers an update if we don't answer fast enough, so the
 * same /start can legitimately arrive twice. The primary key on
 * update_id turns "already handled" into an insert conflict.
 */
async function isDuplicateUpdate(supabaseAdmin, updateId) {
  if (typeof updateId !== 'number') return false;

  const { error } = await supabaseAdmin
    .from('telegram_processed_updates')
    .insert({ update_id: updateId });

  if (!error) return false;

  if (error.code === UNIQUE_VIOLATION) {
    console.log('[Telegram webhook] Skipping duplicate update:', updateId);
    return true;
  }

  // Bookkeeping failure must not cost us a real update — process it.
  console.error('[Telegram webhook] Dedupe insert failed:', error.message);
  return false;
}

/**
 * A user blocking the bot arrives as my_chat_member, not as a message.
 * Handling it is what keeps the database honest: otherwise we only
 * discover a dead chat when a send fails, so every broadcast forever
 * pays for people who left long ago.
 */
async function handleMembershipChange(supabaseAdmin, membership) {
  const chatId = membership.chat?.id;
  const status = membership.new_chat_member?.status;

  // 'kicked' means blocked by the user, 'left' covers a deleted chat.
  // Anything else means the link is fine, and a fresh /start re-links.
  if (!chatId || (status !== 'kicked' && status !== 'left')) return;

  const { error } = await supabaseAdmin
    .from('players')
    .update({ telegram_chat_id: null, telegram_linked_at: null })
    .eq('telegram_chat_id', chatId);

  if (error) {
    console.error('[Telegram webhook] Failed to unlink blocked chat:', error.message);
  } else {
    console.log('[Telegram webhook] Unlinked chat after block/leave:', chatId);
  }
}

/**
 * Consume a one-time nonce and attach this Telegram account to the
 * player who started registration in the browser.
 */
async function linkByNonce(supabaseAdmin, nonce, from, chatId) {
  const { data: link, error } = await supabaseAdmin
    .from('telegram_links')
    .select('player_id, expires_at, linked_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) {
    console.error('[Telegram webhook] Link lookup failed:', error.message);
    return { status: 'error' };
  }

  if (!link) return { status: 'not_found' };
  if (link.linked_at) return { status: 'already' };
  if (new Date(link.expires_at) < new Date()) return { status: 'expired' };

  const { error: playerError } = await supabaseAdmin
    .from('players')
    .update({
      telegram_chat_id: chatId,
      telegram_user_id: from.id,
      telegram_username: from.username ? from.username.toLowerCase() : null,
      telegram_linked_at: new Date().toISOString(),
    })
    .eq('id', link.player_id);

  if (playerError) {
    // telegram_user_id / telegram_chat_id are unique: this Telegram
    // account already belongs to a different player.
    if (playerError.code === UNIQUE_VIOLATION) return { status: 'taken' };
    console.error('[Telegram webhook] Failed to attach telegram to player:', playerError.message);
    return { status: 'error' };
  }

  await supabaseAdmin
    .from('telegram_links')
    .update({ chat_id: chatId, telegram_user_id: from.id, linked_at: new Date().toISOString() })
    .eq('nonce', nonce);

  return { status: 'linked' };
}

/**
 * Keep a already-linked player's chat_id and username fresh.
 *
 * Matching is by telegram_user_id (immutable). The chat_id fallback
 * exists only to backfill players who were linked before
 * telegram_user_id existed — it trusts a chat_id we already stored, so
 * it can't be used to hijack someone else's row the way the old
 * match-by-@username could.
 */
async function refreshKnownPlayer(supabaseAdmin, from, chatId) {
  const username = from.username ? from.username.toLowerCase() : null;

  const { data: byUserId } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('telegram_user_id', from.id)
    .maybeSingle();

  if (byUserId) {
    await supabaseAdmin
      .from('players')
      .update({ telegram_chat_id: chatId, telegram_username: username })
      .eq('id', byUserId.id);
    return true;
  }

  const { data: byChatId } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .is('telegram_user_id', null)
    .maybeSingle();

  if (byChatId) {
    await supabaseAdmin
      .from('players')
      .update({ telegram_user_id: from.id, telegram_username: username })
      .eq('id', byChatId.id);
    return true;
  }

  return false;
}

export async function POST(request) {
  if (!isFromTelegram(request)) {
    console.error('[Telegram webhook] Rejected an update with a missing/incorrect secret token');
    return Response.json({ ok: false }, { status: 401 });
  }

  const update = await request.json();
  const supabaseAdmin = createAdminClient();

  if (await isDuplicateUpdate(supabaseAdmin, update.update_id)) {
    return Response.json({ ok: true });
  }

  if (update.my_chat_member) {
    await handleMembershipChange(supabaseAdmin, update.my_chat_member);
    return Response.json({ ok: true });
  }

  const message = update.message;
  if (!message || !message.chat || !message.from) {
    return Response.json({ ok: true }); // ignore other update types
  }

  const chatId = message.chat.id;
  const from = message.from;
  const firstName = escapeHtml(from.first_name || '');

  // "/start <nonce>" — the deep link from the registration screen.
  const startPayload = message.text?.startsWith('/start ')
    ? message.text.slice('/start '.length).trim()
    : null;

  if (startPayload) {
    const { status } = await linkByNonce(supabaseAdmin, startPayload, from, chatId);

    const replies = {
      linked:
        `★ <b>Готово, ${firstName}!</b> ★\n\n` +
        'Ваш Telegram підключено. Заявку відправлено адміну — щойно він підтвердить ваш рейтинг, ' +
        'повідомлення прийде сюди.\n\nМожна повертатися у застосунок.',
      already: 'Цей Telegram уже підключено ✅ Можна повертатися у застосунок.',
      expired:
        'Посилання застаріло ⏳\n\nВідкрийте застосунок і натисніть «Підключити Telegram» ще раз — ' +
        'зʼявиться нове посилання.',
      not_found:
        'Не вдалося розпізнати посилання 🤔\n\nВідкрийте застосунок і натисніть ' +
        '«Підключити Telegram» — там буде актуальне посилання.',
      taken:
        'Цей Telegram уже привʼязаний до іншого акаунта AMERICANKA.\n\n' +
        'Якщо це ваш другий акаунт — напишіть адміну.',
      error: 'Технічна помилка на нашому боці 😔 Спробуйте ще раз через хвилину.',
    };

    await trySendTelegramMessage(chatId, replies[status] || replies.error);
    return Response.json({ ok: true });
  }

  // Any other interaction: keep a known player's link fresh, and give
  // an unknown chat a useful pointer instead of silence.
  const known = await refreshKnownPlayer(supabaseAdmin, from, chatId);

  if (message.text === '/start') {
    await trySendTelegramMessage(
      chatId,
      known
        ? `★ <b>Вітаємо, ${firstName}!</b> ★\n\nВаш Telegram уже підключено — тут ви будете отримувати новини та підтвердження рейтингу.`
        : '★ <b>Вітаємо в AMERICANKA!</b> ★\n\nЩоб підключити Telegram, зареєструйтесь у застосунку і натисніть кнопку «Підключити Telegram» — вона відкриє цей чат з правильним посиланням.'
    );
  }

  return Response.json({ ok: true });
}
