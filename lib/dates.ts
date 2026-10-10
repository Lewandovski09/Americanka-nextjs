// Dates in the club's own time zone (Odesa / Kyiv). The database keeps
// timestamps in UTC; a day — for a season boundary, «games in one day»,
// a tournament's date — is always the Kyiv day.

export const CLUB_TZ = 'Europe/Kyiv';

/**
 * The calendar day (YYYY-MM-DD) of a moment in Kyiv time. A game at 01:30
 * Kyiv time is 22:30 UTC the day before — slicing the UTC string put it in
 * the previous day. A plain 'YYYY-MM-DD' is returned as it is.
 */
export function kyivDay(when: string | number | Date): string {
  const str = String(when);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return str.slice(0, 10);
  return d.toLocaleDateString('en-CA', { timeZone: CLUB_TZ });
}

// ── Clock time in Kyiv, whatever the phone's own time zone ──
// A player whose phone is set to another zone (a VPN, a trip, a manual
// setting) used to see the schedule shifted — 01:15 instead of 11:15.
// Everything the app shows is Kyiv time, like the beach clock.

function kyivParts(d: Date): { y: number; mo: number; day: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLUB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n('year'), mo: n('month'), day: n('day'), h: n('hour'), mi: n('minute') };
}

/** «11:15» — the moment's clock time in Kyiv. */
export function kyivTime(when: string | number | Date): string {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  const { h, mi } = kyivParts(d);
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** The moment that is h:mi Kyiv time on the Kyiv day of `base`. */
export function atKyivTime(base: string | number | Date, h: number, mi: number): Date {
  const b = new Date(base);
  const { y, mo, day } = kyivParts(b);
  // first guess as if Kyiv were UTC, then correct by the zone's offset at that moment
  const guess = Date.UTC(y, mo - 1, day, h, mi);
  const p = kyivParts(new Date(guess));
  const offset = Date.UTC(p.y, p.mo - 1, p.day, p.h, p.mi) - guess;
  return new Date(guess - offset);
}

/** «2026-10-10T11:15» for a datetime-local input — Kyiv time. */
export function toKyivInput(when: string | number | Date | null | undefined): string {
  if (!when) return '';
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  const { y, mo, day, h, mi } = kyivParts(d);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(day)}T${pad(h)}:${pad(mi)}`;
}

/** A datetime-local input's «2026-10-10T11:15», read as Kyiv time → ISO string (or '' when empty / invalid). */
export function fromKyivInput(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!m) return '';
  const [, y, mo, day, h, mi] = m.map(Number);
  const base = new Date(Date.UTC(y, mo - 1, day, 12)); // noon UTC is the same Kyiv day
  return atKyivTime(base, h, mi).toISOString();
}
