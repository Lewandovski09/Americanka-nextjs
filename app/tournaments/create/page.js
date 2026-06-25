'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { categoryForElo } from '@/lib/elo';
import styles from './create.module.css';

export default function CreateTournamentPage() {
  const router = useRouter();
  const [formats, setFormats] = useState([]);
  const [formatCode, setFormatCode] = useState('americano_2v2_8p');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('B');
  const [gender, setGender] = useState('M');
  const [location, setLocation] = useState('beach13');
  const [courts, setCourts] = useState([1]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [eligiblePlayers, setEligiblePlayers] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedFormat = formats.find((f) => f.code === formatCode);
  const requiredCount = selectedFormat?.player_count || 8;

  useEffect(() => {
    async function loadFormats() {
      const supabase = createClient();
      const { data } = await supabase.from('tournament_formats').select('*').eq('is_active', true);
      setFormats(data || []);
    }
    loadFormats();
  }, []);

  useEffect(() => {
    async function loadPlayers() {
      const supabase = createClient();
      const range = categoryForElo(1000)?.range; // placeholder, real filter below
      const catDef = [
        { id: 'D', range: [800, 1000] },
        { id: 'C', range: [1000, 1200] },
        { id: 'B', range: [1200, 1500] },
        { id: 'A', range: [1500, 1800] },
        { id: 'Open', range: [1800, 2200] },
      ].find((c) => c.id === category);

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
  }, [category, gender]);

  function toggleCourt(n) {
    setCourts((prev) => {
      if (prev.includes(n)) {
        return prev.length > 1 ? prev.filter((c) => c !== n) : prev;
      }
      return prev.length < 2 ? [...prev, n].sort() : prev;
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
    if (selectedIds.length !== requiredCount) {
      setError(`Потрібно рівно ${requiredCount} гравців`);
      return;
    }
    if (!scheduledAt) {
      setError('Вкажіть дату та час');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || `Американка #${Date.now()}`,
        formatCode,
        category,
        gender,
        location,
        courts,
        scheduledAt: new Date(scheduledAt).toISOString(),
        playerIds: selectedIds,
      }),
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

      <label className={styles.label}>Назва</label>
      <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Американка B #1" />

      <label className={styles.label}>Формат</label>
      <select className={styles.input} value={formatCode} onChange={(e) => setFormatCode(e.target.value)}>
        {formats.map((f) => (
          <option key={f.code} value={f.code}>
            {f.display_name}
          </option>
        ))}
      </select>

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
        <OptionBtn active={courts.includes(1)} onClick={() => toggleCourt(1)}>
          Корт 1
        </OptionBtn>
        <OptionBtn active={courts.includes(2)} onClick={() => toggleCourt(2)}>
          Корт 2
        </OptionBtn>
      </div>

      <label className={styles.label}>Категорія</label>
      <div className={styles.chipsRow}>
        {['D', 'C', 'B', 'A', 'Open'].map((c) => (
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
