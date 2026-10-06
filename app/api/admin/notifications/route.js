import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

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

  // The Telegram push to everyone goes separately (./[id]/broadcast) —
  // sending to every player one by one takes a while, and the admin's
  // button used to wait for all of it.
  return Response.json({ success: true, notification });
}
