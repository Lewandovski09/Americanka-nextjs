// The tournament poster (афіша) — the picture of the Telegram
// announcement (lib/server/eventAnnouncement): everything a player needs
// on one 1080×1350 picture — the logo, format and name, day and time,
// «Локація», the leagues with their places, how games are scored, the
// entry fee, when applications open and whom to ask.
//
// Drawn by next/og (app/api/og/poster/[eventId]) with Satori, which knows
// only part of CSS: every element with more than one child is
// display:flex, sizes are plain pixels, no classes or CSS variables, no
// emoji (the font has none) — the marks are drawn shapes.

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

const C = {
  navy: '#0d2347',
  navy2: '#16306b',
  blue: '#2a4d94',
  coral: '#f04e36',
  coralSoft: '#ffb39f',
  white: '#ffffff',
  mute: 'rgba(255,255,255,0.72)',
  line: 'rgba(255,255,255,0.16)',
  card: 'rgba(255,255,255,0.08)',
  green: '#22c55e',
};

const row = (extra = {}) => ({ display: 'flex', flexDirection: 'row', alignItems: 'center', ...extra });
const col = (extra = {}) => ({ display: 'flex', flexDirection: 'column', ...extra });

function Pill({ children, bg = 'rgba(255,255,255,0.12)', color = C.white, border = C.line }) {
  return (
    <div
      style={row({
        height: 52,
        padding: '0 24px',
        borderRadius: 26,
        background: bg,
        border: `2px solid ${border}`,
        color,
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: 1,
      })}
    >
      {children}
    </div>
  );
}

function GenderMark({ gender, mixed }) {
  if (!gender && !mixed) return null;
  const f = gender === 'F';
  if (!gender) {
    return (
      <div
        style={row({
          justifyContent: 'center',
          width: 52,
          height: 52,
          borderRadius: 14,
          marginRight: 20,
          background: '#8fb0ff',
          color: C.navy,
          fontSize: 20,
          fontWeight: 800,
        })}
      >
        ЧЖ
      </div>
    );
  }
  return (
    <div
      style={row({
        justifyContent: 'center',
        width: 52,
        height: 52,
        borderRadius: 14,
        marginRight: 20,
        background: f ? C.coral : C.white,
        color: f ? C.white : C.navy,
        fontSize: 26,
        fontWeight: 800,
      })}
    >
      {f ? 'Ж' : 'Ч'}
    </div>
  );
}

function TelegramIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="24" fill="#29a9eb" />
      <path d="M11 23.5 L35 14 L31 34 L24 28.5 L20.5 32 L20 26.5 L31 17.5 L18 25.5 Z" fill="#ffffff" />
    </svg>
  );
}

function PhoneIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="24" fill="#22c55e" />
      <path
        d="M17.5 13 C16 13 14 15 14 17 C14 26 22 34 31 34 C33 34 35 32 35 30.5 L35 28 L29.5 25.5 L27 28 C24 26.5 21.5 24 20 21 L22.5 18.5 L20 13 Z"
        fill="#ffffff"
      />
    </svg>
  );
}

function CategoryLine({ c, height, last, compact }) {
  const places = c.places || `${c.total} ${c.unit}`;
  const left = c.taken > 0 ? (c.left > 0 ? `вільно ${c.left}` : 'місць немає') : null;
  const tags = [c.bracketLabel, c.avpTier ? `AVP ${c.avpTier}` : null].filter(Boolean).join(' · ');
  return (
    <div
      style={row({
        height,
        borderBottom: last ? 'none' : `2px solid ${C.line}`,
      })}
    >
      <GenderMark gender={c.gender} mixed={c.genderLabel === 'Мікс'} />
      {compact ? (
        <div style={row({ flexGrow: 1 })}>
          <div style={{ display: 'flex', fontSize: 32, fontWeight: 800, color: C.white }}>{c.label}</div>
          {tags ? <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: C.mute, marginLeft: 14 }}>{tags}</div> : null}
        </div>
      ) : (
        <div style={col({ flexGrow: 1, justifyContent: 'center' })}>
          <div style={{ display: 'flex', fontSize: 36, fontWeight: 800, color: C.white }}>{c.label}</div>
          {tags ? <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: C.mute, marginTop: 2 }}>{tags}</div> : null}
        </div>
      )}
      <div style={compact ? row({}) : col({ alignItems: 'flex-end', justifyContent: 'center' })}>
        {left && compact ? (
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: C.coralSoft, marginRight: 14 }}>{left}</div>
        ) : null}
        <div style={{ display: 'flex', fontSize: compact ? 28 : 30, fontWeight: 700, color: C.white }}>{places}</div>
        {left && !compact ? (
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: C.coralSoft, marginTop: 2 }}>{left}</div>
        ) : null}
      </div>
    </div>
  );
}

