'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { getCached, setCached } from '@/lib/clientCache';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import { enrichCategoriesWithSlots } from '@/lib/eventCategories';
import { effectiveTier } from '@/lib/avp/tiers';
import CategoryRow from '@/components/CategoryRow';
import styles from './tournaments.module.css';
import TabBtn from '@/components/TabBtn';
import VenueName from '@/components/VenueName';
import { useVenues, findVenue } from '@/hooks/useVenues';

const TABS = { SCHEDULED: 'scheduled', LIVE: 'live', DONE: 'done' };
const DONE_PAGE = 15;

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
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE);
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

  // Is this the owner of the app? Only they see the archive of deleted
  // tournaments. Asked once per visit.
  const [isOwner, setIsOwner] = useState(() => getCached('me:isOwner') === true);
  useEffect(() => {
    if (!player?.is_admin) return;
    if (getCached('me:isOwner') !== undefined) return;
    createClient()
      .rpc('is_owner')
      .then(({ data }) => {
        setCached('me:isOwner', !!data);
        setIsOwner(!!data);
      });
  }, [player?.is_admin]);

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
        .order('scheduled_at', { ascending: tab === 'done' ? false : true })
        // Finished ones come in pages: the list (and its per-event slot
        // counting) used to download every tournament ever played.
        .limit(tab === 'done' ? doneLimit : 200);

      // One enrichment pass per FORMAT (not per event): every category of
      // the same format is counted in one batch — 1–2 requests per format
      // instead of per tournament. The AVP tier still falls back to each
      // category's own event.
      const byKind = new Map();
      (data || []).forEach((ev) => {
        const k = ev.format_kind || 'americanka';
        if (!byKind.has(k)) byKind.set(k, []);
        byKind.get(k).push(ev);
      });
      const enrichedById = new Map();
      await Promise.all(
        [...byKind.entries()].map(async ([kind, evs]) => {
          const format = getFormat(kind);
          const cats = evs.flatMap((ev) => (ev.tournament_categories || []).map((c) => ({ ...c, _eventId: ev.id })));
          const done = await enrichCategoriesWithSlots(supabase, cats, format, null);
          const tierByEvent = new Map(evs.map((ev) => [ev.id, ev.avp_tier]));
          done.forEach((c) => {
            c.avpTier = effectiveTier(c, { avp_tier: tierByEvent.get(c._eventId) });
            enrichedById.set(c.id, c);
          });
        })
      );
      const enrichedEvents = (data || []).map((ev) => ({
        ...ev,
        format: getFormat(ev.format_kind),
        tournament_categories: (ev.tournament_categories || []).map((c) => enrichedById.get(c.id) || c),
      }));

      // The tournament photos (migration 054) — read on their own, so a
      // missing column cannot break the list.
      const ids = enrichedEvents.map((ev) => ev.id);
      if (ids.length > 0) {
        const { data: ph } = await supabase.from('tournament_events').select('id, photo_url').in('id', ids);
        const photoBy = new Map((ph || []).map((r) => [r.id, r.photo_url]));
        enrichedEvents.forEach((ev) => {
          ev.photo_url = photoBy.get(ev.id) || null;
        });
      }

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
  }, [tab, doneLimit]);

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

      {/* The owner's folder of deleted tournaments — restore with one tap.
          Only under «Завершені», only for the owner (migration 053). */}
      {isOwner && tab === TABS.DONE && (
        <Link href="/tournaments/archive" className={styles.archiveLink}>
          🗂 Архів видалених турнірів →
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
            <span className={styles.badge}>
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
              {/* Banner head (event name, date, venue), category tiles below —
                  the same game-leaderboard look as «Рейтинг». */}
              {ev.photo_url && (
                <Link
                  href={cats[0] ? `/tournaments/${cats[0].id}` : '/tournaments'}
                  className={styles.cardPhotoLink}
                  aria-label="Фото турніру"
                >
                  <Image
                    src={ev.photo_url}
                    alt={`Фото: ${ev.name}`}
                    width={1200}
                    height={675}
                    sizes="(max-width: 600px) 100vw, 560px"
                    className={styles.cardPhoto}
                  />
                </Link>
              )}
              <div className={styles.cardTop}>
              <span className={styles.cardShine} aria-hidden="true" />
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
              </div>

              <div className={styles.cardBody}>
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
            </div>
          );
        })}

      {!loading && tab === TABS.DONE && events.length >= doneLimit && (
        <button type="button" className={styles.moreBtn} onClick={() => setDoneLimit((n) => n + DONE_PAGE)}>
          Показати ще
        </button>
      )}
    </div>
  );
}
