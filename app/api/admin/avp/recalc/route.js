// Recompute AVP points for a category, or for every category of an
// event. The escape hatch for anything the normal flow could not have
// covered:
//   • an event that was already running (or already finished) when the
//     rating was introduced — set its tier, then recalc;
//   • a tier changed after the fact;
//   • a season created later than the events inside it.
//
// Safe to call repeatedly: recalcAvpForCategory rewrites a category's
// rows from scratch every time.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recalcAvpForCategory } from '@/lib/server/avpAward';

export async function POST(request) {
  const { categoryId, eventId } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: me } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();
  if (!me?.is_admin) {
    return Response.json({ success: false, error: 'Тільки для адміністраторів' }, { status: 403 });
  }

  let categoryIds = [];
  if (categoryId) {
    categoryIds = [categoryId];
  } else if (eventId) {
    const { data: cats } = await supabaseAdmin
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    categoryIds = (cats || []).map((c) => c.id);
  } else {
    return Response.json({ success: false, error: 'Потрібен categoryId або eventId' }, { status: 400 });
  }

  const results = [];
  for (const id of categoryIds) {
    results.push({ categoryId: id, ...(await recalcAvpForCategory(supabaseAdmin, id)) });
  }

  const failed = results.find((r) => !r.ok);
  if (failed) {
    return Response.json({ success: false, error: failed.error, results }, { status: 500 });
  }

  const awarded = results.reduce((sum, r) => sum + (r.awarded || 0), 0);
  const skipped = results.find((r) => r.skipped)?.skipped || null;
  return Response.json({ success: true, categories: results.length, awarded, skipped, results });
}
