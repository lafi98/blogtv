# Architecture

## Request flow

```
Browser ──► (reverse proxy / CDN, HTTPS) ──► Node server (Astro standalone)
                                              │
                                              ├─ src/middleware.ts
                                              │    • per-request CSP nonce + security headers
                                              │    • same-origin check for every POST (CSRF defence in depth)
                                              │    • /admin/*: session lookup, redirect to login, CSRF token check
                                              │    • lazy scheduler: publish due posts (≤ once a minute)
                                              │
                                              ├─ src/pages/*        server-rendered pages & endpoints
                                              │    └─ src/lib/*     config, repos (SQL), validation, SEO, ads, consent…
                                              │
                                              └─ data/site.db (SQLite) + data/uploads/ (images)
```

Pages are rendered on the server for every request (fast: SQLite queries take well under a millisecond, and
rendered Markdown is cached per article version). Hashed assets under `/_astro/` and uploaded images under
`/media/` are served with `Cache-Control: immutable`; HTML is `max-age=0, must-revalidate`.

## Content model

`articles` holds everything the brief requires: `title`, `slug`, `excerpt`, `content_md`, `featured_image_id`,
`category_id`, `tags_json`, `author_id`, `published_at`, `content_updated_at` (the visible "Updated" date — only set
for significant updates, never on trivial saves), `seo_title`, `meta_description`, `canonical_url`, `noindex`,
`faq_json`, `related_json`, `sources_json`, `ai_assisted`, `reviewed_by`, plus workflow fields (`status`,
`scheduled_for`, `validation_json`). Statuses: `draft → review → scheduled → published → archived`.
An article is public only if `status = 'published'` **and** `published_at <= now`.

Images are stored once and referenced by id; each has alt text, caption, credit, **licence** and source URL.

## Security model

| Threat | Mitigation |
| --- | --- |
| XSS | Astro escapes all template output; Markdown rendered with raw HTML disabled and unsafe URL schemes rejected; JSON-LD serialised with `<`/`>`/`&` escaped; strict nonce-based CSP with `'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`. |
| SQL injection | Every query uses prepared statements with bound parameters; FTS search input is reduced to plain word tokens. |
| CSRF | Same-origin (Origin/Referer) check on every POST; admin forms also carry a per-session CSRF token; login uses a double-submit token; cookies are `SameSite=Lax` (`Strict` for the login token). |
| Session theft | Opaque random tokens (only SHA-256 stored), `HttpOnly`, `Secure` + `__Host-` prefix on HTTPS, 7-day expiry, all sessions revoked on password change. |
| Brute force | scrypt password hashes; 10 attempts / 15 min per IP and per email; 15-minute lockout after 5 failures; constant-time comparison for unknown accounts. |
| Spam / abuse | Honeypot field, signed minimum-fill-time token, per-IP rate limits (contact 5/h, newsletter 5/h, search 60/min), link-count heuristics, optional Cloudflare Turnstile, double opt-in for the newsletter (GET never confirms). |
| Secrets | Only in environment variables, read server-side; `APP_SECRET` required in production; no keys or IDs in client code. |
| Uploads | Admin-only; type detected from the bytes by sharp, SVG uploads rejected, 10 MB / 50 MP limits, re-encoded (strips EXIF/GPS), content-hashed file names, strict file-name allow-list when serving. |
| Privacy | Raw IPs never stored (HMAC'd keys); subscriber records deletable; CSV export guarded against formula injection. |
| Clickjacking / misc | `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS on HTTPS. |
| Audit | Logins, publishes, overrides, settings changes and deletions are written to `audit_log`. |

## Consent & third-party scripts

`src/lib/consent` decides *which* optional technologies exist (analytics provider configured? ads live?);
`src/scripts/consent.js` decides *when* they may load:

1. Before anything else, Google Consent Mode v2 **default** signals are pushed (denied in opt-in mode).
2. Stored choice (first-party cookie `hh_consent`, 180 days, versioned) or the mode's default is applied.
3. Analytics and AdSense scripts are injected **only** by consent.js and only when allowed. Without JavaScript,
   nothing optional ever loads.
4. Withdrawal deletes accessible cookies and reloads the page so already-running scripts stop.

Modes: `opt-in` (default), `opt-out`, `notice`. CMP: `builtin` or `external` (certified CMP for ads in EEA/UK/CH).
If no optional technology is configured, no banner is shown at all and "Cookie settings" explains that only
essential cookies are used.

## Advertising

`<AdSlot position="top|in-content|sidebar|bottom" />` renders **nothing** unless every condition in
`src/lib/ads/index.ts` holds (kill switch off, admin toggle on, valid publisher ID, slot ID, eligible page).
The AdSense loader itself is only injected by the consent controller. Development-only labelled placeholders can be
switched on in the admin and are never rendered in production builds.

## SEO

- Semantic landmarks, one `<h1>` per page, strict heading order (body H1s are demoted).
- Canonical URLs from `SITE_URL`; `noindex` for search, newsletter utility pages, previews, 404 and (pre-launch) everything.
- Open Graph + Twitter cards with 1200×630 images; JSON-LD: `Organization`, `WebSite`, `BlogPosting`,
  `BreadcrumbList`, and `FAQPage` where an article has an FAQ. (Google currently shows FAQ rich results only for
  a small set of authoritative sites; the markup is still valid. HowTo rich results were retired, so HowTo markup is not used.)
- `/sitemap.xml` (lastmod from real content dates), `/robots.txt`, `/rss.xml`, HTML `/sitemap`.
- Responsive images (`srcset`/`sizes`, explicit dimensions, lazy loading below the fold, `fetchpriority=high` for the hero).
- Internal linking: related articles (manual first, then same category / shared tags), breadcrumbs, category chips,
  in-article links validated on save.

## Scheduled & AI publishing

`src/lib/publishing/`: `publisher.ts` (orchestration, daily limit, idempotency), `generator.ts` (Claude stages),
`keywords.ts` (duplicate detection), `links.ts` (link sanitiser), `validator.ts`, `scheduler.ts`, `time.ts`
(time zones), `simulated.ts` (test client). Tables: `keywords`, `ai_runs` (audit), `ai_publication_slots`
(one row per day — the 1-per-day limit), `ai_locks`. See [PUBLISHING.md](PUBLISHING.md).
