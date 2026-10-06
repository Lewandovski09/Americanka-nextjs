import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { escapeHtml } from '@/lib/telegram';
import { sendEventCardMessage } from '@/lib/server/eventAnnouncement';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { appLink, browserButton } from '@/lib/server/openInApp';
import { getAuthUser } from '@/lib/server/authUser';

// The Telegram note about a pair invitation, sent separately from the
// invitation itself, so the player doesn't wait for it: the page calls
// this right after «Запрошення надіслано» / «Прийняти».
//   • a pending invitation, asked by its sender → the invitee gets
//     «… хоче зіграти з вами в парі»;
//   • an accepted one, asked by the one who accepted → the sender gets
//     «… прийняв(-ла) ваше запрошення».
// Anything else is ignored.
export const maxDuration = 30;

export async function POST(request, { params }) {
  const { eventId, inviteId } = params;
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false }, { status: 401 });
  const me = authUser.user.id;

  const supabaseAdmin = createAdminClient();
  const { data: inv } = await supabaseAdmin
    .from('pair_invites')
    .select('id, event_id, from_user, to_user, status')
    .eq('id', inviteId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (!inv) return Response.json({ success: false }, { status: 404 });

  let to;
  let caption;
  let button;
  const { data: people } = await supabaseAdmin
    .from('users')
    .select('id, full_name, telegram_user_id, telegram_linked_at')
    .in('id', [inv.from_user, inv.to_user]);
  const sender = (people || []).find((u) => u.id === inv.from_user);
  const invitee = (people || []).find((u) => u.id === inv.to_user);

  if (inv.status === 'pending' && me === inv.from_user) {
    to = invitee;
    caption =
      `🤝 <b>${escapeHtml(sender?.full_name || 'Гравець')}</b> хоче зіграти з вами в парі на турнірі.\n\n` +
      'Відкрийте турнір, щоб прийняти або відхилити запрошення.';
    button = '🤝 Відкрити запрошення';
  } else if (inv.status === 'accepted' && me === inv.to_user) {
    to = sender;
    caption = `✅ <b>${escapeHtml(invitee?.full_name || 'Гравець')}</b> прийняв(-ла) ваше запрошення — ви в парі на турнірі!`;
    button = 'Відкрити турнір';
  } else {
    return Response.json({ success: true, skipped: true });
  }

  if (!to?.telegram_user_id || !to?.telegram_linked_at) return Response.json({ success: true, skipped: true });
  const site = publicSiteUrl(request);
  if (!site) return Response.json({ success: true, skipped: true });

  const r = await sendEventCardMessage(to.telegram_user_id, {
    siteUrl: site,
    eventId,
    caption,
    keyboard: browserButton(button, appLink(site, `/events/register/${eventId}`)),
  });
  if (r.blocked) await supabaseAdmin.from('users').update({ telegram_linked_at: null }).eq('id', to.id);
  return Response.json({ success: true, sent: !!r.ok });
}
