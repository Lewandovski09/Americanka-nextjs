'use client';

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

    // TEMPORARY — exposes Sentry on window so we can call
    // Sentry.captureException() directly from the DevTools console,
    // bypassing any quirks in how a bare `throw` in the console
    // context reaches window.onerror. Remove once confirmed working.
    if (typeof window !== 'undefined') {
      window.Sentry = Sentry;
    }
  }, []);

  return null;
}