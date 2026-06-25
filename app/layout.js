import './globals.css';
import AppShell from '@/components/AppShell';

export const metadata = {
  title: 'AMERICANKA — Пляж 13',
  description: 'Турніри американка для пляжного волейболу. Пляж 13, Станція Фонтана, Одеса.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="uk">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
