'use client';

// «Ело» on the profile, drawn right on the page (no extra tap): the
// rating in big, its change over the chosen period, the peak, and the
// line itself — one point per game (get_user_elo_log). Sliding a finger
// along the line shows the rating after each game. Periods: 1М · 3М ·
// Сезон · Все; ⇄ adds a second line for another player by login.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { buildPoints, buildPointsFromLog } from '@/lib/eloSeries';
import { IconX } from '@/components/Icons';
import styles from './EloTrend.module.css';

const W = 330;
const H = 96;

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

const dayLabel = (d) => d.toLocaleDateString('uk', { day: 'numeric', month: 'short' });

// Points inside [from, to]; the last point before the window is carried to
// its left edge, so the line starts from the rating the period began with.
function clip(points, from, to) {
  if (!from && !to) return points;
  const inside = points.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  const before = from ? points.filter((p) => p.date < from) : [];
  if (before.length > 0) inside.unshift({ ...before[before.length - 1], date: from, carried: true });
  return inside;
}

function seriesFor(log, history, elo) {
  const fromLog = buildPointsFromLog(log);
  return fromLog.length > 0 ? fromLog : buildPoints(history, elo);
}

export default function EloTrend({ log, history, currentElo, season, playerName = 'Ви' }) {
  const periods = [
    { key: '1m', label: '1М' },
    { key: '3m', label: '3М' },
    ...(season ? [{ key: 'season', label: 'Сезон' }] : []),
    { key: 'all', label: 'Все' },
  ];
  const [period, setPeriod] = useState(season ? 'season' : 'all');
  useEffect(() => setPeriod(season ? 'season' : 'all'), [season?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [hover, setHover] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [login, setLogin] = useState('');
  const [cmp, setCmp] = useState(null); // { player, log, history }
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpError, setCmpError] = useState('');
  const svgRef = useRef(null);

  const range = useMemo(() => {
    if (period === '1m') return [monthsAgo(1), null];
    if (period === '3m') return [monthsAgo(3), null];
    if (period === 'season' && season) {
      return [new Date(`${season.starts_on}T00:00:00`), season.ends_on ? new Date(`${season.ends_on}T23:59:59`) : null];
    }
    return [null, null];
  }, [period, season]);

  const all = useMemo(() => seriesFor(log, history, currentElo), [log, history, currentElo]);
  const pts = clip(all, range[0], range[1]);
  const cmpPts = cmp ? clip(seriesFor(cmp.log, cmp.history, cmp.player.elo), range[0], range[1]) : [];

  const games = (log || []).filter((r) => {
    if (!r.match_id || !r.created_at) return false;
    const d = new Date(r.created_at);
    return (!range[0] || d >= range[0]) && (!range[1] || d <= range[1]);
  }).length;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const shownElo = period === 'all' || !range[1] ? currentElo ?? last?.elo : last?.elo;
  const delta = first && last ? last.elo - first.elo : 0;
  const peak = pts.reduce((b, p) => (!b || p.elo > b.elo ? p : b), null);
  const periodWord = period === 'season' ? 'за сезон' : period === 'all' ? 'за весь час' : period === '1m' ? 'за місяць' : 'за 3 місяці';

  // Scales over both lines, so a comparison shares one axis.
  const both = [...pts, ...cmpPts];
  const drawable = pts.length >= 2;
  let x = () => 0;
  let y = () => 0;
  if (both.length > 0) {
    const vals = both.map((p) => p.elo);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(10, (hi - lo) * 0.15);
    // Evenly spaced by game, not by date: a tournament day holds many
    // games, and on a time axis they would stack into a vertical jump.
    const idx = new Map();
    [pts, cmpPts].forEach((list) => list.forEach((p, i) => idx.set(p, list.length > 1 ? (i / (list.length - 1)) * W : W / 2)));
    x = (p) => idx.get(p) ?? 0;
    y = (p) => H - ((p.elo - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  }
  const line = (list) => list.map((p) => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');

  function onMove(e) {
    if (!drawable || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(x(p) - px) < Math.abs(x(pts[best]) - px)) best = i;
    });
    setHover(best);
  }

  const focus = hover != null && pts[hover] ? pts[hover] : last;
  const focusIdx = hover != null ? hover : pts.length - 1;
  const focusDelta = focus && !focus.carried && focus.delta ? focus.delta : null;

  async function compare() {
    const l = login.trim().toLowerCase();
    if (!l) return;
    setCmpBusy(true);
    setCmpError('');
    const supabase = createClient();
    const { data: found } = await supabase.from('users').select('id, full_name, elo').eq('login', l).maybeSingle();
    if (!found) {
      setCmpBusy(false);
      setCmpError('Гравця не знайдено');
      return;
    }
    const [{ data: th }, { data: lg }] = await Promise.all([
      supabase.rpc('get_user_tournament_history', { p_user_id: found.id }),
      supabase.rpc('get_user_elo_log', { p_user_id: found.id }),
    ]);
    setCmp({ player: found, history: th || [], log: lg || [] });
    setCmpBusy(false);
    setLogin('');
  }

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.label}>Ело{season && period === 'season' ? ` · ${season.name}` : ''}</span>
        {drawable && delta !== 0 && (
          <span className={delta > 0 ? styles.up : styles.down}>
            {delta > 0 ? '▲ +' : '▼ '}
            {delta} {periodWord}
          </span>
        )}
      </div>
      <div className={styles.bigRow}>
        <span className={styles.big}>{shownElo ?? '—'}</span>
        {peak && (
          <span className={styles.meta}>
            пік {peak.elo} · {dayLabel(peak.date)}
            {games > 0 ? ` · ${games} ${games === 1 ? 'гра' : games < 5 ? 'гри' : 'ігор'}` : ''}
          </span>
        )}
      </div>

      {drawable ? (
        <>
          <div className={styles.plot}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className={styles.svg}
            preserveAspectRatio="none"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="eloTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e85d4a" stopOpacity="0.25" />
                <stop offset="1" stopColor="#e85d4a" stopOpacity="0" />
              </linearGradient>
            </defs>
            {!cmp && <polygon points={`0,${H} ${line(pts)} ${W},${H}`} fill="url(#eloTrendFill)" />}
            {cmpPts.length >= 2 && (
              <polyline points={line(cmpPts)} fill="none" stroke="var(--navy2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            )}
            <polyline points={line(pts)} fill="none" stroke="#e85d4a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {focus && (
              <line x1={x(focus)} y1="0" x2={x(focus)} y2={H} stroke="#101b33" strokeOpacity="0.25" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {focus && (
            <span
              className={styles.dot}
              style={{ left: `${(x(focus) / W) * 100}%`, top: `${(y(focus) / H) * 96}px` }}
              aria-hidden="true"
            />
          )}
          </div>
          <div className={styles.caption}>
            {focusIdx === pts.length - 1 && hover == null ? 'Остання гра · ' : ''}
            {dayLabel(focus.date)}
            {focus.name && !focus.carried && focus.name !== 'Старт' ? ` · ${focus.name}` : ''} · <b>{focus.elo}</b>
            {focusDelta != null && (
              <span className={focusDelta >= 0 ? styles.plus : styles.minus}>
                {' '}
                {focusDelta >= 0 ? '+' : ''}
                {focusDelta}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className={styles.empty}>Ще немає ігор з Ело за цей період</div>
      )}

      {cmp && (
        <div className={styles.legend}>
          <span className={styles.lgMe}>{playerName}</span>
          <span className={styles.lgCmp}>{cmp.player.full_name}</span>
          <button type="button" className={styles.lgX} onClick={() => setCmp(null)} aria-label="Прибрати порівняння">
            <IconX size={11} />
          </button>
        </div>
      )}

      <div className={styles.chips}>
        {periods.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${styles.chip} ${period === p.key ? styles.chipOn : ''}`}
            onClick={() => {
              setPeriod(p.key);
              setHover(null);
            }}
            aria-pressed={period === p.key}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.chip} ${compareOpen || cmp ? styles.chipOn : ''}`}
          onClick={() => setCompareOpen((o) => !o)}
          aria-label="Порівняти з іншим гравцем"
          title="Порівняти з іншим гравцем"
        >
          ⇄
        </button>
      </div>

      {compareOpen && !cmp && (
        <div className={styles.cmpRow}>
          <input
            className={styles.cmpInput}
            placeholder="Логін гравця для порівняння…"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && compare()}
            aria-label="Логін гравця для порівняння"
          />
          <button type="button" className={styles.cmpBtn} onClick={compare} disabled={cmpBusy}>
            {cmpBusy ? '…' : 'Додати'}
          </button>
        </div>
      )}
      {cmpError && <div className={styles.cmpError}>{cmpError}</div>}
    </section>
  );
}
