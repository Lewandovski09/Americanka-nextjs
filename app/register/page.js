'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import CityPicker from '@/components/CityPicker';
import { emailForLogin, isValidLogin } from '@/lib/authIdentity';
import { toJpegDataUrl } from '@/lib/photo';
import Field from '@/components/Field';
import styles from './register.module.css';

const STEPS = {
  FORM: 'form',
  CONNECT_TELEGRAM: 'connect_telegram',
};

// Which bot the deep link points at. An env var so switching bots — or
// pointing a local build at a dev bot — needs no code change.
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'AmericankaVerifyBot';

// This page creates a Supabase client and reads live registration state
// the moment it renders — there's nothing on it worth prerendering to
// static HTML, and doing so means `next build` tries to run that
// Supabase client creation at build time, which throws if env vars
// aren't present in the build environment. force-dynamic skips that
// entirely: this route always renders per-request, like it effectively
// already did in practice.
export const dynamic = 'force-dynamic';

export default function AuthPage() {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [step, setStep] = useState(STEPS.FORM);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Login state ──
  const [loginField, setLoginField] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // ── Register state ──
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    city: '',
    login: '',
    password: '',
    gender: 'M',
    category: 'C',
  });
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [nonce, setNonce] = useState('');
  const [linkExpired, setLinkExpired] = useState(false);
  const finalizingRef = useRef(false);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    // Reset the input so picking the SAME file again fires onChange.
    // Without this, someone whose first attempt failed (a HEIC that
    // wouldn't preview, say) could re-pick the identical photo forever
    // and nothing would happen.
    e.target.value = '';
    if (!file) return;

    setPhotoError('');
    setPhotoBusy(true);
    try {
      // Canvas re-encode: fixes EXIF rotation, converts HEIC to JPEG so
      // the preview actually renders, and takes a 3–20 MB phone photo
      // down to ~200 KB.
      setPhotoDataUrl(await toJpegDataUrl(file));
    } catch (err) {
      console.error('[register photo]', err.message);
      setPhotoDataUrl(null);
      setPhotoError('Не вдалося прочитати це фото. Спробуйте інше (JPG або PNG).');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleLogin() {
    setError('');
    setLoading(true);

    // The Auth address is derived from the login, so there's nothing to
    // look up on the server any more. A wrong login and a wrong password
    // now fail identically, which is also what we want.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: emailForLogin(loginField),
      password: loginPassword,
    });

    setLoading(false);

    if (authError) {
      setError('Невірний логін або пароль');
      return;
    }

    router.push('/');
  }

  // Step 1: create the account and get back a one-time nonce for the
  // Telegram deep link. The account exists from this point on, so
  // switching to Telegram (and possibly losing this tab on mobile) can
  // no longer throw away a half-finished registration.
  async function handleRegister() {
    setError('');
    // The photo is processed asynchronously, so someone who picks a file
    // and immediately taps the button would otherwise be told to add a
    // photo they just added.
    if (photoBusy) return setError('Зачекайте, фото ще обробляється…');
    if (photoError) return setError(photoError);
    if (!photoDataUrl) return setError("Будь ласка, додайте фото профілю — це обов'язкове поле");
    if (!form.firstName.trim()) return setError("Вкажіть ім'я");
    if (!form.lastName.trim()) return setError('Вкажіть прізвище');
    if (!form.city) return setError('Оберіть місто зі списку');
    if (!form.login.trim()) return setError('Вкажіть логін');
    if (!isValidLogin(form.login))
      return setError('Логін: 3–32 символи, лише латиниця, цифри, точка, дефіс, підкреслення');
    if (form.password.length < 4) return setError('Пароль має містити мінімум 4 символи');

    // Nothing is created yet — this only reserves the login and returns
    // the nonce for the deep link. The account appears in step 3, after
    // the bot confirms.
    setLoading(true);
    const res = await fetch('/api/auth/register/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: form.login }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error || 'Не вдалося почати реєстрацію');
      return;
    }

    setNonce(data.nonce);
    setLinkExpired(false);
    setStep(STEPS.CONNECT_TELEGRAM);
  }

  // Step 3: create the account. Runs once the bot has confirmed, and
  // carries the password and photo — the only moment they leave the
  // browser.
  async function finalizeRegistration(confirmedNonce) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, nonce: confirmedNonce, photoDataUrl }),
    });
    const data = await res.json();

    if (!data.success) {
      setError(data.error || 'Не вдалося завершити реєстрацію');
      setStep(STEPS.FORM);
      finalizingRef.current = false;
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: emailForLogin(form.login),
      password: form.password,
    });

    if (signInError) {
      setError('Акаунт створено, але не вдалося увійти. Увійдіть за своїм логіном і паролем.');
      setTab('login');
      setStep(STEPS.FORM);
      return;
    }

    router.push('/?justRegistered=1');
  }

  // Step 2: wait for the bot. Telegram can't push this into the browser,
  // and the user has to switch apps anyway, so waiting on a signal from
  // the server is the honest mechanism here. This used to be a client
  // poll every 2.5s (a new HTTP request each time); it's now a single
  // Server-Sent Events connection that the server pushes updates on —
  // same wait, a fraction of the requests. The browser reconnects
  // EventSource automatically on a dropped connection, so a transient
  // network blip is handled without extra code here.
  useEffect(() => {
    if (step !== STEPS.CONNECT_TELEGRAM || !nonce) return;

    // A new nonce means a new attempt, so the guard has to start clean —
    // otherwise a failed finalize would leave it stuck and the retry
    // would never fire.
    finalizingRef.current = false;

    const source = new EventSource(`/api/telegram/link/watch?nonce=${encodeURIComponent(nonce)}`);

    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data.success) return;

      if (data.linked) {
        source.close();
        // The event can arrive again before finalize resolves; creating
        // the account twice would fail the second time with a
        // confusing "login already registered".
        if (finalizingRef.current) return;
        finalizingRef.current = true;
        finalizeRegistration(nonce);
      } else if (data.expired) {
        source.close();
        setLinkExpired(true);
      }
    };

    return () => {
      source.close();
    };
  }, [step, nonce, router]);

  // No account exists yet at this point, so a fresh link means a fresh
  // reservation — not /api/telegram/link/new, which needs a session.
  async function handleNewLink() {
    setError('');
    setLoading(true);
    const res = await fetch('/api/auth/register/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: form.login }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error || 'Не вдалося створити нове посилання');
      return;
    }

    setNonce(data.nonce);
    setLinkExpired(false);
  }

  function switchTab(newTab) {
    setTab(newTab);
    setStep(STEPS.FORM);
    setError('');
  }

  return (
    <div className={styles.wrap}>
      {/* Decorative stars background — more stars, matching the original HTML design */}
      <div className={styles.starsBg}>
        <span className={styles.star} style={{ top: '6%', left: '10%' }}>★</span>
        <span className={styles.star} style={{ top: '10%', left: '82%' }}>★</span>
        <span className={styles.star} style={{ top: '18%', left: '4%', opacity: 0.3 }}>★</span>
        <span className={styles.star} style={{ top: '15%', left: '50%', opacity: 0.2 }}>★</span>
        <span className={styles.star} style={{ top: '28%', left: '92%', opacity: 0.25 }}>★</span>
        <span className={styles.star} style={{ top: '35%', left: '8%', opacity: 0.2 }}>★</span>
        <span className={styles.star} style={{ top: '45%', left: '95%', opacity: 0.18 }}>★</span>
        <span className={styles.star} style={{ top: '60%', left: '3%', opacity: 0.22 }}>★</span>
        <span className={styles.star} style={{ top: '68%', left: '90%', opacity: 0.25 }}>★</span>
        <span className={styles.star} style={{ top: '78%', left: '20%', opacity: 0.18 }}>★</span>
        <span className={styles.star} style={{ top: '85%', left: '70%', opacity: 0.2 }}>★</span>
        <span className={styles.star} style={{ top: '92%', left: '12%', opacity: 0.15 }}>★</span>
        <span className={styles.star} style={{ top: '5%', left: '35%', opacity: 0.15 }}>★</span>
        <span className={styles.star} style={{ top: '50%', left: '50%', opacity: 0.1 }}>★</span>

        {/* Extra stars, shown only on tablet/desktop via CSS media query */}
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '12%', left: '25%', opacity: 0.2 }}>★</span>
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '22%', left: '65%', opacity: 0.18 }}>★</span>
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '40%', left: '40%', opacity: 0.15 }}>★</span>
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '55%', left: '15%', opacity: 0.2 }}>★</span>
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '65%', left: '60%', opacity: 0.16 }}>★</span>
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '75%', left: '45%', opacity: 0.18 }}>★</span>
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '88%', left: '85%', opacity: 0.15 }}>★</span>
        <span className={`${styles.star} ${styles.starWide}`} style={{ top: '8%', left: '95%', opacity: 0.2 }}>★</span>
      </div>

      <div className={styles.brandHeader}>
        <div className={styles.brandTitle}>
          <span className={styles.brandStar}>★</span> AMERICANKA <span className={styles.brandStar}>★</span>
        </div>
        <div className={styles.brandSub}>КОЛИ НЕ ТУРНІР?</div>
        <div className={styles.brandLocation}>★ ПЛЯЖ 13 · СТАНЦІЯ ФОНТАНА · ОДЕСА ★</div>
      </div>

      <div className={styles.card}>
        {step === STEPS.FORM && (
          <div className={styles.tabs}>
            <button
              className={`${styles.tabBtn} ${tab === 'login' ? styles.tabBtnOn : ''}`}
              onClick={() => switchTab('login')}
              aria-pressed={tab === 'login'}
            >
              Увійти
            </button>
            <button
              className={`${styles.tabBtn} ${tab === 'register' ? styles.tabBtnOn : ''}`}
              onClick={() => switchTab('register')}
              aria-pressed={tab === 'register'}
            >
              Реєстрація
            </button>
          </div>
        )}

        {step === STEPS.FORM && tab === 'login' && (
          <LoginForm
            loginField={loginField}
            setLoginField={setLoginField}
            loginPassword={loginPassword}
            setLoginPassword={setLoginPassword}
            error={error}
            loading={loading}
            onSubmit={handleLogin}
          />
        )}

        {step === STEPS.FORM && tab === 'register' && (
          <FormStep
            form={form}
            updateField={updateField}
            photoDataUrl={photoDataUrl}
            photoBusy={photoBusy}
            photoError={photoError}
            onPhotoChange={handlePhotoChange}
            error={error}
            loading={loading}
            onSubmit={handleRegister}
          />
        )}

        {step === STEPS.CONNECT_TELEGRAM && (
          <ConnectTelegramStep
            nonce={nonce}
            expired={linkExpired}
            error={error}
            loading={loading}
            onNewLink={handleNewLink}
          />
        )}

      </div>
    </div>
  );
}

