'use client';

// «Налаштування» tab of the pre-start event settings page: the same
// form as /tournaments/create, except the format is fixed at creation —
// only the secondary settings (name, date, venue, courts, scoring and
// the category list) can change. Categories that already have members
// cannot be removed.

import { useEffect, useState } from 'react';
import {
  CATEGORY_LABELS,
  BRACKET_SYSTEMS,
  FIRST_TO_OPTIONS,
  getBracketSystem,
  defaultParticipantsFor,
} from '@/lib/formats';
import styles from '@/app/tournaments/create/create.module.css';

const COURT_RANGES = { beach13: [1, 2, 3, 4, 5, 6], dynamo_sc: [1, 2] };

function catKey(gender, label) {
  return `${gender || 'X'}:${label}`;
}

// ISO timestamp → value for <input type="datetime-local"> in local time.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventConfigForm({ event, categories: categoryRows, format, isPair, busy, post }) {
  const [name, setName] = useState(event.name || '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(event.scheduled_at));
  const [location, setLocation] = useState(event.location || 'beach13');
  const [courts, setCourts] = useState(event.courts?.length ? event.courts : [1]);

  const [pointsToWin, setPointsToWin] = useState(event.points_to_win ?? 21);
  const [useFinalPoints, setUseFinalPoints] = useState(event.points_mode === 'from_semifinal');
  const [finalPointsToWin, setFinalPointsToWin] = useState(event.final_points_to_win ?? 15);

  const [categories, setCategories] = useState(() => fromRows(categoryRows, isPair));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Re-sync from the server after a save (new categories get their real
  // ids, removed ones disappear) — load() refreshes the props.
  useEffect(() => {
    setCategories(fromRows(categoryRows, isPair));
  }, [categoryRows, isPair]);
  useEffect(() => {
    setName(event.name || '');
    setScheduledAt(toLocalInput(event.scheduled_at));
    setLocation(event.location || 'beach13');
    setCourts(event.courts?.length ? event.courts : [1]);
    setPointsToWin(event.points_to_win ?? 21);
    setUseFinalPoints(event.points_mode === 'from_semifinal');
    setFinalPointsToWin(event.final_points_to_win ?? 15);
  }, [event]);

  const courtRange = COURT_RANGES[location] || [1, 2];
  const gendersToShow = format.hasGender ? ['M', 'F'] : [null];

  function toggleCourt(n) {
    setCourts((prev) => {
      if (prev.includes(n)) return prev.length > 1 ? prev.filter((c) => c !== n) : prev;
      return prev.length < courtRange.length ? [...prev, n].sort((a, b) => a - b) : prev;
    });
  }

  function findCat(gender, label) {
    return categories.find((c) => catKey(c.gender, c.categoryLabel) === catKey(gender, label));
  }

  function toggleCategory(gender, label) {
    const key = catKey(gender, label);
    const existing = findCat(gender, label);
    if (existing?.hasMembers) return; // occupied leagues can't be removed
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

  async function handleSave() {
    setError('');
    setSaved(false);
    if (!scheduledAt) return setError('Вкажіть дату та час');
    if (categories.length === 0) return setError('Додайте щонайменше одну категорію');
    if (format.needsBracketSystem && categories.some((c) => !c.bracketSystem)) {
      return setError('Виберіть систему турніру для кожної категорії');
    }
    if (format.participantOptions && categories.some((c) => !c.maxParticipants)) {
      return setError('Вкажіть кількість учасників для кожної категорії');
    }

    const ok = await post(`/api/events/${event.id}/update`, {
      name,
      location,
      courts,
      scheduledAt: new Date(scheduledAt).toISOString(),
      pointsToWin: format.scoring === 'first_to' ? pointsToWin : null,
      pointsMode: useFinalPoints ? 'from_semifinal' : 'whole',
      finalPointsToWin: useFinalPoints ? finalPointsToWin : null,
      categories: categories.map(({ hasMembers, ...c }) => c),
    });
    if (ok) setSaved(true);
  }

  return (
    <div>
      <div className={styles.infoBox}>
        Формат: <b>{format.displayName}</b> — його не можна змінити після створення події.
      </div>

      <label className={styles.label}>Назва</label>
      <input
        className={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Залишити порожнім — згенерується сама"
      />

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
      <div className={styles.chipsRow}>
        {courtRange.map((n) => (
          <button
            key={n}
            className={`${styles.chip} ${courts.includes(n) ? styles.chipOn : ''}`}
            onClick={() => toggleCourt(n)}
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
              <button key={p} className={`${styles.chip} ${pointsToWin === p ? styles.chipOn : ''}`} onClick={() => setPointsToWin(p)}>
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

      {/* Category picker */}
      <label className={styles.label}>Категорії</label>
      {gendersToShow.map((gender) => (
        <div key={gender || 'mix'} className={styles.catGroup}>
          {format.hasGender && (
            <div className={styles.catGroupTitle}>{gender === 'M' ? 'Чоловіки' : 'Жінки'}</div>
          )}
          <div className={styles.chipsRow}>
            {CATEGORY_LABELS.map((label) => {
              const cat = findCat(gender, label);
              return (
                <button
                  key={label}
                  className={`${styles.chip} ${cat ? styles.chipOn : ''}`}
                  onClick={() => toggleCategory(gender, label)}
                  title={cat?.hasMembers ? 'У категорії вже є учасники' : ''}
                >
                  {label}
                  {cat?.hasMembers ? ' 🔒' : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Per-category config */}
      {categories.map((c) => {
        const key = catKey(c.gender, c.categoryLabel);
        if (!format.participantOptions && !format.needsBracketSystem) return null;
        return (
          <div key={key} className={styles.catCard}>
            <div className={styles.catCardHead}>
              <div className={styles.catCardTitle}>
                {c.gender ? (c.gender === 'M' ? 'Ч · ' : 'Ж · ') : ''}
                {c.categoryLabel}
              </div>
              {!c.hasMembers && (
                <button className={styles.catRemove} onClick={() => toggleCategory(c.gender, c.categoryLabel)}>
                  Прибрати
                </button>
              )}
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

      {error && <div className={styles.errMsg}>{error}</div>}
      {saved && <div className={styles.infoBox}>✓ Збережено</div>}

      <button className={styles.btnPrimary} disabled={busy} onClick={handleSave}>
        {busy ? 'Збереження...' : 'Зберегти зміни'}
      </button>
    </div>
  );
}

// DB category rows → editable form entries. hasMembers locks the entry
// against removal (players/pairs are already assigned to it).
function fromRows(rows, isPair) {
  return (rows || []).map((r) => ({
    id: r.id,
    gender: r.gender,
    categoryLabel: r.category_label,
    maxParticipants: r.max_participants,
    bracketSystem: r.bracket_system,
    hasMembers: isPair
      ? (r.tournament_teams || []).length > 0
      : (r.tournament_players || []).length > 0,
  }));
}

function OptionBtn({ active, onClick, children }) {
  return (
    <button className={`${styles.optionBtn} ${active ? styles.optionBtnOn : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
