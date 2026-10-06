// «Оголосити в Telegram» — the tournament poster goes to the club's
// channel and, through the bot, to every player who connected Telegram.
//
// Two kinds of announcement (the same machinery, separate bookkeeping):
//   'new'  — on creating the tournament (or from its settings): the poster
//            (lib/eventPoster) with a short caption. If applications open
//            later, it says from when, and its button is «Детальніше».
//   'open' — when that moment comes (migration 067 wakes the server):
//            «Заявки приймаються» with the poster and «Записатися».
//
// Sending to many players takes time, so it is done in batches: each call
// of announceBatch() makes the channel post (only the very first call),
// then sends to the next BATCH players and remembers where it stopped
// (migrations 064 / 066). The caller calls it again until `done`. Two
// calls at once can't send the same batch twice — a batch is claimed first.

import {
  escapeHtml,
  trySendTelegramPhoto,
  trySendTelegramPhotoFile,
  trySendTelegramMessageWithButtons,
  broadcastPause,
} from '@/lib/telegram';
import { loadEventCardData } from '@/lib/server/eventCardData';
import { browserButton } from '@/lib/server/openInApp';

export const BATCH = 100;

const CAPTION_LIMIT = 1024; // Telegram's limit for a photo caption

// Where each kind keeps its progress on tournament_events.
export const KINDS = {
  new: {
    started: 'announced_at',
    photo: 'announce_photo_id',
    cursor: 'announce_cursor',
    sent: 'announce_sent',
    done: 'announce_done_at',
    channelOk: 'announce_channel_ok',
  },
  open: {
    started: 'open_announced_at',
    photo: 'open_announce_photo_id',
    cursor: 'open_announce_cursor',
    sent: 'open_announce_sent',
    done: 'open_announce_done_at',
    channelOk: 'open_announce_channel_ok',
  },
};
const TEXT_ONLY = 'text-only'; // stored by an older version when the picture failed — means «none yet»

/** The club's channel: TELEGRAM_CHANNEL_ID (@name or -100…); «-» turns the channel post off. */
export function channelId() {
  const v = (process.env.TELEGRAM_CHANNEL_ID || '').trim() || '@BV_here_we_go';
  return v === '-' ? null : v;
}

/**
 * The text under the picture (HTML). With `withLink`, the link is in the
 * text too — for the text-only fallback. `kind` — see KINDS.
 */
export function announcementCaption(data, registerUrl, { withLink = false, kind = 'new' } = {}) {
  const soon = data.regState === 'soon';
  const place = [data.venue, data.city].filter(Boolean);
  const head = [
    kind === 'open' ? '🟢 <b>Заявки приймаються!</b>' : null,
    kind === 'open'
      ? `🏐 <b>${escapeHtml(data.title)}</b>`
      : // before the opening the ⏳ line below says when — no need to twice
        `🏐 <b>${escapeHtml(data.title)}</b> · ${escapeHtml(soon ? 'Новий турнір' : data.statusLabel)}`,
    data.name ? `<b>${escapeHtml(data.name)}</b>` : null,
    data.dateLabel ? `📅 ${escapeHtml(data.dateLabel)}` : null,
    place.length ? `📍 Локація: ${escapeHtml(place.join(', '))}` : null,
    data.avpTier ? `🏆 AVP ${escapeHtml(String(data.avpTier))}` : null,
    data.feeLabel ? `💰 Внесок: ${escapeHtml(data.feeLabel)}` : null,
    soon && kind !== 'open' && data.opensLabel ? `⏳ Прийом заявок — з ${escapeHtml(data.opensLabel)}` : null,
  ].filter(Boolean);

  const cats = data.categories.map((c) => {
    const tags = [c.genderLabel, c.bracketLabel, c.avpTier ? `AVP ${c.avpTier}` : null].filter(Boolean);
    return `▫️ <b>${escapeHtml(c.label)}</b>${tags.length ? ` · ${escapeHtml(tags.join(' · '))}` : ''} — ${escapeHtml(c.places || `${c.total} ${c.unit}`)}`;
  });

  // Who to ask (lib/organizer).
  const org = data.organizer || {};
  const contact = [org.telegram ? `✈️ ${escapeHtml(org.telegram)}` : null, org.phone ? `📞 ${escapeHtml(org.phone)}` : null].filter(Boolean);
  const ask = contact.length ? `❓ Питання до організатора: ${contact.join(' · ')}` : null;

  const word = soon ? 'Детальніше' : 'Записатися';
  const tail = withLink
    ? `👉 <a href="${escapeHtml(registerUrl)}">${word}</a>`
    : `👇 ${word} — кнопка нижче`;

  const foot = [ask, tail].filter(Boolean);
  const full = [...head, '', ...cats, '', ...foot].join('\n');
  if (withLink || full.length <= CAPTION_LIMIT) return full;
  // Too long for a caption — the picture already lists the categories.
  return [...head, '', ...foot].join('\n');
}

