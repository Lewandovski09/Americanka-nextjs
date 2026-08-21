import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getJudgeRole, loadMatchContext } from '@/lib/server/judges';

// Moves ONE game: its planned start time and/or its court.
//
// Both are stamped when the category starts (see lib/schedule.js), but a
// real day slips — a court frees up early, a league runs late — so the
// admin can move a single game without touching the rest of the
// schedule. Nothing is recomputed: the other games stay exactly where
// they are, which is the point.
//
// The head judge shares the court half of this: shuffling a game to a
// free court is their call on the day. The timetable stays the admin's.
export async function POST(request, { params }) {
  const { matchId } = params;
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const ctx = await loadMatchContext(supabaseAdmin, matchId);
  if (!ctx) return Response.json({ success: false, error: 'Матч не знайдено' }, { status: 404 });
  const { match, eventId } = ctx;

  const role = await getJudgeRole(supabaseAdmin, authUser.user.id, eventId);
  if (!role.isAdmin && !role.isHeadJudge) {
    return Response.json({ success: false, error: 'Тільки адмін або головний суддя' }, { status: 403 });
  }

  const { scheduledAt, court } = await request.json();

  if (scheduledAt !== undefined && !role.isAdmin) {
    return Response.json(
      { success: false, error: 'Головний суддя може змінити лише корт' },
      { status: 403 }
    );
  }

  if (match.tournament_categories?.status === 'done') {
    return Response.json(
      { success: false, error: 'Категорію завершено — розклад змінити не можна' },
      { status: 400 }
    );
  }

  const update = {};

  if (scheduledAt !== undefined) {
    if (scheduledAt === null || scheduledAt === '') {
      update.scheduled_at = null;
    } else {
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return Response.json({ success: false, error: 'Некоректний час' }, { status: 400 });
      }
      update.scheduled_at = when.toISOString();
    }
  }

  if (court !== undefined) {
    const n = Number(court);
    // Only the courts the category actually booked — a game on court 5 of
    // a two-court event would silently drop out of everyone's plan.
    const allowed = match.tournament_categories?.courts?.length ? match.tournament_categories.courts : [1];
    if (!Number.isInteger(n) || !allowed.includes(n)) {
      return Response.json(
        { success: false, error: `Корт має бути одним із: ${allowed.join(', ')}` },
        { status: 400 }
      );
    }
    update.court = n;
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ success: false, error: 'Нічого змінювати' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('tournament_matches').update(update).eq('id', matchId);
  if (error) {
    console.error('[match schedule]:', error.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти розклад' }, { status: 500 });
  }

  return Response.json({ success: true });
}
