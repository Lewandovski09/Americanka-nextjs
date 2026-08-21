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
    .from('users')
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
    .from('users')
    .select('telegram_user_id, full_name')
    .eq('approval_status', 'approved')
    .not('telegram_user_id', 'is', null)
    .not('telegram_linked_at', 'is', null); // linked_at is nulled when someone blocks the bot

  console.log('[send-notification] Telegram recipients found:', (allPlayers || []).length, playersError?.message);

  // Admin-typed text goes through escapeHtml: a stray "<" would
  // otherwise make Telegram reject every single send with a 400.
  const text = `📢 <b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`;

  const { sent, failed, deadChatIds } = await broadcastTelegramMessage(
    (allPlayers || []).map((p) => p.telegram_user_id),
    text
  );

  console.log('[send-notification] Broadcast finished:', { sent, failed, dead: deadChatIds.length });

  // Players who blocked the bot can never receive anything — clear their
  // reachability so future broadcasts don't waste calls and the admin
  // panel shows them as unlinked. telegram_user_id stays: we still know
  // who they are, and a fresh /start brings them back.
  if (deadChatIds.length > 0) {
    const { error: unlinkError } = await supabaseAdmin
      .from('users')
      .update({ telegram_linked_at: null })
      .in('telegram_user_id', deadChatIds);

    if (unlinkError) {
      console.error('[send-notification] Failed to unlink dead chats:', unlinkError.message);
    }
  }

  return Response.json({ success: true, notification, telegram: { sent, failed } });
}
