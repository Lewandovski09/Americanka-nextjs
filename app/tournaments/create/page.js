'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SKILL_CATEGORIES } from '@/lib/elo';
import styles from './create.module.css';

const COURT_RANGES = { beach13: [1, 2, 3, 4, 5, 6], dynamo_sc: [1, 2] };
const CATEGORY_TEXT_OPTIONS = ['Light', 'Medium', 'Pro'];
const POINTS_OPTIONS = [15, 21];
const BRACKET_SYSTEMS = [
  { id: 'double_elimination', label: 'Double Elimination' },
  { id: 'groups_playoff', label: 'Групи + плей-офф' },
  { id: 'groups_crosses_1_2', label: 'Групи + хрести (1-2 місця)' },
  { id: 'groups_top1_playoff_top23_crosses', label: 'Групи: 1 місце — плей-офф, 2-3 місця — хрести' },
];

export default function CreateTournamentPage() {
  const router = useRouter();
  const [formats, setFormats] = useState([]);
  const [formatCode, setFormatCode] = useState('americano_2v2_8p');
  const [name, setName] = useState('');

  // Americanka-only state (unchanged behaviour)
  const [category, setCategory] = useState('B');
  const [gender, setGender] = useState('M');
  const [eligiblePlayers, setEligiblePlayers] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);

  // New-format state (single_gender / mix / king_of_beach)
  const [categoryText, setCategoryText] = useState('Medium');
  const [genderNew, setGenderNew] = useState('M');
  const [maxParticipants, setMaxParticipants] = useState(null);
  const [bracketSystem, setBracketSystem] = useState(null);
  const [pointsToWin, setPointsToWin] = useState(21);
  const [useFinalPoints, setUseFinalPoints] = useState(false);
  const [finalPointsToWin, setFinalPointsToWin] = useState(15);

  // Shared
  const [location, setLocation] = useState('beach13');
  const [courts, setCourts] = useState([1]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedFormat = formats.find((f) => f.code === formatCode);
  const formatType = selectedFormat?.format_type || 'americanka';
  const requiredCount = selectedFormat?.player_count || 8;
  const courtRange = COURT_RANGES[location] || [1, 2];
  const maxParticipantsOptions = formatType === 'king_of_beach' ? [16, 20, 24, 28, 32] : [12, 16, 24];

  useEffect(() => {
    async function loadFormats() {
      const supabase = createClient();
      const { data } = await supabase.from('tournament_formats').select('*').eq('is_active', true);
      setFormats(data || []);
    }
    loadFormats();
  }, []);

  useEffect(() => {
    if (formatType !== 'americanka') return;
    async function loadPlayers() {
      const supabase = createClient();
      const catDef = SKILL_CATEGORIES.find((c) => c.id === category);

      const { data } = await supabase
        .from('players')
        .select('id, full_name, elo, photo_url')
        .eq('gender', gender)
        .eq('approval_status', 'approved')
        .gte('elo', catDef.range[0])
        .lt('elo', catDef.range[1]);

      setEligiblePlayers(data || []);
      setSelectedIds([]);
    }
    loadPlayers();
  }, [category, gender, formatType]);

  // Reset to a valid court whenever the location (and therefore the
  // available court range) changes.
  useEffect(() => {
    setCourts([1]);
  }, [location]);

  // Reset max participants when switching format type, since the
  // valid option set is different for King of the Beach.
  useEffect(() => {
    setMaxParticipants(null);
    setBracketSystem(null);
  }, [formatType]);

  function toggleCourt(n) {
    setCourts((prev) => {
      if (prev.includes(n)) {
        return prev.length > 1 ? prev.filter((c) => c !== n) : prev;
      }
      return prev.length < 2 ? [...prev, n].sort((a, b) => a - b) : prev;
    });
  }

  function togglePlayer(id) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length < requiredCount) return [...prev, id];
      return prev;
    });
  }

  async function handleCreate() {
    setError('');
    if (!scheduledAt) {
      setError('Вкажіть дату та час');
      return;
    }

    let payload;

    if (formatType === 'americanka') {
      if (selectedIds.length !== requiredCount) {
        setError(`Потрібно рівно ${requiredCount} гравців`);
        return;
      }
      payload = {
        name: name || `Американка #${Date.now()}`,
        formatCode,
        category,
        gender,
        location,
        courts,
        scheduledAt: new Date(scheduledAt).toISOString(),
        playerIds: selectedIds,
      };
    } else {
      if (!maxParticipants) {
        setError('Вкажіть максимальну кількість учасників');
        return;
      }
      if ((formatType === 'single_gender' || formatType === 'mix') && !bracketSystem) {
        setError('Виберіть систему турніру');
        return;
      }
      payload = {
        name: name || `${selectedFormat?.display_name || 'Турнір'} #${Date.now()}`,
        formatCode,
        location,
        courts,
        scheduledAt: new Date(scheduledAt).toISOString(),
        gender: formatType === 'mix' ? null : genderNew,
        maxParticipants,
        bracketSystem: formatType === 'single_gender' || formatType === 'mix' ? bracketSystem : null,
        categoryText,
        pointsToWin,
        finalPointsToWin: useFinalPoints ? finalPointsToWin : null,
      };
    }

    setLoading(true);
    const res = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error || 'Не вдалося створити турнір');
      return;
    }

    router.push(`/tournaments/${data.tournament.id}`);
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Новий турнір</h2>

      <label className={styles.label}>Формат</label>
      <div className={styles.formatGrid}>
        {formats.map((f) => (
          <button
            key={f.code}
            className={`${styles.formatCard} ${formatCode === f.code ? styles.formatCardOn : ''}`}
            onClick={() => setFormatCode(f.code)}
          >
            {f.display_name}
          </button>
        ))}
      </div>

      <label className={styles.label}>Назва</label>
      <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Залишити порожнім — назва згенерується сама" />

      <label className={styles.label}>Дата та час початку</label>
      <input
        className={styles.input}
        type="datetime-local"
        value={scheduledAt}
        onChange={(e) => setScheduledAt(e.target.value)}
      />

      <label className={styles.label}>Місце проведення</label>
      <div className={styles.row}>
        <OptionBtn active={location === 'beach13'} onClick={() => setLocation('beach13')}>
          Beach 13
        </OptionBtn>
        <OptionBtn active={location === 'dynamo_sc'} onClick={() => setLocation('dynamo_sc')}>
          Dynamo SC
        </OptionBtn>
      </div>

      <label className={styles.label}>Корти</label>
      <div className={styles.row}>
        {courtRange.map((n) => (
          <OptionBtn key={n} active={courts.includes(n)} onClick={() => toggleCourt(n)}>
            Корт {n}
          </OptionBtn>
        ))}
      </div>

      {formatType === 'americanka' ? (
        <>
          <label className={styles.label}>Категорія</label>
          <div className={styles.chipsRow}>
            {['D', 'C', 'B', 'A'].map((c) => (
              <button key={c} className={`${styles.chip} ${category === c ? styles.chipOn : ''}`} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>

          <label className={styles.label}>Стать</label>
          <div className={styles.row}>
            <OptionBtn active={gender === 'M'} onClick={() => setGender('M')}>
              Чоловіки
            </OptionBtn>
            <OptionBtn active={gender === 'F'} onClick={() => setGender('F')}>
              Жінки
            </OptionBtn>
          </div>

          <label className={styles.label}>
            Гравці ({selectedIds.length}/{requiredCount})
          </label>
          <div>
            {eligiblePlayers.map((p) => {
              const selected = selectedIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  className={`${styles.playerRow} ${selected ? styles.playerRowOn : ''}`}
                  onClick={() => togglePlayer(p.id)}
                >
                  <div className={styles.playerName}>{p.full_name}</div>
                  <div className={styles.playerElo}>{p.elo} Ело</div>
                </div>
              );
            })}
            {eligiblePlayers.length === 0 && <div className={styles.empty}>Немає гравців у цій категорії/статі</div>}
          </div>
        </>
      ) : (
        <>
          <label className={styles.label}>Категорія</label>
          <div className={styles.chipsRow}>
            {CATEGORY_TEXT_OPTIONS.map((c) => (
              <button key={c} className={`${styles.chip} ${categoryText === c ? styles.chipOn : ''}`} onClick={() => setCategoryText(c)}>
                {c}
              </button>
            ))}
          </div>

          {formatType === 'mix' ? (
            <div className={styles.infoBox}>Мікс — пари з одного чоловіка та однієї жінки. Стать окремо не обирається.</div>
          ) : (
            <>
              <label className={styles.label}>Стать</label>
              <div className={styles.row}>
                <OptionBtn active={genderNew === 'M'} onClick={() => setGenderNew('M')}>
                  Чоловіки
                </OptionBtn>
                <OptionBtn active={genderNew === 'F'} onClick={() => setGenderNew('F')}>
                  Жінки
                </OptionBtn>
              </div>
            </>
          )}

          <label className={styles.label}>
            {formatType === 'king_of_beach' ? 'Максимальна кількість учасників' : 'Максимальна кількість пар'}
          </label>
          <div className={styles.chipsRow}>
            {maxParticipantsOptions.map((n) => (
              <button
                key={n}
                className={`${styles.chip} ${maxParticipants === n ? styles.chipOn : ''}`}
                onClick={() => setMaxParticipants(n)}
              >
                {n}
              </button>
            ))}
          </div>

          {(formatType === 'single_gender' || formatType === 'mix') && (
            <>
              <label className={styles.label}>Система турніру</label>
              <div className={styles.bracketList}>
                {BRACKET_SYSTEMS.map((b) => (
                  <button
                    key={b.id}
                    className={`${styles.bracketOption} ${bracketSystem === b.id ? styles.bracketOptionOn : ''}`}
                    onClick={() => setBracketSystem(b.id)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <label className={styles.label}>Партії до</label>
          <div className={styles.chipsRow}>
            {POINTS_OPTIONS.map((p) => (
              <button key={p} className={`${styles.chip} ${pointsToWin === p ? styles.chipOn : ''}`} onClick={() => setPointsToWin(p)}>
                {p}
              </button>
            ))}
          </div>

          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={useFinalPoints} onChange={(e) => setUseFinalPoints(e.target.checked)} />
            <span>З півфіналу/фіналу інший рахунок</span>
          </label>

          {useFinalPoints && (
            <div className={styles.chipsRow}>
              {POINTS_OPTIONS.map((p) => (
                <button
                  key={p}
                  className={`${styles.chip} ${finalPointsToWin === p ? styles.chipOn : ''}`}
                  onClick={() => setFinalPointsToWin(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className={styles.infoBox}>
            Після створення гравці реєструються самостійно в застосунку (до {maxParticipants || '...'}{' '}
            {formatType === 'king_of_beach' ? 'учасників' : 'пар'}). Сітка/групи формуються після закриття реєстрації.
          </div>
        </>
      )}

      {error && <div className={styles.errMsg}>{error}</div>}

      <button className={styles.btnPrimary} disabled={loading} onClick={handleCreate}>
        {loading ? 'Створення...' : 'Розпочати →'}
      </button>
    </div>
  );
}

function OptionBtn({ active, onClick, children }) {
  return (
    <button className={`${styles.optionBtn} ${active ? styles.optionBtnOn : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
