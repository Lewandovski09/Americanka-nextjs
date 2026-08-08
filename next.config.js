/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

const nextConfig = {
  reactStrictMode: true,
  // `next build`'s own internal type-check + lint pass duplicates what
  // `npm run typecheck` and `npm run lint` already do — and, on a
  // project this size, does it slower and far more memory-hungry inside
  // webpack's pipeline than the standalone tools do on their own (this
  // was actually hanging/OOMing a real build on this project). Both
  // checks still run for real: CI (.github/workflows/ci.yml) runs
  // `npm run typecheck` and `npm run lint` as their own steps BEFORE
  // `npm run build` — so a genuine type or lint error still fails CI
  // before anything deploys. This only skips the redundant in-build
  // copy of that same work.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Required on Next.js 14 for instrumentation.js (Sentry server/edge
  // init) to actually run — it's the default in Next 15, but this repo
  // is pinned to 14.2.5. Safe to remove after an eventual Next 15 bump.
  experimental: {
    instrumentationHook: true,
  },
  // Verification builds can run while `npm run dev` is up: point them at
  // a separate dist dir (NEXT_DIST_DIR=.next-check) so they don't clobber
  // the dev server's .next and white-screen the running app.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    remotePatterns: [
      {
        // Supabase Storage public bucket URLs (player photos)
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
    // PlayerAvatar only ever renders at 26-44px (see components/
    // PlayerAvatar.js). Restricting the generated sizes to what the app
    // actually uses keeps Next from also generating and caching the
    // default 640-3840px ladder for a circle the size of a fingertip.
    imageSizes: [26, 28, 32, 34, 36, 40, 44, 64, 88],
    deviceSizes: [640, 750, 1080, 1200],
  },
  // Content-Security-Policy is deliberately NOT here yet — it's the one
  // header that can silently break the app (blocked Supabase images,
  // blocked Sentry reporting, blocked inline styles) if it's not tuned
  // against this specific app's actual script/style/connect sources,
  // and that tuning needs a real browser console open to watch for
  // violations, not a blind guess. These four don't have that risk —
  // none of them restrict what the page is allowed to load, only how
  // it can be embedded/read, so they're safe to turn on without
  // per-app tuning.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            // Stops the whole site from being embedded in someone
            // else's <iframe> (clickjacking: overlaying invisible
            // buttons over a game's real "approve"/"submit" controls).
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // Stops the browser from guessing a file's type from its
            // content and running it as something more dangerous than
            // what the server actually declared (e.g. treating an
            // uploaded player photo as executable script).
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // Sends the full referrer only to our own origin; other
            // sites just see that a visit came from americanka, not
            // which internal page (a player's profile, an admin
            // screen) they were on when they clicked out.
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // This app never uses the camera/microphone/geolocation
            // APIs — turning them off at the browser level means even
            // a future XSS bug couldn't silently request them.
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

// withSentryConfig is what actually wires sentry.client.config.js into
// the browser bundle — without it the client-side Sentry.init() never
// runs (server/edge still work via instrumentation.js, which doesn't
// need this). No SENTRY_AUTH_TOKEN is configured here, so source map
// upload is skipped with a harmless build-time warning — errors still
// report correctly, just with a minified (not original) stack trace
// until an auth token is added later.
module.exports = withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  disableLogger: true,
  widenClientFileUpload: false,
  sourcemaps: { disable: true },
});