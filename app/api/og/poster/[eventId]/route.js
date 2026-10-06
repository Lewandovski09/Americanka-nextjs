// The tournament poster (афіша) as a PNG — the picture of the Telegram
// announcements (lib/server/eventAnnouncement). See lib/eventPoster.
//
// Public on purpose: Telegram downloads the picture by this link, and it
// shows only what the app already shows to every player.
// Fonts: the same Latin + Cyrillic subset of Inter as the card picture
// (FONT-LICENSE.txt next to this file).

import { ImageResponse } from 'next/og';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEventCardData } from '@/lib/server/eventCardData';
import { EventPoster, POSTER_WIDTH, POSTER_HEIGHT } from '@/lib/eventPoster';

export const runtime = 'edge';

const fonts = Promise.all([
  fetch(new URL('./Inter-Medium.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-SemiBold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-Bold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('./Inter-ExtraBold.otf', import.meta.url)).then((r) => r.arrayBuffer()),
]);

// The app's logo (public/icons/icon-512, made smaller) as a data: URL.
const logo = fetch(new URL('./logo.png', import.meta.url))
  .then((r) => r.arrayBuffer())
  .then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
  })
  .catch(() => null);

export async function GET(_request, { params }) {
  const data = await loadEventCardData(createAdminClient(), params.eventId);
  if (!data) return new Response('Not found', { status: 404 });

  const [[medium, semibold, bold, extrabold], logoSrc] = await Promise.all([fonts, logo]);
  return new ImageResponse(<EventPoster data={data} logo={logoSrc} />, {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    fonts: [
      { name: 'Inter', data: medium, weight: 500, style: 'normal' },
      { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
      { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      { name: 'Inter', data: extrabold, weight: 800, style: 'normal' },
    ],
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
