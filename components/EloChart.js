'use client';

import { useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { IconChartLine, IconX } from '@/components/Icons';
import styles from './EloChart.module.css';

const PERIODS = [
  { key: '1m', label: '1М', months: 1 },
  { key: '2m', label: '2М', months: 2 },
  { key: '3m', label: '3М', months: 3 },
  { key: '6m', label: '6М', months: 6 },
  { key: 'all', label: 'Весь час', months: null },
];

const COLORS = ['var(--rust)', 'var(--navy2)'];

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

// Turns tournament history (each with elo_delta + finished_at) into
// a chronological series of actual ELO values — working backward
// from the current rating, since the RPC only stores deltas.
function buildPoints(history, currentElo) {
  const sorted = (history || [])
    .filter((h) => h.elo_delta !== null && h.elo_delta !== undefined && h.finished_at)
    .slice()
    .sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at));

  const totalDelta = sorted.reduce((s, h) => s + h.elo_delta, 0);
  let running = (currentElo ?? 0) - totalDelta;

  return sorted.map((h) => {
    running += h.elo_delta;
    return { date: new Date(h.finished_at), elo: running, name: h.tournament_name, delta: h.elo_delta };
  });
}

// From the game-by-game Ело log (get_user_elo_log): one point per game,
// using the real rating after it, starting from the rating before the
// first one. This is what «Весь час» draws now — the old per-tournament
// series needed finished tournaments with a stored delta, so a player
// with one tournament (or a running one) got «недостатньо турнірів».
function buildPointsFromLog(log) {
  const rows = (log || [])
    .filter((r) => r.created_at && r.elo_after != null)
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (rows.length === 0) return [];
  const first = rows[0];
  const start =
    first.elo_before != null
      ? [{ date: new Date(new Date(first.created_at).getTime() - 60000), elo: first.elo_before, name: 'Старт', delta: 0 }]
      : [];
  return [
    ...start,
    ...rows.map((r) => ({ date: new Date(r.created_at), elo: r.elo_after, name: r.tournament_name, delta: r.delta })),
  ];
}

// A period keeps the rating it started from: the last point before the
// window is carried to its first edge, so a short period still draws a
// line instead of «недостатньо».
function clipToPeriod(points, months) {
  if (months === null) return points;
  const from = monthsAgo(months);
  const inside = points.filter((p) => p.date >= from);
  const before = points.filter((p) => p.date < from);
  if (before.length > 0) inside.unshift({ ...before[before.length - 1], date: from });
  return inside;
}

