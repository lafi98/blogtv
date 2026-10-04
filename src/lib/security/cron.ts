import { config } from '../config';
import { safeEqual } from './crypto';

/**
 * Cron endpoints require the shared secret, sent as "Authorization: Bearer <CRON_SECRET>"
 * (or "X-Cron-Secret: <CRON_SECRET>" for schedulers that can't set Authorization).
 *   'ok'             — authorised
 *   'not_configured' — CRON_SECRET missing/too short on the server (endpoint refuses to run)
 *   'denied'         — missing or wrong secret
 */
export function cronAuthorized(request: Request): 'ok' | 'not_configured' | 'denied' {
  if (!config.cronSecret || config.cronSecret.length < 24) return 'not_configured';
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (request.headers.get('x-cron-secret') ?? '').trim();
  return token && safeEqual(token, config.cronSecret) ? 'ok' : 'denied';
}

export function cronAuthResponse(auth: 'not_configured' | 'denied'): Response {
  const body =
    auth === 'not_configured'
      ? { error: 'CRON_SECRET_NOT_CONFIGURED', message: 'Set CRON_SECRET (at least 24 characters) in the server environment to enable this endpoint.' }
      : { error: 'UNAUTHORIZED', message: 'Missing or invalid cron secret.' };
  return new Response(JSON.stringify(body), {
    status: auth === 'not_configured' ? 503 : 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
  });
}
