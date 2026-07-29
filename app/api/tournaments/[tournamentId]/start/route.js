import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { prepareCategoryStart, commitCategoryStart } from '@/lib/server/startCategory';

// Admin closes registration for ONE category and generates its matches.
// The admin pages start the whole event at once (see
// /api/events/[eventId]/start); this route stays for starting a single
// league that was left behind.
export async function POST(request, { params }) {
  const { tournamentId } = params; // category id
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

  let prepared;
  try {
    prepared = await prepareCategoryStart(supabaseAdmin, tournamentId);
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 400 });
  }

  const result = await commitCategoryStart(supabaseAdmin, prepared.category, prepared.rows);
  if (result.error) {
    return Response.json({ success: false, error: result.error }, { status: 500 });
  }

  return Response.json({ success: true, matches: result.matches });
}
