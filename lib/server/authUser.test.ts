import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyJwt } from './authUser';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ISS = 'https://x.supabase.co/auth/v1';
const NOW = 1_800_000_000_000;
const claims = (extra: any = {}) => ({ sub: 'u1', aud: 'authenticated', role: 'authenticated', iss: ISS, exp: NOW / 1000 + 600, ...extra });

function signES(c: any, key: crypto.KeyObject, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify(c));
  const s = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(s)}`;
}
function signHS(c: any, secret: string) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(c));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk: any = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256' };
const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

describe('verifyJwt', () => {
  it('accepts a good ES256 token', () => {
    const r: any = verifyJwt(signES(claims(), privateKey), { jwks: [jwk], issuer: ISS, now: NOW });
    expect(r.sub).toBe('u1');
  });
  it('rejects a token signed by someone else', () => {
    expect(verifyJwt(signES(claims(), other.privateKey), { jwks: [jwk], issuer: ISS, now: NOW })).toBe(false);
  });
  it('rejects a changed payload', () => {
    const t = signES(claims(), privateKey).split('.');
    t[1] = b64u(JSON.stringify(claims({ sub: 'admin' })));
    expect(verifyJwt(t.join('.'), { jwks: [jwk], issuer: ISS, now: NOW })).toBe(false);
  });
  it('rejects expired, wrong audience, wrong issuer', () => {
    expect(verifyJwt(signES(claims({ exp: NOW / 1000 - 1 }), privateKey), { jwks: [jwk], issuer: ISS, now: NOW })).toBe(false);
    expect(verifyJwt(signES(claims({ aud: 'anon' }), privateKey), { jwks: [jwk], issuer: ISS, now: NOW })).toBe(false);
    expect(verifyJwt(signES(claims({ iss: 'https://evil/auth/v1' }), privateKey), { jwks: [jwk], issuer: ISS, now: NOW })).toBe(false);
  });
  it('unknown key → can’t tell here (null)', () => {
    expect(verifyJwt(signES(claims(), privateKey, 'k2'), { jwks: [jwk], issuer: ISS, now: NOW })).toBe(null);
  });
  it('HS256 only with the secret', () => {
    const t = signHS(claims(), 'shh');
    expect(verifyJwt(t, { issuer: ISS, now: NOW })).toBe(null);
    expect((verifyJwt(t, { secret: 'shh', issuer: ISS, now: NOW }) as any).sub).toBe('u1');
    expect(verifyJwt(t, { secret: 'wrong', issuer: ISS, now: NOW })).toBe(false);
  });
  it('alg none is never accepted', () => {
    const h = b64u(JSON.stringify({ alg: 'none' }));
    expect(verifyJwt(`${h}.${b64u(JSON.stringify(claims()))}.`, { jwks: [jwk], secret: 'shh', now: NOW })).toBe(null);
  });
});
