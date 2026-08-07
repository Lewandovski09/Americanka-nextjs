// Minimal in-process rate limiter for the API routes middleware.js
// already runs on. It's deliberately simple:
//
//  - In-memory Map, no Redis. This is correct for a single Railway
//    instance (which is what this app runs on) and WRONG the moment
//    the app scales to more than one instance, since each instance
//    would count independently, giving N * limit real capacity. If
//    Railway autoscaling is ever turned on for this service, swap
//    this for Upstash Redis (a few lines using @upstash/ratelimit) —
//    the call site in middleware.js won't need to change shape.
//  - Fixed window, not sliding/token-bucket. Simpler to reason about;
//    the tradeoff is a burst of up to 2x the limit right at a window
//    boundary. Fine for "stop obvious abuse", not built for precision.
//  - Keyed by IP + route bucket. Behind Railway's proxy the real
//    client IP arrives via x-forwarded-for.

import type { NextRequest } from 'next/server';

const WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup so the Map doesn't grow forever across a long
// server lifetime — Vercel/serverless wouldn't need this (fresh
// process per request), but Railway keeps one process running.
//
// middleware.js runs on the Edge runtime, where setInterval returns a
// plain number with no .unref() — only Node's timer objects have it.
// The cast (rather than relying on whichever global `setInterval`
// overload TypeScript's "dom" + "node" lib merge happens to pick) is
// what keeps this correct under both runtimes without guessing.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt < now) buckets.delete(key);
  }
}, WINDOW_MS);
(cleanupTimer as unknown as { unref?: () => void }).unref?.();

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * @param key - unique per (client, route-bucket)
 * @param limit - max requests allowed per WINDOW_MS
 */
export function checkRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, entry);
  }

  entry.count += 1;
  const limited = entry.count > limit;
  return { limited, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
}

export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export interface RateLimitRule {
  prefix: string;
  limit: number;
}

// Route-prefix -> requests per minute. Auth/registration and the
// Telegram link endpoints are the ones actually worth guarding: they're
// unauthenticated and cheap to hammer. Everything else defaults to a
// generous general-purpose limit further down in middleware.js.
export const RATE_LIMITS: RateLimitRule[] = [
  { prefix: '/api/auth/', limit: 10 },
  { prefix: '/api/telegram/link/', limit: 20 },
  { prefix: '/api/players/search', limit: 30 },
];
export const DEFAULT_API_LIMIT = 60;
