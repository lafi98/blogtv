# Production checklist — what you need to configure

Everything else (article generation, validation, publishing, limits, sitemaps, consent, security headers) is
already built. These are the only things that need your accounts, decisions or secrets.

## 1. Hosting
- [ ] A host that runs a **long-running Node.js 22+ server with a persistent disk** (VPS, or a PaaS web service with a
      volume, e.g. Render / Railway / Fly.io). Serverless-only hosts are not suitable (SQLite file + background runs).
- [ ] Deploy: `npm ci && npm run build`, start with `npm start` (see `docs/DEPLOYMENT.md` for systemd + nginx).

## 2. Domain & HTTPS
- [ ] Point your domain to the host and enable HTTPS.
- [ ] `SITE_URL=https://www.your-domain.com` (no trailing slash).
- [ ] `TRUST_PROXY=true` if the app sits behind a proxy/CDN.

## 3. Database / storage
- [ ] Persistent folder for `DATA_DIR` (default `./data`: `site.db` + `uploads/`), writable by the app.
- [ ] First deploy: `npm run db:seed`, then `npm run admin:create -- --email you@your-domain.com --name "Your Name"`.
- [ ] Daily backup of `data/site.db` (`sqlite3 data/site.db ".backup …"`) and `data/uploads/`, stored off the server.

## 4. Secrets (server environment — never in code or git)
- [ ] `APP_SECRET` — 48 random bytes: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- [ ] `ANTHROPIC_API_KEY` — from the Anthropic Console (enable web search for your org if you keep `AI_WEB_SEARCH=true`).
- [ ] `CRON_SECRET` — 32 random bytes (same command, `randomBytes(32)`).

## 5. Scheduler (cron)
- [ ] One job, every 15 minutes:
      `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://www.your-domain.com/api/cron/daily-publish`
      (host-specific instructions: `docs/PUBLISHING.md`).
- [ ] Admin → Settings → Automation: publishing time + time zone.
- [ ] Admin → AI Publisher: add your keywords, then **Resume Daily Publishing** (turn it ON).
- [ ] Next day, check Dashboard → Daily AI Publisher → "Last scheduler call" and "Today's publication".

## 6. Site identity & legal
- [ ] Admin → Settings → Site: site name, operator/legal name, contact email, jurisdiction.
- [ ] Admin → Authors: replace the generic byline with your real author profile.
- [ ] Personalise `content/pages/about.md`; have the policy texts in `content/legal/` reviewed for your situation.

## 7. Email (only if you keep the newsletter / want contact notifications)
- [ ] `EMAIL_PROVIDER=resend` or `postmark`, `EMAIL_API_KEY`, `EMAIL_FROM` (a verified sender on your domain),
      optional `CONTACT_NOTIFY_TO`. Or untick "Show newsletter sign-up forms" in Settings → Site.

## 8. Analytics (optional)
- [ ] Admin → Settings → Analytics: GA4 measurement ID or Plausible domain (loads only after consent).

## 9. Launch switch
- [ ] `ALLOW_INDEXING=true` on the **live** site only when it's ready for search engines
      (the admin shows a red warning and the server logs a warning while it's still `false`).
- [ ] Submit `https://www.your-domain.com/sitemap.xml` in Google Search Console.

## 10. AdSense — only after the site is live and has a good body of reviewed articles
- [ ] Apply at adsense.google.com. Approval is Google's decision and is not guaranteed.
- [ ] Enter your **real** publisher ID in Admin → Settings → Advertising (ads stay disabled) → verification meta tag,
      `/ads.txt` and policy disclosures appear automatically.
- [ ] Visitors in the EEA/UK/Switzerland: set up a Google-certified CMP and choose "External certified CMP" in
      Settings → Cookies & consent.
- [ ] After approval: enter ad unit IDs, then tick **Enable ads**. (`ADS_DISABLED=true` switches all ads off instantly.)
