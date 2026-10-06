'use client';

// «Архів видалених» — the admin's folder of deleted tournaments
// (migration 052). Each one comes back with a single tap on «Відновити»:
// categories, matches, results, places, AVP and Ело as they were.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import { invalidate, setCached } from '@/lib/clientCache';
import styles from './archive.module.css';
import { appConfirm } from '@/components/AppDialog';

const STATUS = { scheduled: 'Не почався', live: 'Йшов', done: 'Завершений', cancelled: 'Скасований' };

function fmt(d, withTime = true) {
  if (!d) return '—';
  return new Date(d).toLocaleString('uk', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export default function DeletedArchivePage() {
  const { player, loading: playerLoading } = useCurrentPlayer();
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null); // { text, href?, error? }

  // Only the owner of the app (migration 053) — everyone else, admins
  // included, is told the page is not theirs.
  const [isOwner, setIsOwner] = useState(null);
  useEffect(() => {
    if (!player) return;
    createClient()
      .rpc('is_owner')
      .then(({ data }) => setIsOwner(!!data));
  }, [player]);
  const isAdmin = isOwner === true;

  useEffect(() => {
    if (!isAdmin) return;
    createClient()
      .from('deleted_events')
      .select('id, event_id, name, format_kind, scheduled_at, event_status, categories_count, matches_count, deleted_at, deleter:users!deleted_events_deleted_by_fkey(full_name)')
      .order('deleted_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error('[archive]', error.message);
          setNotice({ text: 'Не вдалося завантажити архів. Чи виконано SQL міграції 052?', error: true });
        }
        setRows(data || []);
      });
  }, [isAdmin]);

  async function call(row, action) {
    setBusyId(row.id);
    setNotice(null);
    let data = null;
    try {
      const res = await fetch(`/api/admin/events/archive/${row.id}/${action}`, { method: 'POST' });
      data = await res.json();
    } catch {
      data = { success: false, error: 'Не вдалося зв’язатися з сервером' };
    }
    setBusyId(null);
    if (!data.success) {
      setNotice({ text: data.error || 'Сталася помилка', error: true });
      return;
    }
    setRows((list) => (list || []).filter((r) => r.id !== row.id));
    if (action === 'restore') {
      // The tournaments lists cached in this tab are stale now.
      ['scheduled', 'live', 'done'].forEach((t) => invalidate(`tournaments:${t}`));
      invalidate('home:');
      setNotice({
        text: data.warning || `«${row.name}» відновлено`,
        href: row.event_status === 'scheduled' ? `/events/register/${row.event_id}` : null,
        error: !!data.warning,
      });
    } else {
      setNotice({ text: `«${row.name}» видалено назавжди` });
    }
  }

  if (playerLoading || (player && isOwner === null)) return <div className={styles.empty}>Завантаження...</div>;
  if (!isAdmin) return <div className={styles.empty}>Архів доступний лише власнику застосунку</div>;

  return (
    <div className={styles.page}>
      <Link href="/tournaments" className={styles.back} onClick={() => { setCached('tournaments:tab', 'done'); setCached('tournaments:tabChosen', true); }}>
        ← Турніри
      </Link>
      <h2 className={styles.title}>🗂 Архів видалених</h2>
      <div className={styles.lead}>
        Видалені турніри зберігаються тут. «Відновити» повертає турнір повністю — з категоріями, матчами, результатами,
        AVP та Ело.
      </div>

      {notice && (
        <div className={notice.error ? styles.noticeErr : styles.notice}>
          {notice.text}
          {notice.href && (
            <>
              {' · '}
              <Link href={notice.href}>Відкрити</Link>
            </>
          )}
        </div>
      )}

      {rows === null && <div className={styles.empty}>Завантаження...</div>}
      {rows !== null && rows.length === 0 && <div className={styles.empty}>Архів порожній</div>}

      <div className={styles.list}>
        {(rows || []).map((r) => (
          <div key={r.id} className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.name}>{r.name || 'Без назви'}</div>
              <span className={styles.badge}>{getFormat(r.format_kind)?.displayName || r.format_kind}</span>
            </div>
            <div className={styles.meta}>
              {fmt(r.scheduled_at)} · {STATUS[r.event_status] || r.event_status} · категорій: {r.categories_count} · матчів:{' '}
              {r.matches_count}
            </div>
            <div className={styles.meta}>
              Видалено {fmt(r.deleted_at)}
              {r.deleter?.full_name ? ` · ${r.deleter.full_name}` : ''}
            </div>
            <div className={styles.actions}>
              <button className={styles.restoreBtn} disabled={busyId !== null} onClick={() => call(r, 'restore')}>
                {busyId === r.id ? 'Відновлення…' : '↩ Відновити'}
              </button>
              <button
                className={styles.purgeBtn}
                disabled={busyId !== null}
                onClick={async () =>
                  (await appConfirm(`Видалити «${r.name}» з архіву назавжди? Повернути його вже не вийде.`, { okText: 'Видалити', danger: true })) && call(r, 'purge')
                }
              >
                Видалити назавжди
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
