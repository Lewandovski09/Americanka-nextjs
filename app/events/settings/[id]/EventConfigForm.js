'use client';

// «Налаштування» tab of the pre-start event settings page: the same
// form as /tournaments/create, except the format is fixed at creation —
// only the secondary settings (name, date, venue, courts, scoring and
// the category list) can change. Categories that already have members
// cannot be removed.

import { useEffect, useState } from 'react';
import {
  BRACKET_SYSTEMS,
  FIRST_TO_OPTIONS,
  getBracketSystem,
  defaultParticipantsFor,
} from '@/lib/formats';
import AvpTierPicker from '@/components/AvpTierPicker';
import styles from '@/app/tournaments/create/create.module.css';
import OptionBtn from '@/components/OptionBtn';
import { useVenues, selectableVenues, findVenue, venueLabel } from '@/hooks/useVenues';
import { divisionsFor } from '@/lib/sports';
import RegistrationFields from '@/components/RegistrationFields';
import { TestEventSwitch } from '@/components/AnnounceSwitch';
import { fromKyivInput, toKyivInput } from '@/lib/dates';
import { AMERICANKA_SUMS, AMERICANKA_GAMES_6, americankaGames, americankaSum, gamesOfPlan } from '@/lib/formats/americano';

function catKey(gender, label) {
  return `${gender || 'X'}:${label}`;
}

// ISO timestamp → value for <input type="datetime-local"> — Kyiv time (lib/dates).
function toLocalInput(iso) {
  return toKyivInput(iso);
}

