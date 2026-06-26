import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request) {
  const { login } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  if (!login?.trim()) {
    return Response.json({ success: false, error: 'Вкажіть логін' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: foundPlayer, error } = await supabaseAdmin
    .from('players')
    .select('id, full_name, login, photo_url, elo, category, gender')
    .eq('login', login.trim().toLowerCase())
    .eq('approval_status', 'approved')
    .maybeSingle();

  if (error || !foundPlayer) {
    return Response.json({ success: false, error: 'Гравця з таким логіном не знайдено' }, { status: 404 });
  }

  if (foundPlayer.id === authUser.user.id) {
    return Response.json({ success: false, error: 'Це ваш власний профіль' }, { status: 400 });
  }

  return Response.json({ success: true, player: foundPlayer });
}