function LoginForm({ loginField, setLoginField, loginPassword, setLoginPassword, error, loading, onSubmit }) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div>
      <label className={styles.label}>Логін</label>
      <input className={styles.input} value={loginField} onChange={(e) => setLoginField(e.target.value)} placeholder="Login" aria-label="Логін" />

      <label className={styles.label}>Пароль</label>
      <div className={styles.passwordWrap}>
        <input
          className={styles.input}
          type={showPw ? 'text' : 'password'}
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
          placeholder="Password"
          aria-label="Пароль"
          style={{ marginBottom: 0 }}
        />
        <button
          type="button"
          className={styles.eyeBtn}
          onClick={() => setShowPw((s) => !s)}
          aria-label={showPw ? 'Сховати пароль' : 'Показати пароль'}
        >
          {showPw ? '🙈' : '👁️'}
        </button>
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      <button className={styles.btnPrimary} disabled={loading} onClick={onSubmit}>
        {loading ? 'Завантаження...' : 'Увійти →'}
      </button>

      <Link
        href="/reset-password"
        style={{
          display: 'block',
          textAlign: 'center',
          marginTop: 12,
          fontSize: 13,
          color: 'var(--text2)',
        }}
      >
        Забули логін або пароль?
      </Link>
    </div>
  );
}

