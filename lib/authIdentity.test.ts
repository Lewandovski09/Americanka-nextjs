import { describe, it, expect } from 'vitest';
import { isValidLogin, isReservedLogin, normalizeLogin, emailForLogin, normalizeIdentifier } from './authIdentity';

describe('authIdentity', () => {
  it('normalizes and validates logins', () => {
    expect(normalizeLogin('  George.V ')).toBe('george.v');
    expect(isValidLogin('george_v')).toBe(true);
    expect(isValidLogin('ab')).toBe(false);
    expect(isValidLogin('Гіоргій')).toBe(false);
    expect(emailForLogin('George')).toBe('george@americanka.app');
  });

  it('keeps testbot_ logins for test players', () => {
    expect(isReservedLogin('testbot_42')).toBe(true);
    expect(isReservedLogin('TestBot_x')).toBe(true);
    expect(isReservedLogin('testbot')).toBe(false);
    expect(isReservedLogin('my_testbot_1')).toBe(false);
  });

  it('strips Telegram links down to the handle', () => {
    expect(normalizeIdentifier('https://t.me/Name?start=1')).toBe('name');
    expect(normalizeIdentifier('@name')).toBe('name');
  });
});
