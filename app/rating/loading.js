// App Router shows this automatically while app/rating/page.js (a
// Client Component that fetches on mount) is still loading its JS
// bundle and hydrating — giving instant visual feedback instead of a
// blank screen for that first beat. Reuses the .skeleton shimmer class
// already defined in app/globals.css so it matches the rest of the app.
export default function Loading() {
  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ padding: '0 16px 16px' }}>
        <div className="skeleton" style={{ width: 140, height: 24 }} />
      </div>
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}
        >
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="skeleton" style={{ width: '55%', height: 12 }} />
            <div className="skeleton" style={{ width: '30%', height: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
