import './globals.css';
import AppShell from '@/components/AppShell';
import RegisterSW from '@/components/RegisterSW';
import SentryInit from '@/components/SentryInit';
import { PlayerProvider } from '@/hooks/useCurrentPlayer';
import { VENUE } from '@/lib/venue';
import DialogA11y from '@/components/DialogA11y';
import AppDialogHost from '@/components/AppDialog';

// The site's own address, for absolute links in link previews (Open
// Graph). Vercel provides VERCEL_PROJECT_PRODUCTION_URL; NEXT_PUBLIC_SITE_URL
// can override it.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${VENUE.brandName.toUpperCase()} — ${VENUE.venueName}`,
  openGraph: {
    siteName: VENUE.brandName,
    images: ['/icons/icon-512.png'],
    locale: 'uk_UA',
    type: 'website',
  },
  description: `Турніри Americanka для пляжного волейболу. ${VENUE.fullLocation}.`,
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: VENUE.brandName,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d2347',
};

export default function RootLayout({ children }) {
  return (
    <html lang="uk">
      <body>
        <SentryInit />
        <RegisterSW />
        <DialogA11y />
        <AppDialogHost />
        <PlayerProvider>
          <AppShell>{children}</AppShell>
        </PlayerProvider>
      </body>
    </html>
  );
}