'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './BottomNav.module.css';

function HomeIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#e85d4a' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5Z" />
    </svg>
  );
}

function TrophyIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#e85d4a' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" />
    </svg>
  );
}

function StarIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#e85d4a' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
    </svg>
  );
}

function ProfileIcon({ active, photoUrl }) {
  if (photoUrl) {
    return (
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'inline-block',
          border: '1.5px solid rgba(255,255,255,0.4)',
        }}
      >
        <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </span>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#e85d4a' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
    </svg>
  );
}

function AdminIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#e85d4a' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
      <path d="M9.5 12.5l1.8 1.8 3.2-3.6" />
    </svg>
  );
}

const ITEMS = [
  { href: '/', label: 'ГОЛОВНА', Icon: HomeIcon },
  { href: '/tournaments', label: 'ТУРНІРИ', Icon: TrophyIcon },
  { href: '/rating', label: 'РЕЙТИНГ', Icon: StarIcon },
  { href: '/profile', label: 'ПРОФІЛЬ', Icon: ProfileIcon, isProfile: true },
];

export default function BottomNav({ player, requireAuth, onBlocked }) {
  const pathname = usePathname();
  const items = player?.is_admin ? [...ITEMS, { href: '/admin', label: 'АДМІН', Icon: AdminIcon }] : ITEMS;
  const [shrunk, setShrunk] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    let ticking = false;
    function handleScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const delta = currentY - lastScrollY.current;
        // Near the very bottom, resizing this in-flow (sticky) nav
        // changes the document height, which nudges the scroll position,
        // which flips the perceived scroll direction, which resizes the
        // nav again — an oscillation that reads as the page "shaking"
        // when you try to overscroll past the end. Freeze the nav state
        // in that zone so the feedback loop can never start. Also ignore
        // sub-threshold moves so momentum/rubber-band noise can't toggle it.
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        const nearBottom = currentY >= maxY - 24;
        if (!nearBottom && Math.abs(delta) > 4) {
          // Shrink only once the user has scrolled a meaningful amount,
          // so tiny jitters near the top don't trigger it.
          setShrunk(delta > 0 && currentY > 80);
        }
        lastScrollY.current = currentY;
        ticking = false;
      });
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav className={`${styles.nav} ${shrunk ? styles.navShrunk : ''}`}>
      {items.map((item) => {
        const active = pathname === item.href;
        const gated = requireAuth && item.href !== '/';
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(e) => {
              if (gated) {
                e.preventDefault();
                onBlocked?.();
              }
            }}
            className={`${styles.navBtn} ${active ? styles.navBtnOn : ''} ${shrunk ? styles.navBtnShrunk : ''}`}
          >
            <span className={styles.navTile}>
              {item.isProfile ? (
                <item.Icon active={active} photoUrl={player?.photo_url} />
              ) : (
                <item.Icon active={active} />
              )}
            </span>
            <span className={styles.navLabel}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
