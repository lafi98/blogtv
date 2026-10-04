# Hook & Hearth — crochet blog

A fast, accessible, privacy-conscious crochet blog with an admin dashboard, a validated
AI-assisted drafting pipeline, scheduled publishing, consent-gated analytics/ads and
AdSense-ready (but **disabled**) ad slots.

> The site is built to follow Google's published publisher and AdSense policies as closely as
> possible. That does **not** guarantee AdSense approval — the decision is Google's alone.

| | |
| --- | --- |
| Framework | [Astro 7](https://astro.build) in server mode (`@astrojs/node`), TypeScript |
| Database | SQLite via `better-sqlite3` (single file, WAL mode, full-text search with FTS5) |
| Images | `sharp` — responsive WebP variants + 1200×630 social JPEGs, EXIF stripped |
| Markdown | `markdown-it` with raw HTML **disabled** |
| AI | Official Anthropic SDK (`@anthropic-ai/sdk`), server-side only |
| Client JS | ~5 KB of vanilla JS (menu, consent, copy-link). Every page works without JS. |
| Fonts | Fraunces (self-hosted variable font, headings only) + system fonts |

Measured locally with Lighthouse (mobile emulation, indexing enabled): Performance 100,
Accessibility 100, Best Practices 100, SEO 100 on the homepage, an article and a category page.
Real-world numbers depend on your hosting.

---

## 1. Project structure

```
crochet-blog/
├── astro.config.mjs            # Astro + Node adapter (standalone server)
├── package.json                # scripts (see "Commands")
├── .env.example                # every environment variable, documented
├── content/
│   ├── legal/*.md              # Privacy, Cookie, Terms, Disclaimer — editable templates
│   ├── pages/about.md          # About page (author list is appended automatically)
│   └── seed/articles/*.md      # 18 original seed articles (Markdown + YAML front matter)
├── public/                     # favicons, logo, default OG image, SVG diagrams
├── scripts/                    # CLI: migrate, seed, admin, import, validate, publish, generate, QA
├── docs/                       # architecture, publishing, AdSense, deployment, launch + production checklists
├── tests/                      # automated tests (npm test)
├── data/                       # (git-ignored) site.db + uploads/ — created at runtime
└── src/
    ├── middleware.ts           # CSP nonce, security headers, origin check, admin auth + CSRF
    ├── layouts/                # BaseLayout (SEO head, consent), AdminLayout
    ├── components/             # Header, Footer, ArticleCard, AdSlot, CookieConsent, Toc, Faq, …
    │   └── admin/              # ArticleEditor, ValidationReport
    ├── pages/                  # public routes, /admin/*, /api/*, sitemap.xml, robots.txt, rss.xml, ads.txt
    ├── scripts/                # browser JS: site.js, consent.js, admin.js
    ├── styles/                 # global.css (site), admin.css
    └── lib/
        ├── config.ts           # env-var configuration (server only)
        ├── db/                 # connection + append-only migrations
        ├── repos/              # data access: articles, categories, authors, images, keywords, AI runs, …
        ├── settings/           # admin-editable settings (site, ads, consent, analytics, automation)
        ├── content/            # Markdown rendering, editable-page templates, text utils
        ├── seo/                # meta, canonical, robots, JSON-LD builders
        ├── images/             # upload processing, original cover-art generator
        ├── security/           # crypto, rate limiting, spam protection, CSP, cron auth
        ├── auth/               # sessions, password hashing, login throttling
        ├── ads/                # ad runtime (all the "is it allowed?" rules)
        ├── consent/            # consent categories → client config
        ├── email/              # transactional email adapter (none | Resend | Postmark)
        ├── admin/              # admin form handling
        └── publishing/         # validator, scheduler, Claude client, prompts, AI pipeline
```

Layers are kept separate: **frontend** (`pages`, `components`, `layouts`, `styles`, `scripts`),
**backend/API** (`pages/api`, page POST handlers, `middleware.ts`), **database** (`lib/db`, `lib/repos`),
**content system** (`lib/content`, `content/`), **authentication** (`lib/auth`), **images** (`lib/images`),
**SEO** (`lib/seo`), **analytics/consent** (`lib/consent`, `scripts/consent.js`), **advertising** (`lib/ads`,
`AdSlot.astro`) and **scheduled publishing** (`lib/publishing`). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 2. Setup

Requirements: **Node.js 22.12+** (tested on Node 24) and npm. No other services are required.

```bash
cd crochet-blog
npm install
cp .env.example .env            # then edit values (see section 3)
npm run db:seed                 # creates data/site.db, categories and the 18 seed articles
npm run admin:create -- --email you@example.com --name "Your Name"   # prompts for a password (12+ chars)
npm run dev                     # http://localhost:4321  (admin at /admin)
```

Production:

```bash
npm run build
npm start                       # NODE_ENV=production node dist/server/entry.mjs (reads .env if present)
```

Set `HOST`/`PORT` to change the listen address (default `localhost:4321`). Full server setup —
reverse proxy, HTTPS, backups, cron — is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## 3. Environment variables

All secrets live in environment variables and are only read on the server. Full comments are in
[`.env.example`](.env.example).

| Variable | Required | Purpose |
| --- | --- | --- |
| `SITE_URL` | yes | Public URL, no trailing slash (canonicals, sitemap, OG, emails) |
| `APP_SECRET` | **yes in production** | ≥ 32 random chars; signs form tokens, hashes IPs. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ALLOW_INDEXING` | at launch | `false` (default) blocks search engines via robots.txt + `noindex`; set `true` on the live site |
| `DATA_DIR` / `DATABASE_PATH` / `UPLOADS_DIR` | no | Storage locations (default `./data`) |
| `TRUST_PROXY` | behind a proxy | `true` to use `X-Forwarded-For` for rate limiting |
| `CRON_SECRET` | **yes in production** | ≥ 24 chars; required by `/api/cron/daily-publish` and `/api/cron/publish` (`Authorization: Bearer …`) |
| `ANTHROPIC_API_KEY` | **yes in production** | Claude API key (server-side only) |
| `AI_MODEL` / `AI_EFFORT` / `AI_WEB_SEARCH` | no | Default `claude-opus-5-5`, `high`, `true` |
| `AI_SIMULATE` | dev only | `true` = simulated Claude client for local testing (ignored in production builds) |
| `ADS_DISABLED` | no | `true` = global kill switch for all ads |
| `ADSENSE_CLIENT_ID` | no | Optional default publisher ID (admin setting takes precedence). Leave empty until Google gives you one |
| `ANALYTICS_PROVIDER`, `GA_MEASUREMENT_ID`, `PLAUSIBLE_DOMAIN`, `PLAUSIBLE_SCRIPT_URL` | no | Optional defaults; usually set in Admin → Analytics |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `CONTACT_NOTIFY_TO` | for email | `none` logs emails to the console; `resend` or `postmark` sends them |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | no | Optional Cloudflare Turnstile on public forms |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | no | Used once by `npm run admin:create` instead of flags/prompt |

No tracking IDs, publisher IDs or API keys are hard-coded anywhere in the code.

## 4. Database

SQLite in a single file (`data/site.db`). Schema lives in `src/lib/db/migrations.ts` and is applied
automatically on startup (or explicitly with `npm run db:migrate`). Tables: `articles` (+ `articles_fts`
full-text index), `categories`, `authors`, `images`, `keywords` (AI queue), `ai_runs` (AI audit log),
`ai_publication_slots` (one row per day — the daily limit), `ai_locks`, `settings`, `users`,
`sessions`, `subscribers`, `messages`, `rate_limits`, `audit_log`.

- **Seed:** `npm run db:seed` (idempotent). `npm run db:seed -- --reset` wipes the dev database first (refused in production).
- **Backups:** `sqlite3 data/site.db ".backup 'backup-$(date +%F).db'"` plus a copy of `data/uploads/` (see DEPLOYMENT.md).
- **Changing the schema:** append a new entry to `migrations.ts` with the next version number; never edit shipped migrations.
- **Scaling:** SQLite comfortably serves a content site on one server. To run several app servers you would move to
  Postgres/libSQL by re-implementing `src/lib/db` + `src/lib/repos` (all SQL lives there).

## 5. Adding articles

**In the admin (recommended):** `/admin/articles/new`. Every field the brief asked for is supported:
title, slug, excerpt, featured image (from the media library, with alt text + licence), Markdown content,
category, tags, author, published / updated dates, SEO title, meta description, canonical URL, FAQ,
related articles, references, AI-assistance flag and reviewer name. Actions: Save · Save & validate ·
Submit for review · Schedule · Publish · Unpublish · Archive · Preview · Delete.

Publishing and scheduling run the validator first (see section 7). Errors block publication unless you
tick the override box (the override is written to the audit log).

**From Markdown files:**

```bash
npm run content:import -- path/to/article.md            # saved as draft + validated
npm run content:import -- path/to/article.md --publish  # publish immediately
```

Front-matter format (same as `content/seed/articles/*.md`):

```yaml
---
title: "How to Crochet a Granny Square"
slug: classic-granny-square-pattern
category: crochet-patterns           # a category slug
tags: [granny square, beginner pattern]
excerpt: "1–2 sentence summary shown on cards."
seoTitle: "Granny Square Pattern for Beginners"   # ≤ 60 chars
metaDescription: "120–160 characters…"
cover: granny-square                  # optional generated illustration (see src/lib/images/covers.ts)
related: [how-to-make-a-magic-ring]
faq:
  - q: "Question?"
    a: "Answer."
aiAssisted: false                     # optional; shown to readers when true
reviewedBy: "Your Name"               # optional
---
Markdown body (no H1 — use ## sections).
```

**Re-validate everything:** `npm run content:validate` (add `--external` to check external links live).

## 6. Connecting Claude securely

Set `ANTHROPIC_API_KEY` **on the server only** (host secret settings or the git-ignored `.env`) and restart.
It is read solely by the official SDK in `src/lib/publishing/claude.ts`, which is imported only by server code —
browsers never see it. Optional: `AI_MODEL` (default `claude-opus-5-5`), `AI_EFFORT` (`high`), `AI_WEB_SEARCH` (`true`).
If the key is missing, the admin shows a clear configuration message and the cron answers
`503 ANTHROPIC_API_KEY_MISSING` without consuming anything.

## 7. AI Publisher: keyword → published article

**Admin → AI Publisher** (`/admin/topics`): type one keyword, e.g. *easy crochet flower for beginners*, then

- **Generate Draft** — Claude analyses, researches, writes and reviews; the site adds SEO metadata, safe internal links
  and an original cover image, validates, and saves a DRAFT; or
- **Generate & Publish** — the same, but publishes when validation passes (or schedules for the next free day if today's
  AI publication already happened).

Duplicate keywords/topics are refused before any Claude call, with the existing article and the reason shown.
Failed validation ⇒ DRAFT with the exact errors listed. Every run is in **Admin → AI run log**.
Full details: [docs/PUBLISHING.md](docs/PUBLISHING.md).

## 8. Daily automatic publishing

1. Add keywords to the queue (Admin → AI Publisher → *Add Keyword(s)*, one per line).
2. Admin → Settings → Automation: publishing time + time zone; turn Daily publishing **ON** (or *Resume* on the
   AI Publisher page).
3. Have your host call `GET/POST https://YOUR-DOMAIN/api/cron/daily-publish` with `Authorization: Bearer $CRON_SECRET`
   every 15 minutes (or run `npm run publish:daily` from a crontab on the same server).

Each day the first call after the publishing time takes the next keyword → generate → validate → publish → marks the
keyword used → writes the audit log. Hard limits enforced in the database: **max 1 AI publication per day**, one run at a
time, keyword consumed only on successful publication, safe to call repeatedly. Empty queue or Daily Publishing OFF ⇒
the call does nothing. The same call also publishes due scheduled articles.

## 9. Connecting Google AdSense (after the site is ready)

Short version — the full guide with policy notes is [docs/ADSENSE.md](docs/ADSENSE.md):

1. Launch first: real domain on HTTPS, `ALLOW_INDEXING=true`, real author profiles, legal details filled in,
   a solid body of reviewed, original articles, and the Admin dashboard's readiness list green.
2. Apply at adsense.google.com with your domain. When Google shows your publisher ID (`ca-pub-…`), enter it in
   **Admin → Settings → Advertising** (leave ads disabled). The site then automatically serves
   `<meta name="google-adsense-account">` for verification, publishes `/ads.txt`, and adds the AdSense
   disclosures to the Privacy and Cookie policies.
3. If you have visitors in the EEA, UK or Switzerland, set up a Google-certified CMP (e.g. AdSense →
   Privacy & messaging) and choose **External certified CMP** in Admin → Cookies & consent.
4. After approval, create ad units, paste their IDs into the four slots, and tick **Enable ads**.
   `ADS_DISABLED=true` turns every ad off instantly.

## 10. Pre-launch checklist

- **What you need to configure:** [docs/PRODUCTION-CHECKLIST.md](docs/PRODUCTION-CHECKLIST.md)
- Full SEO / privacy / security / accessibility / AdSense review: [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md)

`ALLOW_INDEXING` stays `false` during development and testing. Set `ALLOW_INDEXING=true` on the live site when it is
ready for search engines — the admin shows a red warning and the server logs a warning while a production build runs
with indexing blocked, so it can't be forgotten silently.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build, run production server |
| `npm run check` | Type-check (`astro check`) |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed content |
| `npm run admin:create` | Create an admin user |
| `npm run content:import` / `content:validate` | Import Markdown / re-validate all articles |
| `npm run publish:daily` | Daily AI publisher for crontab on the app server (`-- --now` ignores the publishing time) |
| `npm run publish:due` | Publish due scheduled posts only |
| `npm test` | Automated tests for the AI publisher (simulated Claude, throwaway database) |
| `npm run qa -- --base http://localhost:4321` | Crawl a running site: links, meta, JSON-LD, alt text, headers, ads, protections |
| `npm run assets:generate` | Regenerate favicons, logo and default social image |

## Before you launch: content honesty

The 18 seed articles were drafted with AI assistance (they are labelled as such on the site) and pass the
validator, but **a person should read every one, ideally make the patterns, and add their name as reviewer**
before you rely on them. Replace the generic "Editorial Team" byline with real author profiles, and swap
the illustrated covers for your own photos when you can — genuine experience is what makes a craft site
trustworthy.
