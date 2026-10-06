import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { removeCategory, categoryRatingImpact } from '@/lib/server/removeCategory';

// «Видалити категорію» — while applications are taken, and also after the
// start (the page asks «Точно видалити?» first). { dryRun: true } only
// says what would be undone (games, Ело, AVP). See lib/server/removeCategory.
export async function POST(request, { params }) {
  const { eventId, categoryId } = params;
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });

  const supabaseAdmin = createAdminClient();
  const [{ data: me }, { data: category }, { data: event }, body] = await Promise.all([
    adminRow(supabaseAdmin, authUser.user.id),
    supabaseAdmin.from('tournament_categories').select('id, event_id, status').eq('id', categoryId).maybeSingle(),
    supabaseAdmin.from('tournament_events').select('id, status').eq('id', eventId).maybeSingle(),
    request.json().catch(() => ({})),
  ]);
  if (!me?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  if (!event || !category || category.event_id !== eventId) {
    return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 404 });
  }

  if (body?.dryRun) {
    const { summary } = await categoryRatingImpact(supabaseAdmin, categoryId);
    return Response.json({ success: true, willUndo: summary });
  }

  const r = await removeCategory(supabaseAdmin, categoryId, { eventStarted: event.status !== 'scheduled' });
  if (r.error) return Response.json({ success: false, error: r.error }, { status: 500 });

  // A started tournament whose last playing league was removed is over.
  if (event.status === 'live') {
    const { data: left } = await supabaseAdmin.from('tournament_categories').select('status').eq('event_id', eventId);
    if ((left || []).length > 0 && (left || []).every((c) => c.status === 'done')) {
      await supabaseAdmin.from('tournament_events').update({ status: 'done' }).eq('id', eventId);
    }
  }
  return Response.json({ success: true, undone: r.undone });
}
