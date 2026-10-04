%% Cookie Policy template. Keep the table in sync with what the site really uses —
%% check your browser's developer tools (Application → Cookies) after enabling any service.

_Last updated: {{lastUpdated}}_

This Cookie Policy explains how {{siteName}} uses cookies and similar technologies, and how you can control them.

## What are cookies?

Cookies are small text files a website stores in your browser. Some are essential for a site to work; others help measure use or show advertising. "Similar technologies" include local storage and scripts that read information from your device.

## Cookies we use

| Name | Purpose | Category | Duration |
| --- | --- | --- | --- |
| `hh_consent` | Remembers your cookie choices so we don't ask on every page | Strictly necessary | 180 days |
| `hh_session` / `__Host-hh_session` | Keeps site administrators signed in (admin area only — not set for readers) | Strictly necessary | 7 days |
{{#if ga4}}
| `_ga`, `_ga_<ID>` | Google Analytics: distinguishes visitors and sessions so we can count visits | Analytics (only with consent) | Up to 2 years |
{{/if}}
{{#if ads}}
| Google advertising cookies (for example `__gads`, `__gpi` and cookies on Google domains such as doubleclick.net) | Serve, limit and measure ads; with consent, personalise ads | Advertising (personalised only with consent) | Varies — see Google's cookie list |
{{/if}}

{{#if !analytics}}
{{#if !ads}}
At the moment this site uses **only strictly necessary cookies**, so you won't see a consent banner. If we add analytics or advertising in the future, we will update this page and ask for your consent where required.
{{/if}}
{{/if}}

{{#if ads}}
Google's full, current list of advertising cookies is published at [policies.google.com/technologies/cookies](https://policies.google.com/technologies/cookies).
{{/if}}
{{#if plausible}}
We use Plausible Analytics, which is designed to work without cookies.
{{/if}}
{{#if turnstile}}
Our forms use Cloudflare Turnstile to block spam. It runs inside a frame from Cloudflare's own domain and may use technologies needed to verify you are human.
{{/if}}

## Your choices

- **Cookie settings.** Use the **Cookie settings** link in the footer of any page to accept, reject or change optional cookies at any time. Withdrawing consent deletes the optional cookies we can access and stops the related scripts from loading.
- **Global Privacy Control.** If your browser sends a GPC signal, we treat it as an opt-out of advertising cookies.
- **Browser controls.** You can block or delete cookies in your browser settings. Blocking strictly necessary cookies may stop some features from working.
{{#if ads}}
- **Ad personalisation.** You can also manage Google ad personalisation at [My Ad Center](https://myadcenter.google.com/).
{{/if}}

## Contact

Questions about cookies? Contact us {{contactLine}}. See also our [Privacy Policy](/privacy-policy).
