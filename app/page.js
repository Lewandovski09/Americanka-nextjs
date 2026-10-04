'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { createClient } from '@/lib/supabase/client';
import { getFormat } from '@/lib/formats';
import { enrichCategoriesWithSlots } from '@/lib/eventCategories';
import CategoryRow from '@/components/CategoryRow';
import FormCard from '@/components/FormCard';
import HeroesOfMonth from '@/components/HeroesOfMonth';
import { useClubSeasons, seasonHeadline } from '@/lib/seasons';
import { getCached, setCached } from '@/lib/clientCache';
import { VENUE } from '@/lib/venue';
import VenueName from '@/components/VenueName';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconMapPin, IconMegaphone, IconX, IconChevronDown, IconRocket, IconMail, IconChat } from '@/components/Icons';
import styles from './page.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const isFresh = (finishedAt) => !!finishedAt && Date.now() - new Date(finishedAt).getTime() < DAY_MS;

export default function HomePage() {
  const router = useRouter();
  const { player, loading } = useCurrentPlayer();
  const homeStarted = useRef(false);
  const [nextEvent, setNextEvent] = useState(null);
  // A tournament that ended less than a day ago — shown INSTEAD of the
  // next one for that day, with its photo and winners.
  const [recentEvent, setRecentEvent] = useState(null);
  const [nextCategories, setNextCategories] = useState([]); // one row per category (Light/Medium/Pro), each with its own slots
  const [announcements, setAnnouncements] = useState([]);
  const [eloExplainerOpen, setEloExplainerOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [avpExplainerOpen, setAvpExplainerOpen] = useState(false);
  const [communityCount, setCommunityCount] = useState(0);
  const [recentJoiners, setRecentJoiners] = useState([]);
  // Everything below starts from the last-known values (clientCache), so
  // coming back to Головна shows the page at once and refreshes quietly.
  const seasons = useClubSeasons();

  // Swipe left to jump to the next tab (Турніри) — installed-PWA
  // users expect horizontal swipes to move between sections, not
  // just tapping the bottom nav. Головна is the first tab, so a
  // right-swipe has nowhere to go and is intentionally a no-op.
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }

    function onTouchEnd(e) {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const horizontalSwipe = Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5;
      if (horizontalSwipe && dx < 0) {
        router.push('/tournaments');
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [router]);

  useEffect(() => {
    const home = getCached('home:data');
    if (home) {
      setNextEvent(home.nextEvent);
      setNextCategories(home.nextCategories);
      setRecentEvent(home.recentEvent && isFresh(home.recentEvent.finished_at) ? home.recentEvent : null);
      setCommunityCount(home.communityCount);
      setRecentJoiners(home.recentJoiners);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const remember = (patch) => setCached('home:data', { ...(getCached('home:data') || {}), ...patch });

    // The last finished tournament, if it ended less than 24 hours ago:
    // its photo (migration 054), date, venue and the winners of each
    // category.
    async function loadRecentTournament() {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const { data: ev } = await supabase
        .from('tournament_events')
        .select('id, name, format_kind, location, avp_tier, scheduled_at, finished_at')
        .eq('status', 'done')
        .gte('finished_at', since)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!ev) {
        setRecentEvent(null);
        remember({ recentEvent: null });
        return;
      }
      const [{ data: ph }, { data: cats }] = await Promise.all([
        supabase.from('tournament_events').select('photo_url').eq('id', ev.id).maybeSingle(),
        supabase
          .from('tournament_categories')
          .select('id, category_label, gender')
          .eq('event_id', ev.id)
          .order('category_label', { ascending: true }),
      ]);
      const catIds = (cats || []).map((c) => c.id);
      const { data: wins } = catIds.length
        ? await supabase
            .from('tournament_placements')
            .select('category_id, user_id, users(full_name, last_name)')
            .eq('place', 1)
            .in('category_id', catIds)
        : { data: [] };
      const recent = {
        ...ev,
        format: getFormat(ev.format_kind),
        photo_url: ph?.photo_url || null,
        categories: (cats || []).map((c) => ({
          ...c,
          winners: (wins || [])
            .filter((w) => w.category_id === c.id)
            .map((w) => w.users?.last_name?.trim() || w.users?.full_name || '—'),
        })),
      };
      setRecentEvent(recent);
      remember({ recentEvent: recent });
    }

    async function loadNextTournament() {
      // A "next tournament" is really a whole EVENT, which can have
      // several categories at once (Light, Medium, Pro — up to
      // CATEGORY_LABELS.length, currently 3). The old version fetched
      // a single tournaments row and showed only that one category,
      // silently hiding any siblings under the same event — this finds
      // the nearest upcoming one, then pulls every category alongside
      // it under the same event_id.
      const { data: nearest } = await supabase
        .from('tournament_categories')
        .select('event_id, scheduled_at')
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!nearest?.event_id) {
        setNextEvent(null);
        setNextCategories([]);
        remember({ nextEvent: null, nextCategories: [] });
        return;
      }

      const [{ data: event }, { data: cats }] = await Promise.all([
        supabase.from('tournament_events').select('id, format_kind, avp_tier, location').eq('id', nearest.event_id).maybeSingle(),
        supabase
          .from('tournament_categories')
          .select('id, status, name, scheduled_at, category_label, gender, max_participants, avp_tier, bracket_system')
          .eq('event_id', nearest.event_id)
          .in('status', ['scheduled', 'live'])
          .order('category_label', { ascending: true }),
      ]);

      const format = getFormat(event?.format_kind);
      const isPairFormat = format?.registrationType && format.registrationType !== 'solo';
      const enrichedCategories = await enrichCategoriesWithSlots(supabase, cats || [], format, event?.avp_tier);

      const shown = {
        id: event?.id,
        format,
        isPairFormat,
        avpTier: event?.avp_tier ?? null,
        // The venue is the EVENT's (043) — the category copy could drift.
        location: event?.location,
        scheduled_at: nearest.scheduled_at,
        status: cats?.[0]?.status,
      };
      setNextEvent(shown);
      setNextCategories(enrichedCategories);
      remember({ nextEvent: shown, nextCategories: enrichedCategories });
    }

    async function loadAnnouncements() {
      const { data: notifs } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      // A player's own dismissals hide a notification just for them —
      // the admin's delete (below) is the only thing that removes it
      // for everyone. Skipped for a signed-out visitor: there's no
      // user_id to look up dismissals by, and nothing to dismiss yet.
      let dismissedIds = new Set();
      if (player?.id && notifs?.length) {
        const { data: dismissals } = await supabase
          .from('notification_dismissals')
          .select('notification_id')
          .eq('user_id', player.id)
          .in('notification_id', notifs.map((n) => n.id));
        dismissedIds = new Set((dismissals || []).map((d) => d.notification_id));
      }

      setAnnouncements((notifs || []).filter((n) => !dismissedIds.has(n.id)));
    }

    async function loadCommunity() {
      const [{ count }, { data: recent }] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('approval_status', 'approved'),
        supabase
          .from('users')
          .select('id, full_name, photo_url')
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      setCommunityCount(count || 0);
      setRecentJoiners(recent || []);
      remember({ communityCount: count || 0, recentJoiners: recent || [] });
    }

    // The club's data does not depend on who is signed in — it starts at
    // once; the announcements wait for the player (their dismissals).
    if (!homeStarted.current) {
      homeStarted.current = true;
      loadNextTournament();
      loadRecentTournament();
      loadCommunity();
    }
    if (!loading) loadAnnouncements();
  }, [loading, player?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function dismissAnnouncement(notificationId) {
    setAnnouncements((prev) => prev.filter((a) => a.id !== notificationId));
    const supabase = createClient();

    if (player?.is_admin) {
      // Admin's × removes it for the whole club, same as before.
      await supabase.from('admin_notifications').delete().eq('id', notificationId);
      return;
    }

    if (!player?.id) return;
    // Everyone else's × is personal: record that this player has seen
    // it, without touching the announcement itself. If this exact row
    // already exists (a repeat click, a race), the insert just fails
    // harmlessly — the dismissal it wanted is already there.
    await supabase.from('notification_dismissals').insert({
      notification_id: notificationId,
      user_id: player.id,
    });
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.skeletonHeader}>
          <div className={`skeleton on-dark ${styles.skeletonAvatar}`} />
          <div className={styles.skeletonLines}>
            <div className={`skeleton on-dark ${styles.skeletonLine}`} style={{ width: '55%' }} />
            <div className={`skeleton on-dark ${styles.skeletonLine}`} style={{ width: '35%', marginBottom: 0 }} />
          </div>
        </div>
        <div className={styles.body}>
          <div className={`skeleton ${styles.skeletonCard}`} />
          <div className={`skeleton ${styles.skeletonCard}`} />
        </div>
      </div>
    );
  }

  const seasonText = seasonHeadline(seasons);

  return (
    <div className={styles.page}>
      <div className={`${styles.header} riseIn`}>
        <div className={styles.headerTop}>
          <div className={styles.headerBrand}>
            <span className={styles.headerBrandIcon}>
              <img src="/icons/icon-192.png" alt="" width={28} height={28} className={styles.headerBrandIconImg} />
            </span>
            <span className={styles.headerBrandName}>{VENUE.brandName}</span>
          </div>
          {seasonText && (
            <a href="/rating" className={styles.headerSeason} title="Поточний сезон рейтингу">
              {seasonText}
            </a>
          )}
        </div>
        <div className={styles.headerLocation}>
          <IconMapPin size={13} />
          <span>{VENUE.fullLocation}</span>
        </div>
        {player ? (
          <>
          {/* «Твоя форма» — last five games, progress to the next category
              and the best partner (the name and the Ело/AVP numbers live in
              the profile). A player still awaiting approval has no games. */}
          {player.approval_status === 'pending' ? (
            <div className={styles.headerPlayerSub}>Акаунт очікує підтвердження</div>
          ) : (
            <FormCard player={player} />
          )}
          </>
        ) : (
          <div className={styles.guestRow}>
            <div className={styles.guestText}>
              Увійдіть, щоб бачити свій рейтинг і брати участь у турнірах
            </div>
            <div className={styles.guestBtns}>
              <a href="/register" className={styles.guestRegisterBtn}>
                Зареєструватися
              </a>
              <a href="/login" className={styles.guestLoginBtn}>
                Увійти
              </a>
            </div>
          </div>
        )}
        <div className={styles.headerWave} aria-hidden="true">
          <svg viewBox="0 0 600 22" preserveAspectRatio="none">
            <path d="M0,10 C100,22 200,0 300,10 C400,20 500,0 600,10 L600,22 L0,22 Z" fill="var(--bg-light)" />
          </svg>
        </div>
      </div>

      <div className={styles.body}>

      {player && !player.telegram_linked_at && <ConnectTelegramBanner />}

      {player?.approval_status === 'pending' && (
        <div className={styles.warnMsg}>Акаунт очікує підтвердження рейтингу адміном.</div>
      )}


      {announcements.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Оголошення</div>
          {announcements.map((a) => (
            <div key={a.id} className={`${styles.announcementCard} riseIn`} style={{ animationDelay: '0.05s' }}>
              <button className={styles.announcementClose} onClick={() => dismissAnnouncement(a.id)} aria-label="Закрити">
                <IconX size={11} />
              </button>
              <div className={styles.announcementHeader}>
                <IconMegaphone size={16} color="var(--rust)" />
                <div className={styles.announcementTitle}>{a.title}</div>
              </div>
              <div className={styles.announcementBody}>{a.body}</div>
              <div className={styles.announcementDate}>
                {new Date(a.created_at).toLocaleDateString('uk', { day: 'numeric', month: 'long' })}
              </div>
            </div>
          ))}
        </>
      )}

      {recentEvent && isFresh(recentEvent.finished_at) ? (
        <>
          <div className={styles.sectionLabel}>Щойно завершився</div>
          <div className={`${styles.nextTournamentCard} riseIn`} style={{ animationDelay: '0.1s' }}>
            {recentEvent.photo_url && (
              <a href={recentEvent.categories?.[0] ? `/tournaments/${recentEvent.categories[0].id}` : '/tournaments'}>
                <Image
                  src={recentEvent.photo_url}
                  alt={`Фото: ${recentEvent.name}`}
                  width={1200}
                  height={675}
                  sizes="(max-width: 600px) 100vw, 560px"
                  className={styles.recentPhoto}
                />
              </a>
            )}
            <div className={styles.nextTop}>
              <span className={styles.nextShine} aria-hidden="true" />
              <div className={styles.nextTournamentTop}>
                <div className={styles.nextTournamentName}>{recentEvent.name || recentEvent.format?.displayName || 'Турнір'}</div>
                <span className={styles.doneBadge}>Завершено</span>
              </div>
              <div className={styles.nextTournamentMeta}>
                {new Date(recentEvent.scheduled_at).toLocaleDateString('uk', { dateStyle: 'full' })}
              </div>
              <div className={styles.nextTournamentMeta}>
                <VenueName code={recentEvent.location} />
                {recentEvent.avp_tier ? ` · AVP ${recentEvent.avp_tier}` : ''}
              </div>
            </div>
            <div className={styles.nextBody}>
              {(recentEvent.categories || []).map((c) => (
                <a key={c.id} href={`/tournaments/${c.id}`} className={styles.winnerRow}>
                  <span className={styles.winnerCat}>
                    {c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : ''}
                    {c.category_label || 'Категорія'}
                  </span>
                  <span className={styles.winnerName}>
                    🏆 {c.winners.length ? c.winners.join(' / ') : 'результати'}
                  </span>
                  <span className={styles.winnerArrow}>→</span>
                </a>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
      <div className={styles.sectionLabel}>Найближчий турнір</div>
      {nextEvent ? (
        <div className={`${styles.nextTournamentCard} riseIn`} style={{ animationDelay: '0.1s' }}>
          {/* Banner head + category tiles — the same card as in «Турніри». */}
          <div className={styles.nextTop}>
            <span className={styles.nextShine} aria-hidden="true" />
            <div className={styles.nextTournamentTop}>
              <div className={styles.nextTournamentName}>{nextEvent.format?.displayName || 'Турнір'}</div>
              <span className={styles.statusBadge}>{nextEvent.status === 'live' ? 'Триває' : 'Реєстрація відкрита'}</span>
            </div>
            <div className={styles.nextTournamentMeta}>
              {new Date(nextEvent.scheduled_at).toLocaleString('uk', { dateStyle: 'full', timeStyle: 'short' })}
            </div>
            <div className={styles.nextTournamentMeta}>
              <VenueName code={nextEvent.location} />
              {nextEvent.avpTier ? ` · AVP ${nextEvent.avpTier}` : ''}
            </div>
          </div>

          <div className={styles.nextBody}>
          {nextCategories.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              showGender={nextEvent.isPairFormat}
              // Scheduled → the event registration page (this specific
              // category); live → its play view.
              href={c.status === 'scheduled' && nextEvent.id ? `/events/register/${nextEvent.id}?category=${c.id}` : `/tournaments/${c.id}`}
            />
          ))}
          </div>
        </div>
      ) : (
        <div className={`${styles.emptyTournamentCard} riseIn`} style={{ animationDelay: '0.1s' }}>
          <div className={styles.emptyTournamentIcon}>
            <img src="/icons/shortcut-tournaments-512.png" alt="" width={56} height={56} className={styles.emptyTournamentImg} />
          </div>
          <div className={styles.emptyTournamentTitle}>Чекайте новий турнір</div>
          <div className={styles.emptyTournamentText}>
            Адміністратор готує турнір. Слідкуйте за оголошеннями — щойно з&apos;явиться розклад, ви побачите
            його тут першими.
          </div>
          {/* Folded into the card itself here — a separate full-width
              button right under "there's nothing" read as a dead end
              (go look at... the same nothing). When a real tournament
              IS shown above, "see all" stays a standalone link instead,
              since browsing the full list is still a genuinely
              different, useful action from viewing the one next game. */}
          <a href="/tournaments" className={styles.ctaBtnInline}>
            Дивитись усі турніри →
          </a>
        </div>
      )}

        </>
      )}

      {(nextEvent || (recentEvent && isFresh(recentEvent.finished_at))) && (
        <a href="/tournaments" className={`${styles.ctaBtn} riseIn`} style={{ animationDelay: '0.2s' }}>
          Дивитись усі турніри →
        </a>
      )}

      {/* Podium of the month — most Ело gained in the last 30 days. */}
      <HeroesOfMonth />


      <div className={styles.sectionLabel}>Спільнота</div>
      <a href="/rating" className={`${styles.communityCard} riseIn`} style={{ animationDelay: '0.05s' }}>
        <div className={styles.communityCountRow}>
          <div className={styles.communityCountValue}>{communityCount}</div>
          <div className={styles.communityCountLabel}>гравців вже в AMERICANKA</div>
        </div>
        {recentJoiners.length > 0 && (
          <div className={styles.communityAvatarRow}>
            {recentJoiners.map((p, i) => (
              <span key={p.id} className={styles.communityAvatarItem} style={{ zIndex: recentJoiners.length - i }}>
                <PlayerAvatar player={p} size={32} />
              </span>
            ))}
          </div>
        )}
      </a>

      {/* The club's Telegram channel — news, photos, announcements. */}
      <a href="https://t.me/BV_here_we_go" target="_blank" rel="noopener noreferrer" className={styles.tgCard}>
        <span className={styles.tgIcon} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
            <path d="M21.5 3.6 2.9 10.8c-1.1.4-1.1 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.5ZM9.4 13.6l9-5.7c.4-.3.8-.1.5.2l-7.4 6.7-.3 3.1-1.8-4.3Z" />
          </svg>
        </span>
        <span className={styles.tgText}>
          <span className={styles.tgTitle}>Можете знайти нас у Telegram</span>
          <span className={styles.tgSub}>@BV_here_we_go</span>
        </span>
        <span className={styles.tgArrow} aria-hidden="true">›</span>
      </a>

      {/* What an Americanka day is — the format the season runs on. */}
      <div className={styles.formatsCard}>
        <div className={styles.formatsIconRow}>
          <IconRocket size={17} color="var(--rust)" />
          <div className={styles.formatsTitle}>Старт сезону 26/27 — формат Americanka 2×2</div>
        </div>
        <div className={styles.formatsText}>
          <p>
            Заявку на турнір подаєш <b>сам</b> — пара не потрібна: напарники змінюються після кожного раунду.
          </p>
          <ul className={styles.formatsFacts}>
            <li>
              <b>8 гравців</b> — з кожним ти граєш у парі <b>по одній партії</b>
            </li>
            <li>
              Партія йде <b>до 31 очка в сумі</b> — рахунок може бути 25:6, 19:12 і так далі
            </li>
            <li>
              Разом <b>7 ігор</b> і <b>7 різних напарників</b>
            </li>
            <li>
              Перемагає той, у кого <b>найкраща різниця</b> забитих і пропущених м’ячів
            </li>
            <li>
              <b>Рейтинг Ело змінюється після кожної гри</b> — не треба чекати кінця турніру
            </li>
            <li>
              На одному корті турнір триває <b>близько 3 годин</b>
            </li>
          </ul>
        </div>
      </div>

      <div className={styles.sectionLabel}>Довідка</div>
      <button className={styles.eloExplainerToggle} onClick={() => setInstallOpen((o) => !o)}>
        <span>Як встановити застосунок на ваш телефон?</span>
        <span className={`${styles.eloExplainerArrow} ${installOpen ? styles.eloExplainerArrowOpen : ''}`}>
          <IconChevronDown size={13} />
        </span>
      </button>

      {installOpen && (
        <div className={styles.eloExplainerBody}>
          <p>
            <b>На iPhone (Safari):</b> відкрийте сайт саме в Safari (Chrome на iPhone не вміє додавати на головний
            екран). Натисніть кнопку «Поділитися» (квадрат зі стрілкою вгору) знизу екрана → якщо «На екран Домівки»
            не видно одразу, натисніть «Показати більше» (або «Ще») у списку — пункт з&apos;явиться там → натисніть
            «Додати» у верхньому правому куті.
          </p>
          <p>
            <b>На Android (Chrome):</b> відкрийте сайт у Chrome. Натисніть на три крапки в правому верхньому куті →
            «Додати на головний екран» (або «Встановити застосунок») → підтвердіть.
          </p>
          <p>Після цього іконка AMERICANKA з&apos;явиться на головному екрані, і застосунок відкриватиметься без адресного рядка — як звичайний застосунок.</p>
        </div>
      )}

      <button className={styles.eloExplainerToggle} onClick={() => setEloExplainerOpen((o) => !o)}>
        <span>Що таке рейтинг Ело і як він рахується?</span>
        <span className={`${styles.eloExplainerArrow} ${eloExplainerOpen ? styles.eloExplainerArrowOpen : ''}`}>
          <IconChevronDown size={13} />
        </span>
      </button>

      {eloExplainerOpen && (
        <div className={styles.eloExplainerBody}>
          <p>
            <b>Рейтинг Ело</b> — це числова оцінка сили гравця (від 800 до 2000+), яка автоматично змінюється після
            кожного зіграного матчу залежно від результату та сили суперника.
          </p>
          <p>
            <b>Як рахується:</b> перед матчем система оцінює ймовірність вашої перемоги, виходячи з різниці рейтингів
            команд. Якщо ваш рейтинг нижчий за суперника, а ви перемагаєте — ви отримуєте <b>більше</b> очок, бо це
            несподіваний результат.
          </p>
          <p>
            Перемога над рівним суперником дає приблизно <b>+16</b> очок, поразка — приблизно <b>-16</b>. Перемога над
            набагато сильнішим суперником може дати <b>+25–30</b> очок.
          </p>
          <p>
            Категорії: <b>D</b> (800–1100, старт ~950), <b>C</b> (1100–1400, старт ~1250), <b>B</b> (1400–1700, старт
            ~1550), <b>A</b> (1700+, старт ~1850).
          </p>
        </div>
      )}

      <button className={styles.eloExplainerToggle} onClick={() => setFeaturesOpen((o) => !o)}>
        <span>Які можливості є в застосунку?</span>
        <span className={`${styles.eloExplainerArrow} ${featuresOpen ? styles.eloExplainerArrowOpen : ''}`}>
          <IconChevronDown size={13} />
        </span>
      </button>

      {featuresOpen && (
        <div className={styles.eloExplainerBody}>
          <p>
            <b>Реєстрація через Telegram</b> — без SMS і без оплати. Підтвердження логіну приходить ботом за кілька
            секунд.
          </p>
          <p>
            <b>Турніри AMERICANKA 2x2</b> з живою таблицею результатів — рахунок кожного матчу видно одразу, без
            оновлення сторінки.
          </p>
          <p>
            <b>Автоматичний рейтинг Ело</b>, який перераховується сам одразу після завершення турніру — без ручних
            підрахунків.
          </p>
          <p>
            <b>Профіль гравця</b> з історією турнірів, статистикою побед/поразок і калькулятором шансів проти будь-якого
            суперника.
          </p>
          <p>
            <b>Рейтинг</b> окремо для чоловіків і жінок, з фільтром за категоріями D–A, і пошук будь-якого гравця за
            логіном — щоб подивитись його профіль.
          </p>
          <p>
            <b>Сповіщення</b> про нові турніри та оголошення адміністратора — прямо в Telegram, без потреби заходити в
            застосунок.
          </p>
        </div>
      )}

      <button className={styles.eloExplainerToggle} onClick={() => setAvpExplainerOpen((o) => !o)}>
        <span>Що таке сезонний рейтинг AVP?</span>
        <span className={`${styles.eloExplainerArrow} ${avpExplainerOpen ? styles.eloExplainerArrowOpen : ''}`}>
          <IconChevronDown size={13} />
        </span>
      </button>

      {avpExplainerOpen && (
        <div className={styles.eloExplainerBody}>
          <p>
            Паралельно з Ело існує сезонний рейтинг <b>AVP</b> — за принципом, схожим на ATP в тенісі.
          </p>
          <p>
            Кожен турнір має категорію — <b>250</b>, <b>500</b>, <b>1000</b> або <b>2000</b> — залежно від рівня. Чим
            вища категорія, тим більше очок дає перемога в ньому.
          </p>
          <p>
            Очки за весь сезон підсумовуються, і найкращі гравці сезону визначаються саме за сумою очок, а не за Ело —
            це показує, наскільки успішним був конкретно цей сезон.
          </p>
        </div>
      )}

      {/* Support and the organisers — the very bottom of the home page
          (moved here from the profile). */}
      <div className={styles.sectionLabel}>Підтримка</div>
      <div className={styles.supportCard}>
        <a href="mailto:a921488799327z@gmail.com" className={styles.supportRow}>
          <span className={styles.supportIcon}>
            <IconMail size={16} />
          </span>
          <span>a921488799327z@gmail.com</span>
        </a>
        <a href="https://t.me/one_gogi" target="_blank" rel="noopener noreferrer" className={styles.supportRow}>
          <span className={styles.supportIcon}>
            <IconChat size={16} />
          </span>
          <span>@one_gogi (Telegram)</span>
        </a>
      </div>

      <div className={styles.creditsText}>
        Організатори: Гога і Роде Світа
        <br />
        Головний помічник з технічної частини: Теліга Максим
      </div>
      </div>
    </div>
  );
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'AmericankaVerifyBot';

// Shown to a logged-in player with no Telegram attached: they closed the
// tab mid-registration, or they blocked the bot and got unlinked. Without
// this the only way back would be asking an admin, since an approval is
// impossible without a linked chat.
function ConnectTelegramBanner() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    setError('');
    setLoading(true);
    const res = await fetch('/api/telegram/link/new', { method: 'POST' });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error || 'Не вдалося створити посилання');
      return;
    }

    // A fresh nonce every time, so a stale link can never be reused.
    window.open(
      `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(data.nonce)}`,
      '_blank',
      'noopener'
    );
  }

  return (
    <div className={styles.warnMsg}>
      Telegram не підключено — без нього не буде ні підтвердження рейтингу, ні новин.
      <button
        className={styles.guestRegisterBtn}
        style={{ display: 'block', marginTop: 8, border: 'none', cursor: 'pointer' }}
        onClick={connect}
        disabled={loading}
      >
        {loading ? 'Створюємо посилання…' : 'Підключити Telegram →'}
      </button>
      {error && <div style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
