'use client';

import { useEffect } from 'react';

// Key in localStorage: set whenever the site runs as the INSTALLED app.
// The installed app and the browser on the same phone share storage, so
// the hand-over page (/open/…) can tell that this phone has the app and
// offer to open it — see lib/server/openInApp.
export const APP_MARK_KEY = 'americanka:app-installed';

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
      if (standalone) localStorage.setItem(APP_MARK_KEY, String(Date.now()));
    } catch {
      // storage blocked — the hand-over page just won't know about the app
    }
  }, []);

  return null;
}
