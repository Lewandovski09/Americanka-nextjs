'use client';

import { useState } from 'react';
import { appAlert, appConfirm } from '@/components/AppDialog';
import { invalidate } from '@/lib/clientCache';
import styles from './PublishScheduleBar.module.css';

// The admin's bar while the schedule is a draft: check courts and times
// (the ✎ on every game), then publish — players see it and get it in
// Telegram (lib/server/scheduleNotice).
export default function PublishScheduleBar({ eventId, onPublished, americanka = false }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function publish() {
    if (
      !(await appConfirm(
        'Усі категорії турніру стануть видимі учасникам, а розклад піде в Telegram-канал і кожному учаснику в бот.',
        { title: 'Розклад готовий?', okText: 'Так, опублікувати' }
      ))
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/schedule-notify`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Не вдалося опублікувати');
      setDone(true);
      invalidate('tournament');
      if (onPublished) onPublished();
      else setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      appAlert(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function retime() {
    if (
      !(await appConfirm('Одна категорія — один корт. Перша гра — на час початку, кожна наступна — через 15 хв. Корти й час, змінені вручну, буде замінено.', {
        title: 'Розставити корти й час?',
        okText: 'Розставити',
      }))
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/retime`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Не вдалося');
      invalidate('tournament');
      if (onPublished) onPublished();
      else window.location.reload();
    } catch (e) {
      appAlert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.draftBar}>
      <div className={styles.draftBarText}>
        <b>📝 Розклад — чернетка.</b> Його бачите лише ви і судді. Перевірте корти й час кожної гри (✎ у розкладі) в
        усіх категоріях, тоді опублікуйте.
      </div>
      {americanka && (
        <button className={styles.draftBarGhost} disabled={busy || done} onClick={retime}>
          ⏱ Розставити: 1 категорія — 1 корт, гра кожні 15 хв
        </button>
      )}
      <button className={styles.draftBarBtn} disabled={busy || done} onClick={publish}>
        {done ? '✓ Опубліковано' : busy ? 'Публікуємо…' : '✅ Розклад готовий — опублікувати'}
      </button>
    </div>
  );
}
