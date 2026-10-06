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

import {
  escapeHtml,
  trySendTelegramPhoto,
  trySendTelegramPhotoFile,
  trySendTelegramMessageWithButtons,
  broadcastPause,
} from '@/lib/telegram';
import { loadEventCardData } from '@/lib/server/eventCardData';

export const BATCH = 100;
const CAPTION_LIMIT = 1024; // Telegram's limit for a photo caption
const TEXT_ONLY = 'text-only'; // stored by an older version when the picture failed — means «none yet»

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
 * The card picture as PNG bytes, drawn by our own route. Our server waits
 * for it as long as needed (a cold start of the drawing can take a few
 * seconds — too long for Telegram, which then drops the picture).
 */
export async function fetchCardPng(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return { error: `картинка: HTTP ${res.status}` };
    return { bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    return { error: `картинка: ${e?.name === 'AbortError' ? 'timeout' : e?.message || 'error'}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends the card to one chat. The picture is tried in this order:
 *   1. its Telegram id (once it has been sent anywhere — instant);
 *   2. uploaded from our server (drawn by /api/og/event, fetched here);
 *   3. as a link Telegram downloads itself;
 * and only if all of them fail — the text with a link. `pic` is shared
 * by all the sends of one run: { fileId, url, bytes, failed, error }.
 * Returns { ok, blocked, textOnly? }.
 */
async function sendCard(tg, chatId, pic, { caption, textCaption, keyboard }) {
  if (pic.fileId) {
    const r = await tg.trySendTelegramPhoto(chatId, pic.fileId, caption, keyboard);
    if (r.ok || r.blocked) return r;
  }
  if (!pic.failed) {
    if (pic.bytes === undefined) {
      const got = await tg.fetchCardPng(pic.url);
      pic.bytes = got.bytes || null;
      if (got.error) pic.error = got.error;
    }
    if (pic.bytes) {
      const r = await tg.trySendTelegramPhotoFile(chatId, pic.bytes, caption, keyboard);
      if (r.ok) pic.fileId = r.photoId || pic.fileId;
      if (r.ok || r.blocked) return r;
      pic.error = r.error;
    }
    const r = await tg.trySendTelegramPhoto(chatId, pic.url, caption, keyboard);
    if (r.ok) pic.fileId = r.photoId || pic.fileId;
    if (r.ok || r.blocked) return r;
    pic.error = pic.error || r.error;
    // No picture this run — the rest of it goes as text, without trying
    // (and waiting) again for every player. The next run tries again.
    pic.failed = true;
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
  const tg = telegram || {
    trySendTelegramPhoto,
    trySendTelegramPhotoFile,
    trySendTelegramMessageWithButtons,
    broadcastPause,
    fetchCardPng,
  };
  const data = await loadEventCardData(supabaseAdmin, eventId);
  if (!data) return { error: 'Турнір не знайдено' };

  // The button goes through /open/event — it hands the tournament to the
  // installed app when there is one (app/open/event/[eventId]).
  const registerUrl = `${siteUrl}/open/event/${eventId}`;
  const keyboard = registerKeyboard(registerUrl);
  const caption = announcementCaption(data, registerUrl);
  const textCaption = announcementCaption(data, registerUrl, { withLink: true });
  const msg = { caption, textCaption, keyboard };
  const pic = { fileId: null, url: `${siteUrl}/api/og/event/${eventId}?v=${Date.now()}`, bytes: undefined, failed: false, error: null };

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
    if (chat) {
      const r = await sendCard(tg, chat, pic, msg);
      channel = { ok: r.ok, photo: r.ok && !r.textOnly, error: r.ok ? undefined : r.error };
    }
    const upd = { announce_channel_ok: chat ? !!channel?.ok : null };
    if (pic.fileId) upd.announce_photo_id = pic.fileId;
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

  if (!pic.fileId && ev.announce_photo_id && ev.announce_photo_id !== TEXT_ONLY) pic.fileId = ev.announce_photo_id;
  const hadFileId = pic.fileId;
  let sent = 0;
  const dead = [];
  for (const p of people) {
    const r = await sendCard(tg, p.telegram_user_id, pic, msg);
    if (r.ok) {
      sent++;
      // The first picture that goes through gives its Telegram id — the
      // rest (and the next batches) reuse it.
      if (pic.fileId && pic.fileId !== hadFileId && pic.fileId !== ev.announce_photo_id) {
        ev.announce_photo_id = pic.fileId;
        await supabaseAdmin.from('tournament_events').update({ announce_photo_id: pic.fileId }).eq('id', eventId);
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
  return { done, sent: total, channel: channelState, photoError: pic.failed ? pic.error || 'невідома помилка' : undefined };
}

/**
 * One message with the tournament card on top (the same picture as the
 * announcement) — for the bot's personal messages about a tournament
 * (pair invitations and their answers). `caption` is HTML; the text is
 * sent alone only if no way of sending the picture works.
 * Returns { ok, blocked, textOnly? }.
 */
export async function sendEventCardMessage(chatId, { siteUrl, eventId, caption, keyboard, telegram = null }) {
  const tg = telegram || {
    trySendTelegramPhoto,
    trySendTelegramPhotoFile,
    trySendTelegramMessageWithButtons,
    broadcastPause,
    fetchCardPng,
  };
  const pic = { fileId: null, url: `${siteUrl}/api/og/event/${eventId}?v=${Date.now()}`, bytes: undefined, failed: false, error: null };
  return sendCard(tg, chatId, pic, { caption, textCaption: caption, keyboard });
}
