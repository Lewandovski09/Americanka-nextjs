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
