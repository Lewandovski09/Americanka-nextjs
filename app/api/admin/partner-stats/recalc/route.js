// Rebuilds partner_stats for the whole club from scratch — see
// recalcAllPartnerStats in lib/server/finishCategory.ts for why an
// accumulating counter needs this escape hatch at all.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recalcAllPartnerStats } from '@/lib/server/finishCategory';

export async function POST() {
  try {
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

    const result = await recalcAllPartnerStats(supabaseAdmin);
    if (!result.ok) {
      return Response.json({ success: false, error: result.error }, { status: 500 });
    }

    return Response.json({ success: true, tournaments: result.tournaments });
  } catch (err) {
    console.error('[partner-stats-recalc] Unexpected error:', err.message, err.stack);
    return Response.json({ success: false, error: `Помилка сервера: ${err.message}` }, { status: 500 });
  }
}
