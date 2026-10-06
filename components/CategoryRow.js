'use client';

import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './CategoryRow.module.css';

export default function CategoryRow({ category: c, href, showGender }) {
  const open = !c.status || c.status === 'scheduled';
  return (
    <a href={href} className={styles.row}>
      <div className={styles.top}>
        <span className={styles.label}>{c.category_label}</span>
        {/* Men's / women's league — always said; «Мікс» only for pair formats. */}
        {c.gender === 'M' || c.gender === 'F' ? (
          <span className={`${styles.badge} ${c.gender === 'F' ? styles.badgeF : styles.badgeM}`}>
            {c.gender === 'M' ? 'Чоловіки' : 'Жінки'}
          </span>
        ) : showGender ? (
          <span className={styles.badge}>Мікс</span>
        ) : null}
        {c.bracketLabel && <span className={styles.badge}>{c.bracketLabel}</span>}
        {c.avpTier ? <span className={styles.badge}>AVP {c.avpTier}</span> : null}
      </div>

      <div className={styles.slotsRow}>
        <div className={styles.avatarStack}>
          {(c.players || []).slice(0, 6).map((p, i) => (
            <span key={p.id} className={styles.avatarStackItem} style={{ zIndex: 6 - i }}>
              <PlayerAvatar player={p} size={26} />
            </span>
          ))}
        </div>
        {/* Free places matter only while registration is open — once the
            category has started or finished, just how many play. */}
        <div className={styles.slotsCount}>
          {open ? `${c.slotsTaken}/${c.slotsTotal} ${c.slotsLabel} · ${c.spotsLeft} вільно` : `${c.slotsTaken} ${c.slotsLabel}`}
        </div>
      </div>
      {open && (
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${c.slotsTotal > 0 ? Math.min(100, (c.slotsTaken / c.slotsTotal) * 100) : 0}%` }}
          />
        </div>
      )}
    </a>
  );
}
