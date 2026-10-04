/** Security headers, including a nonce-based strict Content-Security-Policy. */
import { config } from '../config';

export interface CspNeeds {
  ads: boolean;
  analytics: boolean;
  turnstile: boolean;
}

/**
 * Strict CSP (https://csp.withgoogle.com/docs/strict-csp.html): only scripts carrying this
 * request's nonce may run; 'strict-dynamic' lets those scripts load AdSense/analytics.
 * 'unsafe-inline' and https: are ignored by modern browsers when a nonce is present —
 * they are fallbacks for very old browsers only.
 */
export function buildCsp(nonce: string, needs: CspNeeds): string {
  const thirdParty = needs.ads || needs.analytics;
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [`'nonce-${nonce}'`, "'strict-dynamic'", 'https:', "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', ...(thirdParty ? ['https:'] : [])],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(thirdParty ? ['https:'] : [])],
    'frame-src': needs.ads ? ['https:'] : needs.turnstile ? ['https://challenges.cloudflare.com'] : ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
  };
  if (needs.ads && needs.turnstile) d['frame-src'] = ['https:'];
  let csp = Object.entries(d)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
  if (config.siteUrl.startsWith('https://')) csp += '; upgrade-insecure-requests';
  return csp;
}

export function baseSecurityHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  };
  if (config.siteUrl.startsWith('https://')) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}
