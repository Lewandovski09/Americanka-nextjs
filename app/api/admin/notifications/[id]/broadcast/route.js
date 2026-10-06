import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { broadcastTelegramMessage, escapeHtml } from '@/lib/telegram';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// Sends an admin announcement (already saved by ../route) to every
// player's Telegram. Called by the admin page right after saving, in the
// background — the page doesn't wait for it. Only a fresh announcement
// (saved in the last 10 minutes) is sent, so a stray repeat of an old one
// can't message everyone again.
export const maxDuration = 60;

export async function POST(request, { params }) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false }, { status: 401 });
  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) return Response.json({ success: false }, { status: 403 });

  const { data: notification } = await supabaseAdmin
    .from('admin_notifications')
    .select('id, title, body, created_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!notification) return Response.json({ success: false }, { status: 404 });
  // Only fresh ones — a stray repeat of an old one must not spam everyone.
  if (Date.now() - new Date(notification.created_at).getTime() > 10 * 60 * 1000) {
    return Response.json({ success: true, skipped: true });
  }

  const { data: allPlayers } = await supabaseAdmin
    .from('users')
    .select('telegram_user_id')
    .eq('approval_status', 'approved')
    .not('telegram_user_id', 'is', null)
    .not('telegram_linked_at', 'is', null); // linked_at is nulled when someone blocks the bot

  // Admin-typed text goes through escapeHtml: a stray "<" would
  // otherwise make Telegram reject every single send with a 400.
  const text = `📢 <b>${escapeHtml(notification.title)}</b>\n\n${escapeHtml(notification.body)}`;
  const { sent, failed, deadChatIds } = await broadcastTelegramMessage(
    (allPlayers || []).map((p) => p.telegram_user_id),
    text
  );
  console.log('[send-notification] Broadcast finished:', { sent, failed, dead: deadChatIds.length });

  // Players who blocked the bot: mark them unlinked (telegram_user_id
  // stays — a fresh /start brings them back).
  if (deadChatIds.length > 0) {
    await supabaseAdmin.from('users').update({ telegram_linked_at: null }).in('telegram_user_id', deadChatIds);
  }
  return Response.json({ success: true, telegram: { sent, failed } });
}
