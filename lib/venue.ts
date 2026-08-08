// Single source of truth for the club's name and location. Was
// previously hardcoded separately in app/page.js (the header) and
// app/layout.js (page title/description/PWA name) — two copies that
// had to be kept in sync by hand. Still just one club, one location:
// this doesn't turn the app multi-tenant on its own, but it's the
// first step — if a second location or club is ever added, this is
// the one place that becomes a lookup instead of a rewrite.

export const VENUE = {
  brandName: 'Americanka',
  venueName: 'Пляж 13',
  city: 'Одеса',
  address: 'Станція Фонтана, Одеса',
  /** "Пляж 13 · Станція Фонтана, Одеса" — the header/footer one-liner. */
  get fullLocation() {
    return `${this.venueName} · ${this.address}`;
  },
};
