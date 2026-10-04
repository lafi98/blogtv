/**
 * Builds the client-side consent configuration. This module decides WHICH optional
 * technologies exist; public/js consent script decides WHEN they may load.
 *
 * Note: this banner is a configurable tool, not a legal guarantee. For serving Google ads
 * to users in the EEA, the UK and Switzerland, Google requires a Google-certified CMP
 * integrated with the IAB TCF — set consent "cmp" to "external" and use one (AdSense's
 * own "Privacy & messaging" is one option). See docs/ADSENSE.md.
 */
import { getSettings } from '../settings';
import { adRuntime } from '../ads';
import { GA4_ID_RE, DOMAIN_RE } from '../settings';
import { config } from '../config';

export interface ConsentCategory {
  key: 'necessary' | 'analytics' | 'advertising';
  label: string;
  description: string;
  required: boolean;
}

export interface ClientConsentConfig {
  mode: 'opt-in' | 'opt-out' | 'notice';
  cmp: 'builtin' | 'external';
  version: number;
  respectGpc: boolean;
  googleConsentMode: boolean;
  categories: ConsentCategory[];
  analytics: null | { provider: 'ga4'; id: string } | { provider: 'plausible'; domain: string; src: string; requireConsent: boolean };
  ads: null | { clientId: string };
}

export function consentConfig(): ClientConsentConfig {
  const c = getSettings('consent');
  const a = getSettings('analytics');
  const ads = adRuntime();
  let analytics: ClientConsentConfig['analytics'] = null;
  if (a.provider === 'ga4' && GA4_ID_RE.test(a.gaMeasurementId)) analytics = { provider: 'ga4', id: a.gaMeasurementId };
  if (a.provider === 'plausible' && DOMAIN_RE.test(a.plausibleDomain))
    analytics = { provider: 'plausible', domain: a.plausibleDomain, src: config.analytics.plausibleScriptUrl, requireConsent: a.requireConsent };

  const categories: ConsentCategory[] = [
    {
      key: 'necessary',
      label: 'Strictly necessary',
      description: 'Remember your cookie choices and keep the site secure. These cannot be switched off.',
      required: true,
    },
  ];
  if (analytics && (analytics.provider === 'ga4' || analytics.requireConsent))
    categories.push({
      key: 'analytics',
      label: 'Analytics',
      description:
        analytics.provider === 'ga4'
          ? 'Google Analytics helps us understand which articles are useful, using cookies to count visits and see how pages are used.'
          : 'Privacy-friendly visit statistics (Plausible) help us understand which articles are useful.',
      required: false,
    });
  if (ads.live && c.cmp === 'builtin')
    categories.push({
      key: 'advertising',
      label: 'Advertising',
      description:
        'Google AdSense shows ads that help fund the site. With your consent, Google and its partners may use cookies to personalise and measure ads.',
      required: false,
    });

  return {
    mode: c.mode,
    cmp: c.cmp,
    version: c.policyVersion,
    respectGpc: c.respectGlobalPrivacyControl,
    googleConsentMode: c.googleConsentMode,
    categories,
    analytics,
    ads: ads.live ? { clientId: ads.clientId } : null,
  };
}
