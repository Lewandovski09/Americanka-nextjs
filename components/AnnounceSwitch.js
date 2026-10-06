'use client';

// The «Оголосити в Telegram» switch on the tournament creation form.

import styles from './Announce.module.css';

export default function AnnounceSwitch({ checked, onChange, disabled, sub }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`${styles.switchRow} ${checked ? styles.on : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchText}>
        <span className={styles.switchTitle}>📣 Оголосити в Telegram</span>
        <span className={styles.switchSub}>
          {sub || 'Афіша турніру піде в канал і всім гравцям у бот, з кнопкою «Записатися»'}
        </span>
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </button>
  );
}
