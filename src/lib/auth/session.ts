/**
 * Admin authentication: scrypt password hashes, opaque random session tokens (only their
 * SHA-256 hash is stored), HttpOnly + SameSite=Lax cookies, per-session CSRF tokens,
 * login rate limiting and temporary lockout after repeated failures.
 */
import type { AstroCookies } from 'astro';
import { getDb, nowIso, audit } from '../db';
import { config } from '../config';
import { dummyPasswordCheck, hashPassword, randomToken, sha256, verifyPassword } from '../security/crypto';
import { rateLimit } from '../security/rateLimit';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'editor';
  csrfToken: string;
}

const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const secureCookies = () => config.siteUrl.startsWith('https://');
export const sessionCookieName = () => (secureCookies() ? '__Host-hh_session' : 'hh_session');

export function setSessionCookie(cookies: AstroCookies, token: string) {
  cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export function clearSessionCookie(cookies: AstroCookies) {
  cookies.delete(sessionCookieName(), { path: '/' });
}

export function getSessionUser(token: string | undefined): SessionUser | null {
  if (!token || token.length > 200) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, s.csrf_token, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as
    | { id: number; email: string; name: string; role: 'admin' | 'editor'; csrf_token: string; expires_at: string }
    | undefined;
  if (!row || row.expires_at < nowIso()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, csrfToken: row.csrf_token };
}

function createSession(userId: number, userAgent: string): string {
  const token = randomToken(32);
  const now = new Date();
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      sha256(token),
      userId,
      randomToken(24),
      now.toISOString(),
      new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString(),
      userAgent.slice(0, 300),
    );
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  return token;
}

export function destroySession(token: string | undefined) {
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export type LoginResult = { ok: true; token: string } | { ok: false; error: string };

export function login(emailRaw: string, password: string, ipKeyValue: string, userAgent: string): LoginResult {
  const email = emailRaw.trim().toLowerCase();
  const generic = 'Incorrect email or password.';
  if (!rateLimit(`login:ip:${ipKeyValue}`, 10, 900).ok || !rateLimit(`login:email:${email}`, 10, 900).ok) {
    return { ok: false, error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' };
  }
  if (!email || !password || password.length > 1024) return { ok: false, error: generic };
  const db = getDb();
  const user = db.prepare('SELECT id, password_hash, failed_logins, locked_until FROM users WHERE email = ?').get(email) as
    | { id: number; password_hash: string; failed_logins: number; locked_until: string | null }
    | undefined;
  if (!user) {
    dummyPasswordCheck(password);
    return { ok: false, error: generic };
  }
  if (user.locked_until && user.locked_until > nowIso()) {
    return { ok: false, error: 'This account is temporarily locked after several failed attempts. Try again later.' };
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    audit('login.failed', { userId: user.id, entity: 'user', entityId: user.id });
    return { ok: false, error: generic };
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  audit('login.success', { userId: user.id, entity: 'user', entityId: user.id });
  return { ok: true, token: createSession(user.id, userAgent) };
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 256) return 'Password is too long.';
  if (/^(.)\1+$/.test(pw)) return 'Password is too repetitive.';
  return null;
}

export function createUser(email: string, name: string, password: string, role: 'admin' | 'editor' = 'admin'): number {
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(problem);
  const res = getDb()
    .prepare('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email.trim().toLowerCase(), name.trim(), hashPassword(password), role, nowIso());
  return Number(res.lastInsertRowid);
}

export function changePassword(userId: number, current: string, next: string): string | null {
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
  if (!row || !verifyPassword(current, row.password_hash)) return 'Current password is incorrect.';
  const problem = validatePasswordStrength(next);
  if (problem) return problem;
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), userId);
  // Sign out every other session for this user.
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  audit('password.changed', { userId, entity: 'user', entityId: userId });
  return null;
}

export function countUsers(): number {
  return (getDb().prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
}
