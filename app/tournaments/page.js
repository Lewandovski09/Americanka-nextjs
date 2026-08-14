'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import { enrichCategoriesWithSlots } from '@/lib/eventCategories';
import CategoryRow from '@/components/CategoryRow';
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
          `id, name, format_kind, status, location, scheduled_at, avp_tier,
           tournaments(id, category, category_label, gender, status, max_participants, avp_tier, bracket_system)`
        )
        .eq('status', tab)
        .order('scheduled_at', { ascending: tab === 'done' ? false : true });

      // One enrichment pass per event (not per category) — different
      // events can be different formats, which decides whether slots
      // are counted from tournament_players or tournament_teams, so
      // this can't all be batched into one call the way one event's own
      // categories can (see enrichCategoriesWithSlots).
      const enrichedEvents = await Promise.all(
        (data || []).map(async (ev) => {
          const format = getFormat(ev.format_kind);
          const cats = await enrichCategoriesWithSlots(supabase, ev.tournaments || [], format, ev.avp_tier);
          return { ...ev, tournaments: cats, format };
        })
      );

      eventsCacheRef.current[tab] = enrichedEvents;
      setEvents(enrichedEvents);
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
          const cats = ev.tournaments || [];
          const meta = (
            <div className={styles.cardMeta}>
              {new Date(ev.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {LOCATION_LABEL[ev.location] || ev.location}
            </div>
          );
          const badge = (
            <span className={styles.badge} style={{ background: 'var(--bg-light)', color: 'var(--text2)' }}>
              {ev.format?.displayName || ev.format_kind}
            </span>
          );
          const isPairFormat = ev.format?.registrationType && ev.format.registrationType !== 'solo';

          // Scheduled: each category links to the registration page
          // pre-selecting itself (same ?category= param the home page's
          // card uses — the registration form used to always default to
          // the first category no matter which one was actually
          // clicked). Live/done: each category links straight to its own
          // play view. Either way, the card itself is no longer one big
          // link to just the first category — every category is its own
          // real link now that there can be more than one.
          return (
            <div key={ev.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardName}>{ev.name}</div>
                <div className={styles.headerRight}>
                  {badge}
                  {player?.is_admin && (
                    <Link
                      href={ev.status === TABS.SCHEDULED ? `/events/settings/${ev.id}` : `/tournaments/settings/${ev.id}`}
                      className={styles.gearBtn}
                      title="Налаштування"
                    >
                      ⚙
                    </Link>
                  )}
                </div>
              </div>
              {meta}

              {cats.length === 0 && <div className={styles.slotsCount}>Без категорій</div>}
              {cats.map((c) => (
                <CategoryRow
                  key={c.id}
                  category={c}
                  showGender={isPairFormat}
                  href={
                    ev.status === TABS.SCHEDULED ? `/events/register/${ev.id}?category=${c.id}` : `/tournaments/${c.id}`
                  }
                />
              ))}
            </div>
          );
        })}
    </div>
  );
}
