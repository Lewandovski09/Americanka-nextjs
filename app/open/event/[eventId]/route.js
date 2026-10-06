// «Записатися» of a Telegram announcement — the hand-over to the installed
// app (lib/server/openInApp), then the tournament's registration page.
import { openInAppResponse } from '@/lib/server/openInApp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function GET(request, { params }) {
  const id = String(params.eventId || '');
  if (!UUID.test(id)) return new Response('Not found', { status: 404 });
  return openInAppResponse(request, `/events/register/${id}`);
}
