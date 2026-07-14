/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  },
};

module.exports = nextConfig;
