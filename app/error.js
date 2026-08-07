'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// App Router's error boundary — catches any render/data error thrown by
// a page or its children and replaces just that segment with this UI,
// instead of the whole app going white. Must be a Client Component.
export default function Error({ error, reset }) {
  useEffect(() => {
    // Explicit capture (rather than relying only on Sentry's global
    // handlers) tags this as a caught boundary error, and it still
    // logs to the console even before a Sentry DSN is configured.
    console.error('[error boundary]', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '32px 24px',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 40 }}>🏐</div>
      <h2 style={{ margin: 0, color: 'var(--text)', fontSize: 20 }}>Щось пішло не так</h2>
      <p style={{ margin: 0, color: 'var(--text2)', fontSize: 15, maxWidth: 320 }}>
        Сталася неочікувана помилка. Спробуйте ще раз — якщо проблема
        повторюється, повідомте нас.
      </p>
      <button
        onClick={() => reset()}
        style={{
          marginTop: 8,
          padding: '10px 24px',
          borderRadius: 'var(--r-pill)',
          border: 'none',
          background: 'var(--rust)',
          color: '#fff',
          fontWeight: 600,
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        Спробувати ще раз
      </button>
    </div>
  );
}
