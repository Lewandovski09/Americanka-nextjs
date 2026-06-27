'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import BottomNav from './BottomNav';
import GlobalNotice from './GlobalNotice';
import SideCourtDecor from './SideCourtDecor';

// Pages where the bottom nav AND the dark background card should
// NEVER show — these are the public/auth screens, which have their
// own self-contained design.
const NO_SHELL_PATHS = ['/register', '/login'];

// Everything under these prefixes requires a logged-in player.
// Logged-out visitors get bounced back to "/" with the auth-gate
// modal explaining why, instead of seeing a broken/empty page.
const GATED_PREFIXES = ['/tournaments', '/rating', '/profile', '/admin', '/players'];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { player, loading } = useCurrentPlayer();
  const [authGateOpen, setAuthGateOpen] = useState(false);

  const isAuthPage = NO_SHELL_PATHS.includes(pathname);
  const isGatedPath = !isAuthPage && GATED_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (!loading && !player && isGatedPath) {
      router.replace('/');
      setAuthGateOpen(true);
    }
  }, [loading, player, isGatedPath, router]);

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
      <BottomNav player={player} requireAuth={!loading && !player} onBlocked={() => setAuthGateOpen(true)} />

      {authGateOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(13, 35, 71, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 500,
            padding: 20,
          }}
          onClick={() => setAuthGateOpen(false)}
        >
          <div
            className="riseIn"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 20,
              padding: '28px 24px',
              maxWidth: 340,
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 800, color: '#14213d', marginBottom: 8 }}>
              Потрібен вхід в акаунт
            </div>
            <div style={{ fontSize: 13.5, color: '#6b7280', lineHeight: 1.5, marginBottom: 20 }}>
              Щоб були доступні всі розділи, увійдіть або зареєструйтесь. Без акаунту відкрита лише головна сторінка.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <a
                href="/register"
                style={{
                  background: '#e85d4a',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  padding: '12px',
                  borderRadius: 12,
                  textDecoration: 'none',
                }}
              >
                Зареєструватися
              </a>
              <a
                href="/login"
                style={{
                  background: 'none',
                  border: '1.5px solid #e6eaf2',
                  color: '#14213d',
                  fontWeight: 700,
                  fontSize: 14,
                  padding: '12px',
                  borderRadius: 12,
                  textDecoration: 'none',
                }}
              >
                Увійти
              </a>
              <button
                onClick={() => setAuthGateOpen(false)}
                style={{ background: 'none', border: 'none', color: '#9aa1b1', fontSize: 13, padding: '6px', cursor: 'pointer' }}
              >
                Залишитись на головній
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
