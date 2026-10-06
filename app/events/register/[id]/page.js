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
import { useEventData, useEventPost, CategoryTabs, CategoryPanel } from '../../shared';
import styles from '../../event.module.css';
import VenueName from '@/components/VenueName';
import VotePoll from '@/components/VotePoll';
import { voteOptionsFrom } from '@/lib/voteOptions';
import PartnerBoard, { postPartnerAd } from '@/components/PartnerBoard';
import PairInvites from '@/components/PairInvites';
import { notifyInvite } from '@/lib/inviteNotify';
import { appAlert } from '@/components/AppDialog';

export default function EventRegisterPage({ params, searchParams }) {
  const { id } = params;
  // Which category the person actually clicked on the home page's
  // per-category cards — without this, both the info tabs and the
  // apply form silently default to categories[0] regardless of which
  // one was clicked.
  const preselectedCategoryId = searchParams?.category || null;
  const { player } = useCurrentPlayer();
  const { event, categories, applications, loading, load } = useEventData(id);
  const { post, busy, error } = useEventPost(load);
  const [activeCatId, setActiveCatId] = useState(null);
  // Bumped after an application, so the «Шукаю пару» board reloads.
  const [boardVersion, setBoardVersion] = useState(0);
  const [invitesVersion, setInvitesVersion] = useState(0);

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

  const activeCat = categories.find((c) => c.id === activeCatId) || categories.find((c) => c.id === preselectedCategoryId) || categories[0];
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';
  const regClosed = event.registration_open === false;

  // One application per person — mine is the one I filed OR the one a
  // partner filed naming me, so the second half of a pair sees their
  // status instead of a form that would be refused anyway.
  const myApp = applications.find(
    (a) =>
      (a.user_id === player?.id || a.partner_id === player?.id) &&
      a.status !== 'withdrawn' &&
      a.status !== 'rejected'
  );

  // Everyone the event already holds — they cannot be picked as a
  // partner (the server refuses it too), so keep them out of the search.
  const takenIds = [
    ...new Set([
      ...applications
        .filter((a) => a.status !== 'withdrawn' && a.status !== 'rejected')
        .flatMap((a) => [a.user_id, a.partner_id]),
      ...categories.flatMap((c) => [
        ...(c.tournament_players || []).map((tp) => tp.user_id),
        ...(c.tournament_teams || []).flatMap((t) => [t.user1_id, t.user2_id]),
      ]),
      player?.id,
    ]),
  ].filter(Boolean);

  // For the «Шукаю пару» board: who already has a partner (their notices
  // are hidden) and who has filed an application alone.
  const liveApps = applications.filter((a) => a.status !== 'withdrawn' && a.status !== 'rejected');
  const activeTeams = activeCat?.tournament_teams || [];
  const pairedIds = [
    ...liveApps.filter((a) => a.partner_id).flatMap((a) => [a.user_id, a.partner_id]),
    ...activeTeams.filter((t) => t.user1_id && t.user2_id).flatMap((t) => [t.user1_id, t.user2_id]),
  ];
  const appliedIds = [
    ...liveApps.filter((a) => !a.partner_id).map((a) => a.user_id),
    ...activeTeams.flatMap((t) => [t.user1_id, t.user2_id]).filter(Boolean),
  ];

  // Partner search: players who applied ALONE and look for a partner stay
  // pickable — choosing one sends them an invitation (the server checks the
  // same). Before, they were hidden as «already in the event», so after
  // declining someone's invitation you could not invite that person back.
  const fullTeamIds = new Set(
    categories.flatMap((c) =>
      (c.tournament_teams || []).filter((t) => t.user1_id && t.user2_id).flatMap((t) => [t.user1_id, t.user2_id])
    )
  );
  const openSeekerIds = new Set(
    liveApps
      .filter((a) => !a.partner_id && a.seeking_partner && a.user_id !== player?.id && !fullTeamIds.has(a.user_id))
      .map((a) => a.user_id)
  );
  const partnerExcludeIds = takenIds.filter((id) => !openSeekerIds.has(id));

  async function apply(payload) {
    // Not waiting for the page to reload its data — the answer is shown
    // the moment the server has saved the application / invitation.
    const ok = await post(`/api/events/${event.id}/apply`, payload, { background: true });
    if (ok) setBoardVersion((n) => n + 1);
    if (ok?.invited) {
      notifyInvite(event.id, ok.inviteId); // the Telegram note, in the background
      setInvitesVersion((n) => n + 1);
      appAlert('Напарник має його прийняти (у застосунку або через повідомлення в Telegram) — тоді ви будете в парі.', { title: 'Запрошення надіслано ✅' });
    }
    return ok;
  }

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
        <VenueName code={event.location} />
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
          takenIds={partnerExcludeIds}
          categories={categories}
          initialCategoryId={preselectedCategoryId}
          myApp={myApp}
          regClosed={regClosed}
          busy={busy}
          isMix={event.format_kind === 'mix'}
          onApply={async ({ partnerAd, partnerAdNote, ...payload }) => {
            const ok = await apply(payload);
            // Applied alone and asked for a notice — post it in the chosen league.
            if (ok && partnerAd && payload.seekingPartner && payload.categoryId) {
              await postPartnerAd(payload.categoryId, player.id, partnerAdNote);
              setBoardVersion((n) => n + 1);
            }
            return ok;
          }}
          onWithdraw={(withPartner) => post(`/api/events/${event.id}/withdraw`, { withPartner })}
        />
      )}

      {/* Pair invitations (migration 058): asked to play / asked by me. */}
      {isPair && player && (
        <PairInvites
          eventId={event.id}
          version={invitesVersion}
          onChanged={() => {
            load();
            setBoardVersion((n) => n + 1);
          }}
        />
      )}

      {categories.length === 0 && <div className={styles.loading}>Категорій немає</div>}

      {categories.length > 0 && (
        <>
          <CategoryTabs categories={categories} activeId={activeCat.id} onSelect={setActiveCatId} />
          <CategoryPanel category={activeCat} format={format} isAdmin={false} />
          {/* «Шукаю пару» — pair formats: players without a partner. */}
          {isPair && (
            <PartnerBoard
              key={`pb-${activeCat.id}`}
              categoryId={activeCat.id}
              isMix={event.format_kind === 'mix'}
              categoryGender={activeCat.gender || null}
              open={activeCat.status === 'scheduled'}
              pairedIds={pairedIds}
              appliedIds={appliedIds}
              canJoin={!myApp && !regClosed}
              onJoin={(ad) => apply({ categoryId: activeCat.id, partnerId: ad.user_id, seekingPartner: false })}
              version={boardVersion}
            />
          )}
          {/* «Хто виграє?» — over whoever is in this category right now. */}
          <VotePoll
            key={activeCat.id}
            categoryId={activeCat.id}
            title={`${activeCat.gender === 'M' ? '♂ ' : activeCat.gender === 'F' ? '♀ ' : ''}${activeCat.category_label || ''}`.trim()}
            options={voteOptionsFrom({ isPair, players: activeCat.tournament_players, teams: activeCat.tournament_teams })}
            open={activeCat.status === 'scheduled'}
          />
        </>
      )}
    </div>
  );
}

