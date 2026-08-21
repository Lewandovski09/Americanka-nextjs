// One-time (but safe to re-run) backfill: recompute
// tournament_placements for every already-'done' category, or one
// specific category, or every category in one event. Needed because
// the table is new — every tournament finished before it existed has
// no rows, which is exactly why a real past winner can show "0
// турнірів зіграно" on their profile until this runs.
//
// Safe to call repeatedly: recalcPlacementsForCategory rewrites a
// category's rows from scratch every time, same guarantee
// recalcAvpForCategory already gives for AVP points.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recalcPlacementsForCategory } from '@/lib/server/finishCategory';

export async function POST(request) {
  try {
    const { categoryId, eventId } = await request.json().catch(() => ({}));

    const supabase = createClient();
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser?.user) {
      return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();
    const { data: me } = await supabaseAdmin
      .from('users')
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
      const { data: cats } = await supabaseAdmin.from('tournament_categories').select('id').eq('event_id', eventId);
      categoryIds = (cats || []).map((c) => c.id);
    } else {
      // No target given: backfill every finished category at once — the
      // normal case for a one-off run right after this feature ships.
      const { data: cats } = await supabaseAdmin.from('tournament_categories').select('id').eq('status', 'done');
      categoryIds = (cats || []).map((c) => c.id);
    }

    // Each category isolated in its own try/catch: one tournament with
    // unexpected data (an old bracket shape, a stray null) must not
    // abort the whole batch, and must show up by id instead of taking
    // down every other, already-fine category with it.
    const results = [];
    for (const id of categoryIds) {
      try {
        results.push({ categoryId: id, ...(await recalcPlacementsForCategory(supabaseAdmin, id)) });
      } catch (err) {
        console.error(`[placements-recalc] category ${id} failed:`, err.message, err.stack);
        results.push({ categoryId: id, ok: false, error: err.message });
      }
    }

    const failed = results.filter((r) => !r.ok);
    const totalPlacements = results.reduce((sum, r) => sum + (r.placements || 0), 0);

    return Response.json({
      success: failed.length === 0,
      categories: results.length,
      placements: totalPlacements,
      failed: failed.length,
      results,
    });
  } catch (err) {
    console.error('[placements-recalc] Unexpected error:', err.message, err.stack);
    return Response.json({ success: false, error: `Помилка сервера: ${err.message}` }, { status: 500 });
  }
}
