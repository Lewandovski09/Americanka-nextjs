import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { prepareCategoryStart, commitCategoryStart } from '@/lib/server/startCategory';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { removeCategory } from '@/lib/server/removeCategory';

// «Запустити» — the whole event goes off at once: every league that has
// not started yet gets its matches generated and turns live.
//
// Every league is built first, in memory. By default it is all or
// nothing: if any league can't be built (too few players, …) nothing is
// written and the answer names it. With { partial: true } — the admin
// confirmed «Точно почати?» — the leagues that can be built start, and
// the rest are cancelled (removed; their applications are closed), so
// the tournament goes on with what got together.
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
  const { partial } = await request.json().catch(() => ({}));
  const prepFail = prepTries.find((t) => t.e);
  if (prepFail && !partial) {
    return Response.json({ success: false, error: `${categoryName(prepFail.c)}: ${prepFail.e.message}` }, { status: 400 });
  }
  const prepared = prepTries.filter((t) => t.p).map((t) => t.p);
  const left = prepTries.filter((t) => t.e);
  if (prepared.length === 0) {
    return Response.json(
      {
        success: false,
        error: `Жодна категорія не готова до старту: ${left.map((t) => `${categoryName(t.c)} — ${t.e.message}`).join('; ')}`,
      },
      { status: 400 }
    );
  }

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

  // The leagues that didn't get together are cancelled.
  const cancelled = [];
  for (const t of left) {
    const r = await removeCategory(supabaseAdmin, t.c.id, { eventStarted: true });
    if (r.ok) cancelled.push(categoryName(t.c));
    else console.error('[start] cancel category:', r.error);
  }

  return Response.json({ success: true, categories: prepared.length, matches, cancelled });
}

function categoryName(c) {
  const g = c.gender === 'M' ? 'Ч · ' : c.gender === 'F' ? 'Ж · ' : '';
  return `${g}${c.category_label || 'Категорія'}`;
}
