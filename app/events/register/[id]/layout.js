import { headers } from 'next/headers';
import { createPublicClient } from '@/lib/supabase/public';
import { PREVIEW_BOT_RE } from '@/lib/previewBots';
import { getFormat } from '@/lib/formats';
import { eventDateLabel } from '@/lib/server/eventCardData';

// Link preview of a tournament's registration page — the link the
// «Записатися» button of the Telegram announcement opens, and the one
// people forward. The picture is the tournament card itself
// (app/api/og/event/[eventId]).
export async function generateMetadata({ params }) {
  if (!PREVIEW_BOT_RE.test(headers().get('user-agent') || '')) return {};
  try {
    const { data: ev } = await createPublicClient()
      .from('tournament_events')
      .select('id, name, format_kind, scheduled_at')
      .eq('id', params.id)
      .maybeSingle();
    if (!ev) return {};
    const title = `${ev.name || getFormat(ev.format_kind)?.displayName || 'Турнір'} · Реєстрація`;
    const description = `${getFormat(ev.format_kind)?.displayName || 'Americanka'} · ${eventDateLabel(ev.scheduled_at)}`;
    const images = [`/api/og/event/${ev.id}`];
    return {
      title,
      description,
      openGraph: { title, description, images },
      twitter: { card: 'summary_large_image', title, description, images },
    };
  } catch {
    return {};
  }
}

export default function EventRegisterLayout({ children }) {
  return children;
}
