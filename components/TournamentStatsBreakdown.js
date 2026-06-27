'use client';

import { useState } from 'react';
import { IconChevronDown } from '@/components/Icons';
import styles from './TournamentStatsBreakdown.module.css';

function groupBy(list, keyFn) {
  const out = {};
  list.forEach((item) => {
    const k = keyFn(item) || '—';
    if (!out[k]) out[k] = [];
    out[k].push(item);
  });
  return out;
}

/**
 * Expandable breakdown of tournament count + 1st/2nd/3rd place
 * counts, each opening to show the detail (by format+category for
 * the total, by tournament+category for each placement).
 *
 * `history` is the array returned by get_player_tournament_history
 * (tournament_id, tournament_name, format_name, category, placement, ...).
 */
export default function TournamentStatsBreakdown({ history }) {
  const [openKey, setOpenKey] = useState(null);

  const byPlacement = (n) => history.filter((h) => h.placement === n);
  const formatBreakdown = groupBy(history, (h) => h.format_name || 'AMERICANKA 2x2');

  const rows = [
    { key: 'total', label: 'Турнірів зіграно', count: history.length, type: 'formats' },
    { key: 'p1', label: '1-і місця', count: byPlacement(1).length, type: 'list', list: byPlacement(1) },
    { key: 'p2', label: '2-і місця', count: byPlacement(2).length, type: 'list', list: byPlacement(2) },
    { key: 'p3', label: '3-і місця', count: byPlacement(3).length, type: 'list', list: byPlacement(3) },
  ];

  return (
    <div className={styles.wrap}>
      {rows.map((row, i) => (
        <div key={row.key} className={`${styles.statRow} ${i === rows.length - 1 ? styles.statRowLast : ''}`}>
          <button className={styles.statHeader} onClick={() => setOpenKey(openKey === row.key ? null : row.key)}>
            <span className={styles.statLabel}>{row.label}</span>
            <span className={styles.statRight}>
              <span className={styles.statCount}>{row.count}</span>
              <span className={`${styles.arrow} ${openKey === row.key ? styles.arrowOpen : ''}`}>
                <IconChevronDown size={13} />
              </span>
            </span>
          </button>

          {openKey === row.key && (
            <div className={styles.statBody}>
              {row.type === 'formats' ? (
                history.length === 0 ? (
                  <div className={styles.empty}>Ще немає турнірів</div>
                ) : (
                  Object.entries(formatBreakdown).map(([format, list]) => {
                    const cats = groupBy(list, (h) => h.category);
                    return (
                      <div key={format} className={styles.formatBlock}>
                        <div className={styles.formatName}>
                          {format} — {list.length}
                        </div>
                        <div className={styles.catRow}>
                          {Object.entries(cats).map(([cat, items]) => (
                            <span key={cat} className={styles.catChip}>
                              Кат. {cat}: {items.length}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )
              ) : row.list.length === 0 ? (
                <div className={styles.empty}>Ще не було</div>
              ) : (
                row.list.map((h) => (
                  <div key={h.tournament_id} className={styles.placeItem}>
                    <span className={styles.placeName}>{h.tournament_name}</span>
                    <span className={styles.placeCat}>Кат. {h.category || '—'}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
