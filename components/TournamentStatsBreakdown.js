'use client';

import { useState } from 'react';
import { IconChevronDown } from '@/components/Icons';
import styles from './TournamentStatsBreakdown.module.css';

// Canonical tournament formats. "gendered" covers the single-sex
// bracket format — same slot, but its label switches between
// "Чоловічі"/"Жіночі" depending on the player being viewed, since
// a player only ever plays one side of it.
const FORMATS = [
  { key: 'americanka', label: 'Americanka', aliases: ['americanka', 'americanka 2x2', 'americanka2x2'] },
  { key: 'gendered', label: null, aliases: ['чоловічі', 'жіночі', 'чоловічі/жіночі', 'мужские', 'женские', 'чоловіче', 'жіноче'] },
  { key: 'mix', label: 'Мікс', aliases: ['мікс', 'мікс 2x2', 'mix', 'микс'] },
];

function normalize(s) {
  return (s || '').trim().toLowerCase();
}

function matchFormatKey(formatName) {
  const n = normalize(formatName);
  for (const f of FORMATS) {
    if (f.aliases.includes(n)) return f.key;
  }
  // Unknown or missing format name — today the only format that
  // actually exists in the data is Americanka, so that's the safe
  // default rather than silently dropping the tournament.
  return 'americanka';
}

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
 * counts. Each row opens to show every format — including formats
 * never played, shown as 0 — and for formats actually played, the
 * categories played in.
 *
 * `history` is the array from get_player_tournament_history
 * (needs format_name from migration 008; gracefully defaults to
 * Americanka if that migration hasn't been run yet).
 * `gender` ('M' | 'F') picks the label for the single-sex format.
 */
export default function TournamentStatsBreakdown({ history, gender }) {
  const [openKey, setOpenKey] = useState(null);

  function formatLabel(f) {
    if (f.key === 'gendered') return gender === 'F' ? 'Жіночі' : 'Чоловічі';
    return f.label;
  }

  function buildSections(list) {
    return FORMATS.map((f) => {
      const matches = list.filter((h) => matchFormatKey(h.format_name) === f.key);
      const cats = groupBy(matches, (h) => h.category);
      return { key: f.key, label: formatLabel(f), count: matches.length, cats };
    });
  }

  const byPlacement = (n) => history.filter((h) => h.placement === n);
  const rows = [
    { key: 'total', label: 'Турнірів зіграно', count: history.length, list: history },
    { key: 'p1', label: '1-і місця', count: byPlacement(1).length, list: byPlacement(1) },
    { key: 'p2', label: '2-і місця', count: byPlacement(2).length, list: byPlacement(2) },
    { key: 'p3', label: '3-і місця', count: byPlacement(3).length, list: byPlacement(3) },
  ];

  return (
    <div className={styles.wrap}>
      {rows.map((row, i) => {
        const isOpen = openKey === row.key;
        const sections = buildSections(row.list);
        return (
          <div key={row.key} className={`${styles.statRow} ${i === rows.length - 1 ? styles.statRowLast : ''}`}>
            <button className={styles.statHeader} onClick={() => setOpenKey(isOpen ? null : row.key)}>
              <span className={styles.statLabel}>{row.label}</span>
              <span className={styles.statRight}>
                <span className={styles.statCount}>{row.count}</span>
                <span className={`${styles.arrow} ${isOpen ? styles.arrowOpen : ''}`}>
                  <IconChevronDown size={13} />
                </span>
              </span>
            </button>

            {isOpen && (
              <div className={styles.statBody}>
                {sections.map((s) => (
                  <div key={s.key} className={styles.formatBlock}>
                    <div className={styles.formatName}>
                      {s.label} — {s.count}
                    </div>
                    {s.count > 0 && (
                      <div className={styles.catRow}>
                        {Object.entries(s.cats).map(([cat, items]) => (
                          <span key={cat} className={styles.catChip}>
                            Кат. {cat}: {items.length}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
