import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';

// A player withdraws from an event.
//  - Solo: remove their tournament_players row.
//  - Pair: `withPartner` decides whether the whole team leaves or only
//    this player (the remaining player stays on, now "seeking partner").
export async function POST(request, { params }) {
  const { eventId } = params;
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }
  const playerId = authUser.user.id;

  const { withPartner } = await request.json().catch(() => ({}));
  const supabaseAdmin = createAdminClient();

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id, format_kind, status')
    .eq('id', eventId)
    .single();
  if (!event) return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  if (event.status === 'done' || event.status === 'cancelled') {
    return Response.json({ success: false, error: 'Подію вже завершено' }, { status: 400 });
  }

  const format = getFormat(event.format_kind);
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';

  // Only categories that have NOT started yet — you can't leave a
  // category whose matches are already generated.
  const { data: cats } = await supabaseAdmin
    .from('tournament_categories')
    .select('id, status')
    .eq('event_id', eventId)
    .eq('status', 'scheduled');
  const categoryIds = (cats || []).map((c) => c.id);

  if (categoryIds.length > 0) {
    if (isPair) {
      const { data: team } = await supabaseAdmin
        .from('tournament_teams')
        .select('*')
        .in('category_id', categoryIds)
        .or(`user1_id.eq.${playerId},user2_id.eq.${playerId}`)
        .maybeSingle();

      if (team) {
        const alone = !team.user2_id;
        if (withPartner || alone) {
          await supabaseAdmin.from('tournament_teams').delete().eq('id', team.id);
        } else if (team.user2_id === playerId) {
          // The second player leaves; owner stays and looks for a new partner.
          await supabaseAdmin
            .from('tournament_teams')
            .update({ user2_id: null })
            .eq('id', team.id);
        } else {
          // The owner leaves but the partner stays — promote partner to owner.
          await supabaseAdmin
            .from('tournament_teams')
            .update({ user1_id: team.user2_id, user2_id: null })
            .eq('id', team.id);
        }
      }
    } else {
      await supabaseAdmin
        .from('tournament_players')
        .delete()
        .eq('user_id', playerId)
        .in('category_id', categoryIds);
    }
  }

  // Keep the application in step with the team. One person = one
  // application per event, so the row this player belongs to is either
  // their own or the one a partner filed naming them — and it is either
  // withdrawn or handed over to whoever stays on.
  const { data: appRows } = await supabaseAdmin
    .from('tournament_applications')
    .select('id, user_id, partner_id')
    .eq('event_id', eventId)
    .or(`user_id.eq.${playerId},partner_id.eq.${playerId}`);

  const withdraw = (id) =>
    supabaseAdmin
      .from('tournament_applications')
      .update({ status: 'withdrawn', assigned_category_id: null })
      .eq('id', id);

  for (const row of appRows || []) {
    if (row.user_id !== playerId) {
      // The named partner leaves: alone — the applicant stays on and is
      // now looking for someone; together — the application is gone.
      if (withPartner) await withdraw(row.id);
      else
        await supabaseAdmin
          .from('tournament_applications')
          .update({ partner_id: null, seeking_partner: true })
          .eq('id', row.id);
    } else if (!withPartner && row.partner_id) {
      // The applicant leaves alone — the partner inherits the row, just
      // as they inherit the team. A leftover row of their own (legacy
      // data) would collide, so fall back to a plain withdrawal.
      const { error } = await supabaseAdmin
        .from('tournament_applications')
        .update({ user_id: row.partner_id, partner_id: null, seeking_partner: true })
        .eq('id', row.id);
      if (error) await withdraw(row.id);
    } else {
      await withdraw(row.id);
    }
  }

  return Response.json({ success: true });
}