function MyRegistration({ isPair, isMix, me, takenIds = [], categories: allCategories, initialCategoryId, myApp, regClosed, busy, onApply, onWithdraw }) {
  // A men's league takes men, a women's league women (the server refuses
  // the rest too) — so only the leagues this player may enter are offered.
  const categories = allCategories.filter((c) => !c.gender || c.gender === me?.gender);
  const [partner, setPartner] = useState(null);
  const [seeking, setSeeking] = useState(false);
  // Applying alone in a pair format: optionally also post a «Шукаю пару»
  // notice in the chosen league, with a short note.
  const [postAd, setPostAd] = useState(true);
  const [adNote, setAdNote] = useState('');
  const [catId, setCatId] = useState(
    (initialCategoryId && categories.some((c) => c.id === initialCategoryId) ? initialCategoryId : categories[0]?.id) || ''
  );

  if (myApp) {
    const inTeam = myApp.status === 'assigned';
    const inReserve = myApp.status === 'reserve';
    // The application may have been filed by the partner — then the other
    // half of the pair is the applicant, not the `partner` column.
    const filedByPartner = myApp.user_id !== me?.id;
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

  // Whom this player pairs with: in a mix — the other gender.
  const lookingFor = isMix ? (me?.gender === 'M' ? 'напарниці' : 'напарника') : me?.gender === 'F' ? 'напарниці' : 'напарника';

  if (regClosed) {
    return (
      <div className={styles.myBox}>
        <div className={styles.myStatus}>🔒 Реєстрацію закрито</div>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className={styles.myBox}>
        <div className={styles.myStatus}>
          {me?.gender === 'M' ? 'У цьому турнірі немає чоловічих ліг' : 'У цьому турнірі немає жіночих ліг'}
        </div>
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
            <span>Записатися одному — без {lookingFor}</span>
          </label>
          {seeking && (
            <div className={styles.adOptBox}>
              <label className={styles.checkboxRow}>
                <input type="checkbox" checked={postAd} onChange={(e) => setPostAd(e.target.checked)} />
                <span>
                  Розмістити оголошення «Шукаю {lookingFor === 'напарниці' ? 'напарницю' : 'напарника'}» у розділі
                  «Шукаю пару» цієї ліги
                </span>
              </label>
              {postAd && (
                <textarea
                  className={styles.adNote}
                  rows={2}
                  maxLength={200}
                  placeholder="Кілька слів про себе (необов’язково)"
                  value={adNote}
                  onChange={(e) => setAdNote(e.target.value)}
                />
              )}
            </div>
          )}
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
                placeholder={isMix ? (me?.gender === 'M' ? 'Напарниця: ім’я, прізвище або нік…' : 'Напарник: ім’я, прізвище або нік…') : me?.gender === 'F' ? 'Напарниця: ім’я, прізвище або нік…' : 'Напарник: ім’я, прізвище або нік…'}
                excludeIds={takenIds}
                gender={me?.gender ? (isMix ? (me.gender === 'M' ? 'F' : 'M') : me.gender) : null}
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
            partnerId: seeking ? null : partner?.id || null,
            seekingPartner: seeking,
            partnerAd: seeking && postAd,
            partnerAdNote: adNote,
          })
        }
      >
        Подати заявку
      </button>
    </div>
  );
}
