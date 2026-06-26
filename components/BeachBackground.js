// Decorative court-view background for the light theme — a custom
// illustrated aerial view of a beach volleyball court (sand texture,
// court lines, net), sitting visibly behind the content at the top
// of the page. This is an original illustration, not a photo, to
// avoid any licensing risk.

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
          <stop offset="0%" stopColor="#f0dfb4" />
          <stop offset="100%" stopColor="#e3cf99" />
        </linearGradient>
        <linearGradient id="fadeOut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3f6fb" stopOpacity="0" />
          <stop offset="65%" stopColor="#f3f6fb" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f3f6fb" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Sand court patch, aerial view, full visible strip at top */}
      <rect x="-150" y="0" width="900" height="340" fill="url(#sandGrad)" />

      {/* Sand grain texture, denser and more visible */}
      {Array.from({ length: 140 }).map((_, i) => {
        const x = (i * 37) % 900 - 150;
        const y = (i * 23 + (i % 7) * 11) % 320;
        return <circle key={i} cx={x} cy={y} r="1.4" fill="#9c8454" opacity="0.35" />;
      })}

      {/* Subtle raked-sand wave lines for texture */}
      {Array.from({ length: 9 }).map((_, i) => (
        <path
          key={`w${i}`}
          d={`M -150 ${20 + i * 36} Q 200 ${10 + i * 36}, 750 ${20 + i * 36}`}
          fill="none"
          stroke="#b89c66"
          strokeWidth="1"
          opacity="0.18"
        />
      ))}

      {/* Court boundary lines — bold and clearly visible */}
      <rect x="60" y="50" width="480" height="240" fill="none" stroke="#0d2347" strokeWidth="3" opacity="0.3" />
      <line x1="300" y1="50" x2="300" y2="290" stroke="#0d2347" strokeWidth="2" opacity="0.3" />

      {/* Net posts + mesh */}
      <line x1="300" y1="14" x2="300" y2="50" stroke="#0d2347" strokeWidth="5" opacity="0.32" />
      <line x1="215" y1="22" x2="385" y2="22" stroke="#0d2347" strokeWidth="2" opacity="0.28" />
      {Array.from({ length: 18 }).map((_, i) => (
        <line key={`n${i}`} x1={215 + i * 9.4} y1="22" x2={215 + i * 9.4} y2="50" stroke="#0d2347" strokeWidth="0.6" opacity="0.18" />
      ))}
      {Array.from({ length: 4 }).map((_, i) => (
        <line key={`h${i}`} x1="215" y1={22 + i * 7} x2="385" y2={22 + i * 7} stroke="#0d2347" strokeWidth="0.5" opacity="0.16" />
      ))}

      {/* Fade so content lower on the page stays fully readable */}
      <rect x="-150" y="0" width="900" height="900" fill="url(#fadeOut)" />
    </svg>
  );
}
