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
    .from('tournaments')
    .select('id, status')
    .eq('event_id', eventId)
    .eq('status', 'scheduled');
  const categoryIds = (cats || []).map((c) => c.id);

  if (categoryIds.length > 0) {
    if (isPair) {
      const { data: team } = await supabaseAdmin
        .from('tournament_teams')
        .select('*')
        .in('tournament_id', categoryIds)
        .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
        .maybeSingle();

      if (team) {
        const alone = !team.player2_id;
        if (withPartner || alone) {
          await supabaseAdmin.from('tournament_teams').delete().eq('id', team.id);
        } else if (team.player2_id === playerId) {
          // The second player leaves; owner stays and looks for a new partner.
          await supabaseAdmin
            .from('tournament_teams')
            .update({ player2_id: null })
            .eq('id', team.id);
        } else {
          // The owner leaves but the partner stays — promote partner to owner.
          await supabaseAdmin
            .from('tournament_teams')
            .update({ player1_id: team.player2_id, player2_id: null })
            .eq('id', team.id);
        }
      }
    } else {
      await supabaseAdmin
        .from('tournament_players')
        .delete()
        .eq('player_id', playerId)
        .in('tournament_id', categoryIds);
    }
  }

  // Mark the application withdrawn (keep the row for history).
  await supabaseAdmin
    .from('tournament_applications')
    .update({ status: 'withdrawn', assigned_tournament_id: null })
    .eq('event_id', eventId)
    .eq('player_id', playerId);

  return Response.json({ success: true });
}
