import { createAdminClient } from '@/lib/supabase/admin';
import { createVerificationCode } from '@/lib/verification';
import { sendTelegramVerificationCode, extractTelegramUsername } from '@/lib/telegram';

export async function POST(request) {
  try {
    const { telegramUsername } = await request.json();

    if (!telegramUsername || typeof telegramUsername !== 'string') {
      return Response.json({ success: false, error: 'Вкажіть Telegram нікнейм' }, { status: 400 });
    }

    const normalized = extractTelegramUsername(telegramUsername);
    const supabaseAdmin = createAdminClient();

    // Find the chat_id this username has linked by messaging our bot.
    const { data: pendingLink } = await supabaseAdmin
      .from('telegram_pending_links')
      .select('chat_id')
      .eq('telegram_username', normalized)
      .maybeSingle();

    if (!pendingLink) {
      return Response.json(
        {
          success: false,
          error:
            'Спочатку відкрийте бота @AmericankaVerifyBot в Telegram і натисніть "Start", потім спробуйте ще раз.',
          needsBotStart: true,
        },
        { status: 400 }
      );
    }

    const { code, error } = await createVerificationCode(
      supabaseAdmin,
      'telegram',
      String(pendingLink.chat_id)
    );

    if (error) {
      return Response.json({ success: false, error }, { status: 429 });
    }

    await sendTelegramVerificationCode(pendingLink.chat_id, code);

    return Response.json({ success: true, message: 'Код надіслано в Telegram' });
  } catch (err) {
    console.error('[send-phone-code] error:', err.message);
    return Response.json(
      { success: false, error: 'Не вдалося надіслати код. Спробуйте пізніше.' },
      { status: 500 }
    );
  }
}
