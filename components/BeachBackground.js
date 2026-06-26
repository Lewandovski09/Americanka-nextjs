// Decorative court-view background for the light theme — a custom
// illustrated aerial view of a beach volleyball court (sand texture,
// court lines, net), sitting subtly behind the content. This is an
// original illustration, not a photo, to avoid any licensing risk.

export default function BeachBackground() {
  return (
    <svg
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
      viewBox="-150 0 900 900"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sandGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3e7c8" />
          <stop offset="100%" stopColor="#e8d8ab" />
        </linearGradient>
        <radialGradient id="vignette" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="#f3f6fb" stopOpacity="0" />
          <stop offset="100%" stopColor="#f3f6fb" stopOpacity="0.97" />
        </radialGradient>
      </defs>

      {/* Sand court patch, aerial view, top of the page only */}
      <rect x="-150" y="0" width="900" height="420" fill="url(#sandGrad)" opacity="0.55" />

      {/* Sand grain texture */}
      {Array.from({ length: 60 }).map((_, i) => {
        const x = (i * 53) % 900 - 150;
        const y = (i * 37) % 380;
        return <circle key={i} cx={x} cy={y} r="1.1" fill="#c9b683" opacity="0.25" />;
      })}

      {/* Court boundary lines */}
      <rect x="80" y="40" width="440" height="280" fill="none" stroke="#0d2347" strokeWidth="2.5" opacity="0.12" />
      <line x1="300" y1="40" x2="300" y2="320" stroke="#0d2347" strokeWidth="2" opacity="0.12" />

      {/* Net */}
      <line x1="300" y1="20" x2="300" y2="60" stroke="#0d2347" strokeWidth="4" opacity="0.15" />
      {Array.from({ length: 18 }).map((_, i) => (
        <line key={`n${i}`} x1={220 + i * 9} y1="20" x2={220 + i * 9} y2="40" stroke="#0d2347" strokeWidth="0.5" opacity="0.1" />
      ))}

      {/* Soft fade so content stays readable below the court strip */}
      <rect x="-150" y="0" width="900" height="900" fill="url(#vignette)" />
    </svg>
  );
}
