import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';
import { makeThumbsFromStorage } from '@/lib/server/thumbs';
import { photoPath } from '@/lib/thumbs';

// «Стиснути фото» (admin → Сервіс): makes the small copies (lib/thumbs)
// for photos uploaded before they existed — every player's avatar and
// every tournament photo. Batch by batch: the page calls it with
// { offset } until it answers done. Safe to run again any time.
export const maxDuration = 60;
const BATCH = 20;

export async function POST(request) {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });

  const { offset = 0 } = await request.json().catch(() => ({}));

  const [{ data: users }, { data: events }] = await Promise.all([
    supabaseAdmin.from('users').select('id, photo_url').not('photo_url', 'is', null).order('id'),
    supabaseAdmin.from('tournament_events').select('id, photo_url').not('photo_url', 'is', null).order('id'),
  ]);
  const jobs = [
    ...(users || []).map((u) => ({ path: photoPath(u.photo_url), kinds: ['sm'] })),
    ...(events || []).map((e) => ({ path: photoPath(e.photo_url), kinds: ['md'] })),
  ].filter((j) => j.path);

  const start = Math.max(0, Number(offset) || 0);
  const batch = jobs.slice(start, start + BATCH);
  let made = 0;
  let failed = 0;
  // a few at a time — quicker, still gentle on Storage
  for (let i = 0; i < batch.length; i += 5) {
    const results = await Promise.all(batch.slice(i, i + 5).map((j) => makeThumbsFromStorage(supabaseAdmin, j.path, j.kinds)));
    for (const n of results) n > 0 ? made++ : failed++;
  }
  const next = start + batch.length;
  return Response.json({ success: true, total: jobs.length, next, done: next >= jobs.length, made, failed });
}
