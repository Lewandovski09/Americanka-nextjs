'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './BottomNav.module.css';

const ACTIVE = '#e85d4a'; // the app's coral
const IDLE = 'rgba(16,27,51,0.72)'; // dark: the bar is clear glass over a light page

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
          border: '1.5px solid rgba(16,27,51,0.15)',
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

  // ── The glass lens ── (modelled frame by frame on the reference video)
  //  • at rest: a soft pill under the active tab;
  //  • finger down: the bar swells a little and the lens grows past the
  //    bar's edges, turning into clear glass;
  //  • drag: the lens follows the finger, the tab under it lights up;
  //  • release: it springs onto the chosen tab and shrinks back.
  const barRef = useRef(null);
  const [barW, setBarW] = useState(0);
  const [press, setPress] = useState(null); // { x, moved } while a finger is on the bar
  const [pendingIndex, setPendingIndex] = useState(null); // tapped tab, before the route changes
  const dragMoved = useRef(false);
  const startX = useRef(0);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarW(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  // The route has changed — the lens now follows it again.
  useEffect(() => setPendingIndex(null), [pathname]);

  const PAD = 5; // the bar's inner padding (BottomNav.module.css)
  const itemW = barW ? (barW - 2 * PAD) / n : 0;
  function xToIndex(x) {
    if (!itemW) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor((x - PAD) / itemW)));
  }
  function localX(e) {
    const el = barRef.current;
    const r = el.getBoundingClientRect();
    // The bar is scaled up while held — map back to its own pixels.
    const x = (e.clientX - r.left) * (el.clientWidth / (r.width || 1));
    return Math.min(el.clientWidth, Math.max(0, x));
  }

  function onPointerDown(e) {
    if (!barRef.current) return;
    startX.current = e.clientX;
    dragMoved.current = false;
    setPress({ x: localX(e), moved: false });
  }
  function onPointerMove(e) {
    if (!press) return;
    if (!dragMoved.current && Math.abs(e.clientX - startX.current) > 6) {
      barRef.current.setPointerCapture?.(e.pointerId);
      dragMoved.current = true;
    }
    if (dragMoved.current) setPress({ x: localX(e), moved: true });
  }
  function onPointerUp(e) {
    if (!press) return;
    const idx = xToIndex(localX(e));
    setPress(null);
    if (!dragMoved.current) return; // a plain tap — the link's onClick handles it
    const item = items[idx];
    if (requireAuth && item.href !== '/') {
      onBlocked?.();
      return;
    }
    if (idx !== activeIndex) {
      setPendingIndex(idx);
      router.push(item.href);
    }
  }

  const restIndex = pendingIndex ?? activeIndex;
  const pressed = Boolean(press);
  const lensIndex = press?.moved ? xToIndex(press.x) : restIndex;

  // Geometry in px (relative to the bar's padding box).
  let lensStyle = { opacity: 0 };
  if (itemW) {
    const grow = pressed ? 1.32 : 1; // the swell while the finger is down
    const width = itemW * grow;
    const center = press?.moved ? press.x : PAD + itemW * (Math.max(0, restIndex) + 0.5);
    const left = Math.min(barW - width + 6, Math.max(-6, center - width / 2));
    lensStyle = {
      left,
      width,
      top: pressed ? -8 : PAD,
      bottom: pressed ? -8 : PAD,
      opacity: restIndex < 0 && !pressed ? 0 : 1,
      // Following the finger: no lag. Settling: the springy curve.
      transition: press?.moved ? 'top 0.25s, bottom 0.25s, width 0.25s' : undefined,
    };
  }

  // A tap: the lens leaves for the tapped tab right away, without waiting
  // for the page to load.
  function onTabClick(e, i, gated) {
    if (dragMoved.current) {
      e.preventDefault();
      dragMoved.current = false;
      return;
    }
    if (gated) {
      e.preventDefault();
      onBlocked?.();
      return;
    }
    if (i !== activeIndex) setPendingIndex(i);
  }

  return (
    <nav className={styles.nav}>
      <div
        ref={barRef}
        className={`${styles.bar} ${pressed ? styles.barPressed : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setPress(null)}
      >
        <span className={`${styles.lens} ${pressed ? styles.lensGlass : ''}`} style={lensStyle} aria-hidden="true" />
        {items.map((item, i) => {
          const active = i === lensIndex;
          const gated = requireAuth && item.href !== '/';
          return (
            <Link
              key={item.href}
              href={item.href}
              draggable={false}
              onClick={(e) => onTabClick(e, i, gated)}
              className={`${styles.navBtn} ${active ? styles.navBtnOn : ''} ${active && pressed ? styles.navBtnLifted : ''}`}
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
