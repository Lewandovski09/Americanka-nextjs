// «Оголосити в Telegram» — the tournament card goes to the club's channel
// and, through the bot, to every player who connected Telegram.
//
// The picture is the home page's «Найближчий турнір» card
// (app/api/og/event/[eventId]); under it, a short caption and a
// «Записатися» button that opens the registration page.
//
// Sending to many players takes time, so it is done in batches: each call
// of announceBatch() makes the channel post (only the very first call),
// then sends to the next BATCH players and remembers where it stopped
// (migration 064). The page calls it again until `done`. Two calls at
// once can't send the same batch twice — a batch is claimed first.

import { escapeHtml, trySendTelegramPhoto, trySendTelegramMessageWithButtons, broadcastPause } from '@/lib/telegram';
import { loadEventCardData } from '@/lib/server/eventCardData';

export const BATCH = 100;
const CAPTION_LIMIT = 1024; // Telegram's limit for a photo caption
const TEXT_ONLY = 'text-only'; // announce_photo_id when the picture could not be sent

/** The club's channel: TELEGRAM_CHANNEL_ID (@name or -100…); «-» turns the channel post off. */
export function channelId() {
  const v = (process.env.TELEGRAM_CHANNEL_ID || '').trim() || '@BV_here_we_go';
  return v === '-' ? null : v;
}

/**
 * The text under the picture (HTML). With `withLink`, the registration
 * link is in the text too — for the text-only fallback.
 */
export function announcementCaption(data, registerUrl, { withLink = false } = {}) {
  const head = [
    `🏐 <b>${escapeHtml(data.title)}</b> · ${escapeHtml(data.statusLabel)}`,
    data.name ? `<b>${escapeHtml(data.name)}</b>` : null,
    data.dateLabel ? `📅 ${escapeHtml(data.dateLabel)}` : null,
    [data.venue, data.avpTier ? `AVP ${data.avpTier}` : null].filter(Boolean).length
      ? `📍 ${escapeHtml([data.venue, data.avpTier ? `AVP ${data.avpTier}` : null].filter(Boolean).join(' · '))}`
      : null,
  ].filter(Boolean);

  const cats = data.categories.map((c) => {
    const tags = [c.genderLabel, c.bracketLabel, c.avpTier ? `AVP ${c.avpTier}` : null].filter(Boolean);
    return `▫️ <b>${escapeHtml(c.label)}</b>${tags.length ? ` · ${escapeHtml(tags.join(' · '))}` : ''} — ${c.taken}/${c.total} ${escapeHtml(c.unit)}, ${c.left} вільно`;
  });

  const tail = withLink
    ? `👉 <a href="${escapeHtml(registerUrl)}">Записатися</a>`
    : '👇 Записатися — кнопка нижче';

  const full = [...head, '', ...cats, '', tail].join('\n');
  if (withLink || full.length <= CAPTION_LIMIT) return full;
  // Too long for a caption — the picture already lists the categories.
  return [...head, '', tail].join('\n');
}

export function registerKeyboard(registerUrl) {
  return { inline_keyboard: [[{ text: '📝 Записатися', url: registerUrl }]] };
}

/**
 * Sends the card to one chat: the picture (by its Telegram id, or by
 * URL the first time), and the text with a link if the picture fails.
 * Returns { ok, blocked, photoId?, textOnly? }.
 */
async function sendCard(tg, chatId, { photo, caption, textCaption, keyboard }) {
  if (photo && photo !== TEXT_ONLY) {
    const r = await tg.trySendTelegramPhoto(chatId, photo, caption, keyboard);
    if (r.ok || r.blocked) return r;
  }
  const t = await tg.trySendTelegramMessageWithButtons(chatId, textCaption, keyboard);
  return { ...t, textOnly: true };
}

/**
 * One step of the announcement. `siteUrl` — the site's public address
 * (for the picture and the button).
 * @returns {Promise<{ error?: string, done?: boolean, busy?: boolean, sent?: number,
 *                     total?: number, channel?: { ok: boolean, error?: string } | null }>}
 */