export default function EventConfigForm({ event, categories: categoryRows, format, isPair, busy, post }) {
  const [name, setName] = useState(event.name || '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(event.scheduled_at));
  // Venues and their courts come from the `venues` table (migration 043).
  // The event's current venue stays selectable even if it has since been
  // deactivated; the sport is fixed at creation, like the format.
  const allVenues = useVenues();
  const venues = selectableVenues(allVenues, event.sport_id, event.location);
  const divisions = divisionsFor(event.sport_id);
  const [location, setLocation] = useState(event.location);
  const [courts, setCourts] = useState(event.courts?.length ? event.courts : [1]);

  const [pointsToWin, setPointsToWin] = useState(event.points_to_win ?? 21);
  // americanka: the sum a game goes to (lib/formats/americano)
  const [sumPoints, setSumPoints] = useState(americankaSum(event.points_to_win));
  const [useFinalPoints, setUseFinalPoints] = useState(event.points_mode === 'from_semifinal');
  const [finalPointsToWin, setFinalPointsToWin] = useState(event.final_points_to_win ?? 15);
  const [avpTier, setAvpTier] = useState(event.avp_tier ?? null);
  // Fee and the opening of applications (migration 066).
  const [entryFee, setEntryFee] = useState(event.entry_fee == null ? '' : String(event.entry_fee));
  const opensFuture = event.registration_opens_at && new Date(event.registration_opens_at).getTime() > Date.now();
  const [opensMode, setOpensMode] = useState(opensFuture ? 'later' : 'now');
  const [opensAt, setOpensAt] = useState(opensFuture ? toLocalInput(event.registration_opens_at) : '');
  const [closesAt, setClosesAt] = useState(toLocalInput(event.registration_closes_at));
  const [scheduleAt, setScheduleAt] = useState(toLocalInput(event.schedule_at));
  const [isTest, setIsTest] = useState(!!event.is_test);

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
    setLocation(event.location);
    setCourts(event.courts?.length ? event.courts : [1]);
    setPointsToWin(event.points_to_win ?? 21);
    setSumPoints(americankaSum(event.points_to_win));
    setUseFinalPoints(event.points_mode === 'from_semifinal');
    setFinalPointsToWin(event.final_points_to_win ?? 15);
    setAvpTier(event.avp_tier ?? null);
  }, [event]);

  const courtRange = findVenue(allVenues, location)?.courts || [];

  // Moving to another venue keeps only the courts it actually has.
  function chooseVenue(v) {
    setLocation(v.code);
    setCourts((prev) => {
      const kept = prev.filter((c) => v.courts.includes(c));
      return kept.length > 0 ? kept : [v.courts[0]];
    });
  }
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

    if (opensMode === 'later') {
      if (!opensAt) return setError('Вкажіть, коли відкриється прийом заявок');
      if (new Date(fromKyivInput(opensAt)) >= new Date(fromKyivInput(scheduledAt))) return setError('Прийом заявок має початися раніше за турнір');
    }

    const ok = await post(`/api/events/${event.id}/update`, {
      name,
      location,
      courts,
      scheduledAt: fromKyivInput(scheduledAt),
      pointsToWin: format.scoring === 'first_to' ? pointsToWin : format.scoring === 'sum31' ? sumPoints : null,
      pointsMode: useFinalPoints ? 'from_semifinal' : 'whole',
      finalPointsToWin: useFinalPoints ? finalPointsToWin : null,
      avpTier,
      entryFee: entryFee === '' ? null : Number(entryFee),
      registrationOpensAt: opensMode === 'later' && opensAt ? fromKyivInput(opensAt) : null,
      // sent only when there is something (works before SQL 068 as well)
      ...(closesAt || event.registration_closes_at ? { registrationClosesAt: closesAt ? fromKyivInput(closesAt) : null } : {}),
      ...(scheduleAt || event.schedule_at ? { scheduleAt: scheduleAt ? fromKyivInput(scheduleAt) : null } : {}),
      ...(isTest !== !!event.is_test ? { isTest } : {}),
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
        aria-label="Назва події"
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
        {venues.map((v) => (
          <OptionBtn key={v.code} styles={styles} active={location === v.code} onClick={() => chooseVenue(v)}>
            {venueLabel(allVenues, v.code)}
          </OptionBtn>
        ))}
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
        <>
          <label className={styles.label}>Партія до суми</label>
          <div className={styles.chipsRow}>
            {AMERICANKA_SUMS.map((p) => (
              <button key={p} className={`${styles.chip} ${sumPoints === p ? styles.chipOn : ''}`} onClick={() => setSumPoints(p)} aria-pressed={sumPoints === p}>
                {p}
              </button>
            ))}
          </div>
          <div className={styles.fieldNote}>Одна партія, очки двох пар разом дають {sumPoints} (напр. {Math.ceil(sumPoints / 2) + 4}:{Math.floor(sumPoints / 2) - 4}).</div>
        </>
      )}

      <label className={styles.label}>Рівень AVP</label>
      <AvpTierPicker value={avpTier} onChange={setAvpTier} styles={styles} />

      <RegistrationFields
        styles={styles}
        fee={entryFee}
        onFee={setEntryFee}
        opensMode={opensMode}
        onOpensMode={setOpensMode}
        opensAt={opensAt}
        onOpensAt={setOpensAt}
        closesAt={closesAt}
        onClosesAt={setClosesAt}
        scheduleAt={scheduleAt}
        onScheduleAt={setScheduleAt}
      />
      <TestEventSwitch checked={isTest} onChange={setIsTest} disabled={busy} />

      {/* Category picker */}
      <label className={styles.label}>Категорії</label>
      {gendersToShow.map((gender) => (
        <div key={gender || 'mix'} className={styles.catGroup}>
          {format.hasGender && (
            <div className={styles.catGroupTitle}>{gender === 'M' ? 'Чоловіки' : 'Жінки'}</div>
          )}
          <div className={styles.chipsRow}>
            {divisions.map((label) => {
              const cat = findCat(gender, label);
              return (
                <button
                  key={label}
                  className={`${styles.chip} ${cat ? styles.chipOn : ''}`}
                  onClick={() => toggleCategory(gender, label)}
                  title={cat?.hasMembers ? 'У категорії вже є учасники' : ''}
                  aria-pressed={!!cat}
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
                : format.kind === 'americanka'
                ? 'Гравців у категорії'
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
                  {format.kind === 'americanka' && c.maxParticipants === 6 && (
                    <>
                      <div className={styles.miniLabel}>Ігор у категорії</div>
                      <div className={styles.chipsRow}>
                        {AMERICANKA_GAMES_6.map((g) => (
                          <button
                            key={g}
                            className={`${styles.chip} ${americankaGames(6, c.gamesCount) === g ? styles.chipOn : ''}`}
                            onClick={() => updateCategory(key, { gamesCount: g })}
                            aria-pressed={americankaGames(6, c.gamesCount) === g}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                      <div className={styles.fieldNote}>
                        {americankaGames(6, c.gamesCount) === 6
                          ? '6 ігор: по 4 у кожного, ~1 год 30 хв. Жодна пара не повторюється.'
                          : '9 ігор: по 6 у кожного, ~2 год 15 хв. Кожен грає в парі з кожним; одна пара в кожного повторюється, але ніколи двічі поспіль.'}
                      </div>
                    </>
                  )}
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
    // americanka on 6 keeps its plan in bracket_system (lib/formats/americano)
    gamesCount: gamesOfPlan(r.bracket_system),
    hasMembers: isPair
      ? (r.tournament_teams || []).length > 0
      : (r.tournament_players || []).length > 0,
  }));
}
