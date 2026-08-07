// Shown while the tournament detail page (bracket/schedule, live via a
// Supabase Realtime channel) mounts. Same shimmer treatment as
// app/rating/loading.js, shaped like a bracket list instead of a
// leaderboard.
export default function Loading() {
  return (
    <div style={{ padding: '16px' }}>
      <div className="skeleton" style={{ width: '60%', height: 22, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: '35%', height: 14, marginBottom: 20 }} />
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 56, borderRadius: 'var(--r-md)', marginBottom: 10 }}
        />
      ))}
    </div>
  );
}
