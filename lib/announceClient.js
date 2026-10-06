// Runs «Оголосити в Telegram» from the browser: calls the announce route
// until everyone is reached (the server sends one batch per call — see
// lib/server/eventAnnouncement). `onProgress(sent)` after every batch.
//
// Resolves { ok, sent, channel, error }.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runAnnouncement(eventId, onProgress, { retryChannel = false } = {}) {
  let last = { sent: 0, channel: null };
  for (let step = 0; step < 60; step++) {
    let data;
    try {
      const res = await fetch(`/api/events/${eventId}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // only the first call retries the channel post
        body: JSON.stringify({ retryChannel: retryChannel && step === 0 }),
      });
      data = await res.json();
    } catch {
      return { ok: false, ...last, error: 'Немає зʼєднання — розсилку можна продовжити в налаштуваннях турніру' };
    }
    if (!data.success) return { ok: false, ...last, error: data.error || 'Не вдалося надіслати оголошення' };
    last = { sent: data.sent ?? last.sent, channel: data.channel ?? last.channel };
    onProgress?.(last.sent);
    if (data.done) return { ok: true, ...last };
    // Someone else is sending the same batch right now — wait for them.
    if (data.busy) await sleep(2000);
  }
  return { ok: false, ...last, error: 'Розсилка ще триває — продовжити можна в налаштуваннях турніру' };
}

/** One line about how it went, for an alert or a note. */
export function announcementSummary(r) {
  const parts = [];
  if (r.channel) parts.push(r.channel.ok ? 'канал ✅' : `канал ❌${r.channel.error ? ` (${r.channel.error})` : ''}`);
  parts.push(`гравцям у бот: ${r.sent || 0}`);
  return parts.join(' · ');
}
