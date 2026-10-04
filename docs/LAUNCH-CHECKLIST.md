# Pre-launch checklist

Work through this before switching `ALLOW_INDEXING=true` and before applying for AdSense. Items marked
**(auto)** are checked by `npm run qa`, `npm run content:validate` or the admin dashboard.

## Content & E-E-A-T

- [ ] Every seed and AI-assisted article read by a person, facts checked, patterns ideally made; reviewer name filled in.
- [ ] Replace the generic "Editorial Team" byline with real author profiles (name, genuine background, photo if you like).
- [ ] Personalise `content/pages/about.md` — who runs the site and why. Don't invent credentials.
- [ ] Replace illustrated covers with your own photos of finished projects where possible (record licence: "Own photo").
- [ ] A healthy body of substantial, original articles across the categories (no fixed number is required by Google).
- [ ] No published article fails validation **(auto)**; warnings reviewed.
- [ ] Category intros written so category pages aren't thin (Admin → Categories).

## SEO

- [ ] `SITE_URL` is the final https domain; `ALLOW_INDEXING=true` on production only.
- [ ] `/robots.txt` allows crawling and lists the sitemap **(auto)**; `/sitemap.xml` lists every public article **(auto)**.
- [ ] Unique titles, meta descriptions and canonicals on every page; one `<h1>`; valid JSON-LD **(auto)**.
- [ ] Submit the sitemap in Google Search Console and Bing Webmaster Tools; check Coverage after a few days.
- [ ] Social share preview checked (e.g. paste a URL into a social post composer).
- [ ] No broken internal links **(auto)**; external links checked with `npm run content:validate -- --external`.

## Privacy & legal

- [ ] Admin → Settings → Site: operator/legal name, contact email, jurisdiction, "last updated" date.
- [ ] Privacy, Cookie, Terms and Disclaimer texts reviewed (ideally by a qualified professional) for your real
      services, host, data retention and jurisdiction. The templates are not legal advice.
- [ ] Consent mode chosen deliberately (Admin → Cookies & consent); banner text accurate.
- [ ] If analytics is enabled: provider listed in the policies (automatic) and loads only after consent.
- [ ] Email provider configured; newsletter double opt-in tested end-to-end with a real inbox.
- [ ] A process for access/deletion requests (Admin → Subscribers and Messages can delete records).

## Security

- [ ] `APP_SECRET` set (≥ 32 random chars) and different from development; `.env` not in git (`.gitignore` covers it).
- [ ] HTTPS everywhere; HSTS header present (automatic when `SITE_URL` is https).
- [ ] `TRUST_PROXY=true` only when behind a proxy that sets `X-Forwarded-For`.
- [ ] Strong unique admin password; only trusted admin accounts exist.
- [ ] `CRON_SECRET` set (≥ 24 chars) if you use the HTTP cron endpoints; otherwise leave empty.
- [ ] Database + uploads backed up and a restore tested.
- [ ] `npm audit` reviewed; dependencies updated.
- [ ] Security headers & CSP present, admin protected, cross-site POSTs rejected **(auto)**.

## Accessibility

- [ ] Keyboard-only walk-through: skip link, menu, search, forms, consent banner and dialog, admin editor.
- [ ] Screen-reader spot check (VoiceOver/NVDA) of an article, the contact form and the consent dialog.
- [ ] Every image has meaningful alt text (decorative card thumbnails intentionally use empty alt) **(auto)**.
- [ ] Colour contrast meets WCAG AA (palette tokens in `src/styles/global.css` were checked; re-check any changes).
- [ ] Zoom to 200 % and test at 320 px width — no horizontal scrolling.

## Performance

- [ ] Lighthouse / PageSpeed Insights on the live domain (mobile): check LCP, CLS, INP.
- [ ] Static assets and `/media/*` served with long cache lifetimes through your proxy/CDN.
- [ ] Large uploads avoided (the media library resizes, but start from sensible originals).

## AdSense readiness

- [ ] Everything above done; the site is live and indexed.
- [ ] Publisher ID entered (ads still **disabled**) → verification meta tag + `/ads.txt` live.
- [ ] Certified CMP configured if you have EEA/UK/Swiss visitors (Admin → Cookies & consent → External).
- [ ] No "click the ads" wording anywhere (validator enforces this in articles).
- [ ] After approval: ad unit IDs entered, ads enabled, pages checked on mobile for spacing and labels.
- [ ] Keep advertising secondary: the site must stay fully useful with `ADS_DISABLED=true`.

Approval is Google's decision. This checklist follows Google's published requirements but cannot guarantee it.
