import crypto from 'node:crypto';
import { config } from '../config';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const hmac = (s: string) => crypto.createHmac('sha256', config.appSecret).update(s).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// scrypt parameters: N=2^15, r=8, p=1 (≈32 MiB, tens of ms) — comfortably above OWASP minimums.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** A precomputed hash so logins for unknown emails take as long as real ones. */
let dummyHash: string | null = null;
export function dummyPasswordCheck(password: string) {
  dummyHash ??= hashPassword(randomToken(12));
  verifyPassword(password, dummyHash);
}

/** Tamper-evident value: "<payload>.<hmac>". */
export function sign(payload: string): string {
  return `${payload}.${hmac(payload)}`;
}

export function unsign(signed: string): string | null {
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = signed.slice(0, i);
  return safeEqual(hmac(payload), signed.slice(i + 1)) ? payload : null;
}
