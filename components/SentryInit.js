'use client';

// Explicit, code-verified Sentry init for the browser — deliberately
// NOT relying on the instrumentation-client.js / sentry.client.config.js
// filename-convention auto-wiring (which depends on exact Next.js +
// @sentry/nextjs version combinations we couldn't reliably confirm).
// This component is imported directly into the app tree in
// app/layout.js, so its execution is guaranteed by the same import
// graph that already renders every other page — no naming convention,
// no auto-detection, nothing to silently miss.
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

let initialized = false;

export default function SentryInit() {
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.2,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    });
  }, []);

  return null;
}