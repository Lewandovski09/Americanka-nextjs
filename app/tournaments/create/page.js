'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  listFormats,
  getFormat,
  CATEGORY_LABELS,
  BRACKET_SYSTEMS,
  FIRST_TO_OPTIONS,
  getBracketSystem,
  defaultParticipantsFor,
} from '@/lib/formats';
import AvpTierPicker from '@/components/AvpTierPicker';
import styles from './create.module.css';
import OptionBtn from '@/components/OptionBtn';

const COURT_RANGES = { beach13: [1, 2, 3, 4, 5, 6], dynamo_sc: [1, 2] };
const GENDERS = [
  { id: 'M', label: 'Чоловіки' },
  { id: 'F', label: 'Жінки' },
];

function catKey(gender, label) {
  return `${gender || 'X'}:${label}`;
}

export default function CreateEventPage() {
  const router = useRouter();
  const formats = useMemo(() => listFormats(), []);

  const [formatKind, setFormatKind] = useState('americanka');
  const format = getFormat(formatKind);

  const [name, setName] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [location, setLocation] = useState('beach13');
  const [courts, setCourts] = useState([1]);

  const [pointsToWin, setPointsToWin] = useState(21);
  const [useFinalPoints, setUseFinalPoints] = useState(false);
  const [finalPointsToWin, setFinalPointsToWin] = useState(15);
  const [avpTier, setAvpTier] = useState(null);

  // categories: array of { gender, categoryLabel, maxParticipants, bracketSystem }
  // Elo bands are derived automatically on the server (even split of the
  // rating spread across the selected leagues) — not entered here.
  const [categories, setCategories] = useState([]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const courtRange = COURT_RANGES[location] || [1, 2];
  const gendersToShow = format.hasGender ? GENDERS.map((g) => g.id) : [null];

  // Reset location-dependent courts and format-dependent categories.
  useEffect(() => {
    setCourts([1]);
  }, [location]);

  useEffect(() => {
    setCategories([]);
  }, [formatKind]);

  function toggleCourt(n) {
    setCourts((prev) => {
      if (prev.includes(n)) return prev.length > 1 ? prev.filter((c) => c !== n) : prev;
      // Cap at however many courts the venue actually has (Beach 1–6,
      // Dynamo 1–2). Americanka only ever uses 2 in parallel, but King
      // of the Beach / group stages can run on all of them at once.
      return prev.length < courtRange.length ? [...prev, n].sort((a, b) => a - b) : prev;
    });
  }

  function isCatOn(gender, label) {
    return categories.some((c) => catKey(c.gender, c.categoryLabel) === catKey(gender, label));
  }

  function toggleCategory(gender, label) {
    const key = catKey(gender, label);
    setCategories((prev) => {
      if (prev.some((c) => catKey(c.gender, c.categoryLabel) === key)) {
        return prev.filter((c) => catKey(c.gender, c.categoryLabel) !== key);
      }
      const bracketSystem = format.needsBracketSystem ? BRACKET_SYSTEMS[0].id : null;
      const maxParticipants = format.needsBracketSystem
        ? defaultParticipantsFor(bracketSystem)
        : format.participantOptions
        ? format.participantOptions[0]
        : null;
      return [
        ...prev,
        {
          gender: format.hasGender ? gender : null,
          categoryLabel: label,
          maxParticipants,
          bracketSystem,
        },
      ];
    });
  }

  function updateCategory(key, patch) {
    setCategories((prev) =>
      prev.map((c) => (catKey(c.gender, c.categoryLabel) === key ? { ...c, ...patch } : c))
    );
  }

  async function handleCreate() {
    setError('');
    if (!scheduledAt) return setError('Вкажіть дату та час');
    if (categories.length === 0) return setError('Додайте щонайменше одну категорію');

    if (format.needsBracketSystem && categories.some((c) => !c.bracketSystem)) {
      return setError('Виберіть систему турніру для кожної категорії');
    }
    if (format.participantOptions && categories.some((c) => !c.maxParticipants)) {
      return setError('Вкажіть кількість учасників для кожної категорії');
    }

    const payload = {
      formatKind,
      name,
      location,
      courts,
      scheduledAt: new Date(scheduledAt).toISOString(),
      pointsToWin: format.scoring === 'first_to' ? pointsToWin : null,
      pointsMode: useFinalPoints ? 'from_semifinal' : 'whole',
      finalPointsToWin: useFinalPoints ? finalPointsToWin : null,
      avpTier,
      categories,
    };

    setLoading(true);
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) return setError(data.error || 'Не вдалося створити турнір');
    router.push('/tournaments');
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Нова подія</h2>

      <label className={styles.label}>Формат</label>
      <div className={styles.formatGrid}>
        {formats.map((f) => (
          <button
            key={f.kind}
            className={`${styles.formatCard} ${formatKind === f.kind ? styles.formatCardOn : ''}`}
            onClick={() => setFormatKind(f.kind)}
            aria-pressed={formatKind === f.kind}
          >
            {f.displayName}
          </button>
        ))}
      </div>
      <div className={styles.infoBox}>{format.description}</div>

      <label className={styles.label}>Назва</label>
      <input
        className={styles.input}
        value={name}
        aria-label="Назва турніру"
        onChange={(e) => setName(e.target.value)}
        placeholder="Залишити порожнім — згенерується сама"
      />

      <label className={styles.label}>Дата та час початку</label>
      <input
        className={styles.input}
        type="datetime-local"
        value={scheduledAt}
        aria-label="Дата та час початку"
        onChange={(e) => setScheduledAt(e.target.value)}
      />

      <label className={styles.label}>Місце проведення</label>
      <div className={styles.row}>
        <OptionBtn styles={styles} active={location === 'beach13'} onClick={() => setLocation('beach13')}>
          Beach 13
        </OptionBtn>
        <OptionBtn styles={styles} active={location === 'dynamo_sc'} onClick={() => setLocation('dynamo_sc')}>
          Dynamo SC
        </OptionBtn>
      </div>

      <label className={styles.label}>Корти</label>
      <div className={styles.chipsRow}>
        {courtRange.map((n) => (
          <button
            key={n}
            className={`${styles.chip} ${courts.includes(n) ? styles.chipOn : ''}`}
            onClick={() => toggleCourt(n)}
            aria-pressed={courts.includes(n)}
          >
            Корт {n}
          </button>
        ))}
      </div>

      {/* Scoring (americanka is always sum-to-31) */}
      {format.scoring === 'first_to' && (
        <>
          <label className={styles.label}>Партії до</label>
          <div className={styles.chipsRow}>
            {FIRST_TO_OPTIONS.map((p) => (
              <button key={p} className={`${styles.chip} ${pointsToWin === p ? styles.chipOn : ''}`} onClick={() => setPointsToWin(p)} aria-pressed={pointsToWin === p}>
                {p}
              </button>
            ))}
          </div>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={useFinalPoints} onChange={(e) => setUseFinalPoints(e.target.checked)} />
            <span>З півфіналу інший рахунок</span>
          </label>
          {useFinalPoints && (
            <div className={styles.chipsRow}>
              {FIRST_TO_OPTIONS.map((p) => (
                <button
                  key={p}
                  className={`${styles.chip} ${finalPointsToWin === p ? styles.chipOn : ''}`}
                  onClick={() => setFinalPointsToWin(p)}
                  aria-pressed={finalPointsToWin === p}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {format.scoring === 'sum31' && (
        <div className={styles.infoBox}>Американка — рахунок завжди до суми 31.</div>
      )}

      <label className={styles.label}>Рівень AVP</label>
      <AvpTierPicker value={avpTier} onChange={setAvpTier} styles={styles} />

      <div className={styles.infoBox}>
        Реєстрація єдина: гравці подають заявку в обрану лігу, а адмін бачить бажану лігу та реальний
        рейтинг гравця і сам розподіляє учасників.
      </div>

      {/* Category picker */}
      <label className={styles.label}>Категорії</label>
      {gendersToShow.map((gender) => (
        <div key={gender || 'mix'} className={styles.catGroup}>
          {format.hasGender && (
            <div className={styles.catGroupTitle}>{gender === 'M' ? 'Чоловіки' : 'Жінки'}</div>
          )}
          <div className={styles.chipsRow}>
            {CATEGORY_LABELS.map((label) => (
              <button
                key={label}
                className={`${styles.chip} ${isCatOn(gender, label) ? styles.chipOn : ''}`}
                onClick={() => toggleCategory(gender, label)}
                aria-pressed={isCatOn(gender, label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Per-category config */}
      {categories.map((c) => {
        const key = catKey(c.gender, c.categoryLabel);
        // Elo bands are auto-derived; a card only appears when there is
        // something to configure (participants / bracket system).
        if (!format.participantOptions && !format.needsBracketSystem) return null;
        return (
          <div key={key} className={styles.catCard}>
            <div className={styles.catCardHead}>
              <div className={styles.catCardTitle}>
                {c.gender ? (c.gender === 'M' ? 'Ч · ' : 'Ж · ') : ''}
                {c.categoryLabel}
              </div>
              <button className={styles.catRemove} onClick={() => toggleCategory(c.gender, c.categoryLabel)}>
                Прибрати
              </button>
            </div>

            {format.needsBracketSystem && (
              <>
                <div className={styles.miniLabel}>Система турніру</div>
                <div className={styles.bracketList}>
                  {BRACKET_SYSTEMS.map((b) => (
                    <button
                      key={b.id}
                      className={`${styles.bracketOption} ${c.bracketSystem === b.id ? styles.bracketOptionOn : ''}`}
                      // Switching system resets the stored count for it.
                      onClick={() =>
                        updateCategory(key, {
                          bracketSystem: b.id,
                          maxParticipants: defaultParticipantsFor(b.id),
                        })
                      }
                      aria-pressed={c.bracketSystem === b.id}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {(() => {
              const sys = format.needsBracketSystem ? getBracketSystem(c.bracketSystem) : null;
              // Group systems: fixed pair range, nothing to choose.
              if (sys && !sys.sizeChoice) {
                const opts = sys.participantOptions;
                const lo = opts[0];
                const hi = opts[opts.length - 1];
                return (
                  <div className={styles.miniLabel}>
                    {lo === hi
                      ? `Пар: ${lo} (${sys.groupCount} групи по ${lo / sys.groupCount}, зайві — у резерв)`
                      : `Кількість пар: ${lo}–${hi} (зайві — у резерв)`}
                  </div>
                );
              }
              const opts = sys ? sys.participantOptions : format.participantOptions;
              if (!opts || opts.length === 0) return null;
              const label = sys?.sizeChoice
                ? 'Розмір сітки (пар)'
                : format.countsPairs
                ? 'Кількість пар'
                : 'Кількість учасників';
              return (
                <>
                  <div className={styles.miniLabel}>{label}</div>
                  <div className={styles.chipsRow}>
                    {opts.map((n) => (
                      <button
                        key={n}
                        className={`${styles.chip} ${c.maxParticipants === n ? styles.chipOn : ''}`}
                        onClick={() => updateCategory(key, { maxParticipants: n })}
                        aria-pressed={c.maxParticipants === n}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        );
      })}

      <div className={styles.infoBox}>
        Після створення категорії відкриваються для заявок. Гравці реєструються в застосунку
        {format.registrationType === 'solo' ? ' (індивідуально)' : ' (парою або в пошуку напарника)'}, а сітки/групи
        формуються після закриття реєстрації.
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      <button className={styles.btnPrimary} disabled={loading} onClick={handleCreate}>
        {loading ? 'Створення...' : 'Створити подію →'}
      </button>
    </div>
  );
}
