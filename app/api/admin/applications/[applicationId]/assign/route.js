import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { placeMember } from '@/lib/server/registration';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// Admin distributes an application. Two outcomes:
//   • into a category roster (places the player/pair), or
//   • into that category's RESERVE (parked, not in the roster) when the
//     player applied over capacity — promotable later.
// Works for pending applications and for promoting a reserved one.
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

  const { categoryId, asReserve } = await request.json();

  // The application and the league (with its event's format) at once.
  const [{ data: application }, { data: category }] = await Promise.all([
    supabaseAdmin.from('tournament_applications').select('*').eq('id', applicationId).maybeSingle(),
    supabaseAdmin.from('tournament_categories').select('*, tournament_events(format_kind)').eq('id', categoryId).maybeSingle(),
  ]);
  if (!application) return Response.json({ success: false, error: 'Заявку не знайдено' }, { status: 404 });
  if (category && category.event_id !== application.event_id) {
    return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 400 });
  }
  const format = getFormat(category?.tournament_events?.format_kind);

  if (!category) return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 400 });
  if (category.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Категорію вже розпочато' }, { status: 400 });
  }

  // Park in the reserve: record the intended league but do NOT touch the
  // roster, so a full league can still accept over-capacity applicants.
  if (asReserve) {
    const { error } = await supabaseAdmin
      .from('tournament_applications')
      .update({ status: 'reserve', assigned_category_id: category.id })
      .eq('id', applicationId);
    if (error) {
      console.error('[assign] reserve error:', error.message);
      return Response.json({ success: false, error: 'Не вдалося оновити заявку' }, { status: 500 });
    }
    return Response.json({ success: true, reserved: true });
  }

  const placed = await placeMember(supabaseAdmin, category, format, {
    playerId: application.user_id,
    partnerId: application.partner_id,
    seekingPartner: application.seeking_partner,
  });
  if (placed.error) return Response.json({ success: false, error: placed.error }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('tournament_applications')
    .update({ status: 'assigned', assigned_category_id: category.id })
    .eq('id', applicationId);
  if (error) {
    console.error('[assign] update error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося оновити заявку' }, { status: 500 });
  }

  return Response.json({ success: true });
}
