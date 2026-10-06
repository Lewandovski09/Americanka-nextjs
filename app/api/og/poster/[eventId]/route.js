// The tournament poster (афіша) as a PNG — the picture of the Telegram
// announcements (lib/server/eventAnnouncement). See lib/eventPoster.
//
// Public on purpose: Telegram downloads the picture by this link, and it
// shows only what the app already shows to every player.
// Fonts: the same Latin + Cyrillic subset of Inter as the card picture
// (three weights only — the function must stay under 1 MB)
// (FONT-LICENSE.txt next to this file).

import { ImageResponse } from 'next/og';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEventCardData } from '@/lib/server/eventCardData';
import { EventPoster, POSTER_WIDTH, POSTER_HEIGHT } from '@/lib/eventPoster';

export const runtime = 'edge';

const fonts = Promise.all([
  fetch(new URL('./Inter-SemiBold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-Bold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-ExtraBold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
]);

// The app's logo — fetched from the site's own public/icons at draw time
// (bundling it made this function too big for the plan's 1 MB limit).
async function loadLogo(request) {
  try {
    const res = await fetch(new URL('/icons/icon-192.png', request.url));
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export async function GET(request, { params }) {
  const data = await loadEventCardData(createAdminClient(), params.eventId);
  if (!data) return new Response('Not found', { status: 404 });

  const [[semibold, bold, extrabold], logoSrc] = await Promise.all([fonts, loadLogo(request)]);
  return new ImageResponse(<EventPoster data={data} logo={logoSrc} />, {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    fonts: [
      { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
      { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      { name: 'Inter', data: extrabold, weight: 800, style: 'normal' },
    ],
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
