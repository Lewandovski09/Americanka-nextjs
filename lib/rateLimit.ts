// Rate limiter for the API routes middleware.js runs on — built for
// Vercel, where the app runs as MANY short-lived instances at once.
//
// Two backends, picked by environment:
//
//  - Upstash Redis (when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//    are set — Vercel → Storage / Marketplace → Upstash, free tier is
//    plenty). One shared counter for every instance, so the limit is the
//    real limit. Spoken to over its REST API with plain fetch(): no
//    package, works on the Edge runtime middleware uses.
//  - In-memory fallback (no Upstash configured, or Upstash unreachable).
//    Each Vercel instance counts on its own, so the effective limit is
//    looser than the number says — still stops a single client
//    hammering one instance, and never blocks the site.
//
// Fixed one-minute windows: the counter key carries the window number,
// so it expires on its own. Fails OPEN — a rate limiter that is down
// must not take the login form down with it.

import type { NextRequest } from 'next/server';

const WINDOW_MS = 60_000;
const UPSTASH_TIMEOUT_MS = 800;

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
}

// ── In-memory fallback ──
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

function checkInMemory(key: string, limit: number, now: number): RateLimitResult {
  // Opportunistic cleanup instead of a timer: serverless instances are
  // frozen between requests, so a setInterval would never fire anyway.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  }
  let entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, entry);
  }
  entry.count += 1;
  return { limited: entry.count > limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
}

// ── Upstash (shared across all instances) ──
async function checkUpstash(url: string, token: string, key: string, limit: number, now: number): Promise<RateLimitResult> {
  const windowNo = Math.floor(now / WINDOW_MS);
  const resetAt = (windowNo + 1) * WINDOW_MS;
  const redisKey = `rl:${key}:${windowNo}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, String(Math.ceil(WINDOW_MS / 1000) + 5)],
      ]),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ result?: number; error?: string }>;
    const count = Number(data?.[0]?.result);
    if (!Number.isFinite(count)) throw new Error(data?.[0]?.error || 'Upstash: bad reply');
    return { limited: count > limit, remaining: Math.max(0, limit - count), resetAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param key - unique per (client, route-bucket)
 * @param limit - max requests allowed per minute
 */
export async function checkRateLimit(key: string, limit: number): Promise<RateLimitResult> {
  const now = Date.now();
  // Vercel's Upstash integration names them KV_REST_API_*; a database
  // made on upstash.com directly gives UPSTASH_REDIS_REST_*. Either works.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    try {
      return await checkUpstash(url, token, key, limit, now);
    } catch (err) {
      console.error('[rateLimit] Upstash unavailable, using in-memory fallback:', (err as Error).message);
    }
  }
  return checkInMemory(key, limit, now);
}

/** The visitor's IP. On Vercel both headers are set by the platform itself. */
export function clientIp(request: NextRequest): string {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

export interface RateLimitRule {
  prefix: string;
  limit: number;
}

// Route-prefix -> requests per minute.
//
// Counted PER PLAYER when the request carries a session (middleware.js
// reads the player from the session cookie — lib/sessionUser), and per
// address only for visitors who are not logged in. On a tournament day
// the whole beach sits on one Wi-Fi, i.e. one address: 100 players at
// once must not share one counter.
export const RATE_LIMITS: RateLimitRule[] = [
  // Login / registration / password reset — before a session exists, so
  // per address: roomy enough for a crowd logging in on one Wi-Fi, still
  // a wall against a password-guessing script.
  { prefix: '/api/auth/', limit: 150 },
  { prefix: '/api/telegram/link/', limit: 60 },
  // partner search as you type — per player
  { prefix: '/api/players/search', limit: 90 },
];
export const DEFAULT_API_LIMIT = 300; // per player (or per address without a session)

// Logged-in traffic from ONE address, all players together — only a
// ceiling against a forged-cookie flood; 150+ real players stay far below.
export const ADDRESS_CEILING = 6000;
