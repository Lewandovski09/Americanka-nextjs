'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { createClient } from '@/lib/supabase/client';
import { categoryForElo, SKILL_CATEGORIES } from '@/lib/elo';
import { getFormat } from '@/lib/formats';
import { enrichCategoriesWithSlots } from '@/lib/eventCategories';
import CategoryRow from '@/components/CategoryRow';
import { loadPlayerHeaderStats } from '@/lib/playerHeaderStats';
import { winPluralUk } from '@/lib/pluralize';
import { VENUE } from '@/lib/venue';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconMapPin, IconMegaphone, IconX, IconChevronDown, IconRocket, IconTrendUp } from '@/components/Icons';
import styles from './page.module.css';

export default function HomePage() {
  const router = useRouter();
  const { player, loading } = useCurrentPlayer();
  const [nextEvent, setNextEvent] = useState(null);
  const [nextCategories, setNextCategories] = useState([]); // one row per category (Light/Medium/Pro), each with its own slots
  const [announcements, setAnnouncements] = useState([]);
  const [eloExplainerOpen, setEloExplainerOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [avpExplainerOpen, setAvpExplainerOpen] = useState(false);
  const [communityCount, setCommunityCount] = useState(0);
  const [recentJoiners, setRecentJoiners] = useState([]);
  const [eloRank, setEloRank] = useState(null);
  const [avpStanding, setAvpStanding] = useState(null); // { points, rank }
  const [winStreak, setWinStreak] = useState(0);

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
    if (loading) return;
    const supabase = createClient();

    async function loadNextTournament() {
      // A "next tournament" is really a whole EVENT, which can have
      // several categories at once (Light, Medium, Pro — up to
      // CATEGORY_LABELS.length, currently 3). The old version fetched
      // a single tournaments row and showed only that one category,
      // silently hiding any siblings under the same event — this finds
      // the nearest upcoming one, then pulls every category alongside
      // it under the same event_id.
      const { data: nearest } = await supabase
        .from('tournaments')
        .select('event_id, scheduled_at')
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!nearest?.event_id) {
        setNextEvent(null);
        setNextCategories([]);
        return;
      }

      const [{ data: event }, { data: cats }] = await Promise.all([
        supabase.from('tournament_events').select('id, format_kind, avp_tier').eq('id', nearest.event_id).maybeSingle(),
        supabase
          .from('tournaments')
          .select('id, status, name, scheduled_at, location, category, category_label, gender, max_participants, avp_tier, bracket_system')
          .eq('event_id', nearest.event_id)
          .in('status', ['scheduled', 'live'])
          .order('category_label', { ascending: true }),
      ]);

      const format = getFormat(event?.format_kind);
      const isPairFormat = format?.registrationType && format.registrationType !== 'solo';
      const enrichedCategories = await enrichCategoriesWithSlots(supabase, cats || [], format, event?.avp_tier);

      setNextEvent({
        id: event?.id,
        format,
        isPairFormat,
        avpTier: event?.avp_tier ?? null,
        location: cats?.[0]?.location,
        scheduled_at: nearest.scheduled_at,
        status: cats?.[0]?.status,
      });
      setNextCategories(enrichedCategories);
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
      // player_id to look up dismissals by, and nothing to dismiss yet.
      let dismissedIds = new Set();
      if (player?.id && notifs?.length) {
        const { data: dismissals } = await supabase
          .from('notification_dismissals')
          .select('notification_id')
          .eq('player_id', player.id)
          .in('notification_id', notifs.map((n) => n.id));
        dismissedIds = new Set((dismissals || []).map((d) => d.notification_id));
      }

      setAnnouncements((notifs || []).filter((n) => !dismissedIds.has(n.id)));
    }

    async function loadCommunity() {
      const { count } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'approved');
      setCommunityCount(count || 0);

      const { data: recent } = await supabase
        .from('players')
        .select('id, full_name, photo_url')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(8);
      setRecentJoiners(recent || []);
    }

    async function loadRankAndStreak() {
      if (!player?.id) return;
      const { eloRank: rank, avpStanding: avp, winStreak: streak } = await loadPlayerHeaderStats(supabase, player);
      setEloRank(rank);
      setAvpStanding(avp);
      setWinStreak(streak);
    }

    loadNextTournament();
    loadAnnouncements();
    loadCommunity();
    loadRankAndStreak();
  }, [loading, player]);

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
      player_id: player.id,
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

  // Elo progress toward the next category, for the header stat card.
  // Top category (A) has nowhere further to go, so nextCategory stays
  // null and the meta line falls back to just the rank.
  const playerCategory = player ? categoryForElo(player.elo) : null;
  const categoryIndex = playerCategory ? SKILL_CATEGORIES.findIndex((c) => c.id === playerCategory.id) : -1;
  const nextCategory = categoryIndex >= 0 && categoryIndex < SKILL_CATEGORIES.length - 1 ? SKILL_CATEGORIES[categoryIndex + 1] : null;
  const eloProgressPct = playerCategory
    ? Math.min(100, Math.max(0, Math.round(((player.elo - playerCategory.range[0]) / (playerCategory.range[1] - playerCategory.range[0])) * 100)))
    : 0;

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
        </div>
        <div className={styles.headerLocation}>
          <IconMapPin size={13} />
          <span>{VENUE.fullLocation}</span>
        </div>
        {player ? (
          <>
          <div className={styles.headerPlayerRow}>
            <PlayerAvatar player={player} size={44} />
            <div className={styles.headerPlayerInfo}>
              <div className={styles.headerPlayerName}>{player.full_name}</div>
              <div className={styles.headerPlayerSub}>
                {player.approval_status === 'pending' ? 'Очікує підтвердження' : categoryForElo(player.elo)?.label}
              </div>
            </div>
          </div>
          {player.approval_status !== 'pending' && player.elo != null && (
            <div className={styles.headerStatsRow}>
              <div className={styles.headerStatCard}>
                <div className={styles.headerStatLabel}>Ело</div>
                <div className={styles.headerStatValue}>{player.elo}</div>
                {playerCategory && (
                  <div className={styles.headerStatBar}>
                    <div className={styles.headerStatBarFill} style={{ width: `${eloProgressPct}%` }} />
                  </div>
                )}
                <div className={styles.headerStatMeta}>
                  {eloRank ? `№${eloRank}` : ''}
                  {nextCategory
                    ? ` · ${nextCategory.range[0] - player.elo} до Кат. ${nextCategory.id}`
                    : playerCategory
                    ? ' · Найвища категорія'
                    : ''}
                </div>
              </div>
              {avpStanding && (
                <div className={`${styles.headerStatCard} ${styles.headerStatCardAvp}`}>
                  <div className={styles.headerStatLabelAvp}>AVP сезон</div>
                  <div className={styles.headerStatValueAvp}>{avpStanding.points}</div>
                  <div className={styles.headerStatMetaAvp}>№{avpStanding.rank} сезону</div>
                </div>
              )}
            </div>
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

      {winStreak >= 2 && (
        <div className={`${styles.streakCard} riseIn`}>
          <IconTrendUp size={18} color="var(--rust)" />
          <div className={styles.streakText}>
            {winStreak} {winPluralUk(winStreak)} поспіль
          </div>
        </div>
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

      <div className={styles.sectionLabel}>Найближчий турнір</div>
      {nextEvent ? (
        <div className={`${styles.nextTournamentCard} riseIn`} style={{ animationDelay: '0.1s' }}>
          <div className={styles.nextTournamentTop}>
            <div className={styles.nextTournamentName}>{nextEvent.format?.displayName || 'Турнір'}</div>
            <span className={styles.statusBadge}>{nextEvent.status === 'live' ? 'Триває' : 'Реєстрація відкрита'}</span>
          </div>
          <div className={styles.nextTournamentMeta}>
            {new Date(nextEvent.scheduled_at).toLocaleString('uk', { dateStyle: 'full', timeStyle: 'short' })}
          </div>
          <div className={styles.nextTournamentMeta}>
            {nextEvent.location === 'beach13' ? 'Beach 13' : 'Dynamo SC'}
            {nextEvent.avpTier ? ` · AVP ${nextEvent.avpTier}` : ''}
          </div>

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
      ) : (
        <div className={`${styles.emptyTournamentCard} riseIn`} style={{ animationDelay: '0.1s' }}>
          <div className={styles.emptyTournamentIcon}>
            <img src="/icons/shortcut-tournaments-512.png" alt="" width={56} height={56} className={styles.emptyTournamentImg} />
          </div>
          <div className={styles.emptyTournamentTitle}>Турнірів ще немає</div>
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

      {nextEvent && (
        <a href="/tournaments" className={`${styles.ctaBtn} riseIn`} style={{ animationDelay: '0.2s' }}>
          Дивитись усі турніри →
        </a>
      )}


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

      <div className={styles.formatsCard}>
        <div className={styles.formatsIconRow}>
          <IconRocket size={17} color="var(--rust)" />
          <div className={styles.formatsTitle}>Старт сезону — AMERICANKA</div>
        </div>
        <div className={styles.formatsText}>
          Зараз стартує класичний формат <b>AMERICANKA 2x2</b>. Найближчим часом додадуться нові формати: <b>мікс</b>,{' '}
          <b>чоловічі та жіночі</b>, <b>король корту</b>, <b>випадковий мікс</b> та інші.
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
