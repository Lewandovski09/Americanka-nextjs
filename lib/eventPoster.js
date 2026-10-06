// The tournament poster (афіша) — the picture of the Telegram
// announcement (lib/server/eventAnnouncement). In the app's own look:
// the light page, the navy «Найближчий турнір» banner, white «3D» cards
// with a solid bottom edge, league tiles like CategoryRow and the coral
// button colour. Everything a player needs: the logo, format and name,
// day and time, «Локація», the leagues with their places, how games are
// scored, the entry fee, when applications open and whom to ask.
//
// Drawn by next/og (app/api/og/poster/[eventId]) with Satori, which knows
// only part of CSS: every element with more than one child is
// display:flex, sizes are plain pixels, no classes or CSS variables, no
// emoji (the font has none) — icons are inline SVG.

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

const C = {
  page: '#f3f6fb',
  text: '#101b33',
  text2: '#5a6476',
  navy: '#0d2347',
  border: '#d3dbe9',
  edge: '#cbd4e3',
  rust: '#e85d4a',
  rustDark: '#c8432f',
  green: '#22c55e',
  white: '#ffffff',
};

const row = (extra = {}) => ({ display: 'flex', flexDirection: 'row', alignItems: 'center', ...extra });
const col = (extra = {}) => ({ display: 'flex', flexDirection: 'column', ...extra });

// A white card with the app's solid bottom edge.
const card = (extra = {}) => ({
  display: 'flex',
  background: C.white,
  border: `3px solid ${C.border}`,
  borderRadius: 36,
  boxShadow: `0 8px 0 ${C.edge}`,
  ...extra,
});

function Badge({ children, tone = 'light' }) {
  const tones = {
    light: { background: C.white, color: '#34486e', border: `2px solid ${C.border}` },
    navy: { background: C.navy, color: C.white, border: `2px solid ${C.navy}` },
    coral: { background: '#fceae6', color: C.rustDark, border: '2px solid #f5c3b8' },
    glass: { background: 'rgba(255,255,255,0.16)', color: C.white, border: '2px solid rgba(255,255,255,0.35)' },
  };
  return (
    <div style={row({ height: 46, padding: '0 20px', borderRadius: 23, fontSize: 23, fontWeight: 700, ...tones[tone] })}>
      {children}
    </div>
  );
}

const GENDER_TONE = { Чоловіки: 'navy', Жінки: 'coral', Мікс: 'light' };

function CategoryTile({ c, height, compact }) {
  return (
    <div
      style={row({
        height,
        padding: compact ? '0 22px' : '0 28px',
        borderRadius: 26,
        background: 'linear-gradient(180deg, #f7f9fd 0%, #e9eef7 100%)',
        border: `3px solid ${C.border}`,
        boxShadow: `0 5px 0 ${C.edge}`,
        justifyContent: 'space-between',
      })}
    >
      <div style={row({ gap: 14 })}>
        <div style={{ display: 'flex', fontSize: compact ? 32 : 38, fontWeight: 800, color: C.text }}>{c.label}</div>
        {c.genderLabel ? <Badge tone={GENDER_TONE[c.genderLabel] || 'light'}>{c.genderLabel}</Badge> : null}
        {!compact && c.bracketLabel ? <Badge>{c.bracketLabel}</Badge> : null}
      </div>
      <div style={{ display: 'flex', fontSize: compact ? 28 : 32, fontWeight: 800, color: C.rust }}>{c.places}</div>
    </div>
  );
}

function TelegramIcon({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="24" fill="#29a9eb" />
      <path d="M11 23.5 L35 14 L31 34 L24 28.5 L20.5 32 L20 26.5 L31 17.5 L18 25.5 Z" fill="#ffffff" />
    </svg>
  );
}

function PhoneIcon({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="24" fill={C.green} />
      <path
        d="M17.5 13 C16 13 14 15 14 17 C14 26 22 34 31 34 C33 34 35 32 35 30.5 L35 28 L29.5 25.5 L27 28 C24 26.5 21.5 24 20 21 L22.5 18.5 L20 13 Z"
        fill="#ffffff"
      />
    </svg>
  );
}

function PinIcon({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 2 C8 2 5 5 5 9 C5 14 12 22 12 22 C12 22 19 14 19 9 C19 5 16 2 12 2 Z" fill={C.rust} />
      <circle cx="12" cy="9" r="3" fill="#ffffff" />
    </svg>
  );
}

