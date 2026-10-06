// When a tournament takes applications, and what a player pays — shared
// by the pages, the API routes and the Telegram poster (migration 066).
//
//   registration_opens_at  — the moment applications open; null = at once
//   registration_closes_at — the moment they stop (068); null = when the
//                            admin closes them or starts the tournament
//   schedule_at            — when the schedule will be ready (068), shown
//                            to players; it goes out when the admin starts
//   entry_fee              — UAH per player; 0 = free; null = not set
//                            (tournaments created before 066)

import { CLUB_TZ } from '@/lib/dates';

/**
 * 'closed' — the admin closed it (or the event has started / finished);
 * 'soon'   — applications open at `registration_opens_at`, still ahead;
 * 'open'   — applications are taken now.
 */
export function registrationState(event, now = Date.now()) {
  if (!event) return 'closed';
  if (event.status && event.status !== 'scheduled') return 'closed';
  if (event.registration_open === false) return 'closed';
  const at = event.registration_opens_at ? new Date(event.registration_opens_at).getTime() : NaN;
  if (!Number.isNaN(at) && at > now) return 'soon';
  const until = event.registration_closes_at ? new Date(event.registration_closes_at).getTime() : NaN;
  if (!Number.isNaN(until) && until <= now) return 'closed';
  return 'open';
}

/** Milliseconds until applications close (0 when no closing time / passed). */
export function msUntilClose(event, now = Date.now()) {
  const at = event?.registration_closes_at ? new Date(event.registration_closes_at).getTime() : NaN;
  return Number.isNaN(at) ? 0 : Math.max(0, at - now);
}

/** Milliseconds until applications open (0 when they already are). */
export function msUntilOpen(event, now = Date.now()) {
  const at = event?.registration_opens_at ? new Date(event.registration_opens_at).getTime() : NaN;
  return Number.isNaN(at) ? 0 : Math.max(0, at - now);
}

const parts = (when) => {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('uk', { day: 'numeric', month: 'long', timeZone: CLUB_TZ });
  const time = d.toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit', timeZone: CLUB_TZ });
  return { date, time };
};

/** «10 жовтня о 12:00» — in Kyiv time. */
export function opensLabel(when) {
  const p = parts(when);
  return p ? `${p.date} о ${p.time}` : '';
}

/** «Заявки з 10 жовтня о 12:00» / «Реєстрація відкрита» / «Реєстрацію закрито». */
export function registrationLabel(event, now = Date.now()) {
  const s = registrationState(event, now);
  if (s === 'soon') return `Заявки з ${opensLabel(event.registration_opens_at)}`;
  if (s === 'open') return event.registration_closes_at ? `Заявки до ${opensLabel(event.registration_closes_at)}` : 'Реєстрація відкрита';
  return 'Реєстрацію закрито';
}

/** «300 грн з гравця» / «Безкоштовно» / null (not set). */
export function feeLabel(fee) {
  if (fee == null || fee === '') return null;
  const n = Number(fee);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'Безкоштовно';
  return `${n.toLocaleString('uk').replace(/\s/g, ' ')} грн з гравця`;
}

export const MAX_FEE = 100000;

/**
 * The fee from a form: a whole number of hryvnias, 0…MAX_FEE.
 * `required` — at creation the admin must answer it (0 is an answer).
 * Returns { fee } or { error }.
 */
export function parseEntryFee(value, { required = false } = {}) {
  if (value == null || String(value).trim() === '') {
    return required ? { error: 'Вкажіть внесок з гравця (0 — безкоштовно)' } : { fee: null };
  }
  const s = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.0+)?$/.test(s)) return { error: 'Внесок — ціле число гривень' };
  const n = Math.round(Number(s));
  if (n < 0 || n > MAX_FEE) return { error: `Внесок — від 0 до ${MAX_FEE} грн` };
  return { fee: n };
}

/**
 * The opening moment from a form. Empty → at once (null). A moment that
 * has already passed is «at once» too. It must come before the start.
 * Returns { opensAt: ISO string | null } or { error }.
 */
export function parseRegistrationOpens(value, scheduledAt, now = Date.now()) {
  if (value == null || String(value).trim() === '') return { opensAt: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: 'Невірний час початку прийому заявок' };
  const start = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isNaN(start) && d.getTime() >= start) {
    return { error: 'Прийом заявок має початися раніше за турнір' };
  }
  if (d.getTime() <= now) return { opensAt: null };
  return { opensAt: d.toISOString() };
}

/**
 * The closing moment from a form: after the opening (or now), not after
 * the start. Empty → none. Returns { closesAt } or { error }.
 * @param {any} value
 * @param {{ opensAt?: string | null, scheduledAt?: string | null, now?: number }} [opts]
 * @returns {{ closesAt?: string | null, error?: string }}
 */
export function parseRegistrationCloses(value, { opensAt = null, scheduledAt = null, now = Date.now() } = {}) {
  if (value == null || String(value).trim() === '') return { closesAt: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: 'Невірний час закриття прийому заявок' };
  const from = opensAt ? new Date(opensAt).getTime() : now;
  if (d.getTime() <= from) return { error: 'Прийом заявок має закритися пізніше, ніж відкриється' };
  const start = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isNaN(start) && d.getTime() > start) return { error: 'Прийом заявок має закритися до початку турніру' };
  return { closesAt: d.toISOString() };
}

/**
 * When the schedule will be ready: not after the start. Empty → none.
 * @param {any} value
 * @param {string | null} [scheduledAt]
 * @returns {{ scheduleAt?: string | null, error?: string }}
 */
export function parseScheduleAt(value, scheduledAt = null) {
  if (value == null || String(value).trim() === '') return { scheduleAt: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: 'Невірний час розкладу' };
  const start = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isNaN(start) && d.getTime() > start) return { error: 'Розклад має бути готовий до початку турніру' };
  return { scheduleAt: d.toISOString() };
}
