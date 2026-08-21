import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { categoryForElo } from '@/lib/elo';

export async function POST(request, { params }) {
  const { playerId } = params;
  const { elo } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();

  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може редагувати Ело' }, { status: 403 });
  }

  if (!Number.isInteger(elo) || elo < 800 || elo > 2200) {
    return Response.json({ success: false, error: 'Ело має бути від 800 до 2200' }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin.from('users').select('elo').eq('id', playerId).single();

  await supabaseAdmin
    .from('users')
    .update({ elo, category: categoryForElo(elo)?.id })
    .eq('id', playerId);

  await supabaseAdmin.from('elo_history').insert({
    user_id: playerId,
    delta: elo - (before?.elo || 0),
    elo_before: before?.elo || 0,
    elo_after: elo,
    reason: 'admin_adjustment',
  });

  return Response.json({ success: true });
}
