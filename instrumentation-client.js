// Runs in the browser — this is the current file-naming convention for
// @sentry/nextjs v8+; the SDK renamed this from sentry.client.config.js,
// and only auto-wires this exact filename into the client bundle now.
import * as Sentry from '@sentry/nextjs';
import { dropForeignErrors } from '@/lib/sentryFilter';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 100% of errors, a light sample of normal traces — tune down
  // tracesSampleRate first if the free-tier quota gets tight.
  tracesSampleRate: 0.2,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  // Not the app's errors: browser extensions and scripts a browser puts
  // into the page (lib/sentryFilter). Our own files are never filtered.
  denyUrls: [/^(chrome|moz|safari|safari-web|ms-browser|edge)-extension:/i, /\/executors\/\d+\.js/i],
  beforeSend: dropForeignErrors,
});

// Required by current SDK versions to instrument client-side page
// navigations (App Router route changes) for performance monitoring.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;