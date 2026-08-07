// middleware.js runs on the Edge runtime, which can't use the Node
// server SDK — this lighter config covers it. Same no-DSN-no-op note
// as sentry.client.config.js.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  environment: process.env.NODE_ENV,
});
