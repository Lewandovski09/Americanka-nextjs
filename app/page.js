'use client';

import { useEffect, useState } from 'react';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { createClient } from '@/lib/supabase/client';
import { categoryForElo } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconMapPin, IconMegaphone, IconX, IconChevronDown, IconRocket, IconVolleyball } from '@/components/Icons';
import styles from './page.module.css';

export default function HomePage() {
  const { player, loading } = useCurrentPlayer();
  const [nextTournament, setNextTournament] = useState(null);
  const [nextTournamentPlayers, setNextTournamentPlayers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [eloExplainerOpen, setEloExplainerOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [communityCount, setCommunityCount] = useState(0);
  const [recentJoiners, setRecentJoiners] = useState([]);

  useEffect(() => {
    if (loading) return;
    const supabase = createClient();

    async function loadNextTournament() {
      const { data } = await supabase
        .from('tournaments')
        .select('id, name, scheduled_at, location, category, gender')
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      setNextTournament(data || null);

      if (data) {
        const { data: tps } = await supabase
          .from('tournament_players')
          .select('players(id, full_name, photo_url)')
          .eq('tournament_id', data.id);
        setNextTournamentPlayers((tps || []).map((tp) => tp.players));
      }
    }

    async function loadAnnouncements() {
      const { data: notifs } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      setAnnouncements(notifs || []);
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

    loadNextTournament();
    loadAnnouncements();
    loadCommunity();
  }, [loading, player]);

  async function dismissAnnouncement(notificationId) {
    if (!player?.is_admin) return;
    setAnnouncements((prev) => prev.filter((a) => a.id !== notificationId));
    const supabase = createClient();
    await supabase.from('admin_notifications').delete().eq('id', notificationId);
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

  const slotsTotal = 8; // current format size; will read from format data once multiple formats are live
  const slotsTaken = nextTournamentPlayers.length;

  return (
    <div className={styles.page}>
      <div className={`${styles.header} riseIn`}>
        <div className={styles.headerTop}>
          <div className={styles.headerBrand}>
            <span className={styles.headerBrandIcon}>
              <IconVolleyball size={15} color="#fff" />
            </span>
            <span className={styles.headerBrandName}>Americanka</span>
          </div>
        </div>
        <div className={styles.headerLocation}>
          <IconMapPin size={13} />
          <span>Пляж 13 · Станція Фонтана, Одеса</span>
        </div>
        {player ? (
          <div className={styles.headerPlayerRow}>
            <PlayerAvatar player={player} size={44} />
            <div className={styles.headerPlayerInfo}>
              <div className={styles.headerPlayerName}>{player.full_name}</div>
              <div className={styles.headerPlayerSub}>
                {player.approval_status === 'pending' ? 'Очікує підтвердження' : categoryForElo(player.elo)?.label}
              </div>
            </div>
            <div className={styles.headerElo}>
              <div className={styles.headerEloValue}>{player.elo ?? '—'}</div>
              <div className={styles.headerEloLabel}>ELO</div>
            </div>
          </div>
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

      {player?.approval_status === 'pending' && (
        <div className={styles.warnMsg}>Акаунт очікує підтвердження рейтингу адміном.</div>
      )}

      {announcements.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Оголошення</div>
          {announcements.map((a) => (
            <div key={a.id} className={`${styles.announcementCard} riseIn`} style={{ animationDelay: '0.05s' }}>
              {player?.is_admin && (
                <button className={styles.announcementClose} onClick={() => dismissAnnouncement(a.id)} aria-label="Закрити">
                  <IconX size={11} />
                </button>
              )}
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
      {nextTournament ? (
        <a href={`/tournaments/${nextTournament.id}`} className={`${styles.nextTournamentCard} riseIn`} style={{ animationDelay: '0.1s' }}>
          <div className={styles.nextTournamentTop}>
            <div className={styles.nextTournamentName}>{nextTournament.name}</div>
            <span className={styles.statusBadge}>Реєстрація відкрита</span>
          </div>
          <div className={styles.nextTournamentMeta}>
            {new Date(nextTournament.scheduled_at).toLocaleString('uk', { dateStyle: 'full', timeStyle: 'short' })}
          </div>
          <div className={styles.nextTournamentMeta}>
            {nextTournament.location === 'beach13' ? 'Beach 13' : 'Dynamo SC'} · Кат. {nextTournament.category} ·{' '}
            {nextTournament.gender === 'M' ? 'Чоловіки' : 'Жінки'}
          </div>

          <div className={styles.slotsRow}>
            <div className={styles.avatarStack}>
              {nextTournamentPlayers.slice(0, 6).map((p, i) => (
                <span key={p.id} className={styles.avatarStackItem} style={{ zIndex: 6 - i }}>
                  <PlayerAvatar player={p} size={28} />
                </span>
              ))}
            </div>
            <div className={styles.slotsCount}>
              {slotsTaken}/{slotsTotal} гравців
            </div>
          </div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${Math.min(100, (slotsTaken / slotsTotal) * 100)}%` }} />
          </div>
        </a>
      ) : (
        <div className={`${styles.emptyTournamentCard} riseIn`} style={{ animationDelay: '0.1s' }}>
          <div className={styles.emptyTournamentIcon}>
            <IconVolleyball size={32} color="var(--text2)" strokeWidth={1.6} />
          </div>
          <div className={styles.emptyTournamentTitle}>Турнірів ще немає</div>
          <div className={styles.emptyTournamentText}>
            Адміністратор готує перший турнір. Слідкуйте за оголошеннями — щойно з&apos;явиться розклад, ви побачите
            його тут першими.
          </div>
        </div>
      )}

      <div className={styles.sectionLabel}>Спільнота</div>
      <div className={`${styles.communityCard} riseIn`} style={{ animationDelay: '0.15s' }}>
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
      </div>

      <a href="/tournaments" className={`${styles.ctaBtn} riseIn`} style={{ animationDelay: '0.2s' }}>
        Дивитись усі турніри →
      </a>

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

      <button className={styles.eloExplainerToggle} onClick={() => setInstallOpen((o) => !o)} style={{ marginTop: 8 }}>
        <span>Як встановити застосунок на ваш телефон</span>
        <span className={`${styles.eloExplainerArrow} ${installOpen ? styles.eloExplainerArrowOpen : ''}`}>
          <IconChevronDown size={13} />
        </span>
      </button>

      {installOpen && (
        <div className={styles.eloExplainerBody}>
          <p>
            <b>На iPhone (Safari):</b> відкрийте сайт саме в Safari (Chrome на iPhone не вміє додавати на головний
            екран). Натисніть кнопку «Поділитися» (квадрат зі стрілкою вгору) знизу екрана → у списку знайдіть «На
            екран Домівки» → натисніть «Додати» у верхньому правому куті.
          </p>
          <p>
            <b>На Android (Chrome):</b> відкрийте сайт у Chrome. Натисніть на три крапки в правому верхньому куті →
            «Додати на головний екран» (або «Встановити застосунок») → підтвердіть.
          </p>
          <p>Після цього іконка AMERICANKA з&apos;явиться на головному екрані, і застосунок відкриватиметься без адресного рядка — як звичайний застосунок.</p>
        </div>
      )}
      </div>
    </div>
  );
}
