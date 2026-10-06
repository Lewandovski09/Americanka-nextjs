'use client';

// One season track in the admin panel — AVP or Ело (migration 045). The
// two tracks are independent: each shows its own current season, its
// own archive, and has its own «start the next one» button. Starting one
// never touches the other. A closed season is frozen — its AVP points or
// its final Ело table stay on the rating page for good.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PRIMARY_SPORT_ID } from '@/lib/sports';
import { CATEGORY_STARTING_ELO } from '@/lib/elo';
import { invalidate } from '@/lib/clientCache';
import { appConfirm } from '@/components/AppDialog';

const START_ELO_TEXT = Object.entries(CATEGORY_STARTING_ELO)
  .map(([cat, elo]) => `${cat} ${elo}`)
  .join(' · ');

function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmt(date) {
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString('uk', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

const TRACK = {
  avp: { title: 'Сезони AVP', what: 'Рейтинг AVP', archive: 'його очки AVP збережуться в архіві' },
  elo: { title: 'Сезони Ело', what: 'Таблиця Ело', archive: 'підсумкове Ело всіх гравців збережеться в архіві' },
};

export default function SeasonAdminPanel({ styles, kind }) {
  const track = TRACK[kind];
  const [seasons, setSeasons] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(todayLocal());
  const [eloMode, setEloMode] = useState('carry');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function load() {
    const { data } = await createClient()
      .from('avp_seasons')
      .select('id, name, starts_on, ends_on, closed_at')
      .eq('kind', kind)
      .eq('sport_id', PRIMARY_SPORT_ID)
      .is('city_id', null)
      .order('starts_on', { ascending: false });
    setSeasons(data || []);
  }

  useEffect(() => {
    load();
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = seasons.find((s) => s.ends_on === null) || null;
  const past = seasons.filter((s) => s !== current);

  async function start() {
    const resetText =
      kind !== 'elo'
        ? 'Сезон Ело не змінюється.'
        : eloMode === 'category'
        ? 'Ело КОЖНОГО гравця буде скинуто до стартового значення його категорії.'
        : 'Ело гравців переноситься без змін.';
    const ok = await appConfirm(
      `Почати «${name.trim()}» з ${fmt(startsOn)}?\n\n` +
        `${current ? `«${current.name}» буде закрито, ${track.archive}.\n` : ''}` +
        `${resetText}\n\nЦю дію не можна скасувати.`,
      { okText: 'Почати' }
    );
    if (!ok) return;

    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/admin/seasons/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, name, startsOn, eloMode }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!data.success) {
      setMessage({ error: true, text: data.error || 'Не вдалося почати сезон' });
      return;
    }
    // Every page shows the season name — drop the cached one so they pick up the new season.
    invalidate('seasons:');
    invalidate('rating:');
    setMessage({ error: false, text: `✓ Сезон «${name.trim()}» розпочато` });
    setName('');
    setOpen(false);
    load();
  }

  return (
    <>
      <div className={styles.sectionLabel}>{track.title}</div>
      <div className={styles.notifCard}>
        <div className={styles.fixDescription}>
          {current ? (
            <>
              Поточний сезон: <b>{current.name}</b> — з {fmt(current.starts_on)}, триває до початку наступного.{' '}
              {track.what} цього сезону рахується зараз.
            </>
          ) : kind === 'avp' ? (
            'Відкритого сезону AVP немає — очки AVP зараз нікуди не нараховуються. Почніть сезон.'
          ) : (
            'Відкритого сезону Ело немає. Почніть сезон.'
          )}
        </div>

        {past.length > 0 && (
          <div className={styles.quickList} style={{ marginBottom: 10 }}>
            {past.map((s) => (
              <div key={s.id} className={styles.quickListRow}>
                <span>{s.name}</span>
                <span className={styles.quickListElo}>
                  {fmt(s.starts_on)} — {fmt(s.ends_on)}
                </span>
              </div>
            ))}
          </div>
        )}

        {message && (
          <div className={styles.fixDescription} style={{ color: message.error ? 'var(--danger, #c0392b)' : undefined }}>
            {message.text}
          </div>
        )}

        {!open ? (
          <button className={styles.notifSendBtn} onClick={() => setOpen(true)}>
            Почати новий {kind === 'avp' ? 'сезон AVP' : 'сезон Ело'}
          </button>
        ) : (
          <>
            <input
              className={styles.notifInput}
              placeholder={kind === 'avp' ? 'Назва, напр. «AVP 2027»' : 'Назва, напр. «Ело 2027»'}
              aria-label="Назва нового сезону"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={styles.notifInput}
              type="date"
              aria-label="Дата початку нового сезону"
              value={startsOn}
              max={todayLocal()}
              onChange={(e) => setStartsOn(e.target.value)}
            />
            {kind === 'elo' && (
              <>
            <div className={styles.fixDescription}>Ело на початку нового сезону:</div>
            <label className={styles.fixDescription} style={{ display: 'block' }}>
              <input type="radio" name={`eloMode-${kind}`} checked={eloMode === 'carry'} onChange={() => setEloMode('carry')} />{' '}
              Перенести як є (рейтинг продовжується)
            </label>
            <label className={styles.fixDescription} style={{ display: 'block' }}>
              <input
                type="radio"
                name={`eloMode-${kind}`}
                checked={eloMode === 'category'}
                onChange={() => setEloMode('category')}
              />{' '}
              Скинути до стартового значення категорії ({START_ELO_TEXT})
            </label>
              </>
            )}
            <button className={styles.notifSendBtn} disabled={busy || !name.trim() || !startsOn} onClick={start}>
              {busy ? 'Зачекайте…' : 'Почати сезон'}
            </button>
            <button
              className={styles.notifSendBtn}
              style={{ marginTop: 6, opacity: 0.7 }}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Скасувати
            </button>
          </>
        )}
      </div>
    </>
  );
}
