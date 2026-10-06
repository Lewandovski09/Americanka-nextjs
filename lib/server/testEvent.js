// «Тестовий турнір» (migration 070): a tournament made to try things out.
// Nothing about it ever goes to Telegram — no announcement, no
// «Заявки приймаються», no schedule, no invitations, no withdrawal notes.

/** true when the event is a test one. A read error counts as «not test». */
export async function isTestEvent(supabaseAdmin, eventId) {
  if (!eventId) return false;
  const { data, error } = await supabaseAdmin.from('tournament_events').select('is_test').eq('id', eventId).maybeSingle();
  if (error) return false;
  return !!data?.is_test;
}

export const TEST_SKIP = { success: true, skipped: 'test', note: 'Тестовий турнір — у Telegram нічого не надсилається' };
