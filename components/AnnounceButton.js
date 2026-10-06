'use client';

// «Оголосити в Telegram» in the event settings: for a tournament created
// without the announcement, or to finish a sending that was interrupted.
// Once everyone is reached it only shows when it was sent.

import { useState } from 'react';
import { runAnnouncement, announcementSummary } from '@/lib/announceClient';
import styles from './Announce.module.css';
import { appConfirm } from '@/components/AppDialog';

export default function AnnounceButton({ event, onDone }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const done = !!event.announce_done_at;
  const started = !!event.announced_at;

  async function go(retryChannel = false) {
    if (!started && !(await appConfirm('Надіслати оголошення про турнір у Telegram-канал і всім гравцям у бот?', { okText: 'Надіслати' }))) return;
    setBusy(true);
    setResult(null);
    const r = await runAnnouncement(event.id, setProgress, { retryChannel });
    setBusy(false);
    setResult(r);
    onDone?.();
  }

  const when = event.announced_at
    ? new Date(event.announced_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className={styles.box}>
      {done ? (
        <div className={styles.note}>
          📣 Оголошено в Telegram {when} · гравцям у бот: {event.announce_sent || 0}
          {event.announce_channel_ok === false ? ' · у канал не вдалося' : ''}
        </div>
      ) : null}
      {done && event.announce_channel_ok === false ? (
        <button className={styles.btn} disabled={busy} onClick={() => go(true)}>
          {busy ? 'Надсилаємо…' : '📣 Повторити в канал'}
        </button>
      ) : null}
      {!done ? (
        <>
          <button className={styles.btn} disabled={busy} onClick={() => go(event.announce_channel_ok === false)}>
            {busy
              ? `Надсилаємо… ${progress ?? 0}`
              : started
              ? '📣 Продовжити розсилку в Telegram'
              : '📣 Оголосити в Telegram'}
          </button>
          {started && !busy && (
            <div className={styles.note}>Розсилку почато {when}, але не завершено · надіслано: {event.announce_sent || 0}</div>
          )}
        </>
      ) : null}
      {result && (result.ok ? (
        <div className={styles.note}>Готово: {announcementSummary(result)}</div>
      ) : (
        <div className={styles.err}>{result.error}</div>
      ))}
    </div>
  );
}
