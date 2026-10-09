'use client';

// The tournament photo (migration 054) — the group shot of the
// participants. Shown wide at the top of a tournament once it exists;
// tap to see it full-screen. Only the owner of the app gets the buttons
// to add, replace or remove it (the server checks the same).

import ThumbImage from '@/components/ThumbImage';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toJpegDataUrl } from '@/lib/photo';
import { invalidate } from '@/lib/clientCache';
import styles from './EventPhoto.module.css';
import { appConfirm } from '@/components/AppDialog';

export default function EventPhoto({ eventId, photoUrl, canEdit: canEditProp, ownerCanEdit, onChange }) {
  const [url, setUrl] = useState(photoUrl || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);

  // «ownerCanEdit»: the buttons are shown only to the owner of the app —
  // asked from the database (is_owner, migration 053); the server checks
  // the same on every upload.
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    if (!ownerCanEdit) return;
    let alive = true;
    createClient()
      .rpc('is_owner')
      .then(({ data }) => alive && setIsOwner(!!data));
    return () => {
      alive = false;
    };
  }, [ownerCanEdit]);
  const canEdit = canEditProp || (ownerCanEdit && isOwner);

  // Without a photoUrl prop it reads the event's photo itself (a failed
  // read — e.g. before migration 054 — simply shows nothing).
  useEffect(() => {
    if (photoUrl !== undefined || !eventId) return;
    let alive = true;
    createClient()
      .from('tournament_events')
      .select('photo_url')
      .eq('id', eventId)
      .maybeSingle()
      .then(({ data }) => alive && data?.photo_url && setUrl(data.photo_url));
    return () => {
      alive = false;
    };
  }, [eventId, photoUrl]);

  if (!url && !canEdit) return null;

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await toJpegDataUrl(file, 1600);
      const res = await fetch(`/api/events/${eventId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Не вдалося зберегти фото');
        return;
      }
      setUrl(data.photoUrl);
      ['scheduled', 'live', 'done'].forEach((t) => invalidate(`tournaments:${t}`));
      invalidate('home:');
      onChange?.(data.photoUrl);
    } catch {
      setError('Не вдалося прочитати файл. Спробуйте інше фото (JPG або PNG).');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await appConfirm('Прибрати фото турніру?', { okText: 'Прибрати', danger: true }))) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/photo`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!data.success) {
      setError(data.error || 'Не вдалося прибрати фото');
      return;
    }
    setUrl(null);
    ['scheduled', 'live', 'done'].forEach((t) => invalidate(`tournaments:${t}`));
    invalidate('home:');
    onChange?.(null);
  }

  return (
    <div className={styles.wrap}>
      {url ? (
        <button type="button" className={styles.photoBtn} onClick={() => setZoom(true)} aria-label="Відкрити фото турніру">
          <ThumbImage src={url} kind="md" alt="Фото турніру" width={1200} height={750} loading="eager" className={styles.photo} />
        </button>
      ) : null}

      {canEdit && (
        <div className={styles.actions}>
          <label className={`${styles.btn} ${busy ? styles.btnBusy : ''}`}>
            {busy ? 'Завантаження…' : url ? '📷 Замінити фото' : '📷 Додати фото турніру'}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={pick} />
          </label>
          {url && (
            <button type="button" className={styles.btnGhost} onClick={remove} disabled={busy}>
              Прибрати
            </button>
          )}
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}

      {zoom && url && (
        <div data-dismiss role="dialog" aria-modal="true" aria-label="Фото турніру" className={styles.lightbox} onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Фото турніру" className={styles.lightboxImg} />
        </div>
      )}
    </div>
  );
}
