// Runs once when the app loads in the browser.
//
// No DSN configured yet: create a free project at https://sentry.io,
// grab its DSN, and set NEXT_PUBLIC_SENTRY_DSN in the environment
// (Railway → Variables). Sentry.init with an empty dsn is a documented
// no-op — nothing is sent, nothing breaks — so this file is safe to
// ship before that step happens.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 100% of errors, a light sample of normal traces — tune down
  // tracesSampleRate first if the free-tier quota gets tight.
  tracesSampleRate: 0.2,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
});
