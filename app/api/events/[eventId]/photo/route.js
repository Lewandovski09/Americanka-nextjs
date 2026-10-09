import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { makeThumbs, removeThumbs } from '@/lib/server/thumbs';
import { photoPath } from '@/lib/thumbs';
import { getAuthUser } from '@/lib/server/authUser';

// The tournament photo (migration 054): uploaded by the owner of the
// app only (migration 053). The browser
// downscales it (lib/photo, up to 1600 px) and sends a data URL; the
// server writes it to the public «player-photos» bucket under
// events/<event id>.jpg — one file per event, a new one replaces it.
const MAX_BYTES = 6 * 1024 * 1024;
const DATA_URL = /^data:(image\/(jpeg|png|webp));base64,(.+)$/;

async function guard(eventId) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return { error: Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 }) };
  const supabaseAdmin = createAdminClient();
  const { data: event } = await supabaseAdmin.from('tournament_events').select('id, status').eq('id', eventId).maybeSingle();
  if (!event) return { error: Response.json({ success: false, error: 'Турнір не знайдено' }, { status: 404 }) };
  // Only the owner of the app (migration 053) adds, replaces or removes
  // a tournament photo.
  const { data: owner } = await supabaseAdmin
    .from('app_owners')
    .select('user_id')
    .eq('user_id', authUser.user.id)
    .maybeSingle();
  if (!owner) {
    return { error: Response.json({ success: false, error: 'Фото турніру додає лише власник застосунку' }, { status: 403 }) };
  }
  return { supabaseAdmin, event };
}

export async function POST(request, { params }) {
  const { eventId } = params;
  const g = await guard(eventId);
  if (g.error) return g.error;

  const { dataUrl } = await request.json().catch(() => ({}));
  const parsed = DATA_URL.exec(dataUrl || '');
  if (!parsed) return Response.json({ success: false, error: 'Непідтримуваний формат фото' }, { status: 400 });
  const [, mimeType, subtype, base64] = parsed;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) return Response.json({ success: false, error: 'Порожній файл' }, { status: 400 });
  if (buffer.length > MAX_BYTES) return Response.json({ success: false, error: 'Фото завелике' }, { status: 400 });

  const path = `events/${eventId}.${subtype === 'jpeg' ? 'jpg' : subtype}`;
  const { error: upErr } = await g.supabaseAdmin.storage
    .from('player-photos')
    .upload(path, buffer, { contentType: mimeType, upsert: true, cacheControl: '31536000' });
  if (upErr) {
    console.error('[event photo] upload:', upErr.message);
    return Response.json({ success: false, error: 'Не вдалося завантажити фото' }, { status: 500 });
  }
  // the 800 px copy for cards and lists (lib/thumbs)
  await makeThumbs(g.supabaseAdmin, path, buffer, ['md']);
  const { data: urlData } = g.supabaseAdmin.storage.from('player-photos').getPublicUrl(path);
  const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  const { error: dbErr } = await g.supabaseAdmin.from('tournament_events').update({ photo_url: photoUrl }).eq('id', eventId);
  if (dbErr) {
    console.error('[event photo] db:', dbErr.message);
    return Response.json(
      { success: false, error: 'Не вдалося зберегти фото. Чи виконано SQL міграції 054?' },
      { status: 500 }
    );
  }
  return Response.json({ success: true, photoUrl });
}

// «Прибрати фото».
export async function DELETE(request, { params }) {
  const { eventId } = params;
  const g = await guard(eventId);
  if (g.error) return g.error;
  const { data: before } = await g.supabaseAdmin.from('tournament_events').select('photo_url').eq('id', eventId).maybeSingle();
  const { error } = await g.supabaseAdmin.from('tournament_events').update({ photo_url: null }).eq('id', eventId);
  const oldPath = photoPath(before?.photo_url);
  if (!error && oldPath) await removeThumbs(g.supabaseAdmin, oldPath);
  if (error) return Response.json({ success: false, error: 'Не вдалося прибрати фото' }, { status: 500 });
  return Response.json({ success: true });
}
