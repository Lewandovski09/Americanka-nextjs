import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { broadcastTelegramMessage, escapeHtml } from '@/lib/telegram';

export async function POST(request) {
  const { title, body } = await request.json();

  if (!title?.trim() || !body?.trim()) {
    return Response.json({ success: false, error: "Заповніть заголовок і текст" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: caller } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();

  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може надсилати оголошення' }, { status: 403 });
  }

  const { data: notification, error } = await supabaseAdmin
    .from('admin_notifications')
    .insert({ title, body, created_by: authUser.user.id })
    .select()
    .single();

  if (error) {
    console.error('[send-notification] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося надіслати оголошення' }, { status: 500 });
  }

  // Best-effort push to everyone's Telegram too — failures here
  // don't fail the request, since the in-app notification feed
  // (admin_notifications table) is the source of truth.
  const { data: allPlayers, error: playersError } = await supabaseAdmin
    .from('players')
    .select('telegram_chat_id, full_name')
    .eq('approval_status', 'approved')
    .not('telegram_chat_id', 'is', null);

  console.log('[send-notification] Telegram recipients found:', (allPlayers || []).length, playersError?.message);

  // Admin-typed text goes through escapeHtml: a stray "<" would
  // otherwise make Telegram reject every single send with a 400.
  const text = `📢 <b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`;

  const { sent, failed, deadChatIds } = await broadcastTelegramMessage(
    (allPlayers || []).map((p) => p.telegram_chat_id),
    text
  );

  console.log('[send-notification] Broadcast finished:', { sent, failed, dead: deadChatIds.length });

  // Players who blocked the bot (or never really started it) can never
  // receive anything on that chat_id — unlink them so future broadcasts
  // don't waste calls, and so the admin panel shows them as unlinked.
  if (deadChatIds.length > 0) {
    const { error: unlinkError } = await supabaseAdmin
      .from('players')
      .update({ telegram_chat_id: null })
      .in('telegram_chat_id', deadChatIds);

    if (unlinkError) {
      console.error('[send-notification] Failed to unlink dead chats:', unlinkError.message);
    }
  }

  return Response.json({ success: true, notification, telegram: { sent, failed } });
}
