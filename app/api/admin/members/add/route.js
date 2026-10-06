import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { eventParticipantIds, placeMember } from '@/lib/server/registration';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// Admin enters a participant by hand: pick the player (plus the partner
// in pair formats) and they land straight in the chosen league's roster,
// skipping the application queue. The path for people who never applied
// through the app themselves — the admin signs them up on the spot.
export async function POST(request) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  const { categoryId, playerId, partnerId, seekingPartner } = await request.json();
  if (!playerId) return Response.json({ success: false, error: 'Виберіть гравця' }, { status: 400 });

  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select('*, tournament_events(format_kind)')
    .eq('id', categoryId)
    .maybeSingle();
  if (!category) return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 404 });
  if (category.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Категорію вже розпочато' }, { status: 400 });
  }

  const format = getFormat(category.tournament_events?.format_kind);
  if (!format) return Response.json({ success: false, error: 'Невідомий формат' }, { status: 400 });
  const isPair = format.registrationType === 'pair' || format.registrationType === 'mix_pair';

  // A pair needs both halves — unless the admin deliberately parks the
  // player alone, exactly like the "шукаю напарника" self-registration.
  const withPartner = isPair && !seekingPartner;
  if (withPartner && !partnerId) {
    return Response.json(
      { success: false, error: 'Виберіть другого гравця або позначте «без напарника»' },
      { status: 400 }
    );
  }
  if (withPartner && partnerId === playerId) {
    return Response.json({ success: false, error: 'Гравець не може бути напарником сам собі' }, { status: 400 });
  }

  const ids = withPartner ? [playerId, partnerId] : [playerId];
  const { data: found } = await supabaseAdmin
    .from('users')
    .select('id, approval_status')
    .in('id', ids);
  if ((found || []).length !== ids.length) {
    return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 400 });
  }
  if (found.some((p) => p.approval_status !== 'approved')) {
    return Response.json({ success: false, error: 'Профіль гравця ще не підтверджено' }, { status: 400 });
  }

  // One person = one application per event — an open application (their
  // own or as somebody's partner) or a place in any league of it rules
  // the player out. The unique indexes only guard a single category, so
  // this check is what gives a clear error instead of a 23505.
  const taken = await eventParticipantIds(supabaseAdmin, category.event_id);
  if (ids.some((id) => taken.has(id))) {
    return Response.json({ success: false, error: 'Гравець вже заявлений на цю подію' }, { status: 400 });
  }

  const placed = await placeMember(supabaseAdmin, category, format, {
    playerId,
    partnerId: withPartner ? partnerId : null,
    seekingPartner: !!(isPair && seekingPartner),
  });
  if (placed.error) return Response.json({ success: false, error: placed.error }, { status: 400 });

  // Record it as an application already distributed to this league, so
  // moving / removing / withdrawing later behaves exactly as it does for
  // a player who registered themselves.
  const { error: appError } = await supabaseAdmin.from('tournament_applications').upsert(
    {
      event_id: category.event_id,
      user_id: playerId,
      partner_id: withPartner ? partnerId : null,
      seeking_partner: !!(isPair && seekingPartner),
      requested_category: category.category_label || null,
      status: 'assigned',
      assigned_category_id: category.id,
    },
    { onConflict: 'event_id,user_id' }
  );
  if (appError) {
    // The place in the league was taken, but its application could not be
    // written — most likely the partner joined someone else's pair at
    // this very moment (migration 063). Take the place back, so the
    // roster and the applications never disagree, and say so.
    console.error('[members/add] application upsert:', appError.message);
    await undoPlacement(supabaseAdmin, category.id, isPair, playerId);
    return Response.json(
      {
        success: false,
        error:
          appError.code === '23505'
            ? 'Напарник щойно потрапив в іншу пару — оновіть сторінку і виберіть іншого'
            : 'Не вдалося зберегти заявку — гравця не додано, спробуйте ще раз',
      },
      { status: appError.code === '23505' ? 409 : 500 }
    );
  }

  // The partner's own application (if they filed one) follows the pair
  // out of the queue.
  if (withPartner) {
    const { error: partnerError } = await supabaseAdmin
      .from('tournament_applications')
      .update({ status: 'assigned', assigned_category_id: category.id })
      .eq('event_id', category.event_id)
      .eq('user_id', partnerId);
    if (partnerError) {
      console.error('[members/add] partner application:', partnerError.message);
      return Response.json({
        success: true,
        warning: 'Пару додано, але заявку напарника не оновлено — перевірте її у списку заявок',
      });
    }
  }

  return Response.json({ success: true });
}

// Removes the roster row placeMember has just added.
async function undoPlacement(supabaseAdmin, categoryId, isPair, playerId) {
  const { error } = isPair
    ? await supabaseAdmin.from('tournament_teams').delete().eq('category_id', categoryId).eq('user1_id', playerId)
    : await supabaseAdmin.from('tournament_players').delete().eq('category_id', categoryId).eq('user_id', playerId);
  if (error) console.error('[members/add] undo placement:', error.message);
}
