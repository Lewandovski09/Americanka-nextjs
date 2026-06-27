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

self.addEventListener('fetch', () => {
  // Intentionally not intercepting — everything goes to the network.
});
