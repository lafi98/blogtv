/**
 * Fixed-window rate limiter stored in SQLite, so limits survive restarts and are shared
 * by every worker process using the same database. (For multi-server deployments use a
 * shared store such as Redis instead.)
 */
import { getDb } from '../db';
import { config } from '../config';
import { hmac } from './crypto';

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

let lastCleanup = 0;

export function rateLimit(bucket: string, limit: number, windowSec: number): RateResult {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const row = db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .get(bucket, windowStart) as { count: number };
  if (now - lastCleanup > 600) {
    lastCleanup = now;
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(now - 86400 * 2);
  }
  return { ok: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfter: windowStart + windowSec - now };
}

/** Client IP, honouring X-Forwarded-For only when TRUST_PROXY=true. */
export function clientIp(request: Request, clientAddress?: string): string {
  if (config.trustProxy) {
    const fwd = request.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    const real = request.headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return clientAddress || 'unknown';
}

/** Pseudonymous IP key — raw IP addresses are never stored. */
export const ipKey = (ip: string) => hmac(`ip:${ip}`).slice(0, 24);
