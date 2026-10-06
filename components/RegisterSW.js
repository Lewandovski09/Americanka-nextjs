'use client';

import { useEffect } from 'react';

// Key in localStorage: set whenever the site runs as the INSTALLED app.
// The installed app and the browser on the same phone share storage, so
// the hand-over page (/open/…) can tell that this phone has the app and
// offer to open it — see lib/server/openInApp.
export const APP_MARK_KEY = 'americanka:app-installed';
const APP_ORIGIN_SENT_KEY = 'americanka:app-origin-sent';

export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-critical — the app works fine without it, this just
        // enables "Add to Home Screen" on some browsers.
      });
    }
    try {
      const standalone =
        window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
      if (standalone) {
        localStorage.setItem(APP_MARK_KEY, String(Date.now()));
        // Tell the server which address this app runs on (migration 065)
        // — once a week is plenty; it retries until it gets through
        // (e.g. the player signs in later).
        const last = Number(localStorage.getItem(APP_ORIGIN_SENT_KEY) || 0);
        if (Date.now() - last > 7 * 24 * 3600 * 1000) {
          fetch('/api/me/app-origin', { method: 'POST' })
            .then((r) => r.ok && localStorage.setItem(APP_ORIGIN_SENT_KEY, String(Date.now())))
            .catch(() => {});
        }
      }
    } catch {
      // storage blocked — the hand-over page just won't know about the app
    }
  }, []);

  return null;
}
