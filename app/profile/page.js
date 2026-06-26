'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, expectedScore } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
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

  async function openPartnerHistory(partner) {
    setOpenPartner(partner);
    const supabase = createClient();
    const { data } = await supabase.rpc('get_partner_match_history', {
      p_player_id: player.id,
      p_partner_id: partner.id,
    });
    setPartnerMatches(data || []);
  }

  async function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file || !player) return;
    const supabase = createClient();
    const ext = file.name.split('.').pop();
    const path = `${player.id}.${ext}`;
    await supabase.storage.from('player-photos').upload(path, file, { upsert: true });
    const { data: urlData } = supabase.storage.from('player-photos').getPublicUrl(path);
    await supabase.from('players').update({ photo_url: urlData.publicUrl }).eq('id', player.id);
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
          <PlayerAvatar player={player} size={56} />
          <label className={styles.photoEditBtn}>
            ✎
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
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          Вийти
        </button>
      </div>

      {player.is_admin ? (
        <AdminStats />
      ) : (
        <>
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

          <div className={styles.sectionLabel}>Партнери</div>
          <div className={styles.card}>
            {partners.length === 0 && <div className={styles.empty}>Дані після турнірів</div>}
            {partners.map((p) => (
              <div
                key={p.partner_id}
                className={styles.partnerRow}
                onClick={() => openPartnerHistory(p.partner)}
                style={{ cursor: 'pointer' }}
              >
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
            <div
              key={h.tournament_id}
              className={styles.historyCard}
              onClick={() => openTournamentDetails(h.tournament_id)}
              style={{ cursor: 'pointer' }}
            >
              <div>
                <div className={styles.historyName}>{h.tournament_name}</div>
                <div className={styles.historyPlace}>
                  {h.placement ? `${['🥇', '🥈', '🥉'][h.placement - 1] || ''} ${h.placement}-є місце` : 'В процесі'}
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
        </>
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
            <div className={styles.modalSub}>Всі спільні гри за весь час</div>
            <div className={styles.modalScroll}>
              {partnerMatches.length === 0 && <div className={styles.empty}>Ще немає спільних ігор</div>}
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

function AdminStats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: males } = await supabase
        .from('players')
        .select('id, full_name, elo')
        .eq('gender', 'M')
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false })
        .limit(3);
      const { data: females } = await supabase
        .from('players')
        .select('id, full_name, elo')
        .eq('gender', 'F')
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false })
        .limit(3);
      const { count: maleCount } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('gender', 'M')
        .eq('approval_status', 'approved');
      const { count: femaleCount } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('gender', 'F')
        .eq('approval_status', 'approved');
      const { count: pendingCount } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending');
      const { count: doneCount } = await supabase
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'done');

      setStats({ males, females, maleCount, femaleCount, pendingCount, doneCount });
    }
    load();
  }, []);

  if (!stats) return <div className={styles.loading}>Завантаження...</div>;

  return (
    <div>
      <div className={styles.statsGrid}>
        <StatBox value={stats.maleCount} label="Чоловіків" />
        <StatBox value={stats.femaleCount} label="Жінок" />
        <StatBox value={stats.doneCount} label="Турнірів" />
        <StatBox value={stats.pendingCount} label="Очікують" />
      </div>
      <div className={styles.sectionLabel}>Топ Ело · Чоловіки</div>
      {stats.males.map((p) => (
        <div key={p.id} className={styles.partnerRow}>
          <div className={styles.partnerName}>{p.full_name}</div>
          <div className={styles.partnerMeta}>{p.elo} Ело</div>
        </div>
      ))}
      <div className={styles.sectionLabel}>Топ Ело · Жінки</div>
      {stats.females.map((p) => (
        <div key={p.id} className={styles.partnerRow}>
          <div className={styles.partnerName}>{p.full_name}</div>
          <div className={styles.partnerMeta}>{p.elo} Ело</div>
        </div>
      ))}
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
