import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { trySendTelegramMessage } from '@/lib/telegram';
import { channelId } from '@/lib/server/eventAnnouncement';
import { announcementText } from '@/lib/server/adminAnnouncement';

export async function POST(request) {
  const { title, body } = await request.json();

  if (!title?.trim() || !body?.trim()) {
    return Response.json({ success: false, error: "Заповніть заголовок і текст" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);

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

  // The club's channel — one post, right here (once per click). A failure
  // doesn't undo the announcement: the page says the channel was missed.
  const chat = channelId();
  let channel = null;
  if (chat) {
    const r = await trySendTelegramMessage(chat, announcementText(title.trim(), body.trim()));
    channel = r.ok ? 'ok' : 'failed';
    if (!r.ok) console.error('[send-notification] channel:', r.error);
  }

  // The Telegram push to every player goes separately (./[id]/broadcast) —
  // sending to every player one by one takes a while, and the admin's
  // button used to wait for all of it.
  return Response.json({ success: true, notification, channel });
}
