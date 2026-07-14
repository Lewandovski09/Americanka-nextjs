'use client';

// Admin settings page for a RUNNING (or finished) event, [id] = event id.
// Runs the categories: enter scores, advance stages, start the leagues
// that have not kicked off yet. Registration and the application queue
// live on /events/settings/[id] and are gone once the event starts.

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import {
  LOCATION_LABEL,
  useEventData,
  useEventPost,
  CategoryTabs,
  CategoryPanel,
  DeleteEventButton,
} from '@/app/events/shared';
import styles from '@/app/events/event.module.css';

export default function TournamentSettingsPage({ params }) {
  const { id } = params;
  const { player, loading: playerLoading } = useCurrentPlayer();
  const { event, categories, loading, load } = useEventData(id);
  const { post, busy, error } = useEventPost(load);
  const [activeCatId, setActiveCatId] = useState(null);

  if (loading || playerLoading) return <div className={styles.loading}>Завантаження...</div>;
  if (!player?.is_admin) return <div className={styles.loading}>Тільки для адміністраторів</div>;
  if (!event) return <div className={styles.loading}>Подію не знайдено</div>;

  // A scheduled event is configured on the pre-start settings page.
  if (event.status === 'scheduled') {
    return (
      <div className={styles.page}>
        <h2 className={styles.title}>⚙ {event.name}</h2>
        <div className={styles.meta}>Турнір ще не розпочато.</div>
        <Link href={`/events/settings/${event.id}`} className={styles.openLink}>
          Налаштування та реєстрація →
        </Link>
      </div>
    );
  }

  const format = getFormat(event.format_kind);
  const activeCat = categories.find((c) => c.id === activeCatId) || categories[0];

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>⚙ {event.name}</h2>
      <div className={styles.meta}>
        {format?.displayName} ·{' '}
        {new Date(event.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
        {LOCATION_LABEL[event.location] || event.location}
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      {categories.length === 0 && <div className={styles.loading}>Категорій немає</div>}

      {categories.length > 0 && (
        <>
          <CategoryTabs categories={categories} activeId={activeCat.id} onSelect={setActiveCatId} />
          <CategoryPanel
            category={activeCat}
            format={format}
            isAdmin
            allCategories={categories}
            busy={busy}
            onStart={() => post(`/api/tournaments/${activeCat.id}/start`)}
            onScore={(matchId, sets) => post(`/api/matches/${matchId}/score`, { sets })}
            onMove={(ref, targetId, asReserve) =>
              post('/api/admin/members/move', {
                fromCategoryId: activeCat.id,
                targetCategoryId: targetId,
                asReserve: !!asReserve,
                ...ref,
              })
            }
            onRemove={(ref) => post('/api/admin/members/remove', { categoryId: activeCat.id, ...ref })}
          />
        </>
      )}

      <DeleteEventButton event={event} busy={busy} post={post} />
    </div>
  );
}
