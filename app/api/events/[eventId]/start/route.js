import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { prepareCategoryStart, commitCategoryStart } from '@/lib/server/startCategory';

// «Запустити» — the whole event goes off at once: every league that has
// not started yet gets its matches generated and turns live.
//
// All or nothing. Every league is built first, in memory; if any of them
// can't be (seeding not set, too few pairs, …) nothing is written and
// the answer names the league at fault. Half a started event would leave
// the admin with brackets they cannot take back.
export async function POST(request, { params }) {
  const { eventId } = params;

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
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { data: categories } = await supabaseAdmin
    .from('tournaments')
    .select('id, category_label, gender, status')
    .eq('event_id', eventId)
    .order('gender', { ascending: true })
    .order('category_label', { ascending: true });

  const pending = (categories || []).filter((c) => c.status === 'scheduled');
  if (pending.length === 0) {
    return Response.json(
      { success: false, error: 'Немає категорій, які ще не розпочато' },
      { status: 400 }
    );
  }

  const prepared = [];
  for (const c of pending) {
    try {
      prepared.push(await prepareCategoryStart(supabaseAdmin, c.id));
    } catch (e) {
      return Response.json({ success: false, error: `${categoryName(c)}: ${e.message}` }, { status: 400 });
    }
  }

  let matches = 0;
  for (const p of prepared) {
    const result = await commitCategoryStart(supabaseAdmin, p.category, p.rows);
    if (result.error) {
      // Whatever went in before this stays in — an insert failing here is
      // a database problem, not something the admin can fix by retrying
      // the rest, so say which league broke.
      return Response.json(
        { success: false, error: `${categoryName(p.category)}: ${result.error}` },
        { status: 500 }
      );
    }
    matches += result.matches;
  }

  return Response.json({ success: true, categories: prepared.length, matches });
}

function categoryName(c) {
  const g = c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : '';
  return `${g}${c.category_label || 'Категорія'}`;
}
