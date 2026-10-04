import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { eventParticipantIds } from '@/lib/server/registration';

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
    .from('users')
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
    .eq('user_id', playerId)
    .maybeSingle();
  if (existing && existing.status !== 'withdrawn' && existing.status !== 'rejected') {
    return Response.json({ success: false, error: 'Ви вже подали заявку на цю подію' }, { status: 400 });
  }

  // One person = one application per event. Besides their own row that
  // also covers being named as somebody's partner, or having been
  // entered by an admin by hand — in both cases there is no row of their
  // own to find above.
  const taken = await eventParticipantIds(supabaseAdmin, eventId);
  if (taken.has(playerId)) {
    return Response.json(
      { success: false, error: 'Вас вже заявлено на цю подію — знайдіть свою заявку нижче' },
      { status: 400 }
    );
  }

  // The player must pick the league they want to apply to.
  if (!categoryId) {
    return Response.json({ success: false, error: 'Виберіть лігу для заявки' }, { status: 400 });
  }
  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select('id, category_label, status, gender')
    .eq('id', categoryId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (!category) return Response.json({ success: false, error: 'Лігу не знайдено' }, { status: 400 });
  if (category.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Реєстрацію в цю лігу закрито' }, { status: 400 });
  }
  // A men's league takes men, a women's league women — alone or as a
  // pair. (A mix has no gender on its categories.)
  if (category.gender && category.gender !== player.gender) {
    return Response.json(
      {
        success: false,
        error: category.gender === 'M' ? 'Це чоловіча ліга — заявку можуть подати лише чоловіки' : 'Це жіноча ліга — заявку можуть подати лише жінки',
      },
      { status: 400 }
    );
  }

  // Resolve partner (pair formats)
  let partner = null;
  const isPair = format.registrationType === 'pair' || format.registrationType === 'mix_pair';
  if (isPair && partnerId && !seekingPartner) {
    const { data: p } = await supabaseAdmin
      .from('users')
      .select('id, gender, approval_status')
      .eq('id', partnerId)
      .maybeSingle();
    if (!p || p.approval_status !== 'approved') {
      return Response.json({ success: false, error: 'Напарника не знайдено або не підтверджено' }, { status: 400 });
    }
    if (p.id === playerId) {
      return Response.json({ success: false, error: 'Не можна бути напарником самому собі' }, { status: 400 });
    }
    if (format.registrationType === 'mix_pair' && p.gender === player.gender) {
      return Response.json({ success: false, error: 'У міксі пара — чоловік і жінка' }, { status: 400 });
    }
    if (format.registrationType === 'pair' && p.gender !== player.gender) {
      return Response.json({ success: false, error: 'Напарник має бути тієї ж статі' }, { status: 400 });
    }
    if (taken.has(p.id)) {
      // Already in the event — fine if they applied ALONE and are looking
      // for a partner (the «Шукаю пару» notices lead exactly here): then
      // this player joins their application instead of filing a new one.
      const joined = await joinSeeker(supabaseAdmin, eventId, p.id, playerId);
      if (joined.error) return Response.json({ success: false, error: joined.error }, { status: 400 });
      await dropPartnerAds(supabaseAdmin, eventId, [playerId, p.id]);
      return Response.json({ success: true, joined: true });
    }
    partner = p;
  }

  // Always pending — the admin distributes. The chosen league is only a
  // request; the admin may place the player elsewhere.
  const appRow = {
    event_id: eventId,
    user_id: playerId,
    partner_id: partner?.id || null,
    seeking_partner: !!seekingPartner,
    requested_category: category.category_label || null,
    status: 'pending',
    assigned_category_id: null,
  };

  const { error: appError } = existing
    ? await supabaseAdmin.from('tournament_applications').update(appRow).eq('id', existing.id)
    : await supabaseAdmin.from('tournament_applications').insert(appRow);

  if (appError) {
    console.error('[apply] application error:', appError.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти заявку' }, { status: 500 });
  }

  // A pair has formed — their «Шукаю пару» notices are no longer needed.
  if (partner) await dropPartnerAds(supabaseAdmin, eventId, [playerId, partner.id]);

  return Response.json({ success: true });
}

// Deletes the «Шукаю пару» notices (migration 051) of these players in
// every category of the event. Best-effort: a missing table (migration
// not run yet) must not break the application itself.
async function dropPartnerAds(supabaseAdmin, eventId, userIds) {
  const { data: cats } = await supabaseAdmin.from('tournament_categories').select('id').eq('event_id', eventId);
  const ids = (cats || []).map((c) => c.id);
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin.from('partner_ads').delete().in('category_id', ids).in('user_id', userIds);
  if (error) console.error('[apply] partner_ads cleanup:', error.message);
}

// `seekerId` applied alone, looking for a partner; `playerId` joins them.
// Their application gets the partner; if the admin has already placed
// them into a category (a half-filled pair), the empty seat is filled.
async function joinSeeker(supabaseAdmin, eventId, seekerId, playerId) {
  const { data: app } = await supabaseAdmin
    .from('tournament_applications')
    .select('id, status, partner_id, seeking_partner, assigned_category_id')
    .eq('event_id', eventId)
    .eq('user_id', seekerId)
    .not('status', 'in', '(withdrawn,rejected)')
    .maybeSingle();
  if (!app || app.partner_id || !app.seeking_partner) {
    return { error: 'Напарник вже заявлений на цю подію' };
  }

  if (app.status === 'assigned' && app.assigned_category_id) {
    const { data: cat } = await supabaseAdmin
      .from('tournament_categories')
      .select('status')
      .eq('id', app.assigned_category_id)
      .maybeSingle();
    if (cat?.status !== 'scheduled') return { error: 'Цю лігу вже розпочато' };
    const { data: team } = await supabaseAdmin
      .from('tournament_teams')
      .select('id, user1_id, user2_id')
      .eq('category_id', app.assigned_category_id)
      .or(`user1_id.eq.${seekerId},user2_id.eq.${seekerId}`)
      .maybeSingle();
    if (team) {
      if (team.user1_id && team.user2_id) return { error: 'У напарника вже є пара' };
      const seat = team.user1_id ? { user2_id: playerId } : { user1_id: playerId };
      const { error } = await supabaseAdmin.from('tournament_teams').update(seat).eq('id', team.id);
      if (error) {
        console.error('[apply] join team:', error.message);
        return { error: 'Не вдалося приєднатися до пари' };
      }
    }
  }

  const { error } = await supabaseAdmin
    .from('tournament_applications')
    .update({ partner_id: playerId, seeking_partner: false })
    .eq('id', app.id);
  if (error) {
    console.error('[apply] join application:', error.message);
    return { error: 'Не вдалося приєднатися до заявки' };
  }
  return {};
}