function FormStep({
  form,
  updateField,
  photoDataUrl,
  photoBusy,
  photoError,
  onPhotoChange,
  error,
  loading,
  onSubmit,
}) {
  return (
    <div>
      <div className={styles.photoRow}>
        <label className={styles.photoUpload} aria-label="Завантажити фото профілю">
          {photoBusy ? (
            <span className={styles.photoIcon} aria-hidden="true">⏳</span>
          ) : photoDataUrl ? (
            <img src={photoDataUrl} alt="Попередній перегляд фото профілю" className={styles.photoPreview} />
          ) : (
            <span className={styles.photoIcon} aria-hidden="true">📷</span>
          )}
          <input type="file" accept="image/*" onChange={onPhotoChange} hidden />
        </label>
        <div>
          <div className={styles.photoLabel}>Фото профілю *</div>
          <div className={styles.photoHint}>
            {photoBusy
              ? 'Обробляємо фото…'
              : photoError
                ? photoError
                : photoDataUrl
                  ? 'Готово ✓ Натисніть, щоб замінити'
                  : "Обов'язково"}
          </div>
        </div>
      </div>

      <Field label="Ім'я *" value={form.firstName} onChange={(v) => updateField('firstName', v)} placeholder="Ім'я" styles={styles} />
      <Field label="Прізвище *" value={form.lastName} onChange={(v) => updateField('lastName', v)} placeholder="Прізвище" styles={styles} />

      <label className={styles.label}>Місто *</label>
      <CityPicker
        value={form.city}
        onChange={(v) => updateField('city', v)}
        inputClassName={styles.input}
        ariaLabel="Місто"
      />

      <Field label="Логін *" value={form.login} onChange={(v) => updateField('login', v)} placeholder="Login" styles={styles} />
      <div className={styles.fieldHint}>
        3–32 символи: латинські літери, цифри, точка, дефіс, підкреслення. Змінити логін пізніше
        не можна.
      </div>
      <Field label="Пароль *" type="password" value={form.password} onChange={(v) => updateField('password', v)} placeholder="мін. 4 символи" styles={styles} />

      <label className={styles.label}>Стать *</label>
      <div className={styles.genderRow}>
        <button
          className={`${styles.genderBtn} ${form.gender === 'M' ? styles.genderBtnOn : ''}`}
          onClick={() => updateField('gender', 'M')}
          aria-pressed={form.gender === 'M'}
        >
          Чоловіча
        </button>
        <button
          className={`${styles.genderBtn} ${form.gender === 'F' ? styles.genderBtnOn : ''}`}
          onClick={() => updateField('gender', 'F')}
          aria-pressed={form.gender === 'F'}
        >
          Жіноча
        </button>
      </div>

      <label className={styles.label}>Рівень *</label>
      <div className={styles.chipsRow}>
        {['D', 'C', 'B', 'A'].map((cat) => (
          <button
            key={cat}
            className={`${styles.chip} ${form.category === cat ? styles.chipOn : ''}`}
            onClick={() => updateField('category', cat)}
            aria-pressed={form.category === cat}
          >
            {cat}
          </button>
        ))}
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      <button className={styles.btnPrimary} disabled={loading || photoBusy} onClick={onSubmit}>
        {photoBusy ? 'Обробляємо фото…' : loading ? 'Перевірка...' : 'Зареєструватися →'}
      </button>
    </div>
  );
}

