// Who to ask about a tournament — printed on the poster and in the
// Telegram announcement (lib/eventPoster, lib/server/eventAnnouncement).
//
// Telegram: the tournament creator's own @username from their profile
// (filled when they joined through the bot), unless ORGANIZER_TELEGRAM is
// set in Vercel. Phone: ORGANIZER_PHONE in Vercel, else the club's number.

export const DEFAULT_ORGANIZER_PHONE = '0671874410';

/** «0671874410» → «067 187 44 10» (a Ukrainian mobile number, as people write it). */
export function formatPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const local = d.length === 12 && d.startsWith('380') ? `0${d.slice(3)}` : d;
  if (local.length !== 10) return String(raw || '').trim() || null;
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8)}`;
}

/** «@name» from «name», «@name» or «https://t.me/name»; null when empty. */
export function formatTelegram(raw) {
  const s = String(raw || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@+/, '');
  return /^[A-Za-z0-9_]{3,32}$/.test(s) ? `@${s}` : null;
}

/** { telegram: '@name' | null, phone: '067 187 44 10' | null } */
export function organizerContacts(creatorTelegram) {
  const env = typeof process !== 'undefined' ? process.env || {} : {};
  return {
    telegram: formatTelegram(env.ORGANIZER_TELEGRAM) || formatTelegram(creatorTelegram),
    phone: formatPhone(env.ORGANIZER_PHONE || DEFAULT_ORGANIZER_PHONE),
  };
}
