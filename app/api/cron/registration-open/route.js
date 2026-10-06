import { createAdminClient } from '@/lib/supabase/admin';
import { runOpenAnnouncements } from '@/lib/server/registrationOpen';
import { publicSiteUrl } from '@/lib/server/siteUrl';

// «Заявки приймаються» — woken every minute by the database when an
// announced tournament has reached its opening time (migration 067), and
// by the app as a safety net (lib/server/registrationOpen).
//
// Open to anyone on purpose: it only ever sends what is already due, and
// never twice, so a stray call changes nothing. No secrets to keep.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(request) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return Response.json({ success: true, skipped: 'no bot token' });
  const site = publicSiteUrl(request);
  if (!site || !site.startsWith('https://')) return Response.json({ success: true, skipped: 'not https' });
  const report = await runOpenAnnouncements(createAdminClient(), { siteUrl: site });
  return Response.json({ success: true, report });
}

export const GET = run;
export const POST = run;