// «Записатися» — opens the registration page in the browser
// (lib/server/openInApp).
// Before applications open, the button just shows the tournament.
export function registerKeyboard(registerUrl, { soon = false } = {}) {
  return browserButton(soon ? '👀 Детальніше' : '📝 Записатися', registerUrl);
}

/** The poster picture's address (app/api/og/poster/[eventId]). */
export function posterUrl(siteUrl, eventId) {
  return `${siteUrl}/api/og/poster/${eventId}?v=${Date.now()}`;
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
 * @param {any} supabaseAdmin
 * @param {string} eventId
 * @param {{ siteUrl: string, batchSize?: number, retryChannel?: boolean, telegram?: any, kind?: 'new' | 'open' }} opts
 * @returns {Promise<{ error?: string, done?: boolean, busy?: boolean, sent?: number,
 *                     total?: number, channel?: { ok: boolean, error?: string } | null }>}
 */
export async function announceBatch(
  supabaseAdmin,
  eventId,
  { siteUrl, batchSize = BATCH, retryChannel = false, telegram = null, kind = 'new' }
) {
  const K = KINDS[kind];
  if (!K) return { error: 'Невідомий вид оголошення' };
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
  const keyboard = registerKeyboard(registerUrl, { soon: data.regState === 'soon' });
  const caption = announcementCaption(data, registerUrl, { kind });
  const textCaption = announcementCaption(data, registerUrl, { withLink: true, kind });
  const msg = { caption, textCaption, keyboard };
  const pic = { fileId: null, url: posterUrl(siteUrl, eventId), bytes: undefined, failed: false, error: null };

  // ── 1. the channel post — exactly once, by whoever starts it ──
  let channel = null;
  const { data: started, error: startError } = await supabaseAdmin
    .from('tournament_events')
    .update({ [K.started]: new Date().toISOString() })
    .eq('id', eventId)
    .is(K.started, null)
    .select('id');
  if (startError) {
    console.error('[announce] start:', startError.message);
    return { error: `Не вдалося почати розсилку (чи виконано SQL ${kind === 'open' ? '066' : '064'}?)` };
  }
  // «Повторити в канал»: the channel post failed earlier (e.g. the bot
  // was not yet an admin of the channel) — claimed the same way.
  let retry = false;
  if (retryChannel && (started || []).length === 0) {
    const { data: again } = await supabaseAdmin
      .from('tournament_events')
      .update({ [K.channelOk]: null })
      .eq('id', eventId)
      .eq(K.channelOk, false)
      .select('id');
    retry = (again || []).length === 1;
  }
  if ((started || []).length === 1 || retry) {
    const chat = channelId();
    if (chat) {
      const r = await sendCard(tg, chat, pic, msg);
      channel = { ok: r.ok, photo: r.ok && !r.textOnly, error: r.ok ? undefined : r.error };
    }
    const upd = { [K.channelOk]: chat ? !!channel?.ok : null };
    if (pic.fileId) upd[K.photo] = pic.fileId;
    await supabaseAdmin.from('tournament_events').update(upd).eq('id', eventId);
  }

  // ── 2. the next batch of players ──
  const { data: row } = await supabaseAdmin
    .from('tournament_events')
    .select(`${K.cursor}, ${K.photo}, ${K.sent}, ${K.done}, ${K.channelOk}`)
    .eq('id', eventId)
    .maybeSingle();
  if (!row) return { error: 'Турнір не знайдено' };
  // The same names for both kinds below.
  const ev = {
    announce_cursor: row[K.cursor],
    announce_photo_id: row[K.photo],
    announce_sent: row[K.sent],
    announce_done_at: row[K.done],
    announce_channel_ok: row[K.channelOk],
  };
  const channelState = channel || (ev.announce_channel_ok == null ? null : { ok: ev.announce_channel_ok });
  if (ev.announce_done_at) return { done: true, sent: ev.announce_sent || 0, channel: channelState };

  const recipients = (cols) => {
    let q = supabaseAdmin
      .from('users')
      .select(cols)
      .eq('approval_status', 'approved')
      .not('telegram_user_id', 'is', null)
      .not('telegram_linked_at', 'is', null);
    // A men-only / women-only tournament is announced to them only.
    if (data.gender) q = q.eq('gender', data.gender);
    if (ev.announce_cursor) q = q.gt('id', ev.announce_cursor);
    return q.order('id', { ascending: true }).limit(batchSize);
  };
  const { data: people, error: peopleError } = await recipients('id, telegram_user_id');
  if (peopleError) {
    console.error('[announce] recipients:', peopleError.message);
    return { error: 'Не вдалося отримати список гравців' };
  }

  if (!people || people.length === 0) {
    await supabaseAdmin
      .from('tournament_events')
      .update({ [K.done]: new Date().toISOString() })
      .eq('id', eventId)
      .is(K.done, null);
    return { done: true, sent: ev.announce_sent || 0, channel: channelState };
  }

  // Claim the batch: move the cursor past it first. Whoever fails to
  // move it (someone else already did) sends nothing.
  const lastId = people[people.length - 1].id;
  let claim = supabaseAdmin.from('tournament_events').update({ [K.cursor]: lastId }).eq('id', eventId);
  claim = ev.announce_cursor ? claim.eq(K.cursor, ev.announce_cursor) : claim.is(K.cursor, null);
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
        await supabaseAdmin.from('tournament_events').update({ [K.photo]: pic.fileId }).eq('id', eventId);
      }
    } else if (r.blocked) {
      dead.push(p.telegram_user_id);
    }
    await tg.broadcastPause();
  }

  const total = (ev.announce_sent || 0) + sent;
  await supabaseAdmin.from('tournament_events').update({ [K.sent]: total }).eq('id', eventId);

  // Players who blocked the bot: mark them unlinked (same as admin notices).
  if (dead.length > 0) {
    await supabaseAdmin.from('users').update({ telegram_linked_at: null }).in('telegram_user_id', dead);
  }

  const done = people.length < batchSize;
  if (done) {
    await supabaseAdmin
      .from('tournament_events')
      .update({ [K.done]: new Date().toISOString() })
      .eq('id', eventId)
      .is(K.done, null);
  }
  return { done, sent: total, channel: channelState, photoError: pic.failed ? pic.error || 'невідома помилка' : undefined };
}

/**
 * One message with the tournament card on top (the same picture as the
 * announcement) — for the bot's personal messages about a tournament
 * (pair invitations and their answers). `caption` is HTML; the text is
 * sent alone only if no way of sending the picture works.
 * Returns { ok, blocked, textOnly? }.
 *
 * @param {any} chatId
 * @param {{ siteUrl: string, eventId: string, caption: string, keyboard: any, telegram?: any }} opts
 * @returns {Promise<any>}
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
