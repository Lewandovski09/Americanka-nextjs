'use client';

import { usePathname } from 'next/navigation';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import BottomNav from './BottomNav';
import GlobalNotice from './GlobalNotice';
import SideCourtDecor from './SideCourtDecor';

// Pages where the bottom nav AND the dark background card should
// NEVER show — these are the public/auth screens, which have their
// own self-contained design.
const NO_SHELL_PATHS = ['/register', '/login'];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { player } = useCurrentPlayer();

  const isAuthPage = NO_SHELL_PATHS.includes(pathname);
  const showNav = player && !isAuthPage;

  if (isAuthPage) {
    // Auth screens render full-bleed with their own background.
    return <>{children}</>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative' }}>
      <SideCourtDecor />
      <GlobalNotice player={player} />
      <div style={{ flex: 1, position: 'relative', zIndex: 1, maxWidth: 900, width: '100%', margin: '0 auto' }}>
        {children}
      </div>
      {showNav && <BottomNav player={player} />}
    </div>
  );
}
