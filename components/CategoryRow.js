'use client';

import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './CategoryRow.module.css';

export default function CategoryRow({ category: c, href, showGender }) {
  return (
    <a href={href} className={styles.row}>
      <div className={styles.top}>
        <span className={styles.label}>{c.category_label}</span>
        {showGender && (
          <span className={styles.badge}>{c.gender === 'M' ? 'Чоловіки' : c.gender === 'F' ? 'Жінки' : 'Мікс'}</span>
        )}
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
        <div className={styles.slotsCount}>
          {c.slotsTaken}/{c.slotsTotal} {c.slotsLabel} · {c.spotsLeft} вільно
        </div>
      </div>
      <div className={styles.progressBar}>
        <div
          className={styles.progressFill}
          style={{ width: `${c.slotsTotal > 0 ? Math.min(100, (c.slotsTaken / c.slotsTotal) * 100) : 0}%` }}
        />
      </div>
    </a>
  );
}
