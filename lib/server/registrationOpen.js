// «Заявки приймаються» — when a tournament reaches the time its
// applications open (registration_opens_at, migration 066), the channel
// and every player in the bot get the poster with «Записатися». Every
// tournament, announced or not (migration 069).
//
// Woken every minute by the database (migration 067 → /api/cron/
// registration-open), and also, as a safety net, by the app itself when
// someone opens the tournament after that moment. Calling it with nothing
// to do does nothing; calling it twice sends nothing twice (the batches
// are claimed — lib/server/eventAnnouncement).

import { announceBatch } from '@/lib/server/eventAnnouncement';

// An opening older than this is not news any more (e.g. the cron was set
// up later) — same window as migration 067.
export const LATE_LIMIT_MS = 2 * 24 * 60 * 60 * 1000;
export const OPEN_GRACE_MS = 90 * 1000;

/**
 * Tournaments whose opening has come and whose «open» message is not done.
 * @param {any} supabaseAdmin
 * @param {number} [now]
 * @returns {Promise<any[]>}
 */
export async function dueOpenings(supabaseAdmin, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const { data, error } = await supabaseAdmin
    .from('tournament_events')
    .select('*')
    .eq('status', 'scheduled')
    .lt('registration_opens_at', nowIso)
    .gt('registration_opens_at', new Date(now - LATE_LIMIT_MS).toISOString())
    .is('open_announce_done_at', null)
    .order('registration_opens_at', { ascending: true })
    .limit(20);
  if (error) {
    console.error('[registration-open] due:', error.message);
    return [];
  }
  // Every tournament gets it (migration 069) — unless its announcement
  // came after the opening (that one already said «Реєстрація відкрита»).
  // Not announced at all: 90 s of grace, for an announcement starting
  // right after the tournament was created.
  return (data || []).filter((e) => {
    if (e.registration_open === false) return false;
    if (e.is_test) return false; // a test tournament sends nothing (070)
    if (e.registration_closes_at && new Date(e.registration_closes_at).getTime() <= now) return false;
    const opens = new Date(e.registration_opens_at).getTime();
    if (e.announced_at) return new Date(e.announced_at).getTime() < opens;
    return opens <= now - OPEN_GRACE_MS;
  });
}

/**
 * Sends what is due, batch after batch, for at most `budgetMs`; whatever
 * is left goes on the next minute. Returns a short report per tournament.
 *
 * @param {any} supabaseAdmin
 * @param {{ siteUrl?: string, budgetMs?: number, telegram?: any, now?: number }} [opts]
 * @returns {Promise<any[]>}
 */
export async function runOpenAnnouncements(supabaseAdmin, { siteUrl, budgetMs = 45_000, telegram = null, now = Date.now() } = {}) {
  const started = Date.now();
  const report = [];
  for (const ev of await dueOpenings(supabaseAdmin, now)) {
    let r = { done: false };
    let steps = 0;
    while (!r.done && !r.error && Date.now() - started < budgetMs && steps < 50) {
      r = await announceBatch(supabaseAdmin, ev.id, { siteUrl, kind: 'open', telegram });
      steps++;
      if (r.busy) break; // another call is sending this one right now
    }
    report.push({ id: ev.id, done: !!r.done, sent: r.sent || 0, busy: !!r.busy, error: r.error, channel: r.channel || null });
    if (Date.now() - started >= budgetMs) break;
  }
  return report;
}
