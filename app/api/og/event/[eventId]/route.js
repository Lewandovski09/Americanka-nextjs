// The tournament card as a PNG — for the Telegram announcement
// (lib/server/eventAnnouncement). Same look as «Найближчий турнір» on the
// home page; see lib/eventCard for how it is drawn.
//
// Public on purpose: Telegram downloads the picture by this link, and it
// shows only what the home page already shows to everyone.
// Fonts: a Latin + Cyrillic subset of Inter next to this file
// (FONT-LICENSE.txt) — the picture renderer has no Cyrillic of its own.

import { ImageResponse } from 'next/og';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEventCardData } from '@/lib/server/eventCardData';
import { EventCard, CARD_WIDTH, cardHeight } from '@/lib/eventCard';

export const runtime = 'edge';

const fonts = Promise.all([
  fetch(new URL('./Inter-Medium.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-SemiBold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-Bold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-ExtraBold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
]);

export async function GET(request, { params }) {
  // ?kind=schedule — the «Розклад готовий» picture: only the started
  // categories, final rosters (lib/server/scheduleNotice)
  // ?kind=results — «Турнір завершено»: the finished categories, top three (lib/server/resultsNotice)
  const kind = new URL(request.url).searchParams.get('kind');
  const data = await loadEventCardData(createAdminClient(), params.eventId, { schedule: kind === 'schedule', results: kind === 'results' });
  if (!data) return new Response('Not found', { status: 404 });

  const [medium, semibold, bold, extrabold] = await fonts;
  return new ImageResponse(<EventCard data={data} />, {
    width: CARD_WIDTH,
    height: cardHeight(data),
    fonts: [
      { name: 'Inter', data: medium, weight: 500, style: 'normal' },
      { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
      { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      { name: 'Inter', data: extrabold, weight: 800, style: 'normal' },
    ],
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
