import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CATEGORY_STARTING_ELO, categoryForElo } from '@/lib/elo';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(request, { params }) {
  const { playerId } = params;
  const { elo: requestedElo, category } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  // Verify the caller is actually an admin (defense in depth — RLS
  // also enforces this at the DB level, but we check here too for
  // a clean error message).
  const { data: caller } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();

  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може підтверджувати рейтинг' }, { status: 403 });
  }

  const finalElo = requestedElo || CATEGORY_STARTING_ELO[category] || 1050;
  const finalCategory = categoryForElo(finalElo)?.id || category;

  const { data: player, error } = await supabaseAdmin
    .from('players')
    .update({
      elo: finalElo,
      category: finalCategory,
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: authUser.user.id,
      rating_approved_notified: false, // so the player sees the popup on next login
    })
    .eq('id', playerId)
    .select()
    .single();

  if (error) {
    console.error('[approve-player] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося підтвердити гравця' }, { status: 500 });
  }

  await supabaseAdmin.from('admin_actions').insert({
    admin_id: authUser.user.id,
    action_type: 'approve_player',
    target_player_id: playerId,
    details: { elo: finalElo, category: finalCategory },
  });

  // Push an immediate Telegram notification too (in addition to the
  // in-app popup on next login) — players get the good news right away.
  if (player.telegram_chat_id) {
    try {
      await sendTelegramMessage(
        player.telegram_chat_id,
        `✅ <b>Ваш рейтинг підтверджено!</b>\n\nСтартовий рейтинг Ело: <b>${finalElo}</b>\nКатегорія: <b>${finalCategory}</b>\n\nТепер ви можете брати участь у турнірах AMERICANKA!`
      );
    } catch (e) {
      console.error('[approve-player] Telegram notification failed:', e.message);
      // Non-fatal — the in-app popup will still inform them.
    }
  }

  return Response.json({ success: true, player });
}
