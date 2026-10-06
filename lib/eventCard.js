// The tournament card as a picture — the same look as «Найближчий
// турнір» on the home page (app/page.js + components/CategoryRow), drawn
// for the Telegram announcement by next/og (app/api/og/event/[eventId]).
//
// next/og draws with Satori, which understands only a part of CSS:
// every element with more than one child must be display:flex, sizes are
// plain pixels, no CSS variables or classes. So the home page's styles
// are repeated here by hand, scaled up ×S for a crisp 1080 px picture.

export const CARD_WIDTH = 1080;

const S = 2.4; // home-page CSS px → picture px
const px = (n) => Math.round(n * S);

const C = {
  bg: '#f3f6fb',
  text: '#101b33',
  text2: '#5a6476',
  border: '#d3dbe9',
  rust: '#e85d4a',
  navy: '#0d2347',
};

// Heights used to size the picture (Satori needs it up front).
const H_OUTER_PAD = 44;
const H_KICKER = 58;
const H_TOP_BASE = px(14) + px(12) + px(24) + px(6) + 2 * px(19);
const H_NAME = px(21);
const H_BODY_PAD = px(4) + px(12);
const H_ROW = px(8) + px(10) * 2 + px(22) + px(10) + px(18) + px(8) + px(7) + 4;
const H_FOOTER = 66;

export function cardHeight(data) {
  const rows = Math.max(1, data?.categories?.length || 0);
  return Math.round(
    H_OUTER_PAD * 2 + H_KICKER + H_TOP_BASE + (data?.name ? H_NAME : 0) + H_BODY_PAD + rows * H_ROW + H_FOOTER
  );
}

function Badge({ children }) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: px(11.25),
        fontWeight: 700,
        color: '#34486e',
        background: '#fff',
        border: `2px solid ${C.border}`,
        padding: `${px(2)}px ${px(8)}px`,
        borderRadius: px(20),
        marginRight: px(6),
      }}
    >
      {children}
    </div>
  );
}

function CategoryTile({ c }) {
  const pct = c.total > 0 ? Math.min(100, (c.taken / c.total) * 100) : 0;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        marginTop: px(8),
        padding: `${px(10)}px ${px(12)}px`,
        borderRadius: px(14),
        background: 'linear-gradient(180deg, #f7f9fd 0%, #e9eef7 100%)',
        border: `2px solid ${C.border}`,
        boxShadow: `0 ${px(2)}px 0 #cbd4e3`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', height: px(22) }}>
        <div style={{ display: 'flex', fontSize: px(14.75), fontWeight: 600, color: C.text, marginRight: px(8) }}>
          {c.label}
        </div>
        {c.genderLabel ? <Badge>{c.genderLabel}</Badge> : null}
        {c.bracketLabel ? <Badge>{c.bracketLabel}</Badge> : null}
        {c.avpTier ? <Badge>{`AVP ${c.avpTier}`}</Badge> : null}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          height: px(18),
          marginTop: px(10),
          marginBottom: px(8),
          fontSize: px(12.75),
          fontWeight: 700,
          color: C.text2,
        }}
      >
        {`${c.taken}/${c.total} ${c.unit} · ${c.left} вільно`}
      </div>
      <div
        style={{
          display: 'flex',
          height: px(7),
          background: '#d5ddeb',
          borderRadius: px(4),
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #ffb39f, #e85d4a)',
            borderRadius: px(4),
          }}
        />
      </div>
    </div>
  );
}

/** The picture's root element. `data` — lib/server/eventCardData. */
export function EventCard({ data }) {
  const meta2 = [data.venue, data.avpTier ? `AVP ${data.avpTier}` : null].filter(Boolean).join(' · ');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: CARD_WIDTH,
        height: cardHeight(data),
        padding: H_OUTER_PAD,
        background: C.bg,
        fontFamily: 'Inter',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: H_KICKER,
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: 3,
          color: C.rust,
        }}
      >
        НОВИЙ ТУРНІР
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: px(18),
          border: `2px solid ${C.border}`,
          boxShadow: `0 ${px(3)}px 0 #cbd4e3`,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        {/* banner head */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            padding: `${px(14)}px ${px(14)}px ${px(12)}px`,
            color: '#fff',
            background: 'linear-gradient(135deg, #16306b 0%, #2a4d94 60%, #7e5473 100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 60%)',
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              height: px(24),
              marginBottom: px(6),
            }}
          >
            <div style={{ display: 'flex', fontSize: px(16.5), fontWeight: 700, color: '#fff' }}>{data.title}</div>
            <div
              style={{
                display: 'flex',
                background: '#22c55e',
                color: '#fff',
                border: '2px solid #15803d',
                fontSize: px(10.75),
                fontWeight: 700,
                padding: `${px(4)}px ${px(9)}px`,
                borderRadius: px(20),
              }}
            >
              {data.statusLabel}
            </div>
          </div>
          {data.name ? (
            <div style={{ display: 'flex', height: px(21), fontSize: px(13.5), fontWeight: 600, color: '#fff' }}>
              {data.name}
            </div>
          ) : null}
          <div style={{ display: 'flex', height: px(19), fontSize: px(12.75), fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>
            {data.dateLabel}
          </div>
          <div style={{ display: 'flex', height: px(19), fontSize: px(12.75), fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>
            {meta2}
          </div>
        </div>

        {/* category tiles */}
        <div style={{ display: 'flex', flexDirection: 'column', padding: `${px(4)}px ${px(10)}px ${px(12)}px`, background: '#fff' }}>
          {data.categories.map((c) => (
            <CategoryTile key={c.id} c={c} />
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: H_FOOTER,
          fontSize: 28,
          fontWeight: 600,
          color: C.text2,
        }}
      >
        Записатися — у застосунку Americanka
      </div>
    </div>
  );
}
