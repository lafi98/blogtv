# Connecting Google AdSense

Ads are **off** by default and no publisher ID ships with this code. Nothing ad-related loads until you
configure it. Following these steps does **not** guarantee approval: Google reviews every site and the
decision is entirely theirs.

## Before you apply

Google's AdSense review looks for a real, useful site that follows the
[Google Publisher Policies](https://support.google.com/adsense/answer/10502938) and
[AdSense Program policies](https://support.google.com/adsense/answer/48182). In practice:

- **Live on your own domain**, over HTTPS, with `ALLOW_INDEXING=true` (otherwise Google can't crawl it).
- **Substantial, original, helpful content.** Google sets no minimum article count. Many publishers apply with a
  few dozen in-depth articles; what matters is that each one is genuinely useful and not thin, copied or
  mass-produced. Read and fact-check every AI-assisted article and add yourself as reviewer.
- **Real people behind the site:** replace the generic editorial byline with real author profiles (Admin → Authors)
  and personalise `content/pages/about.md`.
- **Clear navigation, a contact page and policies.** Already built: About, Contact, Privacy Policy, Cookie Policy,
  Terms, Disclaimer, sitemap. Fill in your legal name, contact email and jurisdiction in Admin → Settings → Site,
  and have the policy texts reviewed for your situation.
- **No policy-sensitive content.** The validator flags it, but you are responsible for the final call.
- The dashboard's **Launch & AdSense readiness** list should be green.

## Step 1 — Sign up and verify ownership

1. Sign up at <https://adsense.google.com> with your domain.
2. Copy your publisher ID (`ca-pub-` followed by 16 digits) into **Admin → Settings → Advertising → AdSense
   publisher ID**. Leave **Enable ads unticked** for now. As soon as the ID is saved, the site automatically:
   - adds `<meta name="google-adsense-account" content="ca-pub-…">` to every page — choose the **meta tag**
     verification method in AdSense (no ad script is loaded, so no consent is needed for verification);
   - serves `/ads.txt` with `google.com, pub-…, DIRECT, f08c47fec0942fa0`;
   - adds the required advertising disclosures (third-party vendors including Google use cookies, opt-out via
     My Ad Center, etc.) to the Privacy and Cookie policies.
3. Request review in AdSense. Reviews can take from a few days to several weeks. Don't change domains or
   remove content while you wait.

## Step 2 — Consent for EEA, UK and Swiss visitors

Google requires publishers that serve ads to users in the **European Economic Area, the UK and Switzerland**
to use a **Google-certified consent management platform (CMP)** that integrates with the IAB Transparency &
Consent Framework. This site's built-in banner is not a certified CMP.

- If you have (or may have) visitors there: set up a certified CMP — AdSense → **Privacy & messaging** offers one —
  and choose **External certified CMP** in Admin → Settings → Cookies & consent. The built-in banner then only
  manages analytics; AdSense loads and its CMP asks for ad consent.
- If you only serve regions that don't require this, the built-in banner (opt-in or opt-out mode) can gate the
  AdSense script. Check the rules that apply to you; this is a legal decision, not a technical one.

Google Consent Mode v2 signals (default **denied**) are sent before any Google tag loads, and are updated when
visitors make a choice. Global Privacy Control is honoured as an advertising opt-out.

## Step 3 — After approval: create ad units and enable

1. In AdSense → **Ads → By ad unit**, create display ad units (responsive) for the positions you want. Copy each
   unit's numeric `data-ad-slot` ID into Admin → Settings → Advertising:

   | Position | Where it appears |
   | --- | --- |
   | `top` | below the article's featured image, before the text |
   | `in-content` | after the second section, only on articles ≥ 700 words (configurable) |
   | `sidebar` | desktop sidebar under the table of contents (hidden on mobile) |
   | `bottom` | after the article and author box, before related articles; also at the bottom of long article lists |

2. Tick **Enable ads** and save.
3. Keep **Auto ads** switched off in AdSense if you want ads only in these labelled, reserved positions.

Ads never render on legal pages, contact, search results, newsletter pages, error pages, admin pages or previews.
Each unit is labelled **Advertisement**, separated from content by rules and spacing, has reserved height (no layout
shift) and is never styled like a link, button, menu or article card.

## Turning ads off

- Admin → Settings → Advertising → untick **Enable ads**, or
- set `ADS_DISABLED=true` in the environment (overrides the admin setting; restart required).

With ads off, slots render **nothing** — the site's layout and content are unchanged.

## Things that get accounts suspended (don't)

- Clicking your own ads or asking anyone to click them (the validator blocks "click our ads" wording).
- Placing ads where they can be mistaken for navigation or content, or so close to buttons that accidental clicks are likely.
- Ads on pages without real content (thank-you pages, error pages, search results with no results).
- Buying traffic from low-quality sources or "traffic exchange" schemes.
- Republishing other people's patterns or articles.
