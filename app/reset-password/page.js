'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { VENUE } from '@/lib/venue';
import Field from '@/components/Field';
import styles from '../register/register.module.css';

const STEPS = {
  START: 'start',
  CONNECT_TELEGRAM: 'connect_telegram',
  SET_PASSWORD: 'set_password',
  DONE: 'done',
};

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'AmericankaVerifyBot';

// Same reasoning as app/register/page.js: nothing here is worth
// prerendering, and prerendering it makes `next build` fail without
// env vars present at build time.
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState(STEPS.START);
  const [nonce, setNonce] = useState(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const [noAccount, setNoAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [resultLogin, setResultLogin] = useState('');
  const confirmedRef = useRef(false);
  const autoStartedRef = useRef(false);

  async function handleStart() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password/start', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Не вдалося почати відновлення');
        setLoading(false);
        return;
      }
      setNonce(data.nonce);
      setLinkExpired(false);
      setNoAccount(false);
      confirmedRef.current = false;
      setStep(STEPS.CONNECT_TELEGRAM);
    } catch {
      setError('Помилка мережі. Спробуйте ще раз.');
    } finally {
      setLoading(false);
    }
  }

  // No reason to make someone click a button just to start what they
  // already asked for by landing on this page — begin immediately.
  // The guard ref (not just an empty dependency array) is what keeps
  // this to exactly one attempt even under React Strict Mode's
  // double-invoke in development.
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    handleStart();
  }, []);

  // Wait for the bot to confirm — same SSE approach as the registration
  // flow (see app/register/page.js), just watching a different nonce
  // table on the server (password_resets instead of pending_registrations).
  // Reconnects on visibilitychange for the same reason as there: the
  // connection can sit throttled the whole time the person is in the
  // Telegram app, so a fresh check right when they switch back is what
  // actually removes the "did this even work?" delay, not a shorter
  // poll interval on its own.
  useEffect(() => {
    if (step !== STEPS.CONNECT_TELEGRAM || !nonce) return;

    let source = null;

    function connect() {
      source?.close();
      source = new EventSource(`/api/auth/reset-password/watch?nonce=${encodeURIComponent(nonce)}`);

      source.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (!data.success) return;

        if (data.confirmed) {
          if (confirmedRef.current) return;
          confirmedRef.current = true;
          source.close();
          setStep(STEPS.SET_PASSWORD);
        } else if (data.noAccount) {
          source.close();
          setNoAccount(true);
        } else if (data.expired) {
          source.close();
          setLinkExpired(true);
        }
      };
    }

    connect();

    function handleVisibility() {
      if (document.visibilityState === 'visible') connect();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      source?.close();
    };
  }, [step, nonce]);

  async function handleSetPassword() {
    setError('');
    if (password.length < 6) {
      setError('Пароль має бути щонайменше 6 символів');
      return;
    }
    if (password !== password2) {
      setError('Паролі не збігаються');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, newPassword: password }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Не вдалося встановити пароль');
        setLoading(false);
        return;
      }
      setResultLogin(data.login);
      setStep(STEPS.DONE);
    } catch {
      setError('Помилка мережі. Спробуйте ще раз.');
    } finally {
      setLoading(false);
    }
  }

  const deepLink = nonce ? `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(nonce)}` : '';

  return (
    <div className={styles.page}>
      <div className={styles.brandHeader}>
        <div className={styles.brandTitle}>
          <span className={styles.brandStar}>★</span> {VENUE.brandName.toUpperCase()} <span className={styles.brandStar}>★</span>
        </div>
        <div className={styles.brandSub}>ВІДНОВЛЕННЯ ДОСТУПУ</div>
      </div>

      <div className={styles.card}>
        {step === STEPS.START && (
          <div>
            <div className={styles.verifyHeader}>
              <div className={styles.verifyIcon}>🔑</div>
              <div className={styles.verifyTitle}>ЗАБУЛИ ЛОГІН АБО ПАРОЛЬ?</div>
              <div className={styles.verifyDesc}>
                Підтвердіть через Telegram, який ви підключали при реєстрації — і зможете
                побачити свій логін та встановити новий пароль.
              </div>
            </div>
            {error ? (
              <>
                <div className={styles.errMsg}>{error}</div>
                <button className={styles.btnPrimary} disabled={loading} onClick={handleStart}>
                  {loading ? 'Створюємо посилання...' : 'Спробувати ще раз →'}
                </button>
              </>
            ) : (
              <div className={styles.okMsg}>Готуємо посилання для Telegram…</div>
            )}
            <button
              type="button"
              onClick={() => router.push('/register')}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 12,
                padding: '8px',
                background: 'none',
                border: 'none',
                color: 'var(--text2)',
                fontSize: 13,
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              ← Повернутися до входу
            </button>
          </div>
        )}

        {step === STEPS.CONNECT_TELEGRAM && (
          <div>
            <div className={styles.verifyHeader}>
              <div className={styles.verifyIcon}>📱</div>
              <div className={styles.verifyTitle}>ПІДТВЕРДІТЬ TELEGRAM</div>
              <div className={styles.verifyDesc}>
                Відкрийте бота і натисніть <b>&quot;START&quot;</b> — той самий Telegram-акаунт,
                який ви підключали при реєстрації.
                <br />
                Вводити нічого не потрібно.
              </div>
            </div>

            {noAccount ? (
              <>
                <div className={styles.warnMsg}>
                  До цього Telegram не привʼязано жодного акаунта AMERICANKA.
                </div>
                <div className={styles.fieldHint}>
                  Якщо ви реєструвались іншим Telegram-акаунтом — спробуйте ще раз через нього.
                  Якщо ваш старий Telegram більше недоступний (загублений телефон, видалений
                  акаунт) — самостійно прив&apos;язати новий не можна: це б дозволило будь-кому
                  захопити чужий акаунт, знаючи лише логін. У такому разі напишіть адміну клубу —
                  він підтвердить особу і прив&apos;яже Telegram наново.
                </div>
                <button className={styles.btnPrimary} disabled={loading} onClick={handleStart}>
                  {loading ? 'Створюємо...' : 'Спробувати інший Telegram →'}
                </button>
              </>
            ) : linkExpired ? (
              <>
                <div className={styles.errMsg}>Посилання застаріло — запросіть нове.</div>
                <button className={styles.btnPrimary} disabled={loading} onClick={handleStart}>
                  {loading ? 'Створюємо...' : 'Нове посилання →'}
                </button>
              </>
            ) : (
              <>
                <a href={deepLink} target="_blank" rel="noopener noreferrer" className={styles.modalLinkBtn}>
                  Відкрити Telegram →
                </a>
                <div className={styles.okMsg}>Чекаємо підтвердження з Telegram…</div>
                <div className={styles.fieldHint}>
                  Щойно ви натиснете START, поверніться сюди — тут з&apos;явиться форма для
                  нового пароля. <b>Не закривайте цю сторінку.</b>
                </div>
              </>
            )}

            {error && <div className={styles.errMsg}>{error}</div>}
          </div>
        )}

        {step === STEPS.SET_PASSWORD && (
          <div>
            <div className={styles.verifyHeader}>
              <div className={styles.verifyIcon}>✅</div>
              <div className={styles.verifyTitle}>TELEGRAM ПІДТВЕРДЖЕНО</div>
              <div className={styles.verifyDesc}>Встановіть новий пароль для входу.</div>
            </div>

            <Field
              label="Новий пароль *"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="мін. 6 символів"
              styles={styles}
            />
            <Field
              label="Повторіть пароль *"
              type="password"
              value={password2}
              onChange={setPassword2}
              placeholder="ще раз новий пароль"
              styles={styles}
            />

            {error && <div className={styles.errMsg}>{error}</div>}

            <button className={styles.btnPrimary} disabled={loading} onClick={handleSetPassword}>
              {loading ? 'Зберігаємо...' : 'Встановити пароль →'}
            </button>
          </div>
        )}

        {step === STEPS.DONE && (
          <div>
            <div className={styles.verifyHeader}>
              <div className={styles.verifyIcon}>🎉</div>
              <div className={styles.verifyTitle}>ГОТОВО!</div>
              <div className={styles.verifyDesc}>
                Ваш логін: <b>{resultLogin}</b>
                <br />
                Новий пароль встановлено. Тепер можна увійти.
              </div>
            </div>
            <button className={styles.btnPrimary} onClick={() => router.push('/register')}>
              Увійти →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
