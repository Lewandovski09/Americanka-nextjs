'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import styles from './tournaments.module.css';
import TabBtn from '@/components/TabBtn';

const TABS = { SCHEDULED: 'scheduled', LIVE: 'live', DONE: 'done' };
const LOCATION_LABEL = { beach13: 'Beach 13', dynamo_sc: 'Dynamo SC' };

export default function EventsPage() {
  const { player } = useCurrentPlayer();
  const [tab, setTab] = useState(TABS.SCHEDULED);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  // Same reasoning as app/rating/page.js: switching straight back to a
  // tab shown moments ago used to refetch it from scratch every time,
  // which is what made the switch itself feel slow. Cache per tab,
  // show it instantly, refresh quietly underneath.
  const eventsCacheRef = useRef({}); // tab -> events[]

  useEffect(() => {
    const cached = eventsCacheRef.current[tab];
    if (cached) {
      setEvents(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('tournament_events')
        .select(
          `id, name, format_kind, status, location, scheduled_at,
           tournaments(id, category_label, gender, status)`
        )
        .eq('status', tab)
        .order('scheduled_at', { ascending: tab === 'done' ? false : true });
      eventsCacheRef.current[tab] = data || [];
      setEvents(data || []);
      setLoading(false);
    }
    load();
  }, [tab]);

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        <TabBtn styles={styles} active={tab === TABS.SCHEDULED} onClick={() => setTab(TABS.SCHEDULED)}>
          Розклад
        </TabBtn>
        <TabBtn styles={styles} active={tab === TABS.LIVE} onClick={() => setTab(TABS.LIVE)}>
          Активні
        </TabBtn>
        <TabBtn styles={styles} active={tab === TABS.DONE} onClick={() => setTab(TABS.DONE)}>
          Завершені
        </TabBtn>
      </div>

      {player?.is_admin && tab === TABS.SCHEDULED && (
        <Link href="/tournaments/create" className={styles.createBtn}>
          + Створити подію
        </Link>
      )}

      {loading && <div className={styles.empty}>Завантаження...</div>}
      {!loading && events.length === 0 && <div className={styles.empty}>Немає подій</div>}

      {!loading &&
        events.map((ev) => {
          const format = getFormat(ev.format_kind);
          const cats = ev.tournaments || [];
          const meta = (
            <div className={styles.cardMeta}>
              {new Date(ev.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {LOCATION_LABEL[ev.location] || ev.location}
            </div>
          );
          const badge = (
            <span className={styles.badge} style={{ background: 'var(--bg-light)', color: 'var(--text2)' }}>
              {format?.displayName || ev.format_kind}
            </span>
          );

          // Scheduled: the card opens the registration page; admins get a
          // gear to the pre-start settings (queue / reserve / distribution).
          if (ev.status === TABS.SCHEDULED) {
            return (
              <div key={ev.id} className={`${styles.card} ${styles.cardWrap}`}>
                <Link href={`/events/register/${ev.id}`} className={styles.cardLink} aria-label={ev.name} />
                <div className={styles.cardHeader}>
                  <div className={styles.cardName}>{ev.name}</div>
                  <div className={styles.headerRight}>
                    {badge}
                    {player?.is_admin && (
                      <Link href={`/events/settings/${ev.id}`} className={styles.gearBtn} title="Налаштування">
                        ⚙
                      </Link>
                    )}
                  </div>
                </div>
                {meta}
                <div className={styles.chipsRow}>
                  {cats.map((c) => (
                    <span key={c.id} className={styles.catChip}>
                      {c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : ''}
                      {c.category_label}
                    </span>
                  ))}
                  {cats.length === 0 && <span className={styles.slotsCount}>Без категорій</span>}
                </div>
              </div>
            );
          }

          // Live / done: the card opens the first category's play view
          // (таблиця / ігри / чат), the chips pick a specific league.
          // Admins get a gear to the live tournament settings.
          return (
            <div key={ev.id} className={`${styles.card} ${styles.cardWrap}`}>
              {cats.length > 0 && (
                <Link href={`/tournaments/${cats[0].id}`} className={styles.cardLink} aria-label={ev.name} />
              )}
              <div className={styles.cardHeader}>
                <div className={styles.cardName}>{ev.name}</div>
                <div className={styles.headerRight}>
                  {badge}
                  {player?.is_admin && (
                    <Link href={`/tournaments/settings/${ev.id}`} className={styles.gearBtn} title="Керування">
                      ⚙
                    </Link>
                  )}
                </div>
              </div>
              {meta}
              <div className={styles.chipsRow}>
                {cats.map((c) => (
                  <Link key={c.id} href={`/tournaments/${c.id}`} className={styles.catChipLink}>
                    {c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : ''}
                    {c.category_label}
                  </Link>
                ))}
                {cats.length === 0 && <span className={styles.slotsCount}>Без категорій</span>}
              </div>
            </div>
          );
        })}
    </div>
  );
}
