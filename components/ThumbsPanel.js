'use client';

// «Стиснути фото» — admin → Сервіс. One tap makes the small copies
// (lib/thumbs) of every photo uploaded before they existed; new uploads
// get them by themselves. Safe to press again.

import { useState } from 'react';

export default function ThumbsPanel({ styles }) {
  const [state, setState] = useState({ busy: false, done: 0, total: 0, failed: 0, finished: false, error: '' });

  async function run() {
    setState({ busy: true, done: 0, total: 0, failed: 0, finished: false, error: '' });
    let offset = 0;
    let failed = 0;
    for (let step = 0; step < 100; step++) {
      const res = await fetch('/api/admin/thumbs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => null) : null;
      if (!data?.success) {
        setState((s) => ({ ...s, busy: false, error: data?.error || 'Немає зʼєднання — натисніть ще раз, продовжить з початку' }));
        return;
      }
      failed += data.failed || 0;
      offset = data.next;
      setState((s) => ({ ...s, done: data.next, total: data.total, failed }));
      if (data.done) break;
    }
    setState((s) => ({ ...s, busy: false, finished: true }));
  }

  const { busy, done, total, failed, finished, error } = state;
  return (
    <>
      <div className={styles.sectionLabel}>Фото</div>
      <div className={styles.card} style={{ padding: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.4 }}>
          Робить маленькі копії всіх фото (аватарки ~5 КБ замість ~200 КБ), щоб застосунок швидко вантажився. Нові фото
          стискаються самі — це потрібно один раз для старих.
        </div>
        <button className={styles.notifSendBtn} disabled={busy} onClick={run}>
          {busy ? `Стискаю… ${done}${total ? ` / ${total}` : ''}` : finished ? '✓ Готово — стиснути ще раз' : 'Стиснути фото'}
        </button>
        {finished && (
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 8 }}>
            Оброблено {total}
            {failed ? ` · не вдалося ${failed} (файл фото відсутній — покажуться ініціали)` : ''}.
          </div>
        )}
        {error && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
      </div>
    </>
  );
}
