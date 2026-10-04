// The installable-app description (PWA), built from lib/venue — the
// club's name and place live in one file, not copied here by hand.
// Next serves this as /manifest.webmanifest and links it in <head>.
import { VENUE } from '@/lib/venue';

export default function manifest() {
  return {
    name: `${VENUE.brandName.toUpperCase()} — ${VENUE.venueName}`,
    short_name: VENUE.brandName,
    description: `Турніри пляжного волейболу: заявки, сітка, рейтинг Ело. ${VENUE.venueName}, ${VENUE.address}.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d2347',
    theme_color: '#0d2347',
    lang: 'uk',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
