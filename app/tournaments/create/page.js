'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  listFormats,
  getFormat,
  BRACKET_SYSTEMS,
  FIRST_TO_OPTIONS,
  getBracketSystem,
  defaultParticipantsFor,
} from '@/lib/formats';
import AvpTierPicker from '@/components/AvpTierPicker';
import AnnounceSwitch from '@/components/AnnounceSwitch';
import RegistrationFields from '@/components/RegistrationFields';
import { opensLabel } from '@/lib/registrationWindow';
import { runAnnouncement, announcementSummary } from '@/lib/announceClient';
import styles from './create.module.css';
import OptionBtn from '@/components/OptionBtn';
import { useVenues, selectableVenues, findVenue, venueLabel } from '@/hooks/useVenues';
import { listSports, getSport, divisionsFor, PRIMARY_SPORT_ID } from '@/lib/sports';

const GENDERS = [
  { id: 'M', label: 'Чоловіки' },
  { id: 'F', label: 'Жінки' },
];

function catKey(gender, label) {
  return `${gender || 'X'}:${label}`;
}

export default function CreateEventPage() {
  const router = useRouter();
  const sports = useMemo(() => listSports(), []);
  const [sportId, setSportId] = useState(PRIMARY_SPORT_ID);
  // Only the formats this sport offers (lib/sports), in its own order.
  const formats = useMemo(() => {
    const allowed = getSport(sportId)?.formats || [];
    return listFormats().filter((f) => allowed.includes(f.kind));
  }, [sportId]);
  const divisions = divisionsFor(sportId);

  const [formatKind, setFormatKind] = useState('americanka');
  const format = getFormat(formatKind);

  const [name, setName] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  // Venues are rows in the `venues` table (migration 043) — the list,
  // the labels and each venue's courts all come from there.
  const allVenues = useVenues();
  const venues = useMemo(() => selectableVenues(allVenues, sportId), [allVenues, sportId]);
  const [location, setLocation] = useState(null);
  const [courts, setCourts] = useState([]);

  const [pointsToWin, setPointsToWin] = useState(21);
  const [useFinalPoints, setUseFinalPoints] = useState(false);
  const [finalPointsToWin, setFinalPointsToWin] = useState(15);
  const [avpTier, setAvpTier] = useState(null);
  // Fee per player and when applications open (migration 066).
  const [entryFee, setEntryFee] = useState('');
  const [opensMode, setOpensMode] = useState('now'); // 'now' | 'later'
  const [opensAt, setOpensAt] = useState('');
  // «Оголосити в Telegram» — off unless the admin turns it on.
  const [announce, setAnnounce] = useState(false);
  const [announcing, setAnnouncing] = useState(null); // null | number sent so far
  const [created, setCreated] = useState(null); // the event, when it was created but the announcement failed

  // categories: array of { gender, categoryLabel, maxParticipants, bracketSystem }
  // Elo bands are derived automatically on the server (even split of the
  // rating spread across the selected leagues) — not entered here.
  const [categories, setCategories] = useState([]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const opensLater = opensMode === 'later' && !!opensAt && new Date(opensAt).getTime() > Date.now();
  const venue = findVenue(venues, location);
  const courtRange = venue?.courts || [];
  const gendersToShow = format.hasGender ? GENDERS.map((g) => g.id) : [null];

  // Default to the first venue once they load, and again whenever the
  // chosen one is not available for the selected sport.
  useEffect(() => {
    if (venues.length > 0 && !venues.some((v) => v.code === location)) setLocation(venues[0].code);
  }, [venues, location]);

  // A sport that does not offer the chosen format resets it.
  useEffect(() => {
    if (formats.length > 0 && !formats.some((f) => f.kind === formatKind)) setFormatKind(formats[0].kind);
  }, [formats, formatKind]);

  // Reset location-dependent courts and format-dependent categories.
  useEffect(() => {
    setCourts(venue ? [venue.courts[0]] : []);
  }, [location, venue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCategories([]);
  }, [sportId]);

  useEffect(() => {
    setCategories([]);
  }, [formatKind]);

  function toggleCourt(n) {
    setCourts((prev) => {
      if (prev.includes(n)) return prev.length > 1 ? prev.filter((c) => c !== n) : prev;
      // Cap at however many courts the venue actually has (venues.courts in the DB).
      // Americanka only ever uses 2 in parallel, but King
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
    if (!location) return setError('Виберіть місце проведення');
    if (courts.length === 0) return setError('Виберіть щонайменше один корт');
    if (categories.length === 0) return setError('Додайте щонайменше одну категорію');
    if (entryFee === '') return setError('Вкажіть внесок з гравця (0 — безкоштовно)');
    if (opensMode === 'later') {
      if (!opensAt) return setError('Вкажіть, коли відкриється прийом заявок');
      if (new Date(opensAt) >= new Date(scheduledAt)) return setError('Прийом заявок має початися раніше за турнір');
    }

    if (format.needsBracketSystem && categories.some((c) => !c.bracketSystem)) {
      return setError('Виберіть систему турніру для кожної категорії');
    }
    if (format.participantOptions && categories.some((c) => !c.maxParticipants)) {
      return setError('Вкажіть кількість учасників для кожної категорії');
    }

    const payload = {
      sportId,
      formatKind,
      name,
      location,
      courts,
      scheduledAt: new Date(scheduledAt).toISOString(),
      pointsToWin: format.scoring === 'first_to' ? pointsToWin : null,
      pointsMode: useFinalPoints ? 'from_semifinal' : 'whole',
      finalPointsToWin: useFinalPoints ? finalPointsToWin : null,
      avpTier,
      entryFee: Number(entryFee),
      registrationOpensAt: opensMode === 'later' && opensAt ? new Date(opensAt).toISOString() : null,
      categories,
    };

    setLoading(true);
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.success) {
      setLoading(false);
      return setError(data.error || 'Не вдалося створити турнір');
    }

    if (announce && data.event?.id) {
      setAnnouncing(0);
      const r = await runAnnouncement(data.event.id, setAnnouncing);
      setAnnouncing(null);
      setLoading(false);
      if (!r.ok || r.channel?.ok === false || r.channel?.photo === false || r.photoError) {
        // The tournament exists — only the announcement needs another try
        // (the event settings have the button for it).
        setCreated(data.event);
        return setError(
          `Турнір створено ✅, але оголошення: ${r.error || announcementSummary(r)}. Повторити можна в налаштуваннях турніру.`
        );
      }
    }
    setLoading(false);
    router.push('/tournaments');
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Нова подія</h2>

      {sports.length > 1 && (
        <>
          <label className={styles.label}>Вид спорту</label>
          <div className={styles.row}>
            {sports.map((sp) => (
              <OptionBtn key={sp.id} styles={styles} active={sportId === sp.id} onClick={() => setSportId(sp.id)}>
                {sp.displayName}
              </OptionBtn>
            ))}
          </div>
        </>
      )}

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
        {venues.map((v) => (
          <OptionBtn key={v.code} styles={styles} active={location === v.code} onClick={() => setLocation(v.code)}>
            {venueLabel(allVenues, v.code)}
          </OptionBtn>
        ))}
        {allVenues.length > 0 && venues.length === 0 && <div className={styles.infoBox}>Немає жодного майданчика для цього виду спорту</div>}
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
        <div className={styles.infoBox}>Americanka — рахунок завжди до суми 31.</div>
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
            {divisions.map((label) => (
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

      <RegistrationFields
        styles={styles}
        fee={entryFee}
        onFee={setEntryFee}
        opensMode={opensMode}
        onOpensMode={setOpensMode}
        opensAt={opensAt}
        onOpensAt={setOpensAt}
      />

      <div className={styles.infoBox}>
        {opensLater
          ? `Прийом заявок відкриється ${opensLabel(new Date(opensAt))}.`
          : 'Після створення категорії одразу відкриваються для заявок.'}{' '}
        Гравці реєструються в застосунку
        {format.registrationType === 'solo' ? ' (індивідуально)' : ' (парою або в пошуку напарника)'}, а сітки/групи
        формуються після закриття реєстрації.
      </div>

      <AnnounceSwitch
        checked={announce}
        onChange={setAnnounce}
        disabled={loading || !!created}
        sub={
          opensLater
            ? `Зараз — афіша турніру (з внеском і часом прийому заявок) у канал і всім гравцям у бот. ${opensLabel(
                new Date(opensAt)
              )} — повідомлення «Заявки приймаються» з кнопкою «Записатися».`
            : 'Афіша турніру (з усією інформацією та внеском) піде в канал і всім гравцям у бот, з кнопкою «Записатися».'
        }
      />

      {error && <div className={styles.errMsg}>{error}</div>}

      {created ? (
        <button className={styles.btnPrimary} onClick={() => router.push(`/events/settings/${created.id}`)}>
          До налаштувань турніру →
        </button>
      ) : (
        <button className={styles.btnPrimary} disabled={loading} onClick={handleCreate}>
          {announcing != null
            ? `Надсилаємо оголошення… ${announcing}`
            : loading
            ? 'Створення...'
            : announce
            ? 'Створити й оголосити →'
            : 'Створити подію →'}
        </button>
      )}
    </div>
  );
}
