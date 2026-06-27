'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, expectedScore } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconEdit, IconMail, IconChat } from '@/components/Icons';
import styles from './profile.module.css';

export default function ProfilePage() {
  const router = useRouter();
  const { player, loading } = useCurrentPlayer();
  const [tournamentHistory, setTournamentHistory] = useState([]);
  const [partners, setPartners] = useState([]);
  const [opponentElo, setOpponentElo] = useState(1200);

  const [openTournamentId, setOpenTournamentId] = useState(null);
  const [tournamentMatches, setTournamentMatches] = useState([]);
  const [tournamentPlayersMap, setTournamentPlayersMap] = useState({});

  const [openPartner, setOpenPartner] = useState(null);
  const [partnerMatches, setPartnerMatches] = useState([]);
  const [matchupMode, setMatchupMode] = useState('together'); // 'together' | 'against'

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [searchLogin, setSearchLogin] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!player) return;
    async function load() {
      const supabase = createClient();

      const { data: th } = await supabase.rpc('get_player_tournament_history', { p_player_id: player.id });
      setTournamentHistory(th || []);

      const { data: p } = await supabase
        .from('partner_stats')
        .select('*, partner:players!partner_stats_partner_id_fkey(id, full_name, photo_url)')
        .eq('player_id', player.id)
        .order('games_together', { ascending: false });
      setPartners(p || []);
    }
    load();
  }, [player]);

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
    router.push('/register');
  }

  if (loading) return <div className={styles.loading}>Завантаження...</div>;
  if (!player) return <div className={styles.loading}>Будь ласка, увійдіть в акаунт</div>;

  const e = expectedScore(player.elo || 1200, opponentElo);
  const winGain = Math.round(32 * (1 - e));
  const lossDelta = Math.round(32 * (0 - e));
  const totalEloGain = tournamentHistory.reduce((sum, h) => sum + (h.elo_delta || 0), 0);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          <PlayerAvatar player={player} size={64} />
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
              : `${categoryForElo(player.elo)?.label} · ${player.elo} Ело`}
          </div>
          <button className={styles.editProfileBtn} onClick={openEdit}>
            Редагувати профіль
          </button>
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          Вийти
        </button>
      </div>

      <div className={styles.statsGrid}>
        <StatBox value={player.elo ?? '—'} label="Рейтинг Ело" />
        <StatBox value={player.tournaments_played} label="Турнірів" />
        <StatBox value={player.tournaments_won} label="Перемог" />
        <StatBox value={totalEloGain >= 0 ? `+${totalEloGain}` : totalEloGain} label="Ело всього" />
      </div>

      <div className={styles.sectionLabel}>Калькулятор Ело</div>
      <div className={styles.card}>
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
          <CalcBox value={`${Math.round(e * 100)}%`} label="шанс" color="#f0c040" />
          <CalcBox value={`+${winGain}`} label="перемога" color="#6ee7b7" />
          <CalcBox value={lossDelta} label="поразка" color="#fca5a5" />
        </div>
      </div>

      <div className={styles.sectionLabel}>Партнери та суперники</div>
      <div className={styles.card}>
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            placeholder="Логін гравця..."
            value={searchLogin}
            onChange={(e) => setSearchLogin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchPlayer()}
          />
          <button className={styles.searchBtn} disabled={searching} onClick={handleSearchPlayer}>
            {searching ? '...' : 'Знайти'}
          </button>
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

function StatBox({ value, label }) {
  return (
    <div className={styles.statBox}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function CalcBox({ value, label, color }) {
  return (
    <div className={styles.calcBox}>
      <div className={styles.calcValue} style={{ color }}>
        {value}
      </div>
      <div className={styles.calcLabel}>{label}</div>
    </div>
  );
}
