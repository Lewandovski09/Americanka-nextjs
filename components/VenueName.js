'use client';

// The display name of a venue by its code (tournament_events.location),
// read from the `venues` table — the replacement for the LOCATION_LABEL
// maps that used to be copied into every page that showed a venue.
import { useVenues, venueLabel } from '@/hooks/useVenues';

export default function VenueName({ code }) {
  const venues = useVenues();
  return <>{venueLabel(venues, code)}</>;
}
