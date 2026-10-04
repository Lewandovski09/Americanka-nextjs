// Minimal service worker for AMERICANKA.
//
// This exists so the site qualifies as an installable PWA (Add to
// Home Screen). It deliberately does NOT cache pages, API calls, or
// Supabase requests — live scores, chat, and the rating board need
// to always be fresh. If real offline support is wanted later, add
// caching here on purpose and test it against stale-data scenarios
// first.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No «fetch» listener on purpose: an empty one still makes the browser
// start this worker for every request and navigation (slower, and
// Chrome warns about it). Without it everything goes straight to the
// network, which is what the app wants.
