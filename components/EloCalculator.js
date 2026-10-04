'use client';

// «Калькулятор Ело» — the simple one: one slider for the average Ело of
// the opposing pair, and three numbers under it — the chance to win,
// what a win brings and what a loss costs. The payout is the real one
// (lib/elo eloForecast — same K and pair split as an actual Americanka
// game, for a partner of about the same level).

import { useState } from 'react';
import { eloForecast } from '@/lib/elo';
import { IconInfo } from '@/components/Icons';
import styles from './EloCalculator.module.css';

export default function EloCalculator({ elo, onInfo }) {
  const mine = elo || 1200;
  const [opp, setOpp] = useState(Math.min(2000, Math.max(800, Math.round(mine / 10) * 10)));
  const f = eloForecast(mine, opp);
  const pct = ((opp - 800) / 1200) * 100;

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.label}>Калькулятор Ело</span>
        {onInfo && (
          <button type="button" className={styles.info} onClick={onInfo} aria-label="Як користуватись">
            <IconInfo size={15} color="var(--text2)" />
          </button>
        )}
      </div>
      <div className={styles.sliderHead}>
        <span>Середнє Ело суперників</span>
        <b>{opp}</b>
      </div>
      <input
        type="range"
        min={800}
        max={2000}
        step={10}
        value={opp}
        onChange={(e) => setOpp(Number(e.target.value))}
        className={styles.slider}
        style={{ '--fill': `${pct}%` }}
        aria-label="Середнє Ело суперників"
      />
      <div className={styles.res}>
        <div>
          <b className={styles.chance}>{Math.round(f.chance * 100)}%</b>шанс
        </div>
        <div>
          <b className={styles.win}>+{f.win}</b>перемога
        </div>
        <div>
          <b className={styles.loss}>{f.loss}</b>поразка
        </div>
      </div>
    </section>
  );
}
