/** Spam protection for public forms: honeypot, minimum fill time, optional Turnstile, content heuristics. */
import { z } from 'zod';
import { config } from '../config';
import { sign, unsign } from './crypto';

export const HONEYPOT_FIELD = 'website';

export function issueFormToken(): string {
  return sign(`f:${Date.now()}`);
}

/** Rejects submissions made faster than a human could (bots) or with forged/expired tokens. */
export function checkFormToken(token: string | null, minMs = 2500, maxMs = 24 * 3600 * 1000): boolean {
  if (!token) return false;
  const payload = unsign(token);
  if (!payload?.startsWith('f:')) return false;
  const age = Date.now() - Number(payload.slice(2));
  return Number.isFinite(age) && age >= minMs && age <= maxMs;
}

export async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  if (!config.turnstile.enabled) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: config.turnstile.secretKey, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export function looksLikeSpam(text: string): boolean {
  const links = (text.match(/https?:\/\/|www\./gi) ?? []).length;
  if (links > 2) return true;
  if (/\[url=|<a\s+href/i.test(text)) return true;
  return /\b(viagra|cialis|casino|crypto ?invest|seo services|backlinks?|loan offer)\b/i.test(text);
}

const clean = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().max(max));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email address is too long.')
  .pipe(z.email({ message: 'Please enter a valid email address.' }));

export const contactSchema = z.object({
  name: clean(100).pipe(z.string().min(1, 'Please enter your name.')),
  email: emailSchema,
  subject: clean(150),
  message: clean(5000).pipe(z.string().min(10, 'Please write at least a short message (10+ characters).')),
});

export const newsletterSchema = z.object({
  email: emailSchema,
  consent: z.literal('yes', { message: 'Please confirm you would like to receive the newsletter.' }),
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

export function formString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}
