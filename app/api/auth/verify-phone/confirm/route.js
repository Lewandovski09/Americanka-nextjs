import { createAdminClient } from '@/lib/supabase/admin';
import { verifyCode } from '@/lib/verification';
import { extractTelegramUsername } from '@/lib/telegram';

export async function POST(request) {
  const { telegramUsername, code } = await request.json();

  if (!telegramUsername || !code) {
    return Response.json({ success: false, error: 'Відсутні дані' }, { status: 400 });
  }

  const normalized = extractTelegramUsername(telegramUsername);
  const supabaseAdmin = createAdminClient();

  const { data: pendingLink } = await supabaseAdmin
    .from('telegram_pending_links')
    .select('chat_id')
    .eq('telegram_username', normalized)
    .maybeSingle();

  if (!pendingLink) {
    return Response.json(
      { success: false, error: 'Telegram не підключено. Спочатку запросіть код.' },
      { status: 400 }
    );
  }

  const result = await verifyCode(supabaseAdmin, 'telegram', String(pendingLink.chat_id), code);
  return Response.json(result);
}
