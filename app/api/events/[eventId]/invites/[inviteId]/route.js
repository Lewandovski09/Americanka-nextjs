import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { eventParticipantIds } from '@/lib/server/registration';
import { joinSeeker, dropPartnerAds } from '@/lib/server/pairing';
import { getAuthUser } from '@/lib/server/authUser';

// A pair invitation (migration 058): someone who saw a «Шукаю пару»
// notice asked to play with the player who applied alone. The invited
// player answers here:
//   { action: 'accept' } — the two become a pair: one joins the other's
//                          application (see «kind» below) and the
//                          half-filled pair, if the admin already placed it;
//   { action: 'decline' } — the invitation is closed.
// The inviter can also take back their own invitation: { action: 'cancel' }.
export async function POST(request, { params }) {
  const { eventId, inviteId } = params;
  const supabase = createClient();
  const supabaseAdmin = createAdminClient();
  // Independent of each other — fetched at once (every step used to wait
  // for the previous one, and an answer took seconds).
  const [{ data: authUser }, { action } = {}, { data: inv }] = await Promise.all([
    getAuthUser(supabase),
    request.json().catch(() => ({})),
    supabaseAdmin.from('pair_invites').select('*').eq('id', inviteId).eq('event_id', eventId).maybeSingle(),
  ]);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  const me = authUser.user.id;
  if (!inv) return Response.json({ success: false, error: 'Запрошення не знайдено' }, { status: 404 });
  if (inv.status !== 'pending') return Response.json({ success: false, error: 'Запрошення вже закрите' }, { status: 400 });

  const close = (status) =>
    supabaseAdmin.from('pair_invites').update({ status, answered_at: new Date().toISOString() }).eq('id', inv.id).eq('status', 'pending');

  if (action === 'cancel') {
    if (inv.from_user !== me) return Response.json({ success: false, error: 'Це не ваше запрошення' }, { status: 403 });
    await close('cancelled');
    return Response.json({ success: true });
  }

  if (inv.to_user !== me) return Response.json({ success: false, error: 'Це запрошення не для вас' }, { status: 403 });

  if (action === 'decline') {
    await close('declined');
    return Response.json({ success: true });
  }
  if (action !== 'accept') return Response.json({ success: false, error: 'Невідома дія' }, { status: 400 });

  const [{ data: event }, taken] = await Promise.all([
    supabaseAdmin.from('tournament_events').select('id, status').eq('id', eventId).maybeSingle(),
    eventParticipantIds(supabaseAdmin, eventId),
  ]);
  if (!event || event.status === 'done' || event.status === 'cancelled') {
    return Response.json({ success: false, error: 'Реєстрацію закрито' }, { status: 400 });
  }

  // Who joins whose application:
  //   'join_seeker'  (default) — the inviter joins MY solo application;
  //   'join_inviter'           — I join the INVITER's application (they
  //                              named me as their partner when applying).
  const joinInviter = inv.kind === 'join_inviter';
  const seekerId = joinInviter ? inv.from_user : me;
  const joinerId = joinInviter ? me : inv.from_user;

  // The one who joins must still be free — they may have found another
  // pair (or applied themselves) in the meantime.
  if (taken.has(joinerId)) {
    await close('expired');
    return Response.json(
      {
        success: false,
        error: joinInviter ? 'Ви вже заявлені на цю подію — запрошення закрито' : 'Гравець уже записався з іншим напарником',
      },
      { status: 400 }
    );
  }

  // Claim the invitation first, so a double tap can't pair twice.
  const { data: claimed } = await close('accepted').select('id');
  if (!claimed || claimed.length === 0) return Response.json({ success: false, error: 'Запрошення вже закрите' }, { status: 400 });

  const joined = await joinSeeker(supabaseAdmin, eventId, seekerId, joinerId);
  if (joined.error) {
    await supabaseAdmin.from('pair_invites').update({ status: 'pending', answered_at: null }).eq('id', inv.id);
    return Response.json({ success: false, error: joined.error }, { status: 400 });
  }
  // Tidying up, both at once: their «Шукаю пару» notices go, and every
  // other open invitation of these two in this event is void now.
  await Promise.all([
    dropPartnerAds(supabaseAdmin, eventId, [me, inv.from_user]),
    supabaseAdmin
      .from('pair_invites')
      .update({ status: 'expired', answered_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .or(`from_user.in.(${me},${inv.from_user}),to_user.in.(${me},${inv.from_user})`),
  ]);

  // The note to the inviter goes separately (…/notify) — answering does
  // not wait for the tournament card to be drawn and sent.
  return Response.json({ success: true });
}
