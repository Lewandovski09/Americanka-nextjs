import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Avatar upload. The browser downscales the picked photo and sends it
// as a data URL; the SERVER writes it to the bucket with the
// service-role key — exactly like registration already does.
//
// It used to go straight from the browser to storage with the anon key.
// A public bucket is public to READ; writing still needs a storage
// policy on storage.objects, and this project never created one — so
// every upload from the profile page was rejected. The error was not
// checked, and photo_url was overwritten regardless, which is why the
// avatar then showed either the registration photo (when the new file
// happened to have the same extension) or nothing at all (when it
// didn't, e.g. a .png from the gallery).
const MAX_BYTES = 6 * 1024 * 1024;
const DATA_URL = /^data:(image\/(jpeg|png|webp));base64,(.+)$/;

export async function POST(request) {
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const { dataUrl } = await request.json();
  const parsed = DATA_URL.exec(dataUrl || '');
  if (!parsed) {
    return Response.json(
      { success: false, error: 'Непідтримуваний формат фото' },
      { status: 400 }
    );
  }

  const [, mimeType, subtype, base64] = parsed;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    return Response.json({ success: false, error: 'Порожній файл' }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return Response.json({ success: false, error: 'Фото завелике' }, { status: 400 });
  }

  // One object per player, named after them — a new photo overwrites the
  // old one instead of leaving orphans behind. The extension follows the
  // mime type, matching what the registration route writes.
  const path = `${authUser.user.id}.${subtype}`;
  const supabaseAdmin = createAdminClient();

  // Default cacheControl is only 1 hour, so the browser and Supabase's
  // CDN re-fetch the full photo on every visit even though it almost
  // never changes. A new upload gets a fresh ?t= query string below, so
  // the old cached URL is simply never requested again — safe to cache
  // this one for a full year.
  const { error: uploadError } = await supabaseAdmin.storage
    .from('player-photos')
    .upload(path, buffer, { contentType: mimeType, upsert: true, cacheControl: '31536000' });
  if (uploadError) {
    console.error('[profile photo] upload:', uploadError.message);
    return Response.json({ success: false, error: 'Не вдалося завантажити фото' }, { status: 500 });
  }

  // The public URL never changes (same path), so without a cache-buster
  // the browser and the CDN keep serving the previous image.
  const { data: urlData } = supabaseAdmin.storage.from('player-photos').getPublicUrl(path);
  const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  const { error: dbError } = await supabaseAdmin
    .from('players')
    .update({ photo_url: photoUrl })
    .eq('id', authUser.user.id);
  if (dbError) {
    console.error('[profile photo] db:', dbError.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти фото' }, { status: 500 });
  }

  return Response.json({ success: true, photoUrl });
}
