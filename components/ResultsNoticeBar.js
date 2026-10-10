'use client';

// «🏁 Результати в Telegram» — the admin's bar on a finished tournament
// (tournament settings). The results normally go by themselves when the
// last category ends (lib/server/resultsNotice); this sends them for a
// tournament finished before that, or again.

import { useState } from 'react';
import { appAlert, appConfirm } from '@/components/AppDialog';
import { CLUB_TZ } from '@/lib/dates';
import styles from './ResultsNoticeBar.module.css';

const G = { M: 'Ч · ', F: 'Ж · ' };

export default function ResultsNoticeBar({ event, categories = [], onSent }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  if (!event || event.status === 'scheduled') return null;

  // Not over yet: say which categories still need «Зберегти результати турніру» — the
  // results go out by themselves once the last one is finished.
  if (event.status !== 'done') {
    const open = categories.filter((c) => c.status === 'live');
    if (open.length === 0) return null;
    const allPlayed = (c) => (c.tournament_matches || []).length > 0 && (c.tournament_matches || []).every((m) => m.played);
    return (
      <div className={styles.bar} style={{ background: '#f8fafc', borderColor: '#cbd5e1' }}>
        <div className={styles.text} style={{ color: '#334155' }}>
          🏁 <b>Результати в Telegram</b> підуть самі, щойно завершите всі категорії. Ще не завершено:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {open.map((c) => (
              <li key={c.id}>
                <a href={`/tournaments/${c.id}`} style={{ color: 'inherit', fontWeight: 700 }}>
                  {G[c.gender] || ''}
                  {c.category_label}
                </a>
                {allPlayed(c) ? ' — усі ігри зіграні: відкрийте «Таблиця» → «Зберегти результати турніру»' : ' — ще йдуть ігри'}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  const sentAt = result?.at || event.results_announced_at;
  const when = sentAt
    ? new Date(sentAt).toLocaleString('uk', { timeZone: CLUB_TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : null;

  async function send() {
    const again = !!sentAt;
    if (
      !(await appConfirm(
        again
          ? 'Результати вже надсилали. Надіслати ще раз у канал і кожному учаснику в бот?'
          : 'Переможці кожної категорії підуть у Telegram-канал і кожному учаснику в бот, з кнопками на результати.',
        { title: again ? 'Надіслати ще раз?' : 'Надіслати результати?', okText: 'Надіслати' }
      ))
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${event.id}/results-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: again }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Не вдалося надіслати');
      if (data.skipped) {
        appAlert(data.note || 'Тестовий турнір — у Telegram нічого не надсилається');
        return;
      }
      setResult({ at: new Date().toISOString(), sent: data.sent ?? 0, channel: data.channel?.ok });
      onSent?.();
    } catch (e) {
      appAlert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.bar}>
      <div className={styles.text}>
        {when ? (
          <>
            ✅ <b>Результати надіслано</b> {when}
            {result ? ` · канал ${result.channel ? '✓' : '—'} · у бот: ${result.sent}` : ''}
          </>
        ) : (
          <>
            🏁 <b>Турнір завершено.</b> Надішліть переможців у Telegram-канал і всім учасникам.
          </>
        )}
      </div>
      <button className={when ? styles.ghost : styles.btn} disabled={busy} onClick={send}>
        {busy ? 'Надсилаємо…' : when ? 'Надіслати ще раз' : '🏁 Надіслати результати в Telegram'}
      </button>
    </div>
  );
}
