// «Заявки приймаються» — when an announced tournament reaches the time its
// applications open (registration_opens_at, migration 066), the channel
// and every player in the bot get the poster again with «Записатися».
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

/** Tournaments whose opening has come and whose «open» message is not done. */
export async function dueOpenings(supabaseAdmin, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const { data, error } = await supabaseAdmin
    .from('tournament_events')
    .select('id, status, registration_open, registration_opens_at, announced_at, open_announce_done_at')
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
  return (data || []).filter(
    (e) =>
      e.registration_open !== false &&
      e.announced_at &&
      // announced before the opening — otherwise the first post already
      // said «Реєстрація відкрита»
      new Date(e.announced_at).getTime() < new Date(e.registration_opens_at).getTime()
  );
}

/**
 * Sends what is due, batch after batch, for at most `budgetMs`; whatever
 * is left goes on the next minute. Returns a short report per tournament.
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
