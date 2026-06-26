'use client';

import { usePathname } from 'next/navigation';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import BottomNav from './BottomNav';

// Pages where the bottom nav should NEVER show, regardless of
// auth state — these are the public/auth screens.
const NO_NAV_PATHS = ['/register', '/login'];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { player } = useCurrentPlayer();

  const isAuthPage = NO_NAV_PATHS.includes(pathname);
  const showNav = player && !isAuthPage;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <div style={{ flex: 1 }}>{children}</div>
      {showNav && <BottomNav isAdmin={player.is_admin} />}
    </div>
  );
}
