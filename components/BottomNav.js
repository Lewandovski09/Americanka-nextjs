'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './BottomNav.module.css';

const ITEMS = [
  { href: '/', label: 'ГОЛОВНА' },
  { href: '/tournaments', label: 'ТУРНІРИ' },
  { href: '/rating', label: 'РЕЙТИНГ' },
  { href: '/profile', label: 'ПРОФІЛЬ' },
];

export default function BottomNav({ isAdmin }) {
  const pathname = usePathname();
  const items = isAdmin ? [...ITEMS, { href: '/admin', label: 'АДМІН' }] : ITEMS;

  return (
    <nav className={styles.nav}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`${styles.navBtn} ${pathname === item.href ? styles.navBtnOn : ''}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
