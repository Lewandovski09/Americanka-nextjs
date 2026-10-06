// /open?to=/some/page — the hand-over to the installed app for any page of
// the site (links in bot messages). See lib/server/openInApp.
import { openInAppResponse } from '@/lib/server/openInApp';

export function GET(request) {
  const to = new URL(request.url).searchParams.get('to') || '/';
  return openInAppResponse(request, to);
}
