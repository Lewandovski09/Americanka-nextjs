// Everything the tournament card shows — the same card as «Найближчий
// турнір» on the home page — for one event, read on the server. Used by
// the card picture (app/api/og/event/[eventId]) and the Telegram
// announcement text (lib/server/eventAnnouncement).

import { getFormat } from '@/lib/formats';
import { americankaSum } from '@/lib/formats/americano';
import { enrichCategoriesWithSlots } from '@/lib/eventCategories';
import { CLUB_TZ } from '@/lib/dates';
import { registrationState, registrationLabel, opensLabel, feeLabel } from '@/lib/registrationWindow';
import { organizerContacts } from '@/lib/organizer';
import { pluralUk } from '@/lib/pluralize';

/** «8 місць» for players, «8 пар» for pairs — the size of a league, as on the poster. */
export function placesLabel(total, isPair) {
  const n = Number(total) || 0;
  return isPair ? `${n} ${pluralUk(n, 'пара', 'пари', 'пар')}` : `${n} ${pluralUk(n, 'місце', 'місця', 'місць')}`;
}

const GENDER_LABEL = { M: 'Чоловіки', F: 'Жінки' };

/** { day: '10', month: 'жовтня', weekday: 'субота', time: '10:00' } — Kyiv time, for the poster. */
export function eventDateParts(when) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  const dm = d.toLocaleDateString('uk', { day: 'numeric', month: 'long', timeZone: CLUB_TZ });
  const [day, ...month] = dm.split(' ');
  return {
    day,
    month: month.join(' '),
    weekday: d.toLocaleDateString('uk', { weekday: 'long', timeZone: CLUB_TZ }),
    time: d.toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit', timeZone: CLUB_TZ }),
  };
}

/** «Субота, 10 жовтня 2026 р. о 10:00» — in Kyiv time, whatever the server's zone. */
export function eventDateLabel(when) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  const s = d.toLocaleString('uk', { dateStyle: 'full', timeStyle: 'short', timeZone: CLUB_TZ });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @returns {Promise<null | {
 *   id: string, title: string, name: string | null, dateLabel: string,
 *   venue: string, city: string | null, avpTier: string | number | null, statusLabel: string,
 *   regState: 'open' | 'soon' | 'closed', opensLabel: string | null, fee: number | null,
 *   feeLabel: string | null, scoring: string | null, startDate: string,
 *   isPair: boolean, gender: 'M' | 'F' | null,
 *   categories: { id: string, label: string, gender: string | null, genderLabel: string | null,
 *     bracketLabel: string | null, avpTier: any, taken: number, total: number, left: number, unit: string }[]
 * }>}
 */
/**
 * @param {any} supabase
 * @param {string} eventId
 * @param {{ schedule?: boolean }} [opts] schedule — the picture for «Розклад готовий»: only the
 *   categories actually started (live / done) with their final rosters.
 */
export async function loadEventCardData(supabase, eventId, { schedule = false } = {}) {
  const [{ data: event }, { data: cats }] = await Promise.all([
    supabase
      .from('tournament_events')
      .select(
        'id, name, format_kind, avp_tier, location, scheduled_at, status, registration_open, registration_opens_at, registration_closes_at, schedule_at, entry_fee, points_to_win, points_mode, final_points_to_win, created_by, is_test'
      )
      .eq('id', eventId)
      .maybeSingle(),
    supabase
      .from('tournament_categories')
      .select('id, status, name, scheduled_at, category_label, gender, max_participants, avp_tier, bracket_system')
      .eq('event_id', eventId)
      .order('category_label', { ascending: true }),
  ]);
  if (!event) return null;

  const format = getFormat(event.format_kind);
  const isPair = !!format?.registrationType && format.registrationType !== 'solo';
  const open = (cats || []).filter((c) => c.status === 'scheduled' || c.status === 'live');
  const started = (cats || []).filter((c) => c.status === 'live' || c.status === 'done');
  const shownCats = schedule && started.length > 0 ? started : open.length > 0 ? open : cats || [];
  const enriched = await enrichCategoriesWithSlots(supabase, shownCats, format, event.avp_tier);

  const [{ data: venue }, { data: creator }] = await Promise.all([
    event.location
      ? supabase.from('venues').select('name, city:cities(name)').eq('code', event.location).maybeSingle()
      : Promise.resolve({ data: null }),
    // the organizer's Telegram for «питання» (lib/organizer)
    event.created_by
      ? supabase.from('users').select('telegram_username').eq('id', event.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Men only / women only → the announcement goes only to them.
  const genders = new Set(shownCats.map((c) => c.gender || 'X'));
  const gender = genders.size === 1 && (genders.has('M') || genders.has('F')) ? [...genders][0] : null;

  const title = format?.displayName || 'Турнір';
  const name = event.name && event.name.trim() && event.name.trim() !== title ? event.name.trim() : null;
  const live = schedule || shownCats.some((c) => c.status === 'live');
  const regState = live ? 'closed' : registrationState(event);

  // How the games are scored — one line for the poster.
  let scoring = null;
  if (format?.scoring === 'sum31') scoring = `Рахунок до суми ${americankaSum(event.points_to_win)}`;
  else if (format?.scoring === 'first_to' && event.points_to_win) {
    scoring =
      event.points_mode === 'from_semifinal' && event.final_points_to_win
        ? `Партії до ${event.points_to_win}, з півфіналу — до ${event.final_points_to_win}`
        : `Партії до ${event.points_to_win}`;
  }

  return {
    id: event.id,
    title,
    name,
    dateLabel: eventDateLabel(shownCats[0]?.scheduled_at || event.scheduled_at),
    venue: venue?.name || event.location || '',
    city: venue?.city?.name || null,
    avpTier: event.avp_tier ?? null,
    statusLabel: schedule ? 'Розклад готовий' : live ? 'Триває' : registrationLabel(event),
    // the picture's top line and bottom line (lib/eventCard)
    kicker: schedule ? 'РОЗКЛАД ГОТОВИЙ' : 'НОВИЙ ТУРНІР',
    footer: schedule ? 'Розклад і рахунок — у застосунку Americanka' : 'Записатися — у застосунку Americanka',
    schedule,
    // Poster (lib/eventPoster) and captions: when applications open, the fee.
    regState,
    opensLabel: regState === 'soon' ? opensLabel(event.registration_opens_at) : null,
    fee: event.entry_fee ?? null,
    feeLabel: feeLabel(event.entry_fee),
    scoring,
    organizer: organizerContacts(creator?.telegram_username),
    isTest: !!event.is_test,
    startDate: shownCats[0]?.scheduled_at || event.scheduled_at,
    dateParts: eventDateParts(shownCats[0]?.scheduled_at || event.scheduled_at),
    opensParts: regState === 'soon' ? eventDateParts(event.registration_opens_at) : null,
    // until when applications go, and when the schedule is out (068)
    closesLabel: regState !== 'closed' && event.registration_closes_at ? opensLabel(event.registration_closes_at) : null,
    scheduleLabel: event.schedule_at ? opensLabel(event.schedule_at) : null,
    isPair,
    gender,
    categories: enriched.map((c) => ({
      id: c.id,
      label: c.category_label || c.name || '',
      gender: c.gender || null,
      genderLabel: GENDER_LABEL[c.gender] || (isPair ? 'Мікс' : null),
      bracketLabel: c.bracketLabel || null,
      avpTier: c.avpTier || null,
      taken: c.slotsTaken,
      total: c.slotsTotal,
      left: c.spotsLeft,
      unit: c.slotsLabel,
      places: placesLabel(c.slotsTotal, isPair),
    })),
  };
}
