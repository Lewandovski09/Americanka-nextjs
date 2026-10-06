// Everything the tournament card shows — the same card as «Найближчий
// турнір» on the home page — for one event, read on the server. Used by
// the card picture (app/api/og/event/[eventId]) and the Telegram
// announcement text (lib/server/eventAnnouncement).

import { getFormat } from '@/lib/formats';
import { enrichCategoriesWithSlots } from '@/lib/eventCategories';
import { CLUB_TZ } from '@/lib/dates';

const GENDER_LABEL = { M: 'Чоловіки', F: 'Жінки' };

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
 *   venue: string, avpTier: string | number | null, statusLabel: string,
 *   isPair: boolean, gender: 'M' | 'F' | null,
 *   categories: { id: string, label: string, gender: string | null, genderLabel: string | null,
 *     bracketLabel: string | null, avpTier: any, taken: number, total: number, left: number, unit: string }[]
 * }>}
 */
export async function loadEventCardData(supabase, eventId) {
  const [{ data: event }, { data: cats }] = await Promise.all([
    supabase
      .from('tournament_events')
      .select('id, name, format_kind, avp_tier, location, scheduled_at, status')
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
  const shownCats = open.length > 0 ? open : cats || [];
  const enriched = await enrichCategoriesWithSlots(supabase, shownCats, format, event.avp_tier);

  const { data: venue } = event.location
    ? await supabase.from('venues').select('name, city:cities(name)').eq('code', event.location).maybeSingle()
    : { data: null };

  // Men only / women only → the announcement goes only to them.
  const genders = new Set(shownCats.map((c) => c.gender || 'X'));
  const gender = genders.size === 1 && (genders.has('M') || genders.has('F')) ? [...genders][0] : null;

  const title = format?.displayName || 'Турнір';
  const name = event.name && event.name.trim() && event.name.trim() !== title ? event.name.trim() : null;
  const live = shownCats.some((c) => c.status === 'live');

  return {
    id: event.id,
    title,
    name,
    dateLabel: eventDateLabel(shownCats[0]?.scheduled_at || event.scheduled_at),
    venue: venue?.name || event.location || '',
    avpTier: event.avp_tier ?? null,
    statusLabel: live ? 'Триває' : 'Реєстрація відкрита',
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
    })),
  };
}
