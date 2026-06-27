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
export default function EloChart({ history, currentElo, playerName = 'Ви' }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState('all');
  const [compareLogin, setCompareLogin] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [comparePlayer, setComparePlayer] = useState(null);
  const [compareHistory, setCompareHistory] = useState([]);

  const periodDef = PERIODS.find((p) => p.key === period);

  function inPeriod(points) {
    return periodDef.months === null ? points : points.filter((p) => p.date >= monthsAgo(periodDef.months));
  }

  const mainPoints = inPeriod(buildPoints(history, currentElo));
  const comparePoints = comparePlayer ? inPeriod(buildPoints(compareHistory, comparePlayer.elo)) : [];

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
    const { data: found } = await supabase.from('players').select('*').eq('login', login).maybeSingle();
    if (!found) {
      setCompareLoading(false);
      setCompareError('Гравця не знайдено');
      return;
    }
    const { data: th } = await supabase.rpc('get_player_tournament_history', { p_player_id: found.id });
    setComparePlayer(found);
    setCompareHistory(th || []);
    setCompareLoading(false);
    setCompareLogin('');
  }

  function clearCompare() {
    setComparePlayer(null);
    setCompareHistory([]);
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
                >
                  {p.label}
                </button>
              ))}
            </div>

            {drawableCount === 0 ? (
              <div className={styles.empty}>Недостатньо турнірів за цей період</div>
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
