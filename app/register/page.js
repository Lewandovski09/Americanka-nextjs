'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import CityPicker from '@/components/CityPicker';
import { emailForLogin, isValidLogin } from '@/lib/authIdentity';
import styles from './register.module.css';

const STEPS = {
  FORM: 'form',
  CONNECT_TELEGRAM: 'connect_telegram',
};

// Which bot the deep link points at. An env var so switching bots — or
// pointing a local build at a dev bot — needs no code change.
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'AmericankaVerifyBot';

const LINK_POLL_INTERVAL_MS = 2500;

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
  const [nonce, setNonce] = useState('');
  const [linkExpired, setLinkExpired] = useState(false);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoDataUrl(ev.target.result);
    reader.readAsDataURL(file);
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
    if (!photoDataUrl) return setError("Будь ласка, додайте фото профілю — це обов'язкове поле");
    if (!form.firstName.trim()) return setError("Вкажіть ім'я");
    if (!form.lastName.trim()) return setError('Вкажіть прізвище');
    if (!form.city) return setError('Оберіть місто зі списку');
    if (!form.login.trim()) return setError('Вкажіть логін');
    if (!isValidLogin(form.login))
      return setError('Логін: 3–32 символи, лише латиниця, цифри, точка, дефіс, підкреслення');
    if (form.password.length < 4) return setError('Пароль має містити мінімум 4 символи');

    setLoading(true);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, photoDataUrl }),
    });
    const data = await res.json();

    if (!data.success) {
      setLoading(false);
      setError(data.error || 'Не вдалося зареєструватися');
      return;
    }

    // Sign in immediately so the player is authenticated while they
    // connect Telegram — that's what lets them request a fresh link if
    // this one expires.
    await supabase.auth.signInWithPassword({
      email: emailForLogin(form.login),
      password: form.password,
    });

    setLoading(false);
    setNonce(data.nonce);
    setLinkExpired(false);
    setStep(STEPS.CONNECT_TELEGRAM);
  }

  // Step 2: wait for the bot to report the link. Telegram can't push
  // this into the browser, and the user has to switch apps anyway, so a
  // short poll is the honest mechanism here.
  useEffect(() => {
    if (step !== STEPS.CONNECT_TELEGRAM || !nonce) return;

    let cancelled = false;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/telegram/link/status?nonce=${encodeURIComponent(nonce)}`);
        const data = await res.json();
        if (cancelled || !data.success) return;

        if (data.linked) {
          clearInterval(timer);
          router.push('/?justRegistered=1');
        } else if (data.expired) {
          clearInterval(timer);
          setLinkExpired(true);
        }
      } catch {
        // Transient network blip — the next tick retries.
      }
    }, LINK_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, nonce, router]);

  async function handleNewLink() {
    setError('');
    setLoading(true);
    const res = await fetch('/api/telegram/link/new', { method: 'POST' });
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
            >
              Увійти
            </button>
            <button
              className={`${styles.tabBtn} ${tab === 'register' ? styles.tabBtnOn : ''}`}
              onClick={() => switchTab('register')}
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
      <input className={styles.input} value={loginField} onChange={(e) => setLoginField(e.target.value)} placeholder="Login" />

      <label className={styles.label}>Пароль</label>
      <div className={styles.passwordWrap}>
        <input
          className={styles.input}
          type={showPw ? 'text' : 'password'}
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
          placeholder="Password"
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
    </div>
  );
}

function FormStep({ form, updateField, photoDataUrl, onPhotoChange, error, loading, onSubmit }) {
  return (
    <div>
      <div className={styles.photoRow}>
        <label className={styles.photoUpload}>
          {photoDataUrl ? (
            <img src={photoDataUrl} alt="" className={styles.photoPreview} />
          ) : (
            <span className={styles.photoIcon}>📷</span>
          )}
          <input type="file" accept="image/*" onChange={onPhotoChange} hidden />
        </label>
        <div>
          <div className={styles.photoLabel}>Фото профілю *</div>
          <div className={styles.photoHint}>Обов&apos;язково</div>
        </div>
      </div>

      <Field label="Ім'я *" value={form.firstName} onChange={(v) => updateField('firstName', v)} placeholder="Ім'я" />
      <Field label="Прізвище *" value={form.lastName} onChange={(v) => updateField('lastName', v)} placeholder="Прізвище" />

      <label className={styles.label}>Місто *</label>
      <CityPicker
        value={form.city}
        onChange={(v) => updateField('city', v)}
        inputClassName={styles.input}
      />

      <Field label="Логін *" value={form.login} onChange={(v) => updateField('login', v)} placeholder="Login" />
      <div className={styles.fieldHint}>
        3–32 символи: латинські літери, цифри, точка, дефіс, підкреслення. Змінити логін пізніше
        не можна.
      </div>
      <Field label="Пароль *" type="password" value={form.password} onChange={(v) => updateField('password', v)} placeholder="мін. 4 символи" />

      <label className={styles.label}>Стать *</label>
      <div className={styles.genderRow}>
        <button
          className={`${styles.genderBtn} ${form.gender === 'M' ? styles.genderBtnOn : ''}`}
          onClick={() => updateField('gender', 'M')}
        >
          Чоловіча
        </button>
        <button
          className={`${styles.genderBtn} ${form.gender === 'F' ? styles.genderBtnOn : ''}`}
          onClick={() => updateField('gender', 'F')}
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
          >
            {cat}
          </button>
        ))}
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      <button className={styles.btnPrimary} disabled={loading} onClick={onSubmit}>
        {loading ? 'Перевірка...' : 'Зареєструватися →'}
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
          Акаунт створено! Залишився один крок: відкрийте бота і натисніть <b>&quot;START&quot;</b>.
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
            Щойно ви натиснете START у боті, ця сторінка сама пустить вас далі. Якщо закриєте
            сторінку — нічого не втрачено, просто увійдіть за своїм логіном.
          </div>
        </>
      )}

      {error && <div className={styles.errMsg}>{error}</div>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';

  return (
    <>
      <label className={styles.label}>{label}</label>
      {isPassword ? (
        <div className={styles.passwordWrap}>
          <input
            className={styles.input}
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{ marginBottom: 0 }}
          />
          <button
            type="button"
            className={styles.eyeBtn}
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Сховати пароль' : 'Показати пароль'}
          >
            {show ? '🙈' : '👁️'}
          </button>
        </div>
      ) : (
        <input
          className={styles.input}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </>
  );
}
