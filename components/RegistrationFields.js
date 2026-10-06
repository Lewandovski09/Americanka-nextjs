'use client';

// «Внесок з гравця» and «Прийом заявок» — on the tournament creation form
// and in the settings of a tournament that hasn't started (migration 066).
// Takes the form's own CSS module (create.module.css), like OptionBtn.

import OptionBtn from '@/components/OptionBtn';
import { feeLabel, opensLabel } from '@/lib/registrationWindow';

/** «2026-10-07T12:00» for a datetime-local input, in the device's time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RegistrationFields({ styles, fee, onFee, opensMode, onOpensMode, opensAt, onOpensAt }) {
  const shownFee = feeLabel(fee === '' ? null : fee);
  const later = opensMode === 'later';
  const opensText = later && opensAt ? opensLabel(new Date(opensAt)) : '';
  return (
    <>
      <label className={styles.label} htmlFor="entry-fee">
        Внесок з гравця, грн
      </label>
      <input
        id="entry-fee"
        className={styles.input}
        type="text"
        inputMode="numeric"
        value={fee}
        placeholder="Напр. 300 · 0 — безкоштовно"
        onChange={(e) => onFee(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
      />
      {shownFee && <div className={styles.fieldNote}>На афіші: «{shownFee}»</div>}

      <label className={styles.label}>Прийом заявок</label>
      <div className={styles.row}>
        <OptionBtn styles={styles} active={!later} onClick={() => onOpensMode('now')}>
          Одразу
        </OptionBtn>
        <OptionBtn styles={styles} active={later} onClick={() => onOpensMode('later')}>
          З обраного часу
        </OptionBtn>
      </div>
      {later && (
        <>
          <input
            className={styles.input}
            type="datetime-local"
            value={opensAt}
            aria-label="Початок прийому заявок"
            onChange={(e) => onOpensAt(e.target.value)}
          />
          <div className={styles.fieldNote}>
            {opensText
              ? `До ${opensText} гравці бачать турнір, але заявку подати не можуть.`
              : 'Виберіть день і час, коли відкриється прийом заявок.'}
          </div>
        </>
      )}
    </>
  );
}
