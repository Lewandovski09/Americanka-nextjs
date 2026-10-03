'use client';

// Venues (and their cities) come from the `venues` table since migration
// 043 — they used to be hardcoded in five files as LOCATION_LABEL /
// COURT_RANGES maps for exactly two places. Adding a court, a venue or a
// whole city is now a row in the database, not a code change.
//
// Loaded once per page load and shared by every component that asks:
// the list is tiny and changes about as often as a club opens a new
// beach.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

let venuesPromise = null;

export function loadVenues() {
  if (!venuesPromise) {
    venuesPromise = createClient()
      .from('venues')
      .select('id, code, name, address, courts, is_active, sort_order, city:cities(id, name, timezone), venue_sports(sport_id)')
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error('[venues] load:', error.message);
          venuesPromise = null; // let the next caller retry
          return [];
        }
        return (data || []).map((v) => ({
          ...v,
          courts: [...(v.courts || [])].sort((a, b) => a - b),
          sports: (v.venue_sports || []).map((s) => s.sport_id),
        }));
      });
  }
  return venuesPromise;
}

/** All venues, `[]` until loaded. */
export function useVenues() {
  const [venues, setVenues] = useState([]);
  useEffect(() => {
    let alive = true;
    loadVenues().then((v) => alive && setVenues(v));
    return () => {
      alive = false;
    };
  }, []);
  return venues;
}

/** Venues an admin may put a NEW event at, optionally for one sport. */
export function selectableVenues(venues, sportId, keepCode = null) {
  return venues.filter(
    (v) =>
      (v.is_active || v.code === keepCode) &&
      (!sportId || v.sports.length === 0 || v.sports.includes(sportId))
  );
}

export function findVenue(venues, code) {
  return venues.find((v) => v.code === code) || null;
}

/** «Beach 13» — or «Beach 13 · Одеса» once the club plays in more than one city. */
export function venueLabel(venues, code) {
  const v = findVenue(venues, code);
  if (!v) return code || '';
  const cities = new Set(venues.map((x) => x.city?.id).filter(Boolean));
  return cities.size > 1 && v.city?.name ? `${v.name} · ${v.city.name}` : v.name;
}
