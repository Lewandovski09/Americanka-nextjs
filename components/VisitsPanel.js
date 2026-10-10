'use client';

// «Відвідування» — admin → Огляд (migration 073): who opens the app.
// People, not page views: a player counts once a day however many
// times and phones; a logged-out visitor counts by device. Admins are
// left out. Refreshes itself every minute while it's on the screen.

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CLUB_TZ } from '@/lib/dates';
import own from './VisitsPanel.module.css';

const dayLabel = (d, opts) => new Date(`${d}T12:00:00Z`).toLocaleDateString('uk-UA', { timeZone: CLUB_TZ, ...opts });

export default function VisitsPanel({ styles }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [pickDay, setPickDay] = useState(null);
  const [pickHour, setPickHour] = useState(null);

  const load = useCallback(async () => {
    const { data: d, error } = await createClient().rpc('visit_stats', { p_days: 30 });
    if (error) {
      if (/visit_stats|function|schema cache/i.test(error.message || '')) setMissing(true);
      return;
    }
    setData(d);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (missing) {
    return (
      <>
        <div className={styles.sectionLabel}>Відвідування</div>
        <div className={styles.card} style={{ padding: 14, fontSize: 13, color: 'var(--text2)' }}>
          Щоб бачити відвідування, виконайте в Supabase SQL 073 (site_visits).
        </div>
      </>
    );
  }
  if (!data) return null;

  const daily = data.daily || [];
  const hours = data.hours || [];
  const dayMax = Math.max(1, ...daily.map((d) => d.players + d.guests));
  const hourMax = Math.max(1, ...hours);
  const di = pickDay ?? daily.length - 1;
  const sel = daily[di];
  const busiest = hours.reduce((best, v, h) => (v > hours[best] ? h : best), 0);
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;

  return (
    <>
      <div className={styles.sectionLabel}>Відвідування</div>
      <div className={styles.kpiGrid}>
        <div className={`${styles.kpi} ${own.kpiLive}`}>
          <div className={styles.kpiValue}>
            <span className={own.liveDot} aria-hidden="true" />
            {data.online}
          </div>
          <div className={styles.kpiLabel}>Зараз онлайн</div>
          <div className={styles.kpiSub}>за останні 5 хв</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiValue}>{data.today}</div>
          <div className={styles.kpiLabel}>Сьогодні</div>
          <div className={styles.kpiSub}>людей зайшло</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiValue}>{data.week}</div>
          <div className={styles.kpiLabel}>За 7 днів</div>
          <div className={styles.kpiSub}>різних людей</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiValue}>{data.month}</div>
          <div className={styles.kpiLabel}>За 30 днів</div>
          <div className={styles.kpiSub}>з них гравців {data.players_month}</div>
        </div>
      </div>

      <div className={`${styles.card} ${own.card}`}>
        <div className={own.head}>
          <div className={own.title}>По днях · 30 днів</div>
          <div className={own.legend}>
            <span className={own.key}>
              <i className={own.swPlayers} /> гравці
            </span>
            <span className={own.key}>
              <i className={own.swGuests} /> гості
            </span>
          </div>
        </div>
        {sel && (
          <div className={own.readout} aria-live="polite">
            <b>{dayLabel(sel.day, { weekday: 'short', day: 'numeric', month: 'long' })}</b> · {sel.players + sel.guests} (гравців{' '}
            {sel.players}, гостей {sel.guests})
          </div>
        )}
        <div
          className={own.chart}
          role="img"
          aria-label={`Відвідування за 30 днів: сьогодні ${data.today}, за тиждень ${data.week}, за місяць ${data.month}`}
          onMouseLeave={() => setPickDay(null)}
        >
          {daily.map((d, i) => {
            const total = d.players + d.guests;
            return (
              <button
                key={d.day}
                type="button"
                className={`${own.col} ${i === di ? own.colOn : ''}`}
                onMouseEnter={() => setPickDay(i)}
                onClick={() => setPickDay(i)}
                aria-label={`${dayLabel(d.day, { day: 'numeric', month: 'long' })}: ${total}`}
              >
                <span className={own.stack} style={{ height: `${total ? Math.max(4, (total / dayMax) * 100) : 0}%` }}>
                  {d.guests > 0 && <span className={own.segGuests} style={{ flexGrow: d.guests }} />}
                  {d.players > 0 && <span className={own.segPlayers} style={{ flexGrow: d.players }} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className={own.axis}>
          {daily.map((d, i) => (
            <span key={d.day} className={own.tick}>
              {(daily.length - 1 - i) % 7 === 0 ? dayLabel(d.day, { day: 'numeric', month: 'numeric' }) : ''}
            </span>
          ))}
        </div>
      </div>

      <div className={`${styles.card} ${own.card}`}>
        <div className={own.head}>
          <div className={own.title}>Коли заходять · 7 днів</div>
        </div>
        <div className={own.readout} aria-live="polite">
          {pickHour != null ? (
            <>
              <b>
                {hh(pickHour)}–{hh((pickHour + 1) % 24)}
              </b>{' '}
              · {hours[pickHour]} заходів
            </>
          ) : (
            <>
              Найбільше — <b>{hh(busiest)}–{hh((busiest + 1) % 24)}</b> ({hours[busiest]})
            </>
          )}
        </div>
        <div className={`${own.chart} ${own.chartHours}`} role="img" aria-label={`Найбільше заходять о ${hh(busiest)}`} onMouseLeave={() => setPickHour(null)}>
          {hours.map((v, h) => (
            <button
              key={h}
              type="button"
              className={`${own.col} ${h === pickHour ? own.colOn : ''}`}
              onMouseEnter={() => setPickHour(h)}
              onClick={() => setPickHour(h)}
              aria-label={`${hh(h)}: ${v}`}
            >
              <span className={own.stack} style={{ height: `${v ? Math.max(4, (v / hourMax) * 100) : 0}%` }}>
                {v > 0 && <span className={own.segPlayers} style={{ flexGrow: 1 }} />}
              </span>
            </button>
          ))}
        </div>
        <div className={own.axis}>
          {hours.map((_, h) => (
            <span key={h} className={own.tick}>
              {h % 6 === 0 ? hh(h) : ''}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
