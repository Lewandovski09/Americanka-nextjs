import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CATEGORY_STARTING_ELO, categoryForElo } from '@/lib/elo';
import { trySendTelegramMessage, escapeHtml } from '@/lib/telegram';

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

  // Telegram is how a player hears about approvals, tournaments and
  // schedule changes, so approving someone who never linked it means
  // they silently miss everything. This check is where the link is
  // actually enforced — it replaces the old 4-digit code as the gate.
  const { data: target } = await supabaseAdmin
    .from('players')
    .select('telegram_user_id, telegram_linked_at')
    .eq('id', playerId)
    .maybeSingle();

  if (!target?.telegram_user_id || !target?.telegram_linked_at) {
    return Response.json(
      { success: false, error: 'Гравець ще не підключив Telegram — підтвердити неможливо' },
      { status: 400 }
    );
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
  if (player.telegram_user_id) {
    // Non-fatal by design — the in-app popup still informs them, so a
    // Telegram failure must never block the approval itself.
    const { blocked } = await trySendTelegramMessage(
      player.telegram_user_id,
      `✅ <b>Ваш рейтинг підтверджено!</b>\n\nСтартовий рейтинг Ело: <b>${escapeHtml(finalElo)}</b>\nКатегорія: <b>${escapeHtml(finalCategory)}</b>\n\nТепер ви можете брати участь у турнірах AMERICANKA!`
    );

    if (blocked) {
      // Unreachable — clear reachability but keep the identity.
      await supabaseAdmin.from('players').update({ telegram_linked_at: null }).eq('id', playerId);
    }
  }

  return Response.json({ success: true, player });
}
