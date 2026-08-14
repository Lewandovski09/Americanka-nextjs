import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { emailForLogin } from '@/lib/authIdentity';
import { randomUUID } from 'crypto';

// Test players still need a real Supabase Auth account —
// players.id references auth.users(id), there's no way around that —
// so this creates one auth user per bot, then a players row, then a
// real tournament_applications row requesting the given category. It
// deliberately does NOT write straight into tournament_players/
// tournament_teams: applications are what the real registration flow
// produces, and going through them here means testing the actual
// distribution step an admin would do, not skipping past it.
//
// Every bot's login starts with "testbot_" — the one thing the cleanup
// route (test-players/cleanup) relies on to find and remove them again
// without touching anyone real.

export async function POST(request, { params }) {
  const { eventId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: me } = await supabaseAdmin.from('players').select('is_admin').eq('id', authUser.user.id).maybeSingle();
  if (!me?.is_admin) {
    return Response.json({ success: false, error: 'Тільки для адміністраторів' }, { status: 403 });
  }

  const { categoryId, count } = await request.json().catch(() => ({}));
  const n = Math.max(1, Math.min(32, Number(count) || 4)); // sane bounds, not unlimited

  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('id, category_label, gender, event_id')
    .eq('id', categoryId)
    .maybeSingle();
  if (!category || category.event_id !== eventId) {
    return Response.json({ success: false, error: 'Категорію не знайдено в цій події' }, { status: 404 });
  }

  const { data: event } = await supabaseAdmin.from('tournament_events').select('format_kind').eq('id', eventId).maybeSingle();
  const format = getFormat(event?.format_kind);

  const created = [];
  const errors = [];

  for (let i = 0; i < n; i++) {
    // Mix needs both a man and a woman in each pair — alternate so a
    // batch of bots can actually pair up with each other, instead of
    // producing e.g. 4 men and nobody to partner them with.
    const gender = format?.hasGender ? category.gender : i % 2 === 0 ? 'M' : 'F';
    const suffix = `${Date.now().toString(36)}${i}`;
    const login = `testbot_${suffix}`;
    const fullName = `Тест Бот ${suffix.slice(-4)}`;

    const { data: authCreated, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: emailForLogin(login),
      password: randomUUID(),
      email_confirm: true,
    });
    if (authError || !authCreated?.user) {
      errors.push(`${login}: ${authError?.message || 'auth create failed'}`);
      continue;
    }

    const { error: playerError } = await supabaseAdmin.from('players').insert({
      id: authCreated.user.id,
      login,
      full_name: fullName,
      gender,
      elo: 1200 + Math.floor(Math.random() * 400),
      approval_status: 'approved',
    });
    if (playerError) {
      errors.push(`${login}: ${playerError.message}`);
      await supabaseAdmin.auth.admin.deleteUser(authCreated.user.id);
      continue;
    }

    const { error: appError } = await supabaseAdmin.from('tournament_applications').insert({
      event_id: eventId,
      player_id: authCreated.user.id,
      requested_category: category.category_label,
      seeking_partner: format?.registrationType !== 'solo',
      status: 'pending',
    });
    if (appError) {
      errors.push(`${login} (заявка): ${appError.message}`);
      continue;
    }

    created.push({ login, fullName });
  }

  return Response.json({ success: errors.length === 0, created: created.length, errors });
}