function ConnectTelegramStep({ nonce, expired, error, loading, onNewLink }) {
  // The nonce travels to the bot inside the deep link, so the user never
  // sees it, types it, or can get it wrong.
  const deepLink = `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(nonce)}`;

  return (
    <div>
      <div className={styles.verifyHeader}>
        <div className={styles.verifyIcon}>📱</div>
        <div className={styles.verifyTitle}>ПІДКЛЮЧІТЬ TELEGRAM</div>
        <div className={styles.verifyDesc}>
          Залишився один крок: відкрийте бота і натисніть <b>&quot;START&quot;</b>. Акаунт буде
          створено одразу після цього.
          <br />
          Вводити нічого не потрібно.
        </div>
      </div>

      {expired ? (
        <>
          <div className={styles.errMsg}>Посилання застаріло — запросіть нове.</div>
          <button className={styles.btnPrimary} disabled={loading} onClick={onNewLink}>
            {loading ? 'Створюємо...' : 'Нове посилання →'}
          </button>
        </>
      ) : (
        <>
          <a href={deepLink} target="_blank" rel="noopener noreferrer" className={styles.modalLinkBtn}>
            Підключити Telegram →
          </a>
          <div className={styles.okMsg}>Чекаємо підтвердження з Telegram…</div>
          <div className={styles.fieldHint}>
            Щойно ви натиснете START, поверніться сюди — реєстрація завершиться сама.{' '}
            <b>Не закривайте цю сторінку</b>: акаунт створюється саме тут, після підтвердження.
          </div>
        </>
      )}

      {error && <div className={styles.errMsg}>{error}</div>}
    </div>
  );
}
