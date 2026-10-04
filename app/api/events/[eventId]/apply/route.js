import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { eventParticipantIds } from '@/lib/server/registration';
import { trySendTelegramMessage, escapeHtml } from '@/lib/telegram';

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
  let invitee = null;
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
      // for a partner (the «Шукаю пару» notices lead exactly here). They
      // are not paired up on the spot any more: the seeker gets an
      // invitation and decides (migration 058, /invites/[id]/accept).
      const { data: seekerApp } = await supabaseAdmin
        .from('tournament_applications')
        .select('id, partner_id, seeking_partner')
        .eq('event_id', eventId)
        .eq('user_id', p.id)
        .not('status', 'in', '(withdrawn,rejected)')
        .maybeSingle();
      if (!seekerApp || seekerApp.partner_id || !seekerApp.seeking_partner) {
        return Response.json({ success: false, error: 'Напарник вже заявлений на цю подію' }, { status: 400 });
      }
      const sent = await sendInvite(supabaseAdmin, request, { eventId, categoryId, from: playerId, to: p.id, kind: 'join_seeker' });
      if (sent.error) return Response.json({ success: false, error: sent.error }, { status: 500 });
      return Response.json({ success: true, invited: true });
    }
    // Not in the event yet: they are not put into a pair without saying
    // yes either. This player's application is filed alone (waiting for
    // the partner), and the partner gets an invitation — on «Прийняти»
    // they join it (migration 061, kind 'join_inviter').
    invitee = p;
  }

  // Always pending — the admin distributes. The chosen league is only a
  // request; the admin may place the player elsewhere.
  const appRow = {
    event_id: eventId,
    user_id: playerId,
    // a partner joins only by accepting an invitation (pairing.joinSeeker)
    partner_id: null,
    seeking_partner: !!seekingPartner || !!invitee,
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

  if (invitee) {
    const sent = await sendInvite(supabaseAdmin, request, { eventId, categoryId, from: playerId, to: invitee.id, kind: 'join_inviter' });
    if (sent.error) return Response.json({ success: false, error: sent.error }, { status: 500 });
    return Response.json({ success: true, invited: true });
  }

  return Response.json({ success: true });
}

// A pair invitation (migrations 058, 061) plus a note in the invitee's
// Telegram when it is linked. kind:
//   'join_seeker'  — the inviter joins the invitee's application;
//   'join_inviter' — the invitee joins the inviter's application.
async function sendInvite(supabaseAdmin, request, { eventId, categoryId, from, to, kind }) {
  const { data: dup } = await supabaseAdmin
    .from('pair_invites')
    .select('id')
    .eq('event_id', eventId)
    .eq('from_user', from)
    .eq('to_user', to)
    .eq('status', 'pending')
    .maybeSingle();
  if (dup) return {};
  let { error } = await supabaseAdmin
    .from('pair_invites')
    .insert({ event_id: eventId, category_id: categoryId, from_user: from, to_user: to, kind });
  if (error && /kind/.test(error.message || '') && kind === 'join_seeker') {
    // before migration 061 (no «kind» column yet)
    ({ error } = await supabaseAdmin.from('pair_invites').insert({ event_id: eventId, category_id: categoryId, from_user: from, to_user: to }));
  }
  if (error) {
    console.error('[apply] invite:', error.message);
    return { error: 'Не вдалося надіслати запрошення. Чи виконано SQL міграцій 058 і 061?' };
  }
  const { data: people } = await supabaseAdmin
    .from('users')
    .select('id, full_name, telegram_user_id, telegram_linked_at')
    .in('id', [from, to]);
  const me = (people || []).find((u) => u.id === from);
  const them = (people || []).find((u) => u.id === to);
  if (them?.telegram_user_id && them?.telegram_linked_at) {
    const base = new URL(request.url).origin;
    await trySendTelegramMessage(
      them.telegram_user_id,
      `🤝 <b>${escapeHtml(me?.full_name || 'Гравець')}</b> хоче зіграти з вами в парі на турнірі.\n\n` +
        'Відкрийте турнір у застосунку, щоб прийняти або відхилити запрошення.' +
        `\n${base}/events/register/${eventId}`
    );
  }
  return {};
}
