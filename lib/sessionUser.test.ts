import { describe, it, expect } from 'vitest';
import { sessionUserId, sessionCookieValue } from './sessionUser';

const SUB = '6f1c2a3b-1234-4abc-9def-0123456789ab';
const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = `${b64u('{"alg":"HS256"}')}.${b64u(JSON.stringify({ sub: SUB, role: 'authenticated' }))}.sig`;
const session = JSON.stringify({ access_token: jwt, refresh_token: 'r', user: { id: SUB, user_metadata: { name: 'Влада' } } });

describe('sessionUserId', () => {
  it('base64- cookie (current @supabase/ssr)', () => {
    expect(sessionUserId([{ name: 'sb-abc-auth-token', value: 'base64-' + b64u(session) }])).toBe(SUB);
  });
  it('plain JSON cookie (older versions)', () => {
    expect(sessionUserId([{ name: 'sb-abc-auth-token', value: encodeURIComponent(session) }])).toBe(SUB);
  });
  it('chunked cookie, chunks in any order', () => {
    const v = 'base64-' + b64u(session);
    const cut = Math.floor(v.length / 2);
    const cookies = [
      { name: 'sb-abc-auth-token.1', value: v.slice(cut) },
      { name: 'sb-abc-auth-token.0', value: v.slice(0, cut) },
    ];
    expect(sessionCookieValue(cookies)).toBe(v);
    expect(sessionUserId(cookies)).toBe(SUB);
  });
  it('no session / garbage → null', () => {
    expect(sessionUserId([])).toBe(null);
    expect(sessionUserId([{ name: 'other', value: 'x' }])).toBe(null);
    expect(sessionUserId([{ name: 'sb-abc-auth-token', value: 'base64-@@@' }])).toBe(null);
  });
});
