import { describe, it, expect } from 'vitest';
import {
  registrationState,
  registrationLabel,
  opensLabel,
  feeLabel,
  parseEntryFee,
  parseRegistrationOpens,
  msUntilOpen,
} from './registrationWindow';

const NOW = Date.parse('2026-10-06T10:00:00Z');
const later = '2026-10-07T09:00:00.000Z'; // 12:00 in Kyiv
const earlier = '2026-10-05T09:00:00.000Z';

describe('registrationState', () => {
  it('open when no opening time is set', () => {
    expect(registrationState({ status: 'scheduled' }, NOW)).toBe('open');
  });
  it('soon before the opening, open after it', () => {
    expect(registrationState({ status: 'scheduled', registration_opens_at: later }, NOW)).toBe('soon');
    expect(registrationState({ status: 'scheduled', registration_opens_at: earlier }, NOW)).toBe('open');
  });
  it('closed by the admin or once started — whatever the time', () => {
    expect(registrationState({ status: 'scheduled', registration_open: false, registration_opens_at: later }, NOW)).toBe('closed');
    expect(registrationState({ status: 'live' }, NOW)).toBe('closed');
  });
  it('counts down to the opening', () => {
    expect(msUntilOpen({ registration_opens_at: later }, NOW)).toBe(Date.parse(later) - NOW);
    expect(msUntilOpen({ registration_opens_at: earlier }, NOW)).toBe(0);
  });
});

describe('labels', () => {
  it('shows the opening in Kyiv time', () => {
    expect(opensLabel(later)).toBe('7 жовтня о 12:00');
    expect(registrationLabel({ status: 'scheduled', registration_opens_at: later }, NOW)).toBe('Заявки з 7 жовтня о 12:00');
    expect(registrationLabel({ status: 'scheduled' }, NOW)).toBe('Реєстрація відкрита');
  });
  it('fee', () => {
    expect(feeLabel(300)).toBe('300 грн з гравця');
    expect(feeLabel(1500)).toBe('1 500 грн з гравця');
    expect(feeLabel(0)).toBe('Безкоштовно');
    expect(feeLabel(null)).toBe(null);
  });
});

describe('parseEntryFee', () => {
  it('required at creation, 0 is an answer', () => {
    expect(parseEntryFee('', { required: true }).error).toBeTruthy();
    expect(parseEntryFee(0, { required: true })).toEqual({ fee: 0 });
    expect(parseEntryFee('300')).toEqual({ fee: 300 });
    expect(parseEntryFee('')).toEqual({ fee: null });
  });
  it('refuses nonsense', () => {
    expect(parseEntryFee('-5').error).toBeTruthy();
    expect(parseEntryFee('12.5').error).toBeTruthy();
    expect(parseEntryFee('abc').error).toBeTruthy();
    expect(parseEntryFee('1000000').error).toBeTruthy();
  });
});

describe('parseRegistrationOpens', () => {
  const start = '2026-10-10T07:00:00.000Z';
  it('empty or past → at once', () => {
    expect(parseRegistrationOpens('', start, NOW)).toEqual({ opensAt: null });
    expect(parseRegistrationOpens(earlier, start, NOW)).toEqual({ opensAt: null });
  });
  it('a future moment before the start', () => {
    expect(parseRegistrationOpens(later, start, NOW)).toEqual({ opensAt: later });
  });
  it('not after the start', () => {
    expect(parseRegistrationOpens('2026-10-11T07:00:00Z', start, NOW).error).toBeTruthy();
    expect(parseRegistrationOpens('nope', start, NOW).error).toBeTruthy();
  });
});

import { formatPhone, formatTelegram } from './organizer';
import { placesLabel } from './server/eventCardData';
describe('organizer and places', () => {
  it('formats the phone and the Telegram name', () => {
    expect(formatPhone('0671874410')).toBe('067 187 44 10');
    expect(formatPhone('+380671874410')).toBe('067 187 44 10');
    expect(formatTelegram('https://t.me/george_bv')).toBe('@george_bv');
    expect(formatTelegram('@george_bv')).toBe('@george_bv');
    expect(formatTelegram('')).toBe(null);
  });
  it('places', () => {
    expect(placesLabel(8, false)).toBe('8 місць');
    expect(placesLabel(21, false)).toBe('21 місце');
    expect(placesLabel(3, false)).toBe('3 місця');
    expect(placesLabel(16, true)).toBe('16 пар');
    expect(placesLabel(2, true)).toBe('2 пари');
  });
});
