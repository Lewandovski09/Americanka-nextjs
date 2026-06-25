'use client';

import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import BottomNav from './BottomNav';

export default function AppShell({ children }) {
  const { player } = useCurrentPlayer();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <div style={{ flex: 1 }}>{children}</div>
      {player && <BottomNav isAdmin={player.is_admin} />}
    </div>
  );
}
