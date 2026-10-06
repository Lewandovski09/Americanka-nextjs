'use client';

// Telegram is required: a signed-in player whose Telegram isn't connected
// (never pressed Start, or blocked the bot and got unlinked) sees only
// this screen until they connect it — the bot is how they get the
// rating approval, invitations, announcements. Admins are never locked
// out (so the app can't be closed for the people who run it).
//
// The bot link is made in advance (a fresh one-time code from
// /api/telegram/link/new, renewed before it expires), so the button is a
// plain link — iPhone blocks a window opened after a network wait. While
// the screen is up, it checks every few seconds whether the bot has
// linked the account, and lets the player in by itself.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './TelegramGate.module.css';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'AmericankaVerifyBot';
const RENEW_MS = 20 * 60 * 1000; // the code lives 30 min on the server

export function needsTelegram(player) {
  return !!player && !player.is_admin && !player.telegram_linked_at;
}

export default function TelegramGate({ player, onLinked }) {
  const [nonce, setNonce] = useState(null);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);

  // A fresh link now and every 20 minutes.
  useEffect(() => {
    let alive = true;
    async function make() {
      try {
        const res = await fetch('/api/telegram/link/new', { method: 'POST' });
        const data = await res.json();
        if (!alive) return;
        if (data.success) {
          setNonce(data.nonce);
          setError('');
        } else setError(data.error || 'Не вдалося створити посилання');
      } catch {
        if (alive) setError('Немає зʼєднання — спробуйте ще раз');
      }
    }
    make();
    const t = setInterval(make, RENEW_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Has the bot linked it yet? (also when the player comes back from Telegram)
  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    async function check() {
      const { data } = await supabase.from('users').select('telegram_linked_at').eq('id', player.id).maybeSingle();
      if (alive && data?.telegram_linked_at) onLinked?.();
    }
    const t = setInterval(check, 4000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [player.id, onLinked]);

  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = '/';
  }

  const href = nonce ? `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(nonce)}` : null;

  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-labelledby="tg-gate-title">
      <div className={styles.card}>
        <div className={styles.icon} aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="24" fill="#29a9eb" />
            <path d="M11 23.5 L35 14 L31 34 L24 28.5 L20.5 32 L20 26.5 L31 17.5 L18 25.5 Z" fill="#fff" />
          </svg>
        </div>
        <h2 id="tg-gate-title" className={styles.title}>
          Підтвердіть Telegram
        </h2>
        <p className={styles.text}>
          Без підключеного Telegram користуватися застосунком не можна: через бота приходять підтвердження рейтингу,
          запрошення в пару та оголошення турнірів.
        </p>
        <ol className={styles.steps}>
          <li>Натисніть кнопку нижче — відкриється наш бот.</li>
          <li>
            У боті натисніть <b>Start</b> (якщо бота заблоковано — спершу розблокуйте його).
          </li>
          <li>Поверніться сюди — застосунок відкриється сам.</li>
        </ol>
        {href ? (
          <a className={styles.btn} href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
            Підключити Telegram →
          </a>
        ) : (
          <button className={styles.btn} disabled>
            {error ? 'Помилка' : 'Готуємо посилання…'}
          </button>
        )}
        {error && <div className={styles.err}>{error}</div>}
        {opened && <div className={styles.wait}>Чекаємо підтвердження від бота…</div>}
        <button className={styles.out} onClick={signOut}>
          Вийти з акаунта
        </button>
      </div>
    </div>
  );
}
