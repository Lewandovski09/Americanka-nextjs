'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, expectedScore } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconArrowLeft, IconTrophy, IconMedal, IconChat, IconTrendUp, IconTrendDown } from '@/components/Icons';
import TournamentStatsBreakdown from '@/components/TournamentStatsBreakdown';
import styles from './player.module.css';

export default function PlayerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { player: viewer } = useCurrentPlayer();
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tournamentHistory, setTournamentHistory] = useState([]);
  const [formatStats, setFormatStats] = useState([]);
  const [opponentElo, setOpponentElo] = useState(1200);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('players').select('*').eq('id', params.id).maybeSingle();
      if (!active) return;
      if (!data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setPlayer(data);
      setOpponentElo(data.elo || 1200);

      const [{ data: th }, { data: fs }] = await Promise.all([
        supabase.rpc('get_player_tournament_history', { p_player_id: data.id }),
        supabase.rpc('get_player_format_stats', { p_player_id: data.id }),
      ]);
      if (!active) return;
      setTournamentHistory(th || []);
      setFormatStats(fs || []);
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [params.id]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.skeletonHeroHeader}>
          <div className={styles.skeletonHeader}>
            <div className={`skeleton on-dark ${styles.skeletonAvatar}`} />
            <div className={styles.skeletonLines}>
              <div className={`skeleton on-dark ${styles.skeletonLine}`} style={{ width: '50%' }} />
              <div className={`skeleton on-dark ${styles.skeletonLine}`} style={{ width: '35%', marginBottom: 0 }} />
            </div>
          </div>
          <div className={`skeleton on-dark ${styles.skeletonEloLine}`} />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <IconArrowLeft size={15} /> Назад
        </button>
        <div className={styles.notFound}>Гравця не знайдено</div>
      </div>
    );
  }

  const totalGames = formatStats.reduce((s, r) => s + (r.games_played || 0), 0);
  const totalWins = formatStats.reduce((s, r) => s + (r.games_won || 0), 0);
  const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  const eloLog = tournamentHistory
    .filter((h) => h.elo_delta !== null && h.elo_delta !== undefined)
    .slice()
    .sort((a, b) => new Date(b.finished_at || 0) - new Date(a.finished_at || 0));

  const showCalculator = viewer && viewer.id !== player.id;
  const myElo = viewer?.elo || 1200;
  const e = expectedScore(myElo, opponentElo);
  const winGain = Math.round(32 * (1 - e));
  const lossDelta = Math.round(32 * (0 - e));

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => router.back()}>
        <IconArrowLeft size={15} /> Назад
      </button>

      <div className={`${styles.header} riseIn`}>
        <div className={styles.headerTop}>
          <PlayerAvatar player={player} size={64} />
          <div className={styles.headerInfo}>
            <div className={styles.name}>{player.full_name}</div>
            <div className={styles.cat}>@{player.login}</div>
          </div>
        </div>

        <div className={styles.heroEloRow}>
          <div className={styles.heroEloBlock}>
            <div className={styles.heroEloValue}>{player.elo ?? '—'}</div>
            <div className={styles.heroEloLabel}>РЕЙТИНГ ЕЛО · {categoryForElo(player.elo)?.label}</div>
          </div>
        </div>

        <div className={styles.headerWave} aria-hidden="true">
          <svg viewBox="0 0 600 22" preserveAspectRatio="none">
            <path d="M0,10 C100,22 200,0 300,10 C400,20 500,0 600,10 L600,22 L0,22 Z" fill="var(--bg-light)" />
          </svg>
        </div>
      </div>

      <div className={`${styles.statSquares} riseIn`} style={{ animationDelay: '0.06s' }}>
        <div className={styles.statSquare}>
          <IconTrophy size={20} color="var(--navy)" />
          <div className={styles.statSquareValue}>{totalGames}</div>
          <div className={styles.statSquareLabel}>Ігор зіграно</div>
        </div>
        <div className={styles.statSquare}>
          <IconMedal size={20} color="var(--navy)" />
          <div className={styles.statSquareValue}>{winRate}%</div>
          <div className={styles.statSquareLabel}>Перемог</div>
        </div>
      </div>

      <div className="riseIn" style={{ animationDelay: '0.08s' }}>
        <TournamentStatsBreakdown history={tournamentHistory} />
      </div>

      {player.telegram_username && (
        <a
          href={`https://t.me/${player.telegram_username}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.telegramRow} riseIn`}
          style={{ animationDelay: '0.08s' }}
        >
          <span className={styles.telegramIcon}>
            <IconChat size={16} />
          </span>
          <span>@{player.telegram_username} в Telegram</span>
        </a>
      )}

      {showCalculator && (
        <>
          <div className={styles.sectionLabel}>Калькулятор Ело</div>
          <div className={`${styles.card} riseIn`} style={{ animationDelay: '0.1s' }}>
            <div className={styles.sliderLabel}>
              Ело {player.full_name.split(' ')[0]}: <b>{opponentElo}</b>
            </div>
            <input
              type="range"
              min={800}
              max={2000}
              step={10}
              value={opponentElo}
              onChange={(ev) => setOpponentElo(Number(ev.target.value))}
              className={styles.slider}
            />
            <div className={styles.calcGrid}>
              <div className={styles.calcBox}>
                <div className={styles.calcValue} style={{ color: 'var(--navy)' }}>
                  {Math.round(e * 100)}%
                </div>
                <div className={styles.calcLabel}>ваш шанс</div>
              </div>
              <div className={styles.calcBox}>
                <div className={styles.calcIcon}>
                  <IconTrendUp size={14} color="var(--accent-green)" />
                </div>
                <div className={styles.calcValue} style={{ color: 'var(--accent-green)' }}>
                  +{winGain}
                </div>
                <div className={styles.calcLabel}>перемога</div>
              </div>
              <div className={styles.calcBox}>
                <div className={styles.calcIcon}>
                  <IconTrendDown size={14} color="var(--danger)" />
                </div>
                <div className={styles.calcValue} style={{ color: 'var(--danger)' }}>
                  {lossDelta}
                </div>
                <div className={styles.calcLabel}>поразка</div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className={styles.sectionLabel}>Історія турнірів</div>
      {tournamentHistory.length === 0 && <div className={styles.empty}>Ще немає турнірів</div>}
      {tournamentHistory.map((h) => (
        <div key={h.tournament_id} className={styles.historyCard}>
          <div>
            <div className={styles.historyName}>{h.tournament_name}</div>
            <div
              className={styles.historyPlace}
              style={h.placement && h.placement <= 3 ? { color: 'var(--rust)', fontWeight: 700 } : undefined}
            >
              {h.placement ? `${h.placement}-є місце` : 'В процесі'}
            </div>
          </div>
          {h.elo_delta !== null && (
            <div className={h.elo_delta >= 0 ? styles.positive : styles.negative}>
              {h.elo_delta >= 0 ? '+' : ''}
              {h.elo_delta} Ело
            </div>
          )}
        </div>
      ))}

      <div className={styles.sectionLabel}>Журнал змін Ело</div>
      {eloLog.length === 0 && <div className={styles.empty}>Ще немає змін рейтингу</div>}
      {eloLog.map((h) => (
        <div key={h.tournament_id} className={styles.eloLogRow}>
          <div className={styles.eloLogDate}>
            {h.finished_at ? new Date(h.finished_at).toLocaleDateString('uk', { day: 'numeric', month: 'short' }) : '—'}
          </div>
          <div className={styles.eloLogName}>{h.tournament_name}</div>
          <div className={h.elo_delta >= 0 ? styles.positive : styles.negative}>
            {h.elo_delta >= 0 ? '+' : ''}
            {h.elo_delta}
          </div>
        </div>
      ))}
    </div>
  );
}
