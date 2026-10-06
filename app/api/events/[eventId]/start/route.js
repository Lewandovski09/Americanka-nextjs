import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { prepareCategoryStart, commitCategoryStart } from '@/lib/server/startCategory';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

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
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { data: categories } = await supabaseAdmin
    .from('tournament_categories')
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

  // Every league is prepared at once (they don't depend on each other);
  // nothing is written until all of them are fine.
  const prepTries = await Promise.all(
    pending.map((c) =>
      prepareCategoryStart(supabaseAdmin, c.id).then(
        (p) => ({ p }),
        (e) => ({ c, e })
      )
    )
  );
  const prepFail = prepTries.find((t) => t.e);
  if (prepFail) {
    return Response.json({ success: false, error: `${categoryName(prepFail.c)}: ${prepFail.e.message}` }, { status: 400 });
  }
  const prepared = prepTries.map((t) => t.p);

  // And started at once.
  const results = await Promise.all(prepared.map((p) => commitCategoryStart(supabaseAdmin, p.category, p.rows)));
  const failIdx = results.findIndex((r) => r.error);
  if (failIdx >= 0) {
    // Whatever went in for the other leagues stays in — an insert failing
    // here is a database problem, not something the admin can fix by
    // retrying the rest, so say which league broke.
    return Response.json(
      { success: false, error: `${categoryName(prepared[failIdx].category)}: ${results[failIdx].error}` },
      { status: 500 }
    );
  }
  const matches = results.reduce((n, r) => n + (r.matches || 0), 0);

  return Response.json({ success: true, categories: prepared.length, matches });
}

function categoryName(c) {
  const g = c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : '';
  return `${g}${c.category_label || 'Категорія'}`;
}
