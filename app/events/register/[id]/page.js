'use client';

// Player-facing registration page for a scheduled event: info + apply /
// withdraw and a read-only view of the category rosters. Only exists
// before the event starts — once it is live this page just points to the
// per-category play pages (/tournaments/[id]).

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import PlayerAvatar from '@/components/PlayerAvatar';
import PlayerPicker from '@/components/PlayerPicker';
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

  // One application per person — mine is the one I filed OR the one a
  // partner filed naming me, so the second half of a pair sees their
  // status instead of a form that would be refused anyway.
  const myApp = applications.find(
    (a) =>
      (a.player_id === player?.id || a.partner_id === player?.id) &&
      a.status !== 'withdrawn' &&
      a.status !== 'rejected'
  );

  // Everyone the event already holds — they cannot be picked as a
  // partner (the server refuses it too), so keep them out of the search.
  const takenIds = [
    ...new Set([
      ...applications
        .filter((a) => a.status !== 'withdrawn' && a.status !== 'rejected')
        .flatMap((a) => [a.player_id, a.partner_id]),
      ...categories.flatMap((c) => [
        ...(c.tournament_players || []).map((tp) => tp.player_id),
        ...(c.tournament_teams || []).flatMap((t) => [t.player1_id, t.player2_id]),
      ]),
      player?.id,
    ]),
  ].filter(Boolean);

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
          me={player}
          takenIds={takenIds}
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

function MyRegistration({ isPair, me, takenIds = [], categories, myApp, regClosed, busy, onApply, onWithdraw }) {
  const [partner, setPartner] = useState(null);
  const [seeking, setSeeking] = useState(false);
  const [catId, setCatId] = useState(categories[0]?.id || '');

  if (myApp) {
    const inTeam = myApp.status === 'assigned';
    const inReserve = myApp.status === 'reserve';
    // The application may have been filed by the partner — then the other
    // half of the pair is the applicant, not the `partner` column.
    const filedByPartner = myApp.player_id !== me?.id;
    const otherName = filedByPartner ? myApp.applicant?.full_name : myApp.partner?.full_name;
    return (
      <div className={styles.myBox}>
        <div className={styles.myStatus}>
          {inTeam ? '✅ Ви зареєстровані' : inReserve ? '🟡 Ви у резерві' : '🕓 Заявку подано, очікує розподілу'}
          {otherName && ` · напарник: ${otherName}`}
          {filedByPartner && ' (заявку подав напарник)'}
          {myApp.seeking_partner && !filedByPartner && ' · шукаєте напарника'}
        </div>
        {isPair && otherName ? (
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
          {!seeking &&
            (partner ? (
              <div className={styles.regRow}>
                <span className={styles.regNames}>
                  <PlayerAvatar player={partner} size={24} />
                  {partner.full_name}
                </span>
                <button
                  className={styles.miniRemove}
                  title="Вибрати іншого"
                  onClick={() => setPartner(null)}
                >
                  ✕
                </button>
              </div>
            ) : (
              <PlayerPicker
                placeholder="Напарник: ім’я, прізвище або нік…"
                excludeIds={takenIds}
                onPick={setPartner}
              />
            ))}
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