/** The poster's root element. `data` — lib/server/eventCardData; `logo` — a data: URL. */
export function EventPoster({ data, logo }) {
  const cats = data.categories || [];
  // Room for the leagues depends on whether there is a custom name. Many
  // leagues → one-line rows; more than fit → «+ ще N».
  const room = data.name ? 380 : 440;
  const MIN_H = 58;
  let shownCount = Math.min(cats.length, Math.floor(room / MIN_H));
  if (shownCount < cats.length) shownCount = Math.floor((room - 40) / MIN_H);
  const shown = cats.slice(0, shownCount);
  const more = cats.length - shown.length;
  const lineH = Math.min(96, Math.floor((room - (more > 0 ? 40 : 0)) / Math.max(1, shown.length)));
  const compact = lineH < 80;

  const dp = data.dateParts || {};
  const place = [data.venue, data.city].filter(Boolean).join(', ');
  const soon = data.regState === 'soon';
  const closed = data.regState === 'closed';
  const op = data.opensParts;
  const regKind = data.isPair ? 'Реєстрація парами' : 'Індивідуальна реєстрація';
  const org = data.organizer || {};

  return (
    <div
      style={col({
        position: 'relative',
        width: POSTER_WIDTH,
        height: POSTER_HEIGHT,
        padding: '60px 64px 48px',
        background: `linear-gradient(160deg, ${C.navy} 0%, ${C.navy2} 55%, ${C.blue} 100%)`,
        color: C.white,
        fontFamily: 'Inter',
        overflow: 'hidden',
      })}
    >
      {/* decoration: a big ball-like circle and a coral glow */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: -220,
          right: -220,
          width: 640,
          height: 640,
          borderRadius: 320,
          border: '40px solid rgba(255,255,255,0.05)',
        }}
      />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: -300,
          left: -200,
          width: 760,
          height: 760,
          borderRadius: 380,
          background: 'radial-gradient(circle, rgba(240,78,54,0.28) 0%, rgba(240,78,54,0) 65%)',
        }}
      />

      {/* top line */}
      <div style={row({ justifyContent: 'space-between', height: 72 })}>
        <div style={row({ gap: 18 })}>
          {logo ? <img src={logo} alt="" width={72} height={72} style={{ borderRadius: 20, border: `2px solid ${C.line}` }} /> : null}
          <Pill>AMERICANKA · ПЛЯЖНИЙ ВОЛЕЙБОЛ</Pill>
        </div>
        {data.avpTier ? (
          <Pill bg={C.white} color={C.navy} border={C.white}>{`AVP ${data.avpTier}`}</Pill>
        ) : null}
      </div>

      {/* title */}
      <div style={{ display: 'flex', marginTop: 36, fontSize: 104, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
        {data.title}
      </div>
      {data.name ? (
        <div style={{ display: 'flex', marginTop: 4, fontSize: 44, fontWeight: 600, color: C.mute }}>{data.name}</div>
      ) : null}

      {/* when and where */}
      <div
        style={row({
          marginTop: 36,
          height: 168,
          borderRadius: 32,
          background: C.white,
          color: C.navy,
          padding: '0 36px',
        })}
      >
        <div style={col({ alignItems: 'center', justifyContent: 'center', width: 150 })}>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, lineHeight: 1, color: C.coral }}>{dp.day || ''}</div>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, marginTop: 4 }}>{dp.month || ''}</div>
        </div>
        <div style={{ display: 'flex', width: 2, height: 104, background: '#d3dbe9', margin: '0 32px' }} />
        <div style={col({ justifyContent: 'center', flexGrow: 1 })}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: '#5a6476' }}>
            {(dp.weekday || '').charAt(0).toUpperCase() + (dp.weekday || '').slice(1)}
          </div>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>{dp.time || ''}</div>
          <div style={row({ marginTop: 2, gap: 10 })}>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 600, color: '#5a6476' }}>Локація:</div>
            <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: '#34486e' }}>{place}</div>
          </div>
        </div>
      </div>

      {/* how it is played */}
      <div style={row({ marginTop: 24, gap: 14 })}>
        {data.scoring ? <Pill>{data.scoring}</Pill> : null}
        <Pill>{regKind}</Pill>
      </div>

      {/* leagues */}
      <div
        style={col({
          marginTop: 24,
          padding: '18px 32px 10px',
          borderRadius: 32,
          background: C.card,
          border: `2px solid ${C.line}`,
        })}
      >
        <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, letterSpacing: 4, color: C.mute, marginBottom: 4 }}>
          КАТЕГОРІЇ
        </div>
        {shown.map((c, i) => (
          <CategoryLine key={c.id} c={c} height={lineH} compact={compact} last={i === shown.length - 1 && more <= 0} />
        ))}
        {more > 0 ? (
          <div style={row({ height: 40, fontSize: 24, fontWeight: 700, color: C.mute })}>{`+ ще ${more}`}</div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexGrow: 1 }} />

      {/* fee + applications */}
      <div style={row({ gap: 18, height: 128, alignItems: 'stretch' })}>
        <div
          style={col({
            justifyContent: 'center',
            width: 400,
            padding: '0 30px',
            borderRadius: 28,
            background: C.coral,
          })}
        >
          <div style={{ display: 'flex', fontSize: 19, fontWeight: 800, letterSpacing: 3, color: 'rgba(255,255,255,0.85)' }}>ВНЕСОК</div>
          {data.fee == null ? (
            <div style={{ display: 'flex', fontSize: 32, fontWeight: 800, marginTop: 4 }}>уточнюйте</div>
          ) : data.fee === 0 ? (
            <div style={{ display: 'flex', fontSize: 36, fontWeight: 800, marginTop: 4 }}>Безкоштовно</div>
          ) : (
            <div style={row({ alignItems: 'flex-end', marginTop: 4 })}>
              <div style={{ display: 'flex', fontSize: 60, fontWeight: 800, lineHeight: 1 }}>{String(data.fee)}</div>
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, marginLeft: 10, marginBottom: 4 }}>грн</div>
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, marginLeft: 10, marginBottom: 7, color: 'rgba(255,255,255,0.9)' }}>з гравця</div>
            </div>
          )}
        </div>
        <div
          style={col({
            justifyContent: 'center',
            flexGrow: 1,
            padding: '0 30px',
            borderRadius: 28,
            background: C.white,
            color: C.navy,
          })}
        >
          <div style={{ display: 'flex', fontSize: 19, fontWeight: 800, letterSpacing: 3, color: '#5a6476' }}>ПРИЙОМ ЗАЯВОК</div>
          {soon && op ? (
            <div style={row({ marginTop: 4, alignItems: 'flex-end', gap: 12 })}>
              <div style={{ display: 'flex', fontSize: 38, fontWeight: 800, lineHeight: 1.1 }}>{`з ${op.day} ${op.month}`}</div>
              <div style={{ display: 'flex', fontSize: 32, fontWeight: 800, color: C.coral }}>{`о ${op.time}`}</div>
            </div>
          ) : closed ? (
            <div style={{ display: 'flex', fontSize: 36, fontWeight: 800, marginTop: 4 }}>закрито</div>
          ) : (
            <div style={row({ marginTop: 4 })}>
              <div style={{ display: 'flex', width: 20, height: 20, borderRadius: 10, background: C.green, marginRight: 12 }} />
              <div style={{ display: 'flex', fontSize: 38, fontWeight: 800 }}>відкрито</div>
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: '#34486e', marginLeft: 14, marginTop: 6 }}>записуйтесь зараз</div>
            </div>
          )}
        </div>
      </div>

      <div style={row({ justifyContent: 'space-between', height: 44, marginTop: 18 })}>
        <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, color: C.mute }}>Записатися — у застосунку Americanka</div>
        {org.telegram || org.phone ? (
          <div style={row({ gap: 16 })}>
            <div style={{ display: 'flex', fontSize: 16, fontWeight: 600, color: C.mute }}>Питання:</div>
            {org.telegram ? (
              <div style={row({ gap: 7 })}>
                <TelegramIcon />
                <div style={{ display: 'flex', fontSize: 18, fontWeight: 700, color: C.white }}>{org.telegram}</div>
              </div>
            ) : null}
            {org.phone ? (
              <div style={row({ gap: 7 })}>
                <PhoneIcon />
                <div style={{ display: 'flex', fontSize: 18, fontWeight: 700, color: C.white }}>{org.phone}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
