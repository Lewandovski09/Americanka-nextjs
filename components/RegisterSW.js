'use client';

import { useEffect } from 'react';

export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-critical — the app works fine without it, this just
        // enables "Add to Home Screen" on some browsers.
      });
    }
  }, []);

  return null;
}
