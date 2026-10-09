// Small copies of the photos in Supabase Storage (bucket player-photos).
//
// Vercel's image optimization is off (next.config.js — its free quota
// paused the site), so instead every photo gets ready-made small copies
// next to it, made once when it's uploaded (lib/server/thumbs):
//   sm — 128×128 WebP, ~5 KB: avatars (shown at 22–44 px)
//   md — 800 px wide WebP, ~60 KB: tournament photos in cards and lists
// They live in thumbs/ with the original's name:
//   player-photos/<id>.jpeg        → player-photos/thumbs/<id>.sm.webp
//   player-photos/events/<id>.jpg  → player-photos/thumbs/events/<id>.md.webp
// The original's ?t= cache-buster is kept, so a new upload is never
// hidden behind an old cached copy. Pure (see thumbs.test).

export const THUMB_KINDS = {
  sm: { width: 128, height: 128, fit: 'cover', quality: 72 },
  md: { width: 800, height: null, fit: 'inside', quality: 74 },
};

const MARK = '/storage/v1/object/public/player-photos/';

/**
 * The storage path of a photo URL in player-photos, or null.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function photoPath(url) {
  if (!url || typeof url !== 'string') return null;
  const i = url.indexOf(MARK);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + MARK.length).split('?')[0].split('#')[0]);
  if (!path || path.startsWith('thumbs/')) return null;
  return path;
}

/**
 * Where a small copy of `path` is kept.
 * @param {string} path
 * @param {'sm' | 'md'} kind
 */
export function thumbPath(path, kind) {
  return `thumbs/${path.replace(/\.[a-z0-9]+$/i, '')}.${kind}.webp`;
}

/**
 * The small copy's URL for a photo URL — or the URL itself when it isn't
 * one of our Storage photos (e.g. a Telegram avatar link).
 * @param {string | null | undefined} url
 * @param {'sm' | 'md'} kind
 * @returns {string | null | undefined}
 */
export function thumbUrl(url, kind) {
  const path = photoPath(url);
  if (!path || !url) return url;
  const i = url.indexOf(MARK);
  const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
  return `${url.slice(0, i + MARK.length)}${thumbPath(path, kind).split('/').map(encodeURIComponent).join('/')}${q}`;
}
