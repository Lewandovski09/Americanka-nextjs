'use client';

import { useState } from 'react';

// Was a local, non-exported function inside app/register/page.js.
// app/reset-password/page.js needs the exact same label+input(+password
// eye-toggle) pattern; duplicating it would repeat the exact mistake
// TabBtn/OptionBtn were just pulled out of components/ to fix. Takes
// `styles` as a prop (matching AvpTierPicker.js's existing convention)
// since both pages import register.module.css already, but this way it
// isn't tied to that one file specifically.
export default function Field({ label, value, onChange, placeholder, type = 'text', styles }) {
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
            aria-label={label}
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
          aria-label={label}
        />
      )}
    </>
  );
}
