'use client';

import { useState } from 'react';
import { IconChevronDown } from '@/components/Icons';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './PlayerHistoryAccordion.module.css';

/**
 * Three collapsible sections in one card: who they've played with, every
 * tournament they've been in, and the game-by-game Ело log. Was three
 * separate always-open sections; combined here since a visitor rarely
 * wants all three open at once, and it's the same disclosure pattern
 * TournamentStatsBreakdown already uses one card up.
 */
export default function PlayerHistoryAccordion({ partners, tournamentHistory, eloGameLog, onOpenPartner, onOpenTournament }) {
  const [openKey, setOpenKey] = useState(null);

  const rows = [
    { key: 'partners', label: 'Статистика з партнерами', count: partners.length },
    { key: 'history', label: 'Історія турнірів', count: tournamentHistory.length },
    { key: 'elolog', label: 'Журнал змін Ело', count: eloGameLog.length },
  ];

  return (
    <div className={styles.wrap}>
      {rows.map((row, i) => {
        const isOpen = openKey === row.key;
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
                {row.key === 'partners' &&
                  (partners.length === 0 ? (
                    <div className={styles.empty}>Дані після турнірів</div>
                  ) : (
                    partners.map((p) => (
                      <div key={p.partner_id} className={styles.partnerRow} onClick={() => onOpenPartner(p.partner)}>
                        <PlayerAvatar player={p.partner} size={28} />
                        <div className={styles.partnerName}>{p.partner.full_name}</div>
                        <div className={styles.partnerMeta}>
                          {p.wins_together}/{p.games_together} перемог
                        </div>
                      </div>
                    ))
                  ))}

                {row.key === 'history' &&
                  (tournamentHistory.length === 0 ? (
                    <div className={styles.empty}>Ще немає турнірів</div>
                  ) : (
                    tournamentHistory.map((h) => (
                      <div key={h.category_id} className={styles.historyCard} onClick={() => onOpenTournament(h.category_id)}>
                        <div>
                          <div className={styles.historyName}>{h.tournament_name}</div>
                          <div className={styles.historyMeta}>
                            {(h.finished_at || h.scheduled_at) &&
                              new Date(h.finished_at || h.scheduled_at).toLocaleDateString('uk', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                          </div>
                          <div
                            className={styles.historyPlace}
                            style={h.placement && h.placement <= 3 ? { color: 'var(--rust)', fontWeight: 700 } : undefined}
                          >
                            {h.placement ? `${h.placement}-є місце` : 'В процесі'}
                          </div>
                        </div>
                        {h.elo_delta !== null && h.elo_delta !== undefined && (
                          <div className={h.elo_delta >= 0 ? styles.positive : styles.negative}>
                            {h.elo_delta >= 0 ? '+' : ''}
                            {h.elo_delta} Ело
                          </div>
                        )}
                      </div>
                    ))
                  ))}

                {row.key === 'elolog' &&
                  (eloGameLog.length === 0 ? (
                    <div className={styles.empty}>Ще немає змін рейтингу</div>
                  ) : (
                    eloGameLog.map((h) => (
                      <div key={h.id} className={styles.eloLogRow}>
                        <div className={styles.eloLogInfo}>
                          <div className={styles.eloLogDate}>
                            {h.created_at
                              ? `${new Date(h.created_at).toLocaleDateString('uk', { day: 'numeric', month: 'short' })}, ${new Date(
                                  h.created_at
                                ).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}`
                              : '—'}
                          </div>
                          <div className={styles.eloLogName}>
                            {h.tournament_name || 'Турнір'}
                            {h.opponent_names ? ` · проти ${h.opponent_names}` : ''}
                          </div>
                        </div>
                        <div className={h.delta >= 0 ? styles.positive : styles.negative}>
                          {h.delta >= 0 ? '+' : ''}
                          {h.delta}
                        </div>
                      </div>
                    ))
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