export async function announceBatch(
  supabaseAdmin,
  eventId,
  { siteUrl, batchSize = BATCH, retryChannel = false, telegram = null }
) {
  // `telegram` — only tests pass their own senders.
  const tg = telegram || { trySendTelegramPhoto, trySendTelegramMessageWithButtons, broadcastPause };
  const data = await loadEventCardData(supabaseAdmin, eventId);
  if (!data) return { error: 'Турнір не знайдено' };

  const registerUrl = `${siteUrl}/events/register/${eventId}`;
  const keyboard = registerKeyboard(registerUrl);
  const caption = announcementCaption(data, registerUrl);
  const textCaption = announcementCaption(data, registerUrl, { withLink: true });

  // ── 1. the channel post — exactly once, by whoever starts it ──
  let channel = null;
  const { data: started, error: startError } = await supabaseAdmin
    .from('tournament_events')
    .update({ announced_at: new Date().toISOString() })
    .eq('id', eventId)
    .is('announced_at', null)
    .select('id');
  if (startError) {
    console.error('[announce] start:', startError.message);
    return { error: 'Не вдалося почати розсилку (чи виконано SQL 064?)' };
  }
  // «Повторити в канал»: the channel post failed earlier (e.g. the bot
  // was not yet an admin of the channel) — claimed the same way.
  let retry = false;
  if (retryChannel && (started || []).length === 0) {
    const { data: again } = await supabaseAdmin
      .from('tournament_events')
      .update({ announce_channel_ok: null })
      .eq('id', eventId)
      .eq('announce_channel_ok', false)
      .select('id');
    retry = (again || []).length === 1;
  }
  if ((started || []).length === 1 || retry) {
    const chat = channelId();
    let photoId = null;
    if (chat) {
      const r = await sendCard(tg, chat, {
        photo: `${siteUrl}/api/og/event/${eventId}?v=${Date.now()}`,
        caption,
        textCaption,
        keyboard,
      });
      channel = { ok: r.ok, error: r.ok ? undefined : r.error };
      if (r.ok) photoId = r.textOnly ? TEXT_ONLY : r.photoId || null;
    }
    const upd = { announce_channel_ok: chat ? !!channel?.ok : null };
    if (!retry) upd.announce_photo_id = photoId;
    await supabaseAdmin.from('tournament_events').update(upd).eq('id', eventId);
  }

  // ── 2. the next batch of players ──
  const { data: ev } = await supabaseAdmin
    .from('tournament_events')
    .select('announce_cursor, announce_photo_id, announce_sent, announce_done_at, announce_channel_ok')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return { error: 'Турнір не знайдено' };
  const channelState = channel || (ev.announce_channel_ok == null ? null : { ok: ev.announce_channel_ok });
  if (ev.announce_done_at) return { done: true, sent: ev.announce_sent || 0, channel: channelState };

  let q = supabaseAdmin
    .from('users')
    .select('id, telegram_user_id')
    .eq('approval_status', 'approved')
    .not('telegram_user_id', 'is', null)
    .not('telegram_linked_at', 'is', null);
  // A men-only / women-only tournament is announced to them only.
  if (data.gender) q = q.eq('gender', data.gender);
  if (ev.announce_cursor) q = q.gt('id', ev.announce_cursor);
  const { data: people, error: peopleError } = await q.order('id', { ascending: true }).limit(batchSize);
  if (peopleError) {
    console.error('[announce] recipients:', peopleError.message);
    return { error: 'Не вдалося отримати список гравців' };
  }

  if (!people || people.length === 0) {
    await supabaseAdmin
      .from('tournament_events')
      .update({ announce_done_at: new Date().toISOString() })
      .eq('id', eventId)
      .is('announce_done_at', null);
    return { done: true, sent: ev.announce_sent || 0, channel: channelState };
  }

  // Claim the batch: move the cursor past it first. Whoever fails to
  // move it (someone else already did) sends nothing.
  const lastId = people[people.length - 1].id;
  let claim = supabaseAdmin.from('tournament_events').update({ announce_cursor: lastId }).eq('id', eventId);
  claim = ev.announce_cursor ? claim.eq('announce_cursor', ev.announce_cursor) : claim.is('announce_cursor', null);
  const { data: claimed } = await claim.select('id');
  if (!claimed || claimed.length !== 1) return { busy: true, sent: ev.announce_sent || 0, channel: channelState };

  let photo = ev.announce_photo_id || `${siteUrl}/api/og/event/${eventId}?v=${Date.now()}`;
  let sent = 0;
  const dead = [];
  for (const p of people) {
    const r = await sendCard(tg, p.telegram_user_id, { photo, caption, textCaption, keyboard });
    if (r.ok) {
      sent++;
      // The first picture that goes through gives its Telegram id — the
      // rest reuse it (nothing is drawn or downloaded again).
      if (!ev.announce_photo_id) {
        const next = r.textOnly ? TEXT_ONLY : r.photoId;
        if (next) {
          photo = next;
          ev.announce_photo_id = next;
          await supabaseAdmin.from('tournament_events').update({ announce_photo_id: next }).eq('id', eventId);
        }
      }
    } else if (r.blocked) {
      dead.push(p.telegram_user_id);
    }
    await tg.broadcastPause();
  }

  const total = (ev.announce_sent || 0) + sent;
  await supabaseAdmin.from('tournament_events').update({ announce_sent: total }).eq('id', eventId);

  // Players who blocked the bot: mark them unlinked (same as admin notices).
  if (dead.length > 0) {
    await supabaseAdmin.from('users').update({ telegram_linked_at: null }).in('telegram_user_id', dead);
  }

  const done = people.length < batchSize;
  if (done) {
    await supabaseAdmin
      .from('tournament_events')
      .update({ announce_done_at: new Date().toISOString() })
      .eq('id', eventId)
      .is('announce_done_at', null);
  }
  return { done, sent: total, channel: channelState };
}
