import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Admin rejects a pending application.
export async function POST(request, { params }) {
  const { applicationId } = params;
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
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from('tournament_applications')
    .update({ status: 'rejected', assigned_tournament_id: null })
    .eq('id', applicationId);
  if (error) {
    console.error('[reject] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося відхилити заявку' }, { status: 500 });
  }

  return Response.json({ success: true });
}
