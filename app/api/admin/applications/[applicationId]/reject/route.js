import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// Admin rejects a pending application.
export async function POST(request, { params }) {
  const { applicationId } = params;
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from('tournament_applications')
    .update({ status: 'rejected', assigned_category_id: null })
    .eq('id', applicationId);
  if (error) {
    console.error('[reject] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося відхилити заявку' }, { status: 500 });
  }

  return Response.json({ success: true });
}
