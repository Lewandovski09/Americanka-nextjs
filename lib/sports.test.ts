import { describe, it, expect } from 'vitest';
import { getSport, divisionsFor, sportOffersFormat, PRIMARY_SPORT_ID, listSports } from './sports';
import { CATEGORY_LABELS, FORMAT_KINDS } from './formats';

describe('sports registry', () => {
  it('falls back to the primary sport when none is given', () => {
    expect(getSport(null)?.id).toBe(PRIMARY_SPORT_ID);
    expect(getSport(undefined)?.id).toBe(PRIMARY_SPORT_ID);
  });

  it('knows nothing about an unregistered sport', () => {
    expect(getSport('curling')).toBeNull();
    expect(sportOffersFormat('curling', 'americanka')).toBe(false);
  });

  it('keeps CATEGORY_LABELS equal to the primary sport divisions', () => {
    expect(CATEGORY_LABELS).toEqual(divisionsFor(PRIMARY_SPORT_ID));
    expect(divisionsFor(null)).toEqual(['Light', 'Medium', 'Pro']);
  });

  it('only lists formats that exist in the formats registry', () => {
    for (const sport of listSports()) {
      for (const kind of sport.formats) expect(Object.keys(FORMAT_KINDS)).toContain(kind);
    }
  });

  it('beach volleyball offers every current format', () => {
    for (const kind of Object.keys(FORMAT_KINDS)) expect(sportOffersFormat(PRIMARY_SPORT_ID, kind)).toBe(true);
  });
});
