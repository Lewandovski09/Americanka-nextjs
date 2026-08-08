import './globals.css';
import AppShell from '@/components/AppShell';
import RegisterSW from '@/components/RegisterSW';
import SentryInit from '@/components/SentryInit';
import { VENUE } from '@/lib/venue';

export const metadata = {
  title: `${VENUE.brandName.toUpperCase()} — ${VENUE.venueName}`,
  description: `Турніри американка для пляжного волейболу. ${VENUE.fullLocation}.`,
  manifest: '/manifest.json',
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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}