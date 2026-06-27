'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, expectedScore } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconEdit, IconMail, IconChat, IconTrophy, IconMedal, IconTrendUp, IconTrendDown, IconX } from '@/components/Icons';
import styles from './profile.module.css';

export default function ProfilePage() {
  const router = useRouter();
  const { player, loading } = useCurrentPlayer();
  const [tournamentHistory, setTournamentHistory] = useState([]);
  const [formatStats, setFormatStats] = useState([]);
  const [partners, setPartners] = useState([]);
  const [opponentElo, setOpponentElo] = useState(1200);

  const [openTournamentId, setOpenTournamentId] = useState(null);
  const [tournamentMatches, setTournamentMatches] = useState([]);
  const [tournamentPlayersMap, setTournamentPlayersMap] = useState({});

  const [openPartner, setOpenPartner] = useState(null);
  const [partnerMatches, setPartnerMatches] = useState([]);
  const [matchupMode, setMatchupMode] = useState('together'); // 'together' | 'against'

  const [editOpen, setEditOpen] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [searchLogin, setSearchLogin] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (!player) return;
    async function load() {
      const supabase = createClient();

      const { data: th } = await supabase.rpc('get_player_tournament_history', { p_player_id: player.id });
      setTournamentHistory(th || []);

      const { data: fs } = await supabase.rpc('get_player_format_stats', { p_player_id: player.id });
      setFormatStats(fs || []);

      const { data: p } = await supabase
        .from('partner_stats')
        .select('*, partner:players!partner_stats_partner_id_fkey(id, full_name, photo_url)')
        .eq('player_id', player.id)
        .order('games_together', { ascending: false });
      setPartners(p || []);
    }
    load();
  }, [player]);

  useEffect(() => {
    const q = searchLogin.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const supabase = createClient();
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('players')
        .select('id, full_name, login, photo_url')
        .eq('approval_status', 'approved')
        .or(`login.ilike.%${q}%,full_name.ilike.%${q}%`)
        .neq('id', player?.id || '')
        .limit(6);
      if (active) setSuggestions(data || []);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchLogin, player?.id]);

  function highlightMatch(text, query) {
    if (!query || !text) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <b className={styles.matchHighlight}>{text.slice(idx, idx + query.length)}</b>
        {text.slice(idx + query.length)}
      </>
    );
  }

  async function selectSuggestion(p) {
    setSearchLogin('');
    setShowSuggestions(false);
    setSuggestions([]);
    await openPartnerHistory(p, 'together');
  }

  async function openTournamentDetails(tournamentId) {
    setOpenTournamentId(tournamentId);
    const supabase = createClient();

    const { data: matches } = await supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('played', true)
      .order('round_number');

    const { data: tps } = await supabase
      .from('tournament_players')
      .select('player_id, players(full_name)')
      .eq('tournament_id', tournamentId);

    const map = {};
    (tps || []).forEach((tp) => {
      map[tp.player_id] = tp.players.full_name.split(' ')[0];
    });

    setTournamentPlayersMap(map);
    setTournamentMatches(matches || []);
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
    const { data } = await supabase.rpc(fn, { p_player_id: player.id, [paramKey]: partnerId });
    setPartnerMatches(data || []);
  }

  async function handleSearchPlayer() {
    setSearchError('');
    if (!searchLogin.trim()) return;
    setSearching(true);
    const res = await fetch('/api/players/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: searchLogin }),
    });
    const data = await res.json();
    setSearching(false);

    if (!data.success) {
      setSearchError(data.error || 'Гравця не знайдено');
      return;
    }

    setSearchLogin('');
    openPartnerHistory(data.player, 'together');
  }

  async function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file || !player) return;
    const supabase = createClient();
    const ext = file.name.split('.').pop();
    const path = `${player.id}.${ext}`;
    await supabase.storage.from('player-photos').upload(path, file, { upsert: true });
    const { data: urlData } = supabase.storage.from('player-photos').getPublicUrl(path);
    // Cache-bust: the URL itself doesn't change on re-upload (same
    // path), so without this the browser/CDN may keep showing the
    // OLD photo even though a new one was uploaded.
    const bustedUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    await supabase.from('players').update({ photo_url: bustedUrl }).eq('id', player.id);
    router.refresh();
  }

  function openEdit() {
    setEditForm({
      fullName: player.full_name,
      login: player.login,
      telegramUsername: player.telegram_username,
      email: player.email,
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
    router.refresh();
  }

  async function handleLogout() {
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

  const e = expectedScore(player.elo || 1200, opponentElo);
  const winGain = Math.round(32 * (1 - e));
  const lossDelta = Math.round(32 * (0 - e));
  const totalGames = formatStats.reduce((s, r) => s + (r.games_played || 0), 0);
  const totalWins = formatStats.reduce((s, r) => s + (r.games_won || 0), 0);
  const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  const eloLog = tournamentHistory
    .filter((h) => h.elo_delta !== null && h.elo_delta !== undefined)
    .slice()
    .sort((a, b) => new Date(b.finished_at || 0) - new Date(a.finished_at || 0));

  return (
    <div className={styles.page}>
      <div className={`${styles.header} riseIn`}>
        <div className={styles.headerTop}>
          <div className={styles.avatarWrap}>
            <button
              type="button"
              className={styles.avatarZoomBtn}
              onClick={() => player.photo_url && setPhotoLightbox(true)}
              aria-label="Збільшити фото"
            >
              <PlayerAvatar player={player} size={64} />
            </button>
            <label className={styles.photoEditBtn}>
              <IconEdit size={13} color="#fff" />
              <input type="file" accept="image/*" hidden onChange={handlePhotoChange} />
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

        <div className={styles.heroEloRow}>
          <div className={styles.heroEloBlock}>
            <div className={styles.heroEloValue}>{player.elo ?? '—'}</div>
            <div className={styles.heroEloLabel}>РЕЙТИНГ ЕЛО</div>
          </div>
          <button className={styles.editProfileBtn} onClick={openEdit}>
            Редагувати профіль
          </button>
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

      <div className={styles.sectionLabel}>Калькулятор Ело</div>
      <div className={`${styles.card} riseIn`} style={{ animationDelay: '0.1s' }}>
        <div className={styles.sliderLabel}>
          Ело суперника: <b>{opponentElo}</b>
        </div>
        <input
          type="range"
          min={800}
          max={2000}
          step={10}
          value={opponentElo}
          onChange={(e) => setOpponentElo(Number(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.calcGrid}>
          <CalcBox value={`${Math.round(e * 100)}%`} label="шанс" color="var(--navy)" />
          <CalcBox value={`+${winGain}`} label="перемога" color="var(--accent-green)" icon={<IconTrendUp size={14} color="var(--accent-green)" />} />
          <CalcBox value={lossDelta} label="поразка" color="var(--danger)" icon={<IconTrendDown size={14} color="var(--danger)" />} />
        </div>
      </div>

      <div className={styles.sectionLabel}>Статистика з партнерами та суперниками</div>
      <div className={`${styles.card} riseIn`} style={{ animationDelay: '0.14s' }}>
        <div className={styles.searchRow} style={{ position: 'relative' }}>
          <input
            className={styles.searchInput}
            placeholder="Логін гравця..."
            value={searchLogin}
            onChange={(e) => {
              setSearchLogin(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchPlayer()}
          />
          <button className={styles.searchBtn} disabled={searching} onClick={handleSearchPlayer}>
            {searching ? '...' : 'Знайти'}
          </button>

          {showSuggestions && suggestions.length > 0 && (
            <div className={styles.suggestionsDropdown}>
              {suggestions.map((s) => (
                <div key={s.id} className={styles.suggestionRow} onClick={() => selectSuggestion(s)}>
                  <PlayerAvatar player={s} size={26} />
                  <div>
                    <div className={styles.suggestionName}>{highlightMatch(s.full_name, searchLogin.trim())}</div>
                    <div className={styles.suggestionLogin}>@{highlightMatch(s.login, searchLogin.trim())}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {searchError && <div className={styles.searchError}>{searchError}</div>}

        {partners.length === 0 && <div className={styles.empty}>Дані після турнірів</div>}
        {partners.map((p) => (
          <div key={p.partner_id} className={styles.partnerRow} onClick={() => openPartnerHistory(p.partner)}>
            <PlayerAvatar player={p.partner} size={28} />
            <div className={styles.partnerName}>{p.partner.full_name}</div>
            <div className={styles.partnerMeta}>
              {p.wins_together}/{p.games_together} перемог
            </div>
          </div>
        ))}
      </div>

      <div className={styles.sectionLabel}>Історія турнірів</div>
      {tournamentHistory.length === 0 && <div className={styles.empty}>Ще немає турнірів</div>}
      {tournamentHistory.map((h) => (
        <div key={h.tournament_id} className={styles.historyCard} onClick={() => openTournamentDetails(h.tournament_id)}>
          <div>
            <div className={styles.historyName}>{h.tournament_name}</div>
            <div className={styles.historyPlace} style={h.placement && h.placement <= 3 ? { color: 'var(--rust)', fontWeight: 700 } : undefined}>
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

      <div className={styles.sectionLabel}>Підтримка</div>
      <div className={styles.supportCard}>
        <a href="mailto:a921488799327z@gmail.com" className={styles.supportRow}>
          <span className={styles.supportIcon}><IconMail size={16} /></span>
          <span>a921488799327z@gmail.com</span>
        </a>
        <a href="https://t.me/one_gogi" target="_blank" rel="noopener noreferrer" className={styles.supportRow}>
          <span className={styles.supportIcon}><IconChat size={16} /></span>
          <span>@one_gogi (Telegram)</span>
        </a>
      </div>

      {photoLightbox && player.photo_url && (
        <div className={styles.lightboxOverlay} onClick={() => setPhotoLightbox(false)}>
          <div className={styles.lightboxBox} onClick={(e) => e.stopPropagation()}>
            <button className={styles.lightboxClose} onClick={() => setPhotoLightbox(false)} aria-label="Закрити">
              <IconX size={14} color="#fff" />
            </button>
            <img src={player.photo_url} alt={player.full_name} className={styles.lightboxImg} />
          </div>
        </div>
      )}

      {editOpen && (
        <div className={styles.modalOverlay} onClick={() => setEditOpen(false)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Редагувати профіль</div>
            <label className={styles.fieldLabel}>Ім&apos;я та прізвище</label>
            <input
              className={styles.fieldInput}
              value={editForm.fullName}
              onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
            />
            <label className={styles.fieldLabel}>Логін</label>
            <input
              className={styles.fieldInput}
              value={editForm.login}
              onChange={(e) => setEditForm((f) => ({ ...f, login: e.target.value }))}
            />
            <label className={styles.fieldLabel}>Telegram нікнейм</label>
            <input
              className={styles.fieldInput}
              value={editForm.telegramUsername}
              onChange={(e) => setEditForm((f) => ({ ...f, telegramUsername: e.target.value }))}
            />
            <label className={styles.fieldLabel}>Email</label>
            <input
              className={styles.fieldInput}
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
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
            <div className={styles.modalTitle}>Матчі турніру</div>
            <div className={styles.modalScroll}>
              {tournamentMatches.length === 0 && <div className={styles.empty}>Ще немає зіграних матчів</div>}
              {tournamentMatches.map((m) => {
                const nameA = m.team_a_players.map((id) => tournamentPlayersMap[id] || '?').join(' + ');
                const nameB = m.team_b_players.map((id) => tournamentPlayersMap[id] || '?').join(' + ');
                return (
                  <div key={m.id} className={styles.matchRow}>
                    <span className={styles.matchRound}>Р{m.round_number}</span>
                    <span>{nameA}</span>
                    <span className={styles.matchScore}>
                      {m.score_a}:{m.score_b}
                    </span>
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
            </div>
            <div className={styles.matchupTabs}>
              <button
                className={`${styles.matchupTab} ${matchupMode === 'together' ? styles.matchupTabOn : ''}`}
                onClick={() => {
                  setMatchupMode('together');
                  loadMatchup(openPartner.id, 'together');
                }}
              >
                Разом
              </button>
              <button
                className={`${styles.matchupTab} ${matchupMode === 'against' ? styles.matchupTabOn : ''}`}
                onClick={() => {
                  setMatchupMode('against');
                  loadMatchup(openPartner.id, 'against');
                }}
              >
                Проти
              </button>
            </div>
            <div className={styles.modalScroll}>
              {partnerMatches.length === 0 && <div className={styles.empty}>Ще немає ігор</div>}
              {partnerMatches.map((m) => (
                <div key={m.match_id} className={styles.matchRow}>
                  <span className={styles.matchTournament}>{m.tournament_name}</span>
                  <span className={styles.matchScore}>
                    {m.score_a}:{m.score_b}
                  </span>
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
