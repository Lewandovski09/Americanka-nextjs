'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './register.module.css';

const STEPS = {
  FORM: 'form',
  VERIFY_TELEGRAM: 'verify_telegram',
  VERIFY_EMAIL: 'verify_email',
};

export default function AuthPage() {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [step, setStep] = useState(STEPS.FORM);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBotModal, setShowBotModal] = useState(false);

  // ── Login state ──
  const [loginField, setLoginField] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // ── Register state ──
  const [form, setForm] = useState({
    fullName: '',
    login: '',
    telegramUsername: '',
    email: '',
    password: '',
    gender: 'M',
    category: 'C',
  });
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [telegramCode, setTelegramCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [hint, setHint] = useState('');

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

    const lookupRes = await fetch('/api/auth/lookup-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginField }),
    });
    const lookupData = await lookupRes.json();

    if (!lookupData.success) {
      setLoading(false);
      setError('Невірний логін або пароль');
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: lookupData.email,
      password: loginPassword,
    });

    setLoading(false);

    if (authError) {
      setError('Невірний логін або пароль');
      return;
    }

    router.push('/');
  }

  // Step 1: validate fields + check uniqueness, then show the
  // "open the bot first" instruction modal instead of sending
  // immediately — this way the user always sees the instruction
  // before we attempt to send a Telegram message.
  async function handleValidateAndShowModal() {
    setError('');
    if (!photoDataUrl) return setError("Будь ласка, додайте фото профілю — це обов'язкове поле");
    if (!form.fullName.trim()) return setError("Вкажіть ім'я та прізвище");
    if (!form.login.trim()) return setError('Вкажіть логін');
    if (!form.telegramUsername.trim()) return setError('Вкажіть Telegram нікнейм');
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return setError('Вкажіть коректний email');
    }
    if (form.password.length < 4) return setError('Пароль має містити мінімум 4 символи');

    setLoading(true);
    const res = await fetch('/api/auth/check-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: form.login,
        email: form.email,
        telegramUsername: form.telegramUsername,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error || 'Дані вже використовуються');
      return;
    }

    setShowBotModal(true);
  }

  // Step 2: user confirmed they opened the bot — now actually send the code.
  async function handleConfirmBotStartAndSend() {
    setShowBotModal(false);
    setError('');
    setLoading(true);
    const res = await fetch('/api/auth/verify-phone/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramUsername: form.telegramUsername }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error || 'Не вдалося надіслати код');
      return;
    }

    setHint('Код надіслано в Telegram!');
    setStep(STEPS.VERIFY_TELEGRAM);
  }

  async function handleConfirmTelegram() {
    setError('');
    setLoading(true);
    const res = await fetch('/api/auth/verify-phone/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramUsername: form.telegramUsername, code: telegramCode }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error || 'Невірний код');
      return;
    }

    setLoading(true);
    const emailRes = await fetch('/api/auth/verify-email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email }),
    });
    const emailData = await emailRes.json();
    setLoading(false);

    if (!emailData.success) {
      setError(emailData.error || 'Не вдалося надіслати email');
      return;
    }

    setHint('Код надіслано на email!');
    setStep(STEPS.VERIFY_EMAIL);
  }

  async function handleConfirmEmail() {
    setError('');
    setLoading(true);

    const verifyRes = await fetch('/api/auth/verify-email/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, code: emailCode }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.success) {
      setLoading(false);
      setError(verifyData.error || 'Невірний код');
      return;
    }

    const registerRes = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, photoDataUrl }),
    });
    const registerData = await registerRes.json();
    setLoading(false);

    if (!registerData.success) {
      setError(registerData.error || 'Не вдалося зареєструватися');
      return;
    }

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    });

    if (loginError) {
      setError('Акаунт створено, але не вдалося увійти. Спробуйте увійти вручну.');
      setTab('login');
      setStep(STEPS.FORM);
      return;
    }

    router.push('/?justRegistered=1');
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
            onSubmit={handleValidateAndShowModal}
          />
        )}

        {step === STEPS.VERIFY_TELEGRAM && (
          <VerifyStep
            icon="📱"
            title="ПІДТВЕРДЖЕННЯ TELEGRAM"
            description={
              <>
                Ми надіслали код у Telegram-бот <b>@AmericankaVerifyBot</b>.
                <br />
                Якщо нічого не прийшло — переконайтесь, що ви натиснули &quot;Start&quot; у боті.
              </>
            }
            code={telegramCode}
            setCode={setTelegramCode}
            error={error}
            hint={hint}
            loading={loading}
            onBack={() => setStep(STEPS.FORM)}
            onConfirm={handleConfirmTelegram}
          />
        )}

        {step === STEPS.VERIFY_EMAIL && (
          <VerifyStep
            icon="📧"
            title="ПІДТВЕРДЖЕННЯ EMAIL"
            description={<>Ми надіслали код на {form.email}</>}
            code={emailCode}
            setCode={setEmailCode}
            error={error}
            hint={hint}
            loading={loading}
            onBack={() => setStep(STEPS.VERIFY_TELEGRAM)}
            onConfirm={handleConfirmEmail}
          />
        )}
      </div>

      {showBotModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBox}>
            <div className={styles.modalIcon}>📱</div>
            <div className={styles.modalTitle}>Останній крок перед кодом!</div>
            <div className={styles.modalText}>
              Відкрийте бота <b>@AmericankaVerifyBot</b> у Telegram і натисніть кнопку <b>&quot;Start&quot;</b> (або
              напишіть <b>/start</b>).
              <br />
              <br />
              Після цього ми надішлемо вам код з <b>4 цифр</b> прямо в чат з ботом.
            </div>
            <a
              href="https://t.me/AmericankaVerifyBot"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.modalLinkBtn}
            >
              Відкрити бота →
            </a>
            <button className={styles.btnPrimary} onClick={handleConfirmBotStartAndSend}>
              Я натиснув Start, надіслати код
            </button>
            <button className={styles.modalCancelBtn} onClick={() => setShowBotModal(false)}>
              Скасувати
            </button>
          </div>
        </div>
      )}
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

      <Field label="Ім'я та прізвище *" value={form.fullName} onChange={(v) => updateField('fullName', v)} placeholder="Ім'я" />
      <Field label="Логін *" value={form.login} onChange={(v) => updateField('login', v)} placeholder="Login" />
      <Field
        label="Telegram нікнейм *"
        value={form.telegramUsername}
        onChange={(v) => updateField('telegramUsername', v)}
        placeholder="нікнейм або посилання t.me/..."
      />
      <div className={styles.fieldHint}>Можна вписати нікнейм (username), @username, або повне посилання t.me/username — будь-який формат розпізнається.</div>
      <Field label="Email *" type="email" value={form.email} onChange={(v) => updateField('email', v)} placeholder="email@example.com" />
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

function VerifyStep({ icon, title, description, code, setCode, error, hint, loading, onBack, onConfirm }) {
  return (
    <div>
      <button className={styles.backBtn} onClick={onBack}>
        ← Назад
      </button>
      <div className={styles.verifyHeader}>
        <div className={styles.verifyIcon}>{icon}</div>
        <div className={styles.verifyTitle}>{title}</div>
        <div className={styles.verifyDesc}>{description}</div>
      </div>
      <label className={styles.label}>Код підтвердження *</label>
      <input
        className={styles.codeInput}
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="0000"
      />
      {error && <div className={styles.errMsg}>{error}</div>}
      {hint && !error && <div className={styles.okMsg}>{hint}</div>}
      <button className={styles.btnPrimary} disabled={loading} onClick={onConfirm}>
        {loading ? 'Перевірка...' : 'Підтвердити →'}
      </button>
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
