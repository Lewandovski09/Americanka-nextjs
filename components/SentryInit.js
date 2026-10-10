'use client';

import { useEffect } from 'react';
import { dropForeignErrors } from '@/lib/sentryFilter';

let initialized = false;

// Sentry is loaded AFTER the page is up (when the browser is idle), as
// its own chunk — it used to sit in the shared first-load bundle of every
// page. Errors before that moment are rare; the server side is covered
// by instrumentation.js regardless.
export default function SentryInit() {
  useEffect(() => {
    if (initialized || !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    initialized = true;
    const start = () =>
      import('@sentry/nextjs').then((Sentry) => {
        Sentry.init({
          dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
          tracesSampleRate: 0.05,
          environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
          // Not the app's errors: browser extensions and scripts a browser
          // puts into the page (lib/sentryFilter). Our own files never are.
          denyUrls: [/^(chrome|moz|safari|safari-web|ms-browser|edge)-extension:/i, /\/executors\/\d+\.js/i],
          beforeSend: dropForeignErrors,
        });
      });
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 4000 });
    else setTimeout(start, 2000);
  }, []);

  return null;
}
