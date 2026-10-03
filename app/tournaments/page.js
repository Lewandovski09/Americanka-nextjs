'use client';

import { useEffect, useState } from 'react';
import { getCached, setCached } from '@/lib/clientCache';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import { enrichCategoriesWithSlots } from '@/lib/eventCategories';
import CategoryRow from '@/components/CategoryRow';
import styles from './tournaments.module.css';
import TabBtn from '@/components/TabBtn';
import VenueName from '@/components/VenueName';
import { useVenues, findVenue } from '@/hooks/useVenues';

const TABS = { SCHEDULED: 'scheduled', LIVE: 'live', DONE: 'done' };

export default function EventsPage() {
  const { player } = useCurrentPlayer();
  // The tab the player picked earlier in this visit; otherwise the last
  // one shown (the live check below may still switch to «Активні»).
  const initialTab = getCached('tournaments:tab') || TABS.SCHEDULED;
  const [tab, setTab] = useState(initialTab);
  const [events, setEvents] = useState(() => getCached(`tournaments:${initialTab}`) || []);
  const [loading, setLoading] = useState(() => !getCached(`tournaments:${initialTab}`));
  // Same reasoning as app/rating/page.js: switching straight back to a
  // tab shown moments ago used to refetch it from scratch every time,
  // which is what made the switch itself feel slow. Cache per tab,
  // show it instantly, refresh quietly underneath.
  // The cache lives in lib/clientCache, so it also survives leaving the
  // page — coming back from another section is instant too.

  // City filter: an event's city is its venue's (migration 043). The
  // chips only appear once there is more than one city to choose from.
  const venues = useVenues();
  const cities = [...new Map(venues.filter((v) => v.city).map((v) => [v.city.id, v.city])).values()];
  const [cityId, setCityId] = useState('all');
  const visibleEvents =
    cityId === 'all' ? events : events.filter((ev) => findVenue(venues, ev.location)?.city?.id === cityId);

  // While something is being played, the section opens on «Активні» —
  // unless the player has picked a tab themselves this visit.
  useEffect(() => {
    if (getCached('tournaments:tabChosen')) return;
    let alive = true;
    createClient()
      .from('tournament_events')
      .select('id', { count: 'exact', head: true })
      .eq('status', TABS.LIVE)
      .then(({ count }) => {
        if (!alive || getCached('tournaments:tabChosen')) return;
        if (count > 0) setTab(TABS.LIVE);
        else setTab((t) => (t === TABS.LIVE ? TABS.SCHEDULED : t)); // nothing live any more
      });
    return () => {
      alive = false;
    };
  }, []);

  function pickTab(t) {
    setCached('tournaments:tabChosen', true);
    setTab(t);
  }

  useEffect(() => {
    setCached('tournaments:tab', tab);
    const cached = getCached(`tournaments:${tab}`);
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
           tournament_categories(id, category_label, gender, status, max_participants, avp_tier, bracket_system)`
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
          const cats = await enrichCategoriesWithSlots(supabase, ev.tournament_categories || [], format, ev.avp_tier);
          return { ...ev, tournament_categories: cats, format };
        })
      );

      setCached(`tournaments:${tab}`, enrichedEvents);
      if (!alive) return; // the player already switched to another tab
      setEvents(enrichedEvents);
      setLoading(false);
    }
    let alive = true;
    load();
    return () => {
      alive = false;
    };
  }, [tab]);

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        <TabBtn styles={styles} active={tab === TABS.SCHEDULED} onClick={() => pickTab(TABS.SCHEDULED)}>
          Розклад
        </TabBtn>
        <TabBtn styles={styles} active={tab === TABS.LIVE} onClick={() => pickTab(TABS.LIVE)}>
          Активні
        </TabBtn>
        <TabBtn styles={styles} active={tab === TABS.DONE} onClick={() => pickTab(TABS.DONE)}>
          Завершені
        </TabBtn>
      </div>

      {player?.is_admin && tab === TABS.SCHEDULED && (
        <Link href="/tournaments/create" className={styles.createBtn}>
          + Створити подію
        </Link>
      )}

      {cities.length > 1 && (
        <div className={styles.cityFilter}>
          {[{ id: 'all', name: 'Усі міста' }, ...cities].map((c) => (
            <button
              key={c.id}
              className={`${styles.cityChip} ${cityId === c.id ? styles.cityChipOn : ''}`}
              aria-pressed={cityId === c.id}
              onClick={() => setCityId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading && <div className={styles.empty}>Завантаження...</div>}
      {!loading && visibleEvents.length === 0 && <div className={styles.empty}>Немає подій</div>}

      {!loading &&
        visibleEvents.map((ev) => {
          const cats = ev.tournament_categories || [];
          const meta = (
            <div className={styles.cardMeta}>
              {new Date(ev.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              <VenueName code={ev.location} />
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
