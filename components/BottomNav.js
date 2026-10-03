'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import styles from './BottomNav.module.css';

const ACTIVE = '#ff7a66'; // coral, a touch lighter so it glows on the glass
const IDLE = 'rgba(255,255,255,0.78)';

function HomeIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : IDLE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5Z" />
    </svg>
  );
}

function TrophyIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : IDLE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" />
    </svg>
  );
}

function StarIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : IDLE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : IDLE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
    </svg>
  );
}

function AdminIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : IDLE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const router = useRouter();
  const items = player?.is_admin ? [...ITEMS, { href: '/admin', label: 'АДМІН', Icon: AdminIcon }] : ITEMS;
  const n = items.length;

  // The section the bar belongs to: exact for «/», prefix for the rest,
  // so /tournaments/123 still lights up «Турніри».
  // -1 on pages outside the bar's sections (another player's profile…):
  // then no tab is lit and the lens fades out.
  const activeIndex = items.findIndex((it) => (it.href === '/' ? pathname === '/' : pathname.startsWith(it.href)));

  // ── The glass lens ──
  // It sits under the active tab and glides to a new one. Drag a finger
  // along the bar and it follows the finger; let go and it opens the tab
  // it is over — like the iOS tab bar in the reference video.
  const barRef = useRef(null);
  const [drag, setDrag] = useState(null); // { x } while a finger is on the bar
  const dragMoved = useRef(false);
  const startX = useRef(0);

  const PAD = 5; // the bar's inner padding (BottomNav.module.css)
  function xToIndex(x) {
    const w = barRef.current?.clientWidth || 1;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - PAD) / (w - 2 * PAD)) * n)));
  }
  function localX(e) {
    const r = barRef.current.getBoundingClientRect();
    return Math.min(r.width, Math.max(0, e.clientX - r.left));
  }

  function onPointerDown(e) {
    if (!barRef.current) return;
    startX.current = e.clientX;
    dragMoved.current = false;
    setDrag({ x: localX(e) });
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (Math.abs(e.clientX - startX.current) > 8) {
      if (!dragMoved.current) barRef.current.setPointerCapture?.(e.pointerId);
      dragMoved.current = true;
    }
    if (dragMoved.current) setDrag({ x: localX(e) });
  }
  function onPointerUp(e) {
    if (!drag) return;
    const moved = dragMoved.current;
    const idx = xToIndex(localX(e));
    setDrag(null);
    if (!moved) return; // a plain tap — the link handles it
    const item = items[idx];
    if (requireAuth && item.href !== '/') {
      onBlocked?.();
      return;
    }
    if (idx !== activeIndex) router.push(item.href);
  }

  const lensIndex = drag && dragMoved.current ? xToIndex(drag.x) : activeIndex;
  // While dragging the lens is centred on the finger (kept inside the
  // capsule); otherwise it sits on its tab.
  let lensStyle;
  if (drag && dragMoved.current && barRef.current) {
    const w = barRef.current.clientWidth;
    const itemW = (w - 2 * PAD) / n;
    const left = Math.min(w - PAD - itemW, Math.max(PAD, drag.x - itemW / 2));
    lensStyle = { left, width: itemW, transition: 'none', transform: 'scale(1.1)' };
  } else {
    lensStyle = {
      left: `calc(${PAD}px + (100% - ${2 * PAD}px) * ${Math.max(0, activeIndex)} / ${n})`,
      width: `calc((100% - ${2 * PAD}px) / ${n})`,
      opacity: activeIndex < 0 ? 0 : 1,
    };
  }

  return (
    <nav className={styles.nav}>
      <div
        ref={barRef}
        className={styles.bar}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <span className={styles.lens} style={lensStyle} aria-hidden="true" />
        {items.map((item, i) => {
          const active = i === lensIndex;
          const gated = requireAuth && item.href !== '/';
          return (
            <Link
              key={item.href}
              href={item.href}
              draggable={false}
              onClick={(e) => {
                // A drag ends in onPointerUp — the click that follows it
                // must not open the tab the finger started on.
                if (dragMoved.current) {
                  e.preventDefault();
                  dragMoved.current = false;
                  return;
                }
                if (gated) {
                  e.preventDefault();
                  onBlocked?.();
                }
              }}
              className={`${styles.navBtn} ${active ? styles.navBtnOn : ''}`}
              aria-current={i === activeIndex ? 'page' : undefined}
            >
              {item.isProfile ? (
                <item.Icon active={active} photoUrl={player?.photo_url} />
              ) : (
                <item.Icon active={active} />
              )}
              <span className={styles.navLabel}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
