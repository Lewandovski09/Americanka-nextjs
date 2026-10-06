// Asks the server to send the Telegram note about a pair invitation
// (app/api/events/[eventId]/invites/[inviteId]/notify) — in the
// background: the page does not wait for it, and it keeps going even if
// the player leaves the page right away (keepalive).
export function notifyInvite(eventId, inviteId) {
  if (!eventId || !inviteId) return;
  try {
    fetch(`/api/events/${eventId}/invites/${inviteId}/notify`, { method: 'POST', keepalive: true }).catch(() => {});
  } catch {
    // ignore — the invitation itself is saved; only the note is missed
  }
}
