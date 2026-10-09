// Makes the small copies of a photo (lib/thumbs) with sharp and stores
// them next to it. Called right after each upload (profile, registration,
// tournament photo) and by the admin's one-time «Стиснути фото»
// (/api/admin/thumbs) for photos uploaded before. Never throws: without
// a small copy the app simply shows the original.

import { THUMB_KINDS, thumbPath } from '@/lib/thumbs';

const BUCKET = 'player-photos';

/**
 * @param {any} supabaseAdmin
 * @param {string} path      the original's storage path
 * @param {Buffer} buffer    the original's bytes
 * @param {('sm' | 'md')[]} kinds
 * @returns {Promise<number>} how many copies were stored
 */
export async function makeThumbs(supabaseAdmin, path, buffer, kinds) {
  let made = 0;
  try {
    const sharp = (await import('sharp')).default;
    for (const kind of kinds) {
      const k = THUMB_KINDS[kind];
      if (!k) continue;
      const out = await sharp(buffer)
        .rotate()
        .resize({ width: k.width, height: k.height || undefined, fit: k.fit, withoutEnlargement: true })
        .webp({ quality: k.quality })
        .toBuffer();
      const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(thumbPath(path, kind), out, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
      if (error) console.error('[thumbs] upload', kind, path, error.message);
      else made++;
    }
  } catch (e) {
    console.error('[thumbs]', path, e?.message || e);
  }
  return made;
}

/**
 * The same, for a photo already in Storage (downloads it first).
 * @param {any} supabaseAdmin
 * @param {string} path
 * @param {('sm' | 'md')[]} kinds
 */
export async function makeThumbsFromStorage(supabaseAdmin, path, kinds) {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
    if (error || !data) {
      console.error('[thumbs] download', path, error?.message);
      return 0;
    }
    return makeThumbs(supabaseAdmin, path, Buffer.from(await data.arrayBuffer()), kinds);
  } catch (e) {
    console.error('[thumbs] download', path, e?.message || e);
    return 0;
  }
}

/** Removes a photo's small copies (the tournament photo «Прибрати»). */
export async function removeThumbs(supabaseAdmin, path) {
  try {
    await supabaseAdmin.storage.from(BUCKET).remove(Object.keys(THUMB_KINDS).map((k) => thumbPath(path, k)));
  } catch (e) {
    console.error('[thumbs] remove', path, e?.message || e);
  }
}
