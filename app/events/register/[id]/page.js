'use client';

// Player-facing registration page for a scheduled event: info + apply /
// withdraw and a read-only view of the category rosters. Only exists
// before the event starts — once it is live this page just points to the
// per-category play pages (/tournaments/[id]).

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import { LOCATION_LABEL, useEventData, useEventPost, CategoryTabs, CategoryPanel } from '../../shared';
import styles from '../../event.module.css';

export default function EventRegisterPage({ params }) {
  const { id } = params;
  const { player } = useCurrentPlayer();
  const { event, categories, applications, loading, load } = useEventData(id);
  const { post, busy, error } = useEventPost(load);
  const [activeCatId, setActiveCatId] = useState(null);

  if (loading) return <div className={styles.loading}>Завантаження...</div>;
  if (!event) return <div className={styles.loading}>Подію не знайдено</div>;

  const format = getFormat(event.format_kind);
  const started = event.status !== 'scheduled';

  // A started event has no registration page — send everyone to the
  // per-category play views instead.
  if (started) {
    return (
      <div className={styles.page}>
        <h2 className={styles.title}>{event.name}</h2>
        <div className={styles.meta}>Турнір вже розпочато — реєстрація недоступна.</div>
        <div style={{ marginTop: 12 }}>
          {categories.map((c) => (
            <Link key={c.id} href={`/tournaments/${c.id}`} className={styles.openLink}>
              {c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : ''}
              {c.category_label} →
            </Link>
          ))}
        </div>
        {player?.is_admin && (
          <Link href={`/tournaments/settings/${event.id}`} className={styles.openLink}>
            ⚙ Керування турніром →
          </Link>
        )}
      </div>
    );
  }

  const activeCat = categories.find((c) => c.id === activeCatId) || categories[0];
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';
  const regClosed = event.registration_open === false;

  const myApp = applications.find(
    (a) => a.player_id === player?.id && a.status !== 'withdrawn' && a.status !== 'rejected'
  );

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{event.name}</h2>
        {player?.is_admin && (
          <Link href={`/events/settings/${event.id}`} className={styles.manageLink} title="Налаштування">
            ⚙
          </Link>
        )}
      </div>
      <div className={styles.meta}>
        {format?.displayName} ·{' '}
        {new Date(event.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
        {LOCATION_LABEL[event.location] || event.location}
      </div>
      <div className={styles.meta}>
        {regClosed ? '🔒 Реєстрацію закрито' : '🟢 Реєстрація відкрита'}
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      {/* My status / apply / withdraw */}
      {player && player.approval_status === 'approved' && (
        <MyRegistration
          isPair={isPair}
          categories={categories}
          myApp={myApp}
          regClosed={regClosed}
          busy={busy}
          onApply={(payload) => post(`/api/events/${event.id}/apply`, payload)}
          onWithdraw={(withPartner) => post(`/api/events/${event.id}/withdraw`, { withPartner })}
        />
      )}

      {categories.length === 0 && <div className={styles.loading}>Категорій немає</div>}

      {categories.length > 0 && (
        <>
          <CategoryTabs categories={categories} activeId={activeCat.id} onSelect={setActiveCatId} />
          <CategoryPanel category={activeCat} format={format} isAdmin={false} />
        </>
      )}
    </div>
  );
}

function MyRegistration({ isPair, categories, myApp, regClosed, busy, onApply, onWithdraw }) {
  const [partnerLogin, setPartnerLogin] = useState('');
  const [partner, setPartner] = useState(null);
  const [seeking, setSeeking] = useState(false);
  const [catId, setCatId] = useState(categories[0]?.id || '');
  const [msg, setMsg] = useState('');

  async function findPartner() {
    setMsg('');
    const res = await fetch('/api/players/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: partnerLogin }),
    });
    const data = await res.json();
    if (!data.success) return setMsg(data.error);
    setPartner(data.player);
  }

  if (myApp) {
    const inTeam = myApp.status === 'assigned';
    const inReserve = myApp.status === 'reserve';
    return (
      <div className={styles.myBox}>
        <div className={styles.myStatus}>
          {inTeam ? '✅ Ви зареєстровані' : inReserve ? '🟡 Ви у резерві' : '🕓 Заявку подано, очікує розподілу'}
          {myApp.partner?.full_name && ` · напарник: ${myApp.partner.full_name.split(' ')[0]}`}
          {myApp.seeking_partner && ' · шукаєте напарника'}
        </div>
        {isPair && myApp.partner_id ? (
          <div className={styles.row}>
            <button className={styles.btnGhost} disabled={busy} onClick={() => onWithdraw(false)}>
              Знятися (я один)
            </button>
            <button className={styles.btnGhost} disabled={busy} onClick={() => onWithdraw(true)}>
              Знятися з напарником
            </button>
          </div>
        ) : (
          <button className={styles.btnGhost} disabled={busy} onClick={() => onWithdraw(true)}>
            Знятися
          </button>
        )}
      </div>
    );
  }

  if (regClosed) {
    return (
      <div className={styles.myBox}>
        <div className={styles.myStatus}>🔒 Реєстрацію закрито</div>
      </div>
    );
  }

  return (
    <div className={styles.myBox}>
      <div className={styles.myStatus}>Заявка на участь</div>
      <div className={styles.hint}>Оберіть лігу — адмін підтвердить розподіл.</div>

      {/* League choice (always required) */}
      <select className={styles.select} value={catId} onChange={(e) => setCatId(e.target.value)}>
        <option value="">Виберіть лігу…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.gender === 'M' ? 'Ч · ' : c.gender === 'F' ? 'Ж · ' : ''}
            {c.category_label}
          </option>
        ))}
      </select>

      {/* Partner (pair formats) */}
      {isPair && (
        <div className={styles.partnerBox}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={seeking} onChange={(e) => setSeeking(e.target.checked)} />
            <span>Шукаю напарника (запишусь один)</span>
          </label>
          {!seeking && (
            <div className={styles.row}>
              <input
                className={styles.select}
                placeholder="Логін напарника"
                value={partnerLogin}
                onChange={(e) => setPartnerLogin(e.target.value)}
              />
              <button className={styles.btnGhost} onClick={findPartner} type="button">
                Знайти
              </button>
            </div>
          )}
          {partner && !seeking && <div className={styles.myStatus}>Напарник: {partner.full_name}</div>}
          {msg && <div className={styles.errMsg}>{msg}</div>}
        </div>
      )}

      <button
        className={styles.btnPrimary}
        disabled={busy || !catId || (isPair && !seeking && !partner)}
        onClick={() =>
          onApply({
            categoryId: catId || null,
            partnerId: partner?.id || null,
            seekingPartner: seeking,
          })
        }
      >
        Подати заявку
      </button>
    </div>
  );
}
