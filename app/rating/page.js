'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, SKILL_CATEGORIES } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './rating.module.css';

export default function RatingPage() {
  const { player } = useCurrentPlayer();
  const [tab, setTab] = useState('rating'); // 'rating' | 'stats'
  const [gender, setGender] = useState('M');
  const [category, setCategory] = useState('all');
  const [players, setPlayers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  // ── Compare players state ──
  const [loginA, setLoginA] = useState('');
  const [loginB, setLoginB] = useState('');
  const [compareError, setCompareError] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState(null); // { playerA, playerB, statsA, statsB }

  useEffect(() => {
    if (tab !== 'rating') return;
    async function load() {
      const supabase = createClient();
      let query = supabase
        .from('players')
        .select('id, full_name, login, elo, photo_url, tournaments_played')
        .eq('gender', gender)
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false });

      if (category !== 'all') {
        const catDef = SKILL_CATEGORIES.find((c) => c.id === category);
        query = query.gte('elo', catDef.range[0]).lt('elo', catDef.range[1]);
      }

      const { data } = await query;
      setPlayers(data || []);
    }
    load();
  }, [gender, category, tab]);

  const filteredPlayers = searchTerm.trim()
    ? players.filter(
        (p) =>
          p.login.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
          p.full_name.toLowerCase().includes(searchTerm.trim().toLowerCase())
      )
    : players;

  async function handleCompare() {
    setCompareError('');
    setCompareResult(null);
    if (!loginA.trim() || !loginB.trim()) {
      setCompareError("Вкажіть обидва логіни");
      return;
    }

    setCompareLoading(true);
    const supabase = createClient();

    const [resA, resB] = await Promise.all([
      supabase.from('players').select('*').eq('login', loginA.trim().toLowerCase()).maybeSingle(),
      supabase.from('players').select('*').eq('login', loginB.trim().toLowerCase()).maybeSingle(),
    ]);

    if (!resA.data || !resB.data) {
      setCompareLoading(false);
      setCompareError('Одного або обох гравців не знайдено');
      return;
    }

    const [statsA, statsB] = await Promise.all([
      supabase.rpc('get_player_format_stats', { p_player_id: resA.data.id }),
      supabase.rpc('get_player_format_stats', { p_player_id: resB.data.id }),
    ]);

    setCompareLoading(false);
    setCompareResult({
      playerA: resA.data,
      playerB: resB.data,
      statsA: statsA.data || [],
      statsB: statsB.data || [],
    });
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.pageTitle}>Рейтинг і статистика</h2>
      <div className={styles.tabs}>
        <button className={`${styles.tabBtn} ${tab === 'rating' ? styles.tabBtnOn : ''}`} onClick={() => setTab('rating')}>
          Рейтинг
        </button>
        <button className={`${styles.tabBtn} ${tab === 'stats' ? styles.tabBtnOn : ''}`} onClick={() => setTab('stats')}>
          Статистика
        </button>
      </div>

      {tab === 'rating' && (
        <>
          <input
            className={styles.searchInput}
            placeholder="Пошук за нікнеймом або іменем..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <div className={styles.row}>
            <button className={`${styles.genderBtn} ${gender === 'M' ? styles.genderBtnOn : ''}`} onClick={() => setGender('M')}>
              Чоловіки
            </button>
            <button className={`${styles.genderBtn} ${gender === 'F' ? styles.genderBtnOn : ''}`} onClick={() => setGender('F')}>
              Жінки
            </button>
          </div>

          <div className={styles.chipsRow}>
            <button className={`${styles.chip} ${category === 'all' ? styles.chipOn : ''}`} onClick={() => setCategory('all')}>
              Всі
            </button>
            {['A', 'B', 'C', 'D'].map((c) => (
              <button key={c} className={`${styles.chip} ${category === c ? styles.chipOn : ''}`} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>

          {filteredPlayers.length === 0 && <div className={styles.empty}>Немає гравців</div>}

          {filteredPlayers.map((p, i) => (
            <div key={p.id} className={`${styles.playerRow} ${p.id === player?.id ? styles.meRow : ''}`}>
              <div className={styles.rank} style={i === 0 ? { color: 'var(--rust)', fontWeight: 800 } : undefined}>{i + 1}</div>
              <PlayerAvatar player={p} size={36} />
              <div className={styles.playerInfo}>
                <div className={styles.playerName}>{p.full_name}</div>
                <div className={styles.playerMeta}>@{p.login} · {p.tournaments_played} турн.</div>
              </div>
              <div className={styles.playerEloBox}>
                <div className={styles.playerElo}>{p.elo}</div>
                <div className={styles.playerCat}>{categoryForElo(p.elo)?.label}</div>
              </div>
            </div>
          ))}

          <div className={styles.sectionLabel}>Шкала рівнів</div>
          <div className={styles.scaleCard}>
            {SKILL_CATEGORIES.map((c) => (
              <div key={c.id} className={styles.scaleRow}>
                <div className={styles.scaleHeader}>
                  <span>{c.id}</span>
                  <span>{c.range[0]}–{c.range[1]}</span>
                </div>
                <div className={styles.scaleBar}>
                  <div
                    className={styles.scaleFill}
                    style={{ width: `${Math.round(((c.range[1] - 800) / (2200 - 800)) * 100)}%`, background: c.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'stats' && (
        <>
          <div className={styles.sectionLabel}>Порівняти гравців</div>
          <div className={styles.compareCard}>
            <input
              className={styles.compareInput}
              placeholder="Логін гравця А"
              value={loginA}
              onChange={(e) => setLoginA(e.target.value)}
            />
            <input
              className={styles.compareInput}
              placeholder="Логін гравця Б"
              value={loginB}
              onChange={(e) => setLoginB(e.target.value)}
            />
            <button className={styles.compareBtn} disabled={compareLoading} onClick={handleCompare}>
              {compareLoading ? 'Завантаження...' : 'Порівняти'}
            </button>
            {compareError && <div className={styles.searchError}>{compareError}</div>}
          </div>

          {compareResult && (
            <CompareResult
              playerA={compareResult.playerA}
              playerB={compareResult.playerB}
              statsA={compareResult.statsA}
              statsB={compareResult.statsB}
            />
          )}
        </>
      )}
    </div>
  );
}

function CompareResult({ playerA, playerB, statsA, statsB }) {
  const allFormats = Array.from(new Set([...statsA.map((s) => s.format_name), ...statsB.map((s) => s.format_name)]));

  function findStat(stats, formatName) {
    return stats.find((s) => s.format_name === formatName);
  }

  return (
    <div className={styles.compareResultCard}>
      <div className={styles.compareHeaderRow}>
        <div className={styles.comparePlayerCol}>
          <PlayerAvatar player={playerA} size={40} />
          <div className={styles.comparePlayerName}>{playerA.full_name}</div>
          <div className={styles.comparePlayerElo}>{playerA.elo} Ело</div>
        </div>
        <div className={styles.compareVs}>VS</div>
        <div className={styles.comparePlayerCol}>
          <PlayerAvatar player={playerB} size={40} />
          <div className={styles.comparePlayerName}>{playerB.full_name}</div>
          <div className={styles.comparePlayerElo}>{playerB.elo} Ело</div>
        </div>
      </div>

      {allFormats.length === 0 && <div className={styles.empty}>Ще немає завершених турнірів у жодного з гравців</div>}

      {allFormats.map((format) => {
        const a = findStat(statsA, format);
        const b = findStat(statsB, format);
        const winRateA = a && a.games_played > 0 ? Math.round((a.games_won / a.games_played) * 100) : 0;
        const winRateB = b && b.games_played > 0 ? Math.round((b.games_won / b.games_played) * 100) : 0;

        return (
          <div key={format} className={styles.compareFormatRow}>
            <div className={styles.compareFormatName}>{format}</div>
            <div className={styles.compareStatsGrid}>
              <div className={styles.compareStatCol}>
                <div className={styles.compareStatBig}>{winRateA}%</div>
                <div className={styles.compareStatSmall}>{a?.tournaments_played ?? 0} турн. · {a?.games_played ?? 0} ігор</div>
              </div>
              <div className={styles.compareStatCol}>
                <div className={styles.compareStatBig}>{winRateB}%</div>
                <div className={styles.compareStatSmall}>{b?.tournaments_played ?? 0} турн. · {b?.games_played ?? 0} ігор</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
