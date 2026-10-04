'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, eloForecast } from '@/lib/elo';
import { scoreLabel } from '@/lib/formats/sets';
import { toJpegDataUrl } from '@/lib/photo';
import PlayerAvatar from '@/components/PlayerAvatar';
import CityPicker from '@/components/CityPicker';
import { IconEdit, IconTrendUp, IconTrendDown, IconX, IconInfo } from '@/components/Icons';
import ProfileHighlights from '@/components/ProfileHighlights';
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
import styles from './profile.module.css';

export default function ProfilePage() {
  const router = useRouter();
  const { player, loading, refresh: refreshPlayer } = useCurrentPlayer();
  const [tournamentHistory, setTournamentHistory] = useState([]);
  const [eloGameLog, setEloGameLog] = useState([]);
  const [gameData, setGameData] = useState({ games: [], people: {} });
  const [headerStats, setHeaderStats] = useState(null);
  const [opponentElo, setOpponentElo] = useState(1200);

  const [openTournamentId, setOpenTournamentId] = useState(null);
  const [tournamentMatches, setTournamentMatches] = useState([]);
  const [tournamentPlayersMap, setTournamentPlayersMap] = useState({});

  const [openPartner, setOpenPartner] = useState(null);
  const [partnerMatches, setPartnerMatches] = useState([]);
  const [matchupMode, setMatchupMode] = useState('together'); // 'together' | 'against'

  const [editOpen, setEditOpen] = useState(false);
  const [calcInfoOpen, setCalcInfoOpen] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  // A just-uploaded avatar, shown immediately — the profile row behind
  // `player` is re-read right after, but the picture should not wait.
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const winStreak = headerStats?.winStreak || 0;
  // One season switch for the whole page; opens on the current season.
  const seasons = useProfileSeasons();
  const [pickedScope, setPickedScope] = useState(null);

  // All five loads are independent — they run at once (they used to run
  // one after another). The last-known result is shown first, so coming
  // back to the profile is instant; the fresh one replaces it quietly.
  useEffect(() => {
    if (!player) return;
    const key = `profile:${player.id}`;
    const apply = (d) => {
      setTournamentHistory(d.th);
      setEloGameLog(d.elog);
      setGameData(d.games);
      setHeaderStats(d.header);
    };
    const cached = getCached(key);
    if (cached) apply(cached);

    let alive = true;
    async function load() {
      const supabase = createClient();
      // The partner table is computed from the games (lib/playerGames), so
      // it can be shown per season — partner_stats only has all-time sums.
      const [{ data: th }, { data: elog }, gameList, header] = await Promise.all([
        supabase.rpc('get_user_tournament_history', { p_user_id: player.id }),
        supabase.rpc('get_user_elo_log', { p_user_id: player.id }),
        loadPlayerGames(supabase, player.id),
        loadPlayerHeaderStats(supabase, player),
      ]);
      const fresh = { th: th || [], elog: elog || [], games: gameList, header };
      setCached(key, fresh);
      setCached(`header:${player.id}`, header);
      if (alive) apply(fresh);
    }
    load();
    return () => {
      alive = false;
    };
  }, [player]);

  async function openTournamentDetails(tournamentId) {
    setOpenTournamentId(tournamentId);
    const supabase = createClient();

    const { data: allMatches } = await supabase
      .from('tournament_matches')
      .select('*')
      .eq('category_id', tournamentId)
      .eq('played', true)
      .order('round_number');

    // Only the games THIS player was actually in — a tournament's full
    // bracket is full of other people's matches too, which isn't
    // "their history", just noise they'd have to scroll past.
    const matches = (allMatches || []).filter(
      (m) => (m.team_a_players || []).includes(player.id) || (m.team_b_players || []).includes(player.id)
    );

    // Names for whoever they played with/against. Solo-format
    // registrations live in tournament_players; pair formats (mix,
    // single-gender) register through tournament_teams instead — a mix
    // tournament's names would be entirely blank without this second
    // lookup, same root cause as the tournament-history bug this
    // session already fixed at the database function level.
    const { data: tps } = await supabase
      .from('tournament_players')
      .select('user_id, users(full_name)')
      .eq('category_id', tournamentId);
    const { data: teams } = await supabase
      .from('tournament_teams')
      .select('user1_id, user2_id')
      .eq('category_id', tournamentId);

    const map = {};
    (tps || []).forEach((tp) => {
      if (tp.users?.full_name) map[tp.user_id] = tp.users.full_name.split(' ')[0];
    });

    const teamPlayerIds = [...new Set((teams || []).flatMap((t) => [t.user1_id, t.user2_id]).filter(Boolean))];
    if (teamPlayerIds.length > 0) {
      const { data: teamPlayers } = await supabase.from('users').select('id, full_name').in('id', teamPlayerIds);
      (teamPlayers || []).forEach((p) => {
        map[p.id] = p.full_name.split(' ')[0];
      });
    }

    setTournamentPlayersMap(map);
    setTournamentMatches(matches);
  }

  async function openPartnerHistory(partner, mode = 'together') {
    setOpenPartner(partner);
    setMatchupMode(mode);
    await loadMatchup(partner.id, mode);
  }

  async function loadMatchup(partnerId, mode) {
    const supabase = createClient();
    const fn = mode === 'together' ? 'get_partner_match_history' : 'get_opponent_match_history';
    const paramKey = mode === 'together' ? 'p_partner_id' : 'p_opponent_id';
    const { data } = await supabase.rpc(fn, { p_user_id: player.id, [paramKey]: partnerId });
    setPartnerMatches(data || []);
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    // Reset the input: picking the SAME file twice must fire onChange
    // again (a retry after an error, say).
    e.target.value = '';
    if (!file || !player) return;

    setPhotoError('');
    setPhotoBusy(true);
    try {
      const dataUrl = await toJpegDataUrl(file);
      const res = await fetch('/api/profile/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json();
      if (!data.success) {
        setPhotoError(data.error || 'Не вдалося зберегти фото');
        return;
      }
      // Show it at once, and re-read the profile so everything else on
      // the page (and the header avatar) follows.
      setPhotoUrl(data.photoUrl);
      refreshPlayer();
    } catch (err) {
      console.error('[profile photo]', err.message);
      setPhotoError('Не вдалося прочитати файл. Спробуйте інше фото (JPG або PNG).');
    } finally {
      setPhotoBusy(false);
    }
  }

  function openEdit() {
    setEditForm({
      firstName: player.first_name || '',
      lastName: player.last_name || '',
      city: player.city || '',
      login: player.login,
      telegramUsername: player.telegram_username || '',
    });
    setEditError('');
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    setEditError('');
    setEditSaving(true);
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    setEditSaving(false);

    if (!data.success) {
      setEditError(data.error || 'Не вдалося оновити профіль');
      return;
    }

    setEditOpen(false);
    // The profile row is read on the client, so router.refresh() alone
    // would leave the header showing the old name until a reload.
    refreshPlayer();
    router.refresh();
  }

  function handleLogout() {
    setLogoutConfirmOpen(true);
  }

  async function confirmLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

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
        <div className={styles.skeletonStatsGrid}>
          <div className={`skeleton ${styles.skeletonStatBox}`} />
          <div className={`skeleton ${styles.skeletonStatBox}`} />
          <div className={`skeleton ${styles.skeletonStatBox}`} />
        </div>
      </div>
    );
  }
  if (!player) return <div className={styles.loading}>Будь ласка, увійдіть в акаунт</div>;

  // The avatar the page shows: the freshly uploaded one wins until the
  // reloaded profile catches up with it.
  const shownPhoto = photoUrl || player.photo_url;
  const me = shownPhoto === player.photo_url ? player : { ...player, photo_url: shownPhoto };

  // The calculator uses the real payout (lib/elo eloForecast — same K
  // and pair split as a real game), for this player's own rating.
  const forecast = eloForecast(player.elo || 1200, opponentElo);
  const e = forecast.chance;
  const winGain = forecast.win;
  const lossDelta = forecast.loss;
  const scope = pickedScope ?? seasons?.current ?? ALL_TIME;
  const scopeSeason = scope === ALL_TIME ? null : scope;
  const within = (when) => !scopeSeason || inSeason(when, scopeSeason);
  const scopedHistory = tournamentHistory.filter((h) => within(h.scheduled_at));
  const scopedEloLog = eloGameLog.filter((h) => within(h.created_at));
  const partners = partnerStatsFrom(gameData.games.filter((g) => within(g.played_at)), gameData.people);

  return (
    <div className={styles.page}>
      <div className={`${styles.header} riseIn`}>
        <div className={styles.headerTop}>
          <div className={styles.avatarWrap}>
            <button
              type="button"
              className={styles.avatarZoomBtn}
              onClick={() => shownPhoto && setPhotoLightbox(true)}
              aria-label="Збільшити фото"
            >
              <PlayerAvatar player={me} size={64} />
              {photoBusy && <span className={styles.photoBusy}>…</span>}
            </button>
            <label className={styles.photoEditBtn} aria-label="Змінити фото профілю">
              <IconEdit size={13} color="#fff" />
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={photoBusy}
                onChange={handlePhotoChange}
              />
            </label>
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.name}>{player.full_name}</div>
            <div className={styles.cat}>
              {player.approval_status === 'pending'
                ? 'Очікує підтвердження'
                : categoryForElo(player.elo)?.label}
            </div>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Вийти
          </button>
        </div>

        {photoError && <div className={styles.photoError}>{photoError}</div>}

        {player.approval_status !== 'pending' && (
          <HeaderStatCards styles={styles} player={me} stats={headerStats} />
        )}

        <button className={styles.editProfileBtn} onClick={openEdit} style={{ marginTop: 10 }}>
          Редагувати профіль
        </button>

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
        <ProfileHighlights
          history={tournamentHistory}
          eloLog={eloGameLog}
          games={gameData.games}
          people={gameData.people}
          season={scopeSeason}
          gender={player.gender}
          onOpenTournament={openTournamentDetails}
          onOpenPartner={(p) => openPartnerHistory(p, 'together')}
          onOpenOpponent={(p) => openPartnerHistory(p, 'against')}
        />
      </div>

      <div className={styles.sectionLabel}>Рейтинг AVP</div>
      <AvpSeasonCard playerId={player.id} gender={player.gender} scope={seasons ? scope : undefined} />

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
          onChange={(e) => setOpponentElo(Number(e.target.value))}
          className={styles.slider}
          aria-label="Середнє Ело суперників"
        />
        <div className={styles.calcGrid}>
          <CalcBox value={`${Math.round(e * 100)}%`} label="шанс" color="var(--navy)" />
          <CalcBox value={`+${winGain}`} label="перемога" color="var(--accent-green)" icon={<IconTrendUp size={14} color="var(--accent-green)" />} />
          <CalcBox value={lossDelta} label="поразка" color="var(--danger)" icon={<IconTrendDown size={14} color="var(--danger)" />} />
        </div>
      </div>

      <div className="riseIn" style={{ animationDelay: '0.12s' }}>
        <EloChart history={tournamentHistory} log={eloGameLog} currentElo={player.elo} />
      </div>

      <PlayerHistoryAccordion
        partners={partners}
        tournamentHistory={scopedHistory}
        eloGameLog={scopedEloLog}
        scopeLabel={scopeSeason ? scopeSeason.name : 'Весь час'}
        userId={player.id}
        onOpenPartner={openPartnerHistory}
        onOpenTournament={openTournamentDetails}
      />


      {photoLightbox && shownPhoto && (
        <div className={styles.lightboxOverlay} onClick={() => setPhotoLightbox(false)}>
          <div className={styles.lightboxBox} onClick={(e) => e.stopPropagation()}>
            <button className={styles.lightboxClose} onClick={() => setPhotoLightbox(false)} aria-label="Закрити">
              <IconX size={14} color="#fff" />
            </button>
            <img src={shownPhoto} alt={player.full_name} className={styles.lightboxImg} />
          </div>
        </div>
      )}

      {calcInfoOpen && (
        <div className={styles.modalOverlay} onClick={() => setCalcInfoOpen(false)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle} style={{ marginBottom: 10 }}>
              Як користуватись калькулятором
            </div>
            <div className={styles.calcInfoText}>
              <p>
                Повзунок задає <b>середнє Ело пари суперників</b> — (Ело першого + Ело другого) / 2. Це може бути
                будь-яке число від 800 до 2000.
              </p>
              <p>
                Розрахунок — за вашим поточним рейтингом ({player.elo ?? '—'}), так само, як рахується справжня гра
                Americanka, якщо ваш партнер приблизно вашого рівня.
              </p>
              <p>
                <b>Шанс</b> — ймовірність перемоги вашої пари.
              </p>
              <p>
                <b>Перемога</b> — скільки очок Ело отримаєте саме ви, якщо пара переможе.{' '}
                <b>Поразка</b> — скільки втратите, якщо програєте.
              </p>
              <p>
                Чим сильніший суперник (вищий рейтинг), тим більше очок дає перемога над ним і тим менше втрачається
                при поразці — несподівані результати важать більше.
              </p>
            </div>
            <button className={styles.saveBtn} onClick={() => setCalcInfoOpen(false)} style={{ marginTop: 4 }}>
              Зрозуміло
            </button>
          </div>
        </div>
      )}

      {editOpen && (
        <div className={styles.modalOverlay} onClick={() => setEditOpen(false)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Редагувати профіль</div>
            <label className={styles.fieldLabel}>Ім&apos;я</label>
            <input
              className={styles.fieldInput}
              aria-label="Ім'я"
              value={editForm.firstName}
              onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <label className={styles.fieldLabel}>Прізвище</label>
            <input
              className={styles.fieldInput}
              aria-label="Прізвище"
              value={editForm.lastName}
              onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
            />
            <label className={styles.fieldLabel}>Місто</label>
            <CityPicker
              value={editForm.city}
              onChange={(v) => setEditForm((f) => ({ ...f, city: v }))}
              inputClassName={styles.fieldInput}
              ariaLabel="Місто"
            />
            {/* Both read-only, for different reasons: the login is what
                the Auth account address is derived from, and the Telegram
                username is refreshed from the bot on every interaction. */}
            <label className={styles.fieldLabel}>Логін (незмінний)</label>
            <input className={styles.fieldInput} aria-label="Логін (незмінний)" value={editForm.login} readOnly />
            <label className={styles.fieldLabel}>Telegram (з бота)</label>
            <input
              className={styles.fieldInput}
              aria-label="Telegram нікнейм"
              value={editForm.telegramUsername ? `@${editForm.telegramUsername}` : 'не підключено'}
              readOnly
            />
            {editError && <div className={styles.searchError}>{editError}</div>}
            <button className={styles.saveBtn} disabled={editSaving} onClick={handleSaveEdit}>
              {editSaving ? 'Збереження...' : 'Зберегти'}
            </button>
            <button className={styles.modalCloseBtn} onClick={() => setEditOpen(false)}>
              Скасувати
            </button>
          </div>
        </div>
      )}

      {openTournamentId && (
        <div className={styles.modalOverlay} onClick={() => setOpenTournamentId(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Ваші матчі в турнірі</div>
            <div className={styles.modalScroll}>
              {tournamentMatches.length === 0 && <div className={styles.empty}>Ще немає зіграних матчів</div>}
              {tournamentMatches.map((m) => {
                const nameA = m.team_a_players.map((id) => tournamentPlayersMap[id] || '?').join(' + ');
                const nameB = m.team_b_players.map((id) => tournamentPlayersMap[id] || '?').join(' + ');
                return (
                  <div key={m.id} className={styles.matchRow}>
                    <span className={styles.matchRound}>Р{m.round_number}</span>
                    <span>{nameA}</span>
                    <span className={styles.matchScore}>{scoreLabel(m)}</span>
                    <span>{nameB}</span>
                  </div>
                );
              })}
            </div>
            <button className={styles.modalCloseBtn} onClick={() => setOpenTournamentId(null)}>
              Закрити
            </button>
          </div>
        </div>
      )}

      {openPartner && (
        <div className={styles.modalOverlay} onClick={() => setOpenPartner(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <PlayerAvatar player={openPartner} size={36} />
              <div className={styles.modalTitle}>{openPartner.full_name}</div>
              <a href={`/players/${openPartner.id}`} className={styles.modalProfileLink}>
                Профіль →
              </a>
            </div>
            <div className={styles.matchupTabs}>
              <button
                className={`${styles.matchupTab} ${matchupMode === 'together' ? styles.matchupTabOn : ''}`}
                onClick={() => {
                  setMatchupMode('together');
                  loadMatchup(openPartner.id, 'together');
                }}
                aria-pressed={matchupMode === 'together'}
              >
                Разом
              </button>
              <button
                className={`${styles.matchupTab} ${matchupMode === 'against' ? styles.matchupTabOn : ''}`}
                onClick={() => {
                  setMatchupMode('against');
                  loadMatchup(openPartner.id, 'against');
                }}
                aria-pressed={matchupMode === 'against'}
              >
                Проти
              </button>
            </div>
            <div className={styles.modalScroll}>
              {partnerMatches.length === 0 && <div className={styles.empty}>Ще немає ігор</div>}
              {partnerMatches.map((m) => (
                <div key={m.match_id} className={styles.matchRow}>
                  <span className={styles.matchTournament}>{m.tournament_name}</span>
                  <span className={styles.matchScore}>{scoreLabel(m)}</span>
                  <span className={m.won ? styles.positive : styles.negative}>{m.won ? 'Перемога' : 'Поразка'}</span>
                </div>
              ))}
            </div>
            <button className={styles.modalCloseBtn} onClick={() => setOpenPartner(null)}>
              Закрити
            </button>
          </div>
        </div>
      )}

      {logoutConfirmOpen && (
        <div className={styles.modalOverlay} onClick={() => setLogoutConfirmOpen(false)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320, gap: 14 }}>
            <div className={styles.modalTitle} style={{ textAlign: 'center' }}>
              Вийти з акаунту?
            </div>
            <p style={{ margin: 0, textAlign: 'center', color: 'var(--text2)', fontSize: 14 }}>
              Вам доведеться увійти знову, щоб продовжити користуватись застосунком.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                className={styles.logoutBtn}
                style={{ flex: 1, borderColor: 'var(--border)', color: 'var(--text)' }}
                onClick={() => setLogoutConfirmOpen(false)}
              >
                Скасувати
              </button>
              <button
                className={styles.logoutBtn}
                style={{ flex: 1, background: 'var(--rust)', borderColor: 'var(--rust)', color: '#fff' }}
                onClick={confirmLogout}
              >
                Так, вийти
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalcBox({ value, label, color, icon }) {
  return (
    <div className={styles.calcBox}>
      {icon && <div className={styles.calcIcon}>{icon}</div>}
      <div className={styles.calcValue} style={{ color }}>
        {value}
      </div>
      <div className={styles.calcLabel}>{label}</div>
    </div>
  );
}
