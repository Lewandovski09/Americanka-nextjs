import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';

// Admin takes a participant (solo player or pair) out of a category and
// returns them to the application queue (status back to 'pending'), so
// they can be re-distributed. Allowed only before the category started.
export async function POST(request, { params }) {
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
  if (!caller?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  const { categoryId, playerId, teamId } = await request.json();

  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('id, event_id, status, tournament_events(format_kind)')
    .eq('id', categoryId)
    .maybeSingle();
  if (!category) return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 404 });
  if (category.status !== 'scheduled') {
    return Response.json({ success: false, error: 'Категорію вже розпочато' }, { status: 400 });
  }

  const format = getFormat(category.tournament_events?.format_kind);
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';

  if (isPair) {
    if (!teamId) return Response.json({ success: false, error: 'Не вказано пару' }, { status: 400 });
    const { data: team } = await supabaseAdmin
      .from('tournament_teams')
      .select('player1_id, player2_id')
      .eq('id', teamId)
      .eq('tournament_id', categoryId)
      .maybeSingle();

    await supabaseAdmin.from('tournament_teams').delete().eq('id', teamId).eq('tournament_id', categoryId);

    if (team) {
      await supabaseAdmin
        .from('tournament_applications')
        .update({ status: 'pending', assigned_tournament_id: null })
        .eq('event_id', category.event_id)
        .in('player_id', [team.player1_id, team.player2_id].filter(Boolean));
    }
    return Response.json({ success: true });
  }

  if (!playerId) return Response.json({ success: false, error: 'Не вказано гравця' }, { status: 400 });
  await supabaseAdmin
    .from('tournament_players')
    .delete()
    .eq('tournament_id', categoryId)
    .eq('player_id', playerId);

  await supabaseAdmin
    .from('tournament_applications')
    .update({ status: 'pending', assigned_tournament_id: null })
    .eq('event_id', category.event_id)
    .eq('player_id', playerId);

  return Response.json({ success: true });
}
