import Link from 'next/link';

// App Router renders this automatically for any unmatched route, and
// also whenever a page calls notFound() (e.g. a tournament id that
// doesn't exist). Server Component — no client state needed.
export default function NotFound() {
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
      <div style={{ fontSize: 40 }}>🔍</div>
      <h2 style={{ margin: 0, color: 'var(--text)', fontSize: 20 }}>Сторінку не знайдено</h2>
      <p style={{ margin: 0, color: 'var(--text2)', fontSize: 15, maxWidth: 320 }}>
        Можливо, посилання застаріле, або сторінку було видалено.
      </p>
      <Link
        href="/"
        style={{
          marginTop: 8,
          padding: '10px 24px',
          borderRadius: 'var(--r-pill)',
          background: 'var(--rust)',
          color: '#fff',
          fontWeight: 600,
          fontSize: 15,
          textDecoration: 'none',
        }}
      >
        На головну
      </Link>
    </div>
  );
}
