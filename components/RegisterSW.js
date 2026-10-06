'use client';

import { useEffect } from 'react';

// Key in localStorage: set whenever the site runs from the home-screen
// icon. The hand-over page behind Telegram links (lib/server/openInApp)
// uses it to open the page at the address where this phone's app — and
// its sign-in — lives.
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
      // storage blocked — the hand-over page just won't know about it
    }
  }, []);

  return null;
}
