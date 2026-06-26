'use client';

// On wide screens (desktop/tablet), the main content is capped at
// 900px and centered, leaving big empty margins on either side.
// This component fills those margins with a more visible beach
// volleyball court illustration (net, posts, court lines) — purely
// decorative, hidden on narrower screens via CSS.

import styles from './SideCourtDecor.module.css';

export default function SideCourtDecor() {
  return (
    <>
      <div className={`${styles.sideDecor} ${styles.left}`}>
        <CourtSvg />
      </div>
      <div className={`${styles.sideDecor} ${styles.right}`}>
        <CourtSvg flipped />
      </div>
    </>
  );
}

function CourtSvg({ flipped = false }) {
  return (
    <svg
      viewBox="0 0 200 500"
      style={{ transform: flipped ? 'scaleX(-1)' : 'none', width: '100%', height: '100%' }}
    >
      {/* Net posts */}
      <line x1="30" y1="120" x2="30" y2="280" stroke="#0d2347" strokeWidth="4" opacity="0.04" />
      <line x1="170" y1="120" x2="170" y2="280" stroke="#0d2347" strokeWidth="4" opacity="0.04" />
      {/* Net top/bottom cables */}
      <line x1="30" y1="150" x2="170" y2="150" stroke="#0d2347" strokeWidth="2" opacity="0.07" />
      <line x1="30" y1="200" x2="170" y2="200" stroke="#0d2347" strokeWidth="1" opacity="0.05" />
      {/* Net mesh */}
      {Array.from({ length: 12 }).map((_, i) => (
        <line
          key={`v${i}`}
          x1={30 + i * 12.7}
          y1="150"
          x2={30 + i * 12.7}
          y2="200"
          stroke="#0d2347"
          strokeWidth="0.5"
          opacity="0.04"
        />
      ))}
      {Array.from({ length: 4 }).map((_, i) => (
        <line key={`h${i}`} x1="30" y1={150 + i * 12.5} x2="170" y2={150 + i * 12.5} stroke="#0d2347" strokeWidth="0.5" opacity="0.04" />
      ))}

      {/* Court lines */}
      <rect x="15" y="300" width="170" height="160" fill="none" stroke="#0d2347" strokeWidth="1.3" opacity="0.06" />
      <line x1="100" y1="300" x2="100" y2="460" stroke="#0d2347" strokeWidth="0.8" opacity="0.05" />

      {/* Sand texture dots */}
      {[
        [50, 330], [140, 350], [70, 400], [120, 420], [40, 440], [160, 380],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.8" fill="#0d2347" opacity="0.06" />
      ))}

      {/* Stars scattered around */}
      <text x="20" y="60" fontSize="16" fill="#0d2347" opacity="0.07">★</text>
      <text x="150" y="90" fontSize="11" fill="#0d2347" opacity="0.06">★</text>
      <text x="60" y="490" fontSize="13" fill="#0d2347" opacity="0.04">★</text>
    </svg>
  );
}
