// Runs once per server process (route handlers, server components,
// middleware runs separately — see sentry.edge.config.js). Same
// no-DSN-no-op note as instrumentation-client.js.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  environment: process.env.NODE_ENV,
});