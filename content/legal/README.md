# Editable page templates

These Markdown files are rendered by the site at request time:

| File | URL |
| --- | --- |
| `legal/privacy-policy.md` | /privacy-policy |
| `legal/cookie-policy.md` | /cookie-policy |
| `legal/terms.md` | /terms |
| `legal/disclaimer.md` | /disclaimer |
| `pages/about.md` | /about (the author list is added automatically) |

## Template syntax

- `{{siteName}}`, `{{siteUrl}}`, `{{operatorName}}`, `{{contactEmail}}`, `{{contactLine}}`, `{{jurisdiction}}`, `{{lastUpdated}}` are filled from **Admin → Settings → Site**.
- `{{#if flag}} … {{/if}}` shows a block only when a feature is on; `{{#if !flag}}` is the opposite. Flags:
  `ga4`, `plausible`, `analytics`, `ads` (an AdSense publisher ID is configured), `newsletter`,
  `emailProvider`, `resend`, `postmark`, `turnstile`, `hasJurisdiction`, `hasContactEmail`.
- Lines starting with `%%` are editor notes and are never shown on the site.
- Raw HTML is not allowed (it is shown as plain text).

## Important

These templates are a **starting point written in plain language, not legal advice**, and using
them does not by itself make the site compliant with any law (GDPR, UK GDPR, ePrivacy, CCPA/CPRA,
COPPA, etc.). Review them — ideally with a qualified professional — for your actual services,
hosting provider, data retention and jurisdiction before launch, and whenever you add a new
third-party service.
