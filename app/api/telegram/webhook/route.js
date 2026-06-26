// Telegram webhook — Telegram calls this URL whenever someone
// interacts with our bot (e.g. presses "Start" or sends a message).
// We use this single signal to learn the user's chat_id, which we
// then need in order to push them verification codes.

import { createAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(request) {
  const update = await request.json();

  const message = update.message;
  if (!message || !message.chat || !message.from) {
    return Response.json({ ok: true }); // ignore non-message updates
  }

  const chatId = message.chat.id;
  const username = message.from.username; // may be undefined if user has no @username set

  if (!username) {
    // We can't link this chat to a player without a username, since
    // that's what the player typed into our registration form.
    return Response.json({ ok: true });
  }

  const supabaseAdmin = createAdminClient();

  // Store/refresh the chat_id for any player row that was registered
  // with this Telegram username, whether or not they're approved yet.
  const { error } = await supabaseAdmin
    .from('players')
    .update({ telegram_chat_id: chatId })
    .eq('telegram_username', username.toLowerCase());

  if (error) {
    console.error('[Telegram webhook] Failed to link chat_id:', error.message);
  }

  // Also store it in a lightweight pending-links table so registration
  // (which happens BEFORE the players row exists, during the
  // verification step) can immediately pick up the chat_id too.
  await supabaseAdmin
    .from('telegram_pending_links')
    .upsert({ telegram_username: username.toLowerCase(), chat_id: chatId, updated_at: new Date().toISOString() });

  // Welcome message, only for the initial /start (not every message
  // the user sends afterwards) — guides them back to the app to
  // request the code.
  const isStartCommand = message.text === '/start';
  if (isStartCommand) {
    try {
      await sendTelegramMessage(
        chatId,
        '★ <b>Вітаємо в AMERICANKA!</b> ★\n\n' +
          'Тепер поверніться у застосунок і натисніть «Отримати код» — код прийде сюди, в Telegram.'
      );
    } catch (e) {
      console.error('[Telegram webhook] Failed to send welcome message:', e.message);
      // Non-fatal — the chat_id link itself already succeeded above.
    }
  }

  return Response.json({ ok: true });
}
