/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
};

module.exports = nextConfig;
