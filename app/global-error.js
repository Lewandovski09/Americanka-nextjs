'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// app/error.js catches errors thrown by a page or its children. It
// CANNOT catch an error thrown by the root layout itself (app/layout.js)
// — by the time layout.js has failed, there's no <html>/<body> left for
// error.js to render into. This file is the one Next.js falls back to
// in exactly that case, which is why it has to supply its own <html>
// and <body> instead of relying on the (possibly broken) root layout.
// This is also what silences the Sentry build warning asking for it.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[global error boundary]', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="uk">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '32px 24px',
            gap: 16,
            fontFamily: 'system-ui, sans-serif',
            // No design-token CSS variables here on purpose — if the
            // root layout itself failed, don't assume anything it would
            // normally set up (globals.css, fonts) is actually in
            // place. Plain, safe fallback styling only.
            background: '#0d2347',
            color: '#fff',
          }}
        >
          <div style={{ fontSize: 40 }}>🏐</div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Щось пішло не так</h2>
          <p style={{ margin: 0, opacity: 0.8, fontSize: 15, maxWidth: 320 }}>
            Сталася неочікувана помилка на рівні всього застосунку. Спробуйте
            перезавантажити сторінку.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 8,
              padding: '10px 24px',
              borderRadius: 999,
              border: 'none',
              background: '#e85d4a',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            Спробувати ще раз
          </button>
        </div>
      </body>
    </html>
  );
}
