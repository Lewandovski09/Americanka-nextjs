import { headers } from 'next/headers';
import { createPublicClient } from '@/lib/supabase/public';
import { PREVIEW_BOT_RE } from '@/lib/previewBots';
import { getFormat } from '@/lib/formats';

// Link preview of a tournament (Telegram, WhatsApp, Viber…): its name,
// date and the tournament photo when there is one (migration 054). The
// page itself stays a client page; only the <head> is built here.
export async function generateMetadata({ params }) {
  // Only link-preview bots get the rich head (see lib/previewBots).
  if (!PREVIEW_BOT_RE.test(headers().get('user-agent') || '')) return {};
  try {
    const supabase = createPublicClient();
    const { data: cat } = await supabase
      .from('tournament_categories')
      .select('id, name, category_label, gender, status, scheduled_at, event_id')
      .eq('id', params.id)
      .maybeSingle();
    if (!cat) return {};
    const [{ data: ev }, { data: ph }] = await Promise.all([
      cat.event_id
        ? supabase.from('tournament_events').select('name, format_kind, scheduled_at').eq('id', cat.event_id).maybeSingle()
        : Promise.resolve({ data: null }),
      cat.event_id
        ? supabase.from('tournament_events').select('photo_url').eq('id', cat.event_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const when = new Date(cat.scheduled_at || ev?.scheduled_at || Date.now()).toLocaleDateString('uk', {
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Kyiv',
    });
    const league = [cat.gender === 'M' ? '♂' : cat.gender === 'F' ? '♀' : '', cat.category_label].filter(Boolean).join(' ');
    const title = `${ev?.name || cat.name || 'Турнір'}${league ? ` · ${league}` : ''}`;
    const status = cat.status === 'done' ? 'Результати' : cat.status === 'live' ? 'Йде зараз' : 'Реєстрація';
    const description = `${getFormat(ev?.format_kind)?.displayName || 'Americanka'} · ${when} · ${status}`;
    const images = ph?.photo_url ? [ph.photo_url] : ['/icons/icon-512.png'];
    return { title, description, openGraph: { title, description, images }, twitter: { card: 'summary_large_image', title, description, images } };
  } catch {
    return {};
  }
}

export default function TournamentLayout({ children }) {
  return children;
}
