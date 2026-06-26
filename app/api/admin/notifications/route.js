import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/telegram';

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
  const { data: allPlayers } = await supabaseAdmin
    .from('players')
    .select('telegram_chat_id')
    .eq('approval_status', 'approved')
    .not('telegram_chat_id', 'is', null);

  const text = `📢 <b>${title}</b>\n\n${body}`;

  await Promise.allSettled(
    (allPlayers || []).map((p) => sendTelegramMessage(p.telegram_chat_id, text))
  );

  return Response.json({ success: true, notification });
}
