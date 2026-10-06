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

// «🧪 Тестовий турнір» (migration 070) — nothing about it goes to Telegram.
export function TestEventSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`${styles.switchRow} ${styles.testRow} ${checked ? `${styles.on} ${styles.testOn}` : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchText}>
        <span className={styles.switchTitle}>🧪 Тестовий турнір</span>
        <span className={styles.switchSub}>
          {checked
            ? 'Увімкнено: жодного повідомлення в Telegram-канал чи бот — ні афіші, ні «Заявки приймаються», ні розкладу, ні запрошень.'
            : 'Увімкніть, щоб перевірити турнір без жодних повідомлень у Telegram.'}
        </span>
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </button>
  );
}
