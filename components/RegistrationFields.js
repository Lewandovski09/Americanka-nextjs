'use client';

// «Внесок з гравця», «Прийом заявок» (from / until) and «Розклад буде» —
// on the tournament creation form and in the settings of a tournament
// that hasn't started (migrations 066, 068).
// Takes the form's own CSS module (create.module.css), like OptionBtn.

import OptionBtn from '@/components/OptionBtn';
import { feeLabel, opensLabel } from '@/lib/registrationWindow';
import { fromKyivInput, toKyivInput } from '@/lib/dates';

/** «2026-10-07T12:00» for a datetime-local input — Kyiv time, whatever the phone's zone. */
export function toLocalInput(iso) {
  return toKyivInput(iso);
}

export default function RegistrationFields({
  styles,
  fee,
  onFee,
  opensMode,
  onOpensMode,
  opensAt,
  onOpensAt,
  closesAt = '',
  onClosesAt,
  scheduleAt = '',
  onScheduleAt,
}) {
  const shownFee = feeLabel(fee === '' ? null : fee);
  const later = opensMode === 'later';
  const opensText = later && opensAt ? opensLabel(new Date(fromKyivInput(opensAt))) : '';
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

      {onClosesAt && (
        <>
          <label className={styles.label} htmlFor="reg-closes">
            Прийом заявок до
          </label>
          <div className={styles.inlineField}>
            <input
              id="reg-closes"
              className={styles.input}
              type="datetime-local"
              value={closesAt}
              onChange={(e) => onClosesAt(e.target.value)}
            />
            {closesAt && (
              <button type="button" className={styles.clearBtn} onClick={() => onClosesAt('')} aria-label="Прибрати час закриття">
                ✕
              </button>
            )}
          </div>
          <div className={styles.fieldNote}>
            {closesAt
              ? `${opensLabel(new Date(fromKyivInput(closesAt)))} заявки перестануть прийматися самі; до того гравці бачать відлік.`
              : 'Не вказано — заявки приймаються, доки ви не закриєте їх або не запустите турнір.'}
          </div>
        </>
      )}

      {onScheduleAt && (
        <>
          <label className={styles.label} htmlFor="schedule-at">
            Розклад буде
          </label>
          <div className={styles.inlineField}>
            <input
              id="schedule-at"
              className={styles.input}
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => onScheduleAt(e.target.value)}
            />
            {scheduleAt && (
              <button type="button" className={styles.clearBtn} onClick={() => onScheduleAt('')} aria-label="Прибрати час розкладу">
                ✕
              </button>
            )}
          </div>
          <div className={styles.fieldNote}>
            {scheduleAt
              ? `На афіші: «Розклад — ${opensLabel(new Date(fromKyivInput(scheduleAt)))}». Сам розклад піде в канал і учасникам у бот, коли ви запустите турнір.`
              : 'Не обовʼязково. Розклад піде в канал і учасникам у бот, коли ви запустите турнір.'}
          </div>
        </>
      )}
    </>
  );
}
