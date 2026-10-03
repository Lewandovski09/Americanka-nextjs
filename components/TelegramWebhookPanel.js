'use client';

// «Telegram-бот» block of the admin panel: shows where Telegram currently
// delivers the bot's updates and points it at this site with one button.
// Registration and password reset depend on it — if the address is wrong
// (an old host, an old domain), new players cannot finish registering.

import { useEffect, useState } from 'react';

export default function TelegramWebhookPanel({ styles }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function call(method) {
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/telegram/webhook', { method });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!data.success) return setError(data.error || 'Не вдалося отримати дані від Telegram');
    setInfo(data);
  }

  useEffect(() => {
    call('GET');
  }, []);

  return (
    <>
      <div className={styles.sectionLabel}>Telegram-бот</div>
      <div className={styles.notifCard}>
        {!info && !error && <div className={styles.fixDescription}>Перевіряю…</div>}
        {error && (
          <div className={styles.fixDescription} style={{ color: 'var(--danger, #c0392b)' }}>
            {error}
          </div>
        )}
        {info && (
          <div className={styles.fixDescription}>
            {info.matches ? '✓ Бот підключений до цього сайту.' : '⚠ Бот надсилає повідомлення НЕ на цей сайт.'}
            <br />
            Зараз: <code>{info.url || '— не підключено —'}</code>
            {!info.matches && (
              <>
                <br />
                Має бути: <code>{info.expected}</code>
              </>
            )}
            {info.pendingUpdates > 0 && (
              <>
                <br />
                Неотриманих повідомлень у черзі: {info.pendingUpdates}
              </>
            )}
            {info.lastError && (
              <>
                <br />
                Остання помилка доставки: {info.lastError}
                {info.lastErrorAt ? ` (${new Date(info.lastErrorAt).toLocaleString('uk')})` : ''}
              </>
            )}
          </div>
        )}
        {info && !info.matches && (
          <button className={styles.notifSendBtn} disabled={busy} onClick={() => call('POST')}>
            {busy ? 'Зачекайте…' : 'Підключити бота до цього сайту'}
          </button>
        )}
      </div>
    </>
  );
}
