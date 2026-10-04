'use client';

// The club-wide seasons of the primary sport, both tracks (AVP and Ело,
// migration 045), loaded once per browser tab and shared by every page
// and card that needs to say «which season is this». One request feeds
// the home header, the rating page, the profile cards and the «Турніри · AVP» list.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PRIMARY_SPORT_ID } from '@/lib/sports';
import { memoize, getCached } from '@/lib/clientCache';
import { kyivDay } from '@/lib/dates';

const KEY = 'seasons:club';
const TTL = 5 * 60 * 1000;

function pickCurrent(list, kind) {
  const track = list.filter((s) => (s.kind || 'avp') === kind);
  // The open one (ends_on = NULL); between seasons — the most recent.
  return track.find((s) => s.ends_on === null) || track[0] || null;
}

function shape(list) {
  return { all: list, avp: pickCurrent(list, 'avp'), elo: pickCurrent(list, 'elo') };
}

export function loadClubSeasons(supabase = createClient()) {
  return memoize(KEY, TTL, async () => {
    const { data } = await supabase
      .from('avp_seasons')
      .select('id, name, kind, starts_on, ends_on')
      .eq('sport_id', PRIMARY_SPORT_ID)
      .is('city_id', null)
      .order('starts_on', { ascending: false });
    return shape(data || []);
  });
}

/** { all, avp, elo } — null until the first load; instant afterwards. */
export function useClubSeasons() {
  const [seasons, setSeasons] = useState(() => getCached(KEY)?.value || null);
  useEffect(() => {
    let alive = true;
    loadClubSeasons().then((s) => alive && setSeasons(s));
    return () => {
      alive = false;
    };
  }, []);
  return seasons;
}

export function formatSeasonDate(date) {
  return date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('uk', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
}

/** «з 1 січ. 2026» for an open season, «1 січ. — 31 груд. 2026» for a closed one. */
export function seasonDates(s) {
  if (!s) return '';
  return s.ends_on === null
    ? `з ${formatSeasonDate(s.starts_on)}`
    : `${formatSeasonDate(s.starts_on)} — ${formatSeasonDate(s.ends_on)}`;
}

/**
 * The text for the home header: one name when both tracks are in the
 * same season (the usual case), both when they differ.
 */
export function seasonHeadline(seasons) {
  if (!seasons) return '';
  const { avp, elo } = seasons;
  if (avp && elo && avp.name === elo.name) return avp.name;
  return [avp && `AVP: ${avp.name}`, elo && `Ело: ${elo.name}`].filter(Boolean).join(' · ');
}

/** Whether a timestamp / date string falls inside the season (inclusive). */
export function inSeason(when, s) {
  if (!s || !when) return false;
  const day = kyivDay(when);
  return day >= s.starts_on && (s.ends_on === null || day <= s.ends_on);
}
