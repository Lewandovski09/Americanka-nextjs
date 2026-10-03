'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { loadEloLogDetails } from '@/lib/eloLogDetails';
import { getCached, setCached } from '@/lib/clientCache';
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
export default function PlayerHistoryAccordion({ partners, tournamentHistory, eloGameLog, onOpenPartner, onOpenTournament, scopeLabel, userId }) {
  const [openKey, setOpenKey] = useState(null);

  // The Ело log's details (partner, opponents, everyone's rating, score)
  // are loaded the first time the log is opened — not before, so the
  // profile itself does not wait for them.
  const detailsKey = userId ? `elodetails:${userId}` : null;
  const [details, setDetails] = useState(() => (detailsKey && getCached(detailsKey)) || null);
  const logIds = eloGameLog.map((h) => h.match_id).filter(Boolean).join(',');
  useEffect(() => {
    if (openKey !== 'elolog' || !userId) return;
    const cached = getCached(detailsKey);
    if (cached && cached.ids === logIds) {
      setDetails(cached);
      return;
    }
    let alive = true;
    loadEloLogDetails(createClient(), userId, eloGameLog).then((byMatch) => {
      const value = { ids: logIds, byMatch };
      setCached(detailsKey, value);
      if (alive) setDetails(value);
    });
    return () => {
      alive = false;
    };
  }, [openKey, userId, logIds]); // eslint-disable-line react-hooks/exhaustive-deps


  const rows = [
    { key: 'partners', label: 'Статистика з партнерами', count: partners.length },
    { key: 'history', label: 'Історія турнірів', count: tournamentHistory.length },
    { key: 'elolog', label: 'Журнал змін Ело', count: eloGameLog.length },
  ];

  return (
    <div className={styles.wrap}>
      {/* Which season these three lists are for — the switch at the top
          of the page picks it. */}
      {scopeLabel && (
        <div style={{ padding: '10px 16px 0', fontSize: 11.75, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {scopeLabel}
        </div>
      )}
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
                    eloGameLog.map((h) => {
                      const d = h.match_id ? details?.byMatch?.[h.match_id] : null;
                      const who = (list) => list.map((x) => (x.elo != null ? `${x.name} (${x.elo})` : x.name)).join(' + ');
                      return (
                        <div key={h.id} className={styles.eloLogRow}>
                          <div className={styles.eloLogInfo}>
                            <div className={styles.eloLogDate}>
                              {h.created_at
                                ? `${new Date(h.created_at).toLocaleDateString('uk', { day: 'numeric', month: 'short' })}, ${new Date(
                                    h.created_at
                                  ).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}`
                                : '—'}
                              {h.tournament_name ? ` · ${h.tournament_name}` : ''}
                            </div>
                            {!h.match_id ? (
                              <div className={styles.eloLogName}>
                                {h.reason === 'season_reset'
                                  ? 'Новий сезон'
                                  : h.reason === 'admin_adjustment'
                                  ? 'Корекція адміном'
                                  : 'Зміна рейтингу'}
                              </div>
                            ) : d ? (
                              <>
                                {d.score && (
                                  <div className={styles.eloLogName}>
                                    <span className={d.won ? styles.positive : styles.negative}>{d.won ? 'Перемога' : 'Поразка'}</span>{' '}
                                    {d.score}
                                  </div>
                                )}
                                {d.partners.length > 0 && <div className={styles.eloLogPeople}>Разом з: {who(d.partners)}</div>}
                                <div className={styles.eloLogPeople}>
                                  Проти: {who(d.opponents)}
                                  {d.opponentsAvg != null && d.opponents.length > 1 ? ` · сер. ${d.opponentsAvg}` : ''}
                                </div>
                              </>
                            ) : (
                              <div className={styles.eloLogName}>
                                {h.opponent_names ? `Проти: ${h.opponent_names}` : 'Гра'}
                              </div>
                            )}
                          </div>
                          <div className={styles.eloLogDelta}>
                            <div className={h.delta >= 0 ? styles.positive : styles.negative}>
                              {h.delta >= 0 ? '+' : ''}
                              {h.delta}
                            </div>
                            {h.elo_before != null && h.elo_after != null && (
                              <div className={styles.eloLogFromTo}>
                                {h.elo_before} → {h.elo_after}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
