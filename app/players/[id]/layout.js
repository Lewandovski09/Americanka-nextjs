import { headers } from 'next/headers';
import { createPublicClient } from '@/lib/supabase/public';
import { PREVIEW_BOT_RE } from '@/lib/previewBots';
import { categoryForElo } from '@/lib/elo';

// Link preview of a player's page: name, category and Ело, their photo.
export async function generateMetadata({ params }) {
  // Only link-preview bots get the rich head (see lib/previewBots).
  if (!PREVIEW_BOT_RE.test(headers().get('user-agent') || '')) return {};
  try {
    const supabase = createPublicClient();
    const { data: u } = await supabase
      .from('users')
      .select('full_name, elo, photo_url, approval_status')
      .eq('id', params.id)
      .maybeSingle();
    if (!u) return {};
    const title = u.full_name || 'Гравець';
    const cat = categoryForElo(u.elo);
    const description = [cat?.label, u.elo != null ? `Ело ${u.elo}` : null].filter(Boolean).join(' · ') || 'Гравець Americanka';
    const images = u.photo_url ? [u.photo_url] : ['/icons/icon-512.png'];
    return { title, description, openGraph: { title, description, images, type: 'profile' } };
  } catch {
    return {};
  }
}

export default function PlayerLayout({ children }) {
  return children;
}
