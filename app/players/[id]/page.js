'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { categoryForElo, eloForecast } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconArrowLeft, IconChat, IconTrendUp, IconTrendDown, IconInfo, IconX } from '@/components/Icons';
import TournamentStatsBreakdown from '@/components/TournamentStatsBreakdown';
import EloChart from '@/components/EloChart';
import AvpSeasonCard from '@/components/AvpSeasonCard';
import PlayerHistoryAccordion from '@/components/PlayerHistoryAccordion';
import { loadPlayerHeaderStats } from '@/lib/playerHeaderStats';
import { loadPlayerGames, partnerStatsFrom } from '@/lib/playerGames';
import ProfileSeasonPicker, { useProfileSeasons, ALL_TIME } from '@/components/ProfileSeasonPicker';
import { inSeason } from '@/lib/seasons';
import HeaderStatCards from '@/components/HeaderStatCards';
import { getCached, setCached } from '@/lib/clientCache';
import { winPluralUk } from '@/lib/pluralize';
import styles from './player.module.css';

export default function PlayerProfilePage() {
  const params = useParams();
  const router = useRouter();
  // A player opened before (or seen in the rating list) shows at once.
  const cached = getCached(`player:${params.id}`);
  const [player, setPlayer] = useState(cached?.player || null);
  const [loading, setLoading] = useState(!cached);
  const [notFound, setNotFound] = useState(false);
  const [tournamentHistory, setTournamentHistory] = useState(cached?.th || []);
  const [gameData, setGameData] = useState(cached?.games || { games: [], people: {} });
  const [eloGameLog, setEloGameLog] = useState(cached?.elog || []);
  const [opponentElo, setOpponentElo] = useState(cached?.player?.elo || 1200);
  const [photoLightbox, setPhotoLightbox] = useState(false);
  const [calcInfoOpen, setCalcInfoOpen] = useState(false);
  const [headerStats, setHeaderStats] = useState(cached?.header || null);
  const winStreak = headerStats?.winStreak || 0;
  // One season switch for the whole page; opens on the current season.
  const seasons = useProfileSeasons();
  const [pickedScope, setPickedScope] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('users').select('*').eq('id', params.id).maybeSingle();
      if (!active) return;
      if (!data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setPlayer(data);
      if (!cached) setOpponentElo(data.elo || 1200);

      // Everything else needs only the id — the five loads run at once.
      const [{ data: th }, gameList, { data: elog }, header] = await Promise.all([
        supabase.rpc('get_user_tournament_history', { p_user_id: data.id }),
        loadPlayerGames(supabase, data.id),
        supabase.rpc('get_user_elo_log', { p_user_id: data.id }),
        loadPlayerHeaderStats(supabase, data),
      ]);
      setCached(`player:${params.id}`, { player: data, th: th || [], games: gameList, elog: elog || [], header });
      if (!active) return;
      setTournamentHistory(th || []);
      setGameData(gameList);
      setEloGameLog(elog || []);
      setHeaderStats(header);
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // The calculator is about THIS profile's player: their own rating
  // against a pair of the chosen average, paid exactly like a real game
  // (lib/elo eloForecast). It used to compute the VIEWER's rating instead.
  const showCalculator = player.elo != null;
  const forecast = eloForecast(player.elo || 1200, opponentElo);
  const e = forecast.chance;
  const winGain = forecast.win;
  const lossDelta = forecast.loss;

  const goToPartner = (p) => router.push(`/players/${p.id}`);
  const goToTournament = (tournamentId) => router.push(`/tournaments/${tournamentId}`);

  const scope = pickedScope ?? seasons?.current ?? ALL_TIME;
  const scopeSeason = scope === ALL_TIME ? null : scope;
  const within = (when) => !scopeSeason || inSeason(when, scopeSeason);
  const scopedHistory = tournamentHistory.filter((h) => within(h.scheduled_at));
  const scopedEloLog = eloGameLog.filter((h) => within(h.created_at));
  const partners = partnerStatsFrom(gameData.games.filter((g) => within(g.played_at)), gameData.people);

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => router.back()}>
        <IconArrowLeft size={15} /> Назад
      </button>

      <div className={`${styles.header} riseIn`}>
        <div className={styles.headerTop}>
          <button
            type="button"
            className={styles.avatarZoomBtn}
            onClick={() => player.photo_url && setPhotoLightbox(true)}
            aria-label="Збільшити фото"
          >
            <PlayerAvatar player={player} size={64} />
          </button>
          <div className={styles.headerInfo}>
            <div className={styles.name}>{player.full_name}</div>
            <div className={styles.cat}>
              @{player.login} · {categoryForElo(player.elo)?.label}
            </div>
          </div>
        </div>

        <HeaderStatCards styles={styles} player={player} stats={headerStats} />

        <div className={styles.headerWave} aria-hidden="true">
          <svg viewBox="0 0 600 22" preserveAspectRatio="none">
            <path d="M0,10 C100,22 200,0 300,10 C400,20 500,0 600,10 L600,22 L0,22 Z" fill="var(--bg-light)" />
          </svg>
        </div>
      </div>

      {winStreak >= 2 && (
        <div className={`${styles.streakCard} riseIn`}>
          <IconTrendUp size={18} color="var(--rust)" />
          <div className={styles.streakText}>
            {winStreak} {winPluralUk(winStreak)} поспіль
          </div>
        </div>
      )}

      <div className="riseIn" style={{ animationDelay: '0.06s' }}>
        <ProfileSeasonPicker seasons={seasons} value={scope} onChange={setPickedScope} />
        <TournamentStatsBreakdown history={tournamentHistory} gender={player.gender} games={gameData.games} season={scopeSeason} />
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

      <div className={styles.sectionLabel}>Рейтинг AVP</div>
      <AvpSeasonCard playerId={player.id} gender={player.gender} scope={seasons ? scope : undefined} />

      {showCalculator && (
        <>
          <div className={styles.sectionLabelRow}>
            <div className={styles.sectionLabel}>Калькулятор Ело</div>
            <button className={styles.infoBtn} onClick={() => setCalcInfoOpen(true)} aria-label="Як користуватись">
              <IconInfo size={15} color="var(--text2)" />
            </button>
          </div>
          <div className={`${styles.card} riseIn`} style={{ animationDelay: '0.1s' }}>
            <div className={styles.sliderLabel}>
              Середнє Ело суперників: <b>{opponentElo}</b>
            </div>
            <input
              type="range"
              min={800}
              max={2000}
              step={10}
              value={opponentElo}
              onChange={(ev) => setOpponentElo(Number(ev.target.value))}
              className={styles.slider}
              aria-label="Середнє Ело суперників"
            />
            <div className={styles.calcGrid}>
              <div className={styles.calcBox}>
                <div className={styles.calcValue} style={{ color: 'var(--navy)' }}>
                  {Math.round(e * 100)}%
                </div>
                <div className={styles.calcLabel}>шанс</div>
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

      <div className="riseIn" style={{ animationDelay: '0.12s' }}>
        <EloChart history={tournamentHistory} currentElo={player.elo} playerName={player.full_name} />
      </div>

      <PlayerHistoryAccordion
        partners={partners}
        tournamentHistory={scopedHistory}
        eloGameLog={scopedEloLog}
        scopeLabel={scopeSeason ? scopeSeason.name : 'Весь час'}
        userId={player.id}
        onOpenPartner={goToPartner}
        onOpenTournament={goToTournament}
      />

      {photoLightbox && player.photo_url && (
        <div className={styles.lightboxOverlay} onClick={() => setPhotoLightbox(false)}>
          <div className={styles.lightboxBox} onClick={(ev) => ev.stopPropagation()}>
            <button className={styles.lightboxClose} onClick={() => setPhotoLightbox(false)} aria-label="Закрити">
              <IconX size={14} color="#fff" />
            </button>
            <img src={player.photo_url} alt={player.full_name} className={styles.lightboxImg} />
          </div>
        </div>
      )}

      {calcInfoOpen && (
        <div className={styles.modalOverlay} onClick={() => setCalcInfoOpen(false)}>
          <div className={styles.modalBox} onClick={(ev) => ev.stopPropagation()}>
            <div className={styles.modalTitle} style={{ marginBottom: 10 }}>
              Як користуватись калькулятором
            </div>
            <div className={styles.calcInfoText}>
              <p>
                Розрахунок — для {player.full_name.split(' ')[0]}, за {player.gender === 'F' ? 'її' : 'його'} поточним рейтингом ({player.elo}), так
                само, як рахується справжня гра Americanka, якщо партнер приблизно того ж рівня.
              </p>
              <p>
                Повзунок задає <b>середнє Ело пари суперників</b> — (Ело першого + Ело другого) / 2. За замовчуванням
                воно дорівнює рейтингу гравця, тобто рівна гра.
              </p>
              <p>
                <b>Шанс</b> — ймовірність перемоги пари гравця.
              </p>
              <p>
                <b>Перемога</b> / <b>поразка</b> — скільки очок Ело гравець отримає чи втратить за таким результатом.
              </p>
            </div>
            <button className={styles.saveBtn} onClick={() => setCalcInfoOpen(false)} style={{ marginTop: 4 }}>
              Зрозуміло
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
