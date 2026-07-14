import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';

// A player submits an application to an event, choosing the league
// (category) they want. It always lands in the pending pool — the admin
// sees the requested league plus the player's real rating and
// distributes everyone by hand.
export async function POST(request, { params }) {
  const { eventId } = params;
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }
  const playerId = authUser.user.id;

  const { categoryId, partnerId, seekingPartner } = await request.json();
  const supabaseAdmin = createAdminClient();

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('*')
    .eq('id', eventId)
    .single();
  if (!event) return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  if (event.status === 'done' || event.status === 'cancelled') {
    return Response.json({ success: false, error: 'Реєстрацію закрито' }, { status: 400 });
  }
  if (event.registration_open === false) {
    return Response.json({ success: false, error: 'Реєстрацію закрито адміністратором' }, { status: 400 });
  }

  const format = getFormat(event.format_kind);
  if (!format) return Response.json({ success: false, error: 'Невідомий формат' }, { status: 400 });

  const { data: player } = await supabaseAdmin
    .from('players')
    .select('id, gender, elo, approval_status')
    .eq('id', playerId)
    .maybeSingle();
  if (!player || player.approval_status !== 'approved') {
    return Response.json({ success: false, error: 'Ваш профіль ще не підтверджено' }, { status: 403 });
  }

  // Already applied?
  const { data: existing } = await supabaseAdmin
    .from('tournament_applications')
    .select('id, status')
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (existing && existing.status !== 'withdrawn' && existing.status !== 'rejected') {
    return Response.json({ success: false, error: 'Ви вже подали заявку на цю подію' }, { status: 400 });
  }

  // Resolve partner (pair formats)
  let partner = null;
  const isPair = format.registrationType === 'pair' || format.registrationType === 'mix_pair';
  if (isPair && partnerId && !seekingPartner) {
    const { data: p } = await supabaseAdmin
      .from('players')
      .select('id, gender, approval_status')
      .eq('id', partnerId)
      .maybeSingle();
    if (!p || p.approval_status !== 'approved') {
      return Response.json({ success: false, error: 'Напарника не знайдено або не підтверджено' }, { status: 400 });
    }
    if (p.id === playerId) {
      return Response.json({ success: false, error: 'Не можна бути напарником самому собі' }, { status: 400 });
    }
    partner = p;
  }

  // The player must pick the league they want to apply to.
  if (!categoryId) {
    return Response.json({ success: false, error: 'Виберіть лігу для заявки' }, { status: 400 });
  }
  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('id, category_label, status')
    .eq('id', categoryId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (!category) return Response.json({ success: false, error: 'Лігу не знайдено' }, { status: 400 });
  if (category.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Реєстрацію в цю лігу закрито' }, { status: 400 });
  }

  // Always pending — the admin distributes. The chosen league is only a
  // request; the admin may place the player elsewhere.
  const appRow = {
    event_id: eventId,
    player_id: playerId,
    partner_id: partner?.id || null,
    seeking_partner: !!seekingPartner,
    requested_category: category.category_label || null,
    status: 'pending',
    assigned_tournament_id: null,
  };

  const { error: appError } = existing
    ? await supabaseAdmin.from('tournament_applications').update(appRow).eq('id', existing.id)
    : await supabaseAdmin.from('tournament_applications').insert(appRow);

  if (appError) {
    console.error('[apply] application error:', appError.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти заявку' }, { status: 500 });
  }

  return Response.json({ success: true });
}