/** The poster's root element. `data` — lib/server/eventCardData; `logo` — a data: URL. */
export function EventPoster({ data, logo }) {
  const cats = data.categories || [];
  const dp = data.dateParts || {};
  const place = [data.venue, data.city].filter(Boolean).join(', ');
  const soon = data.regState === 'soon';
  const closed = data.regState === 'closed';
  const op = data.opensParts;
  const regKind = data.isPair ? 'Реєстрація парами' : 'Індивідуальна реєстрація';
  const org = data.organizer || {};
  const weekday = (dp.weekday || '').charAt(0).toUpperCase() + (dp.weekday || '').slice(1);

  // The leagues get what is left of the height: one column for up to
  // three, two columns for more; whatever doesn't fit → «+ ще N».
  const room = data.name ? 236 : 286;
  const cols = cats.length > 3 ? 2 : 1;
  const GAP = 16;
  let rows = Math.ceil(cats.length / cols) || 1;
  let tileH = Math.min(96, Math.floor((room - GAP * (rows - 1)) / rows));
  let shown = cats;
  if (tileH < 62) {
    rows = Math.max(1, Math.floor((room - 44 + GAP) / (62 + GAP)));
    tileH = 62;
    shown = cats.slice(0, rows * cols);
  }
  const more = cats.length - shown.length;
  const compact = cols === 2 || tileH < 80;
  const grid = [];
  for (let r = 0; r < Math.ceil(shown.length / cols); r++) grid.push(shown.slice(r * cols, r * cols + cols));

  return (
    <div
      style={col({
        position: 'relative',
        width: POSTER_WIDTH,
        height: POSTER_HEIGHT,
        padding: '44px 60px 40px',
        background: C.page,
        color: C.text,
        fontFamily: 'Inter',
        overflow: 'hidden',
      })}
    >
      {/* soft sand-and-sea glow in the corners, like the app's background */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: -260,
          right: -260,
          width: 620,
          height: 620,
          borderRadius: 310,
          background: 'radial-gradient(circle, rgba(42,77,148,0.16) 0%, rgba(42,77,148,0) 70%)',
        }}
      />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: -280,
          left: -240,
          width: 640,
          height: 640,
          borderRadius: 320,
          background: 'radial-gradient(circle, rgba(232,93,74,0.16) 0%, rgba(232,93,74,0) 70%)',
        }}
      />

      {/* logo line */}
      <div style={row({ justifyContent: 'space-between', height: 96 })}>
        <div style={row({ gap: 22 })}>
          {logo ? (
            <img src={logo} alt="" width={96} height={96} style={{ borderRadius: 26, boxShadow: `0 6px 0 ${C.edge}` }} />
          ) : null}
          <div style={col({})}>
            <div style={{ display: 'flex', fontSize: 46, fontWeight: 800, color: C.navy, letterSpacing: 1 }}>AMERICANKA</div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 600, color: C.text2 }}>Пляжний волейбол</div>
          </div>
        </div>
        {data.avpTier ? <Badge tone="navy">{`AVP ${data.avpTier}`}</Badge> : null}
      </div>

      {/* the navy banner — like «Найближчий турнір» */}
      <div
        style={col({
          position: 'relative',
          marginTop: 26,
          padding: '30px 40px 32px',
          borderRadius: 36,
          color: C.white,
          background: 'linear-gradient(135deg, #16306b 0%, #2a4d94 60%, #e85d4a 150%)',
          boxShadow: '0 8px 0 #0b1e45',
          overflow: 'hidden',
        })}
      >
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%)',
          }}
        />
        <div style={row({ justifyContent: 'space-between' })}>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, letterSpacing: 5, color: '#ffb39f' }}>НОВИЙ ТУРНІР</div>
          <div
            style={row({
              height: 46,
              padding: '0 20px',
              borderRadius: 23,
              fontSize: 22,
              fontWeight: 700,
              background: soon ? '#f59e0b' : closed ? '#64748b' : C.green,
              border: `2px solid ${soon ? '#b45309' : closed ? '#475569' : '#15803d'}`,
            })}
          >
            {soon ? 'Скоро прийом заявок' : closed ? 'Реєстрацію закрито' : 'Реєстрація відкрита'}
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 6, fontSize: 92, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
          {data.title}
        </div>
        {data.name ? (
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{data.name}</div>
        ) : null}
      </div>

      {/* when / where / how */}
      <div style={card({ flexDirection: 'column', marginTop: 30, padding: '24px 34px' })}>
        <div style={row({})}>
          <div
            style={col({
              alignItems: 'center',
              justifyContent: 'center',
              width: 150,
              height: 132,
              borderRadius: 26,
              background: '#fceae6',
              border: '2px solid #f5c3b8',
            })}
          >
            <div style={{ display: 'flex', fontSize: 76, fontWeight: 800, lineHeight: 1, color: C.rust }}>{dp.day || ''}</div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: C.rustDark, marginTop: 2 }}>{dp.month || ''}</div>
          </div>
          <div style={col({ marginLeft: 30, flexGrow: 1 })}>
            <div style={row({ gap: 16 })}>
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: C.text2 }}>{weekday}</div>
              <div style={{ display: 'flex', fontSize: 56, fontWeight: 800, color: C.text }}>{dp.time || ''}</div>
            </div>
            <div style={row({ marginTop: 8, gap: 10 })}>
              <PinIcon />
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: C.text2 }}>Локація:</div>
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: C.text }}>{place}</div>
            </div>
          </div>
        </div>
        <div style={row({ marginTop: 18, gap: 12 })}>
          {data.scoring ? <Badge>{data.scoring}</Badge> : null}
          <Badge>{regKind}</Badge>
        </div>
      </div>

      {/* leagues */}
      <div style={row({ marginTop: 30, marginBottom: 14, justifyContent: 'space-between' })}>
        <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, letterSpacing: 4, color: C.text2 }}>КАТЕГОРІЇ</div>
        {more > 0 ? <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: C.text2 }}>{`+ ще ${more}`}</div> : null}
      </div>
      <div style={col({ gap: GAP })}>
        {grid.map((line, i) => (
          <div key={i} style={row({ gap: GAP, alignItems: 'stretch' })}>
            {line.map((c) => (
              <div key={c.id} style={col({ flexGrow: 1, flexBasis: 0 })}>
                <CategoryTile c={c} height={tileH} compact={compact} />
              </div>
            ))}
            {line.length < cols ? <div style={{ display: 'flex', flexGrow: 1, flexBasis: 0 }} /> : null}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexGrow: 1 }} />

      {/* fee + applications */}
      <div style={row({ gap: 22, height: 168, alignItems: 'stretch' })}>
        <div
          style={col({
            justifyContent: 'center',
            width: 430,
            padding: '0 34px',
            borderRadius: 36,
            color: C.white,
            background: 'linear-gradient(180deg, #ff7a5c 0%, #e85d4a 100%)',
            border: `3px solid ${C.rustDark}`,
            boxShadow: '0 8px 0 #a8361f',
          })}
        >
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, letterSpacing: 4, color: 'rgba(255,255,255,0.9)' }}>ВНЕСОК</div>
          {data.fee == null ? (
            <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, marginTop: 4 }}>уточнюйте</div>
          ) : data.fee === 0 ? (
            <div style={{ display: 'flex', fontSize: 48, fontWeight: 800, marginTop: 4 }}>Безкоштовно</div>
          ) : (
            <div style={row({ alignItems: 'flex-end', marginTop: 2 })}>
              <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, lineHeight: 1 }}>{String(data.fee)}</div>
              <div style={col({ marginLeft: 14, marginBottom: 6 })}>
                <div style={{ display: 'flex', fontSize: 34, fontWeight: 800 }}>грн</div>
                <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>з гравця</div>
              </div>
            </div>
          )}
        </div>
        <div style={card({ flexDirection: 'column', justifyContent: 'center', flexGrow: 1, padding: '0 34px' })}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, letterSpacing: 4, color: C.text2 }}>ПРИЙОМ ЗАЯВОК</div>
          {soon && op ? (
            <div style={col({ marginTop: 4 })}>
              <div style={{ display: 'flex', fontSize: 48, fontWeight: 800, lineHeight: 1.1, color: C.text }}>{`з ${op.day} ${op.month}`}</div>
              <div style={{ display: 'flex', fontSize: 38, fontWeight: 800, color: C.rust }}>{`о ${op.time}`}</div>
            </div>
          ) : closed ? (
            <div style={{ display: 'flex', fontSize: 46, fontWeight: 800, marginTop: 4, color: C.text }}>закрито</div>
          ) : (
            <div style={col({ marginTop: 4 })}>
              <div style={row({})}>
                <div style={{ display: 'flex', width: 24, height: 24, borderRadius: 12, background: C.green, marginRight: 14 }} />
                <div style={{ display: 'flex', fontSize: 48, fontWeight: 800, color: C.text }}>відкрито</div>
              </div>
              <div style={{ display: 'flex', fontSize: 26, fontWeight: 600, color: C.text2, marginTop: 2 }}>записуйтесь у застосунку</div>
            </div>
          )}
        </div>
      </div>

      {/* whom to ask */}
      {org.telegram || org.phone ? (
        <div
          style={row({
            marginTop: 26,
            height: 84,
            padding: '0 30px',
            borderRadius: 30,
            background: C.navy,
            color: C.white,
            justifyContent: 'space-between',
          })}
        >
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: 'rgba(255,255,255,0.75)' }}>Питання до організатора</div>
          <div style={row({ gap: 26 })}>
            {org.telegram ? (
              <div style={row({ gap: 12 })}>
                <TelegramIcon />
                <div style={{ display: 'flex', fontSize: 28, fontWeight: 800 }}>{org.telegram}</div>
              </div>
            ) : null}
            {org.phone ? (
              <div style={row({ gap: 12 })}>
                <PhoneIcon />
                <div style={{ display: 'flex', fontSize: 28, fontWeight: 800 }}>{org.phone}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
