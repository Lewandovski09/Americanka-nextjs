'use client';

// «До відкриття прийому заявок» — a live countdown (days · hours · minutes
// · seconds; each digit pops when it changes) next to a little beach
// scene: a ball flying back and forth over the net, its shadow running
// on the sand. Shown while applications open later (migration 066).
// `onOpen` — called once when the time comes.

import { useEffect, useRef, useState } from 'react';
import styles from './RegistrationCountdown.module.css';

function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const pad = (n) => String(n).padStart(2, '0');

function Unit({ value, label }) {
  return (
    <div className={styles.unit}>
      <div className={styles.box}>
        {/* a new key on every change replays the pop */}
        <span key={value} className={styles.digits}>
          {value}
        </span>
      </div>
      <div className={styles.unitLabel}>{label}</div>
    </div>
  );
}

export function BeachScene({ className = '' }) {
  return (
    <div className={`${styles.scene} ${className}`} aria-hidden="true">
      <span className={styles.sun} />
      <span className={styles.sea} />
      <span className={styles.sand} />
      <span className={styles.net}>
        <span className={styles.netMesh} />
      </span>
      <span className={styles.shadowTrack}>
        <span className={styles.shadow} />
      </span>
      <span className={styles.ballTrack}>
        <span className={styles.ballLift}>
          <span className={styles.ball} />
        </span>
      </span>
    </div>
  );
}

export default function RegistrationCountdown({ opensAt, compact = false, onOpen }) {
  const target = new Date(opensAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = Number.isNaN(target) ? 0 : target - now;
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      onOpen?.();
    }
  }, [left, onOpen]);

  const { d, h, m, s } = parts(left);
  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`} role="timer" aria-live="off">
      <div className={styles.main}>
        <div className={styles.title}>{left > 0 ? 'До відкриття прийому заявок' : 'Прийом заявок відкрито!'}</div>
        <div className={styles.units}>
          {d > 0 && <Unit value={String(d)} label="дн" />}
          <Unit value={pad(h)} label="год" />
          <Unit value={pad(m)} label="хв" />
          <Unit value={pad(s)} label="сек" />
        </div>
      </div>
      <BeachScene />
    </div>
  );
}
