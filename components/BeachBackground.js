// Decorative SVG background shared by every internal page —
// volleyball net lines, antenna stripes, sand dots, and stars,
// all very low-opacity so they sit behind content without
// competing with it. Matches the visual language of the
// register/login screen but tuned for content-heavy pages.

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
      viewBox="0 0 430 900"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Net lines near the top */}
      <line x1="0" y1="90" x2="430" y2="90" stroke="#f0c040" strokeWidth="1.5" opacity="0.08" />
      <line x1="0" y1="102" x2="430" y2="102" stroke="#f0c040" strokeWidth="0.8" opacity="0.05" />
      <line x1="0" y1="114" x2="430" y2="114" stroke="#f0c040" strokeWidth="0.8" opacity="0.05" />
      {/* Net vertical threads */}
      {[20, 60, 100, 140, 180, 220, 260, 300, 340, 380, 410].map((x) => (
        <line key={x} x1={x} y1="80" x2={x} y2="120" stroke="#f0c040" strokeWidth="0.6" opacity="0.05" />
      ))}
      {/* Antennas */}
      <line x1="6" y1="70" x2="6" y2="125" stroke="#c0392b" strokeWidth="3" opacity="0.1" />
      <line x1="424" y1="70" x2="424" y2="125" stroke="#c0392b" strokeWidth="3" opacity="0.1" />

      {/* Court lines, mid-page */}
      <rect x="30" y="300" width="370" height="180" rx="2" fill="none" stroke="#f0c040" strokeWidth="1.2" opacity="0.05" />
      <line x1="215" y1="300" x2="215" y2="480" stroke="#f0c040" strokeWidth="0.8" opacity="0.04" />

      {/* Sand texture dots scattered down the page */}
      {[
        [50, 200], [120, 250], [340, 220], [380, 280], [60, 500], [350, 540],
        [200, 600], [90, 700], [320, 750], [180, 820], [60, 850], [380, 60],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2" fill="#f0c040" opacity="0.08" />
      ))}

      {/* Decorative ball outline */}
      <circle cx="370" cy="420" r="22" fill="none" stroke="#f0c040" strokeWidth="1" opacity="0.06" />
      <line x1="370" y1="398" x2="370" y2="442" stroke="#f0c040" strokeWidth="0.7" opacity="0.05" />
      <line x1="349" y1="408" x2="391" y2="432" stroke="#f0c040" strokeWidth="0.7" opacity="0.05" />
      <line x1="391" y1="408" x2="349" y2="432" stroke="#f0c040" strokeWidth="0.7" opacity="0.05" />

      <circle cx="45" cy="620" r="16" fill="none" stroke="#c0392b" strokeWidth="0.9" opacity="0.06" />

      {/* Stars */}
      {[
        [40, 40, 0.18], [390, 50, 0.15], [10, 150, 0.12], [410, 180, 0.14],
        [300, 90, 0.1], [150, 350, 0.12], [380, 600, 0.15], [30, 750, 0.13],
        [200, 850, 0.1], [350, 820, 0.12],
      ].map(([cx, cy, op], i) => (
        <text key={i} x={cx} y={cy} fontSize="13" fill="#f0c040" opacity={op}>
          ★
        </text>
      ))}
    </svg>
  );
}
