import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Basic settings of a RUNNING event: name, date/time, venue. Unlike
// /update (the pre-start form) this touches nothing that the generated
// matches depend on — format, courts, scoring and the category list are
// baked in once a category starts, so they are not editable here.
const LOCATIONS = ['beach13', 'dynamo_sc'];

export async function POST(request, { params }) {
  const { eventId } = params;

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

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id, name')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  }

  const { name, location, scheduledAt } = await request.json();

  const patch = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return Response.json({ success: false, error: 'Вкажіть назву' }, { status: 400 });
    patch.name = trimmed;
  }
  if (location !== undefined) {
    if (!LOCATIONS.includes(location)) {
      return Response.json({ success: false, error: 'Невідоме місце проведення' }, { status: 400 });
    }
    patch.location = location;
  }
  if (scheduledAt !== undefined) {
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) {
      return Response.json({ success: false, error: 'Невірна дата' }, { status: 400 });
    }
    patch.scheduled_at = d.toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ success: false, error: 'Немає що зберігати' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('tournament_events').update(patch).eq('id', eventId);
  if (error) {
    console.error('[event basics] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти' }, { status: 500 });
  }

  return Response.json({ success: true });
}
