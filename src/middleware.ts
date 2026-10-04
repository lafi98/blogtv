import { defineMiddleware } from 'astro:middleware';
import { config } from './lib/config';
import { randomToken, safeEqual } from './lib/security/crypto';
import { baseSecurityHeaders, buildCsp } from './lib/security/headers';
import { getSessionUser, sessionCookieName } from './lib/auth/session';
import { maybePublishDue } from './lib/publishing/scheduler';
import { adRuntime } from './lib/ads';
import { getSettings } from './lib/settings';
import { takeFlash } from './lib/admin/flash';

const PUBLIC_ADMIN_PATHS = new Set(['/admin/login']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** CSRF defence in depth: state-changing requests must come from this site's own pages. */
function sameOrigin(request: Request, url: URL): boolean {
  const allowed = new Set([url.origin]);
  try {
    allowed.add(new URL(config.siteUrl).origin);
  } catch {
    /* ignore */
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return allowed.has(origin);
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return allowed.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  try {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  } catch {
    // Some responses (e.g. Response.redirect) have immutable headers — copy them.
    const copy = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    for (const [k, v] of Object.entries(headers)) copy.headers.set(k, v);
    return copy;
  }
}

let startupChecked = false;
function startupWarnings() {
  if (startupChecked) return;
  startupChecked = true;
  if (config.isProd && !config.allowIndexing)
    console.warn('[launch] ALLOW_INDEXING is not "true": robots.txt blocks search engines and every page is noindex. Set ALLOW_INDEXING=true on the live site.');
  if (config.isProd && !config.siteUrl.startsWith('https://')) console.warn(`[launch] SITE_URL is ${config.siteUrl} — use your https:// domain in production.`);
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  startupWarnings();
  const { pathname } = ctx.url;
  const nonce = randomToken(18);
  ctx.locals.nonce = nonce;
  ctx.locals.user = null;
  ctx.locals.csrfToken = '';
  ctx.locals.flash = null;

  // Safety net for scheduled posts when no external cron is configured.
  maybePublishDue();

  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  const isApi = pathname.startsWith('/api/');

  // Cron endpoints authenticate with a bearer token instead (called by schedulers, not browsers).
  if (UNSAFE_METHODS.has(ctx.request.method) && !pathname.startsWith('/api/cron/') && !sameOrigin(ctx.request, ctx.url)) {
    return new Response('Cross-site form submissions are not allowed.', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }

  if (isAdmin) {
    const user = getSessionUser(ctx.cookies.get(sessionCookieName())?.value);
    ctx.locals.user = user;
    ctx.locals.csrfToken = user?.csrfToken ?? '';
    if (ctx.request.method === 'GET') ctx.locals.flash = takeFlash(ctx.cookies);
    if (!user && !PUBLIC_ADMIN_PATHS.has(pathname)) {
      const nextPath = pathname + ctx.url.search;
      return ctx.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`, 303);
    }
    // CSRF: every state-changing admin request must carry the session's token.
    if (user && ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
      let token = ctx.request.headers.get('x-csrf-token') ?? '';
      if (!token) {
        try {
          const fd = await ctx.request.clone().formData();
          token = String(fd.get('_csrf') ?? '');
        } catch {
          token = '';
        }
      }
      if (!token || !safeEqual(token, user.csrfToken)) {
        return new Response('Invalid or missing CSRF token. Reload the page and try again.', { status: 403 });
      }
    }
  }

  const res = await next();

  const headers: Record<string, string> = { ...baseSecurityHeaders() };
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html') && !import.meta.env.DEV) {
    const ads = adRuntime();
    const analytics = getSettings('analytics').provider !== 'none';
    headers['Content-Security-Policy'] = buildCsp(nonce, { ads: ads.live && !isAdmin, analytics: analytics && !isAdmin, turnstile: config.turnstile.enabled });
  }
  if (isAdmin || isApi) {
    headers['Cache-Control'] = 'no-store';
    headers['X-Robots-Tag'] = 'noindex, nofollow';
  } else if (type.includes('text/html') && !res.headers.has('Cache-Control')) {
    headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
  }
  if (!config.allowIndexing) headers['X-Robots-Tag'] = 'noindex, nofollow';
  return withHeaders(res, headers);
});
