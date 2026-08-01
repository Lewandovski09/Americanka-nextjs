'use client';

// What an event is worth in the season rating. Shared by the three
// places an admin can set it: creating an event, the pre-start settings
// form, and the settings of an event that is already running (the tier
// changes nothing about how the games are played, so it stays editable
// after the start — which is how an event that began before anyone
// decided its tier still gets into the rating).
//
// «Без рейтингу» is a first-class choice and the default: a friendly or
// a practice day should not quietly award points.

import { AVP_TIER_IDS, getTier, tierBreakdown } from '@/lib/avp/tiers';

export default function AvpTierPicker({ value, onChange, styles, disabled }) {
  const tier = getTier(value);
  const breakdown = tierBreakdown(value);

  return (
    <>
      <div className={styles.chipsRow}>
        <button
          type="button"
          className={`${styles.chip} ${!tier ? styles.chipOn : ''}`}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Без рейтингу
        </button>
        {AVP_TIER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`${styles.chip} ${tier?.id === id ? styles.chipOn : ''}`}
            disabled={disabled}
            onClick={() => onChange(id)}
          >
            {id}
          </button>
        ))}
      </div>

      {/* What the choice actually pays, so the tier is picked against
          the field that will play it rather than by its name. */}
      <div className={styles.infoBox}>
        {!tier ? (
          'Подія не входить до сезонного рейтингу AVP — очки не нараховуються.'
        ) : (
          <>
            <b>{tier.label}</b> — очки за місце:{' '}
            {breakdown.map((b, i) => (
              <span key={b.from}>
                {i > 0 ? ' · ' : ''}
                {b.label}: <b>{b.points}</b>
              </span>
            ))}
            . Місця, нижчі за {breakdown[breakdown.length - 1].label}, — 0. Пара отримує очки
            повністю на кожного гравця.
          </>
        )}
      </div>
    </>
  );
}
