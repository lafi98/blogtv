/** Loads the editable Markdown page templates in content/ and fills site-specific values. */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { getSettings } from '../settings';
import { adRuntime } from '../ads';
import { escapeMd, fillTemplate, renderMarkdown, type TemplateVars } from './markdown';
import { formatDate } from './text';
import { ADSENSE_CLIENT_RE } from '../settings';

const CONTENT_DIR = path.resolve(process.env.CONTENT_DIR || 'content');

export function templateVars(): TemplateVars {
  const site = getSettings('site');
  const analytics = getSettings('analytics');
  const ads = getSettings('ads');
  const email = site.contactEmail.trim();
  const contactLine = email
    ? `by email at [${escapeMd(email)}](mailto:${encodeURIComponent(email).replace(/%40/g, '@')}) or through our [contact page](/contact)`
    : 'through our [contact page](/contact)';
  return {
    siteName: site.name,
    siteUrl: config.siteUrl,
    operatorName: site.operatorName || `the owner of ${site.name}`,
    contactEmail: email,
    contactLine: { md: contactLine },
    jurisdiction: site.jurisdiction,
    lastUpdated: formatDate(site.legalLastUpdated) || site.legalLastUpdated,
    ga4: analytics.provider === 'ga4',
    plausible: analytics.provider === 'plausible',
    analytics: analytics.provider !== 'none',
    // Disclose advertising as soon as a publisher ID exists (i.e. before/while applying), or when ads are live.
    ads: ADSENSE_CLIENT_RE.test(ads.clientId) || adRuntime().live,
    newsletter: site.newsletterEnabled,
    emailProvider: config.email.provider !== 'none',
    resend: config.email.provider === 'resend',
    postmark: config.email.provider === 'postmark',
    turnstile: config.turnstile.enabled,
    hasJurisdiction: Boolean(site.jurisdiction.trim()),
    hasContactEmail: Boolean(email),
  };
}

export function renderContentPage(relPath: string) {
  const file = path.join(CONTENT_DIR, relPath);
  if (!file.startsWith(CONTENT_DIR + path.sep)) throw new Error('Invalid content path');
  const source = fs.readFileSync(file, 'utf8');
  return renderMarkdown(fillTemplate(source, templateVars()));
}