function EloSvgChart({ series }) {
  const gradId = useId();
  const width = 320;
  const height = 150;

  const drawable = series.filter((s) => s.points.length >= 2);
  const allPoints = drawable.flatMap((s) => s.points);
  const values = allPoints.map((p) => p.elo);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const pad = Math.max(20, (maxV - minV) * 0.2);
  const yMin = minV - pad;
  const yMax = maxV + pad;

  const dates = allPoints.map((p) => p.date.getTime());
  const minD = Math.min(...dates);
  const maxD = Math.max(...dates);
  const spanD = maxD - minD;

  const xAt = (d) => (spanD === 0 ? width / 2 : ((d.getTime() - minD) / spanD) * width);
  const yAt = (v) => height - ((v - yMin) / (yMax - yMin)) * height;

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--rust)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--rust)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--border-light)" strokeWidth="1" />

        {drawable.map((s, si) => {
          const linePts = s.points.map((p) => `${xAt(p.date)},${yAt(p.elo)}`).join(' ');
          const areaPts = `0,${height} ${linePts} ${width},${height}`;
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.key}>
              {drawable.length === 1 && <polygon points={areaPts} fill={`url(#${gradId})`} />}
              <polyline points={linePts} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {s.points.map((p, i) => (
                <circle
                  key={i}
                  cx={xAt(p.date)}
                  cy={yAt(p.elo)}
                  r={i === s.points.length - 1 ? 4 : 2.5}
                  fill={i === s.points.length - 1 ? s.color : '#fff'}
                  stroke={s.color}
                  strokeWidth="1.5"
                />
              ))}
            </g>
          );
        })}
      </svg>

      <div className={styles.legend}>
        {drawable.map((s) => {
          const first = s.points[0];
          const last = s.points[s.points.length - 1];
          const delta = last.elo - first.elo;
          return (
            <div key={s.key} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: s.color }} />
              <span className={styles.legendName}>{s.label}</span>
              <span className={delta >= 0 ? styles.chartTrendUp : styles.chartTrendDown}>
                {delta >= 0 ? '+' : ''}
                {delta}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Графік Ело" entry row + popup modal with a stock-chart-style
 * line graph, period tabs (1/2/3/6 months, all time), and an
 * optional second line comparing against another player by login.
 */
export default function EloChart({ history, log, currentElo, playerName = 'Ви' }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState('all');
  const [compareLogin, setCompareLogin] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [comparePlayer, setComparePlayer] = useState(null);
  const [compareHistory, setCompareHistory] = useState([]);
  const [compareLog, setCompareLog] = useState([]);

  const periodDef = PERIODS.find((p) => p.key === period);

  // The game log when there is one; tournament totals as the fallback.
  const pointsOf = (gameLog, tHistory, elo) => {
    const fromLog = buildPointsFromLog(gameLog);
    return fromLog.length > 0 ? fromLog : buildPoints(tHistory, elo);
  };
  const mainPoints = clipToPeriod(pointsOf(log, history, currentElo), periodDef.months);
  const comparePoints = comparePlayer
    ? clipToPeriod(pointsOf(compareLog, compareHistory, comparePlayer.elo), periodDef.months)
    : [];

  const series = [{ key: 'me', label: playerName, color: COLORS[0], points: mainPoints }];
  if (comparePlayer) {
    series.push({ key: 'cmp', label: comparePlayer.full_name, color: COLORS[1], points: comparePoints });
  }

  const drawableCount = series.filter((s) => s.points.length >= 2).length;

  async function handleCompare() {
    const login = compareLogin.trim().toLowerCase();
    if (!login) return;
    setCompareError('');
    setCompareLoading(true);
    const supabase = createClient();
    const { data: found } = await supabase.from('users').select('*').eq('login', login).maybeSingle();
    if (!found) {
      setCompareLoading(false);
      setCompareError('Гравця не знайдено');
      return;
    }
    const [{ data: th }, { data: lg }] = await Promise.all([
      supabase.rpc('get_user_tournament_history', { p_user_id: found.id }),
      supabase.rpc('get_user_elo_log', { p_user_id: found.id }),
    ]);
    setComparePlayer(found);
    setCompareHistory(th || []);
    setCompareLog(lg || []);
    setCompareLoading(false);
    setCompareLogin('');
  }

  function clearCompare() {
    setComparePlayer(null);
    setCompareHistory([]);
    setCompareLog([]);
    setCompareError('');
  }

  return (
    <>
      <button className={styles.triggerRow} onClick={() => setOpen(true)}>
        <span className={styles.triggerLeft}>
          <IconChartLine size={16} color="var(--rust)" />
          <span>Графік Ело</span>
        </span>
        <span className={styles.triggerValue}>{currentElo ?? '—'}</span>
      </button>

      {open && (
        <div className={styles.modalOverlay} onClick={() => setOpen(false)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div className={styles.modalTitle}>Графік Ело</div>
              <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Закрити">
                <IconX size={14} color="var(--text2)" />
              </button>
            </div>

            <div className={styles.periodTabs}>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  className={`${styles.periodTab} ${period === p.key ? styles.periodTabOn : ''}`}
                  onClick={() => setPeriod(p.key)}
                  aria-pressed={period === p.key}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {drawableCount === 0 ? (
              <div className={styles.empty}>Ще немає ігор з Ело за цей період</div>
            ) : (
              <EloSvgChart series={series} />
            )}

            <div className={styles.compareRow}>
              {comparePlayer ? (
                <div className={styles.comparePill}>
                  <span className={styles.legendDot} style={{ background: COLORS[1] }} />
                  Порівняння з {comparePlayer.full_name}
                  <button className={styles.compareRemove} onClick={clearCompare} aria-label="Прибрати порівняння">
                    <IconX size={11} />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={styles.compareInput}
                    placeholder="Логін гравця для порівняння..."
                    aria-label="Логін гравця для порівняння"
                    value={compareLogin}
                    onChange={(e) => setCompareLogin(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCompare()}
                  />
                  <button className={styles.compareBtn} disabled={compareLoading} onClick={handleCompare}>
                    {compareLoading ? '...' : 'Додати'}
                  </button>
                </>
              )}
            </div>
            {compareError && <div className={styles.compareError}>{compareError}</div>}
          </div>
        </div>
      )}
    </>
  );
}
