// Next.js calls register() once per runtime on boot. This is the
// documented hook point for wiring up Sentry (or any other
// instrumentation) without touching every route by hand.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
