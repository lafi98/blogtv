/**
 * Editable site settings (stored as JSON per group in the `settings` table).
 * Secrets never live here — only toggles and public identifiers.
 */
import { getDb, nowIso, parseJson } from '../db';
import { config } from '../config';

export type AdPosition = 'top' | 'in-content' | 'sidebar' | 'bottom';
export const AD_POSITIONS: AdPosition[] = ['top', 'in-content', 'sidebar', 'bottom'];

export interface SiteSettings {
  name: string;
  tagline: string;
  description: string;
  /** Legal name of the person/company operating the site (used in legal pages). */
  operatorName: string;
  contactEmail: string;
  /** Free text, e.g. "England and Wales" or "California, USA" — used in Terms. */
  jurisdiction: string;
  postsPerPage: number;
  newsletterEnabled: boolean;
  legalLastUpdated: string;
  social: { pinterest: string; instagram: string; youtube: string; facebook: string };
}

export interface AdsSettings {
  /** Admin master toggle. Ads also need a valid client ID and are blocked by ADS_DISABLED. */
  enabled: boolean;
  clientId: string;
  slots: Record<AdPosition, string>;
  /** Development aid: show labelled grey boxes where ads would go (never in production). */
  showPlaceholders: boolean;
  /** In-content ad only on articles with at least this many words. */
  minWordsForInContent: number;
}

export interface AnalyticsSettings {
  provider: 'none' | 'ga4' | 'plausible';
  gaMeasurementId: string;
  plausibleDomain: string;
  /** Wait for "analytics" consent before loading the script. Strongly recommended. */
  requireConsent: boolean;
}

export interface ConsentSettings {
  /**
   * opt-in  — nothing optional loads until the visitor agrees (EEA/UK-style).
   * opt-out — optional tech loads unless the visitor objects (some US-state models).
   * notice  — informational banner only; use only if no optional cookies are used.
   */
  mode: 'opt-in' | 'opt-out' | 'notice';
  /**
   * builtin  — this site's own banner controls loading of analytics/ads.
   * external — a separate certified CMP (e.g. Google's Privacy & messaging) handles
   *            ad consent; our banner then only manages analytics.
   */
  cmp: 'builtin' | 'external';
  /** Bump to re-ask everyone after a material policy change. */
  policyVersion: number;
  respectGlobalPrivacyControl: boolean;
  /** Send Google Consent Mode v2 signals (default denied) before any Google tag loads. */
  googleConsentMode: boolean;
  bannerText: string;
}

export interface AutomationSettings {
  /** Daily AI publishing ON/OFF. When OFF the cron endpoint does nothing. */
  dailyEnabled: boolean;
  /** Local wall-clock time ("HH:MM") from which the day's article may be published. */
  publishTime: string;
  /** IANA time zone used for the publishing day and time, e.g. "Europe/London". */
  timezone: string;
  /** Check external links live during validation (recommended). */
  checkExternalLinks: boolean;
}

export interface SettingsMap {
  site: SiteSettings;
  ads: AdsSettings;
  analytics: AnalyticsSettings;
  consent: ConsentSettings;
  automation: AutomationSettings;
}

export const DEFAULTS: SettingsMap = {
  site: {
    name: 'Hook & Hearth',
    tagline: 'Friendly crochet tutorials, patterns and tips',
    description:
      'Beginner-friendly crochet tutorials, stitch guides, free patterns and practical tips for hobbyists who want to make things they love.',
    operatorName: '',
    contactEmail: '',
    jurisdiction: '',
    postsPerPage: 9,
    newsletterEnabled: true,
    legalLastUpdated: '2026-10-02',
    social: { pinterest: '', instagram: '', youtube: '', facebook: '' },
  },
  ads: {
    enabled: false,
    clientId: '',
    slots: { top: '', 'in-content': '', sidebar: '', bottom: '' },
    showPlaceholders: false,
    minWordsForInContent: 700,
  },
  analytics: { provider: 'none', gaMeasurementId: '', plausibleDomain: '', requireConsent: true },
  consent: {
    mode: 'opt-in',
    cmp: 'builtin',
    policyVersion: 1,
    respectGlobalPrivacyControl: true,
    googleConsentMode: true,
    bannerText:
      'We use essential cookies to run this site. With your permission we would also like to use analytics and advertising cookies. You can change your choice at any time.',
  },
  automation: {
    dailyEnabled: false,
    publishTime: '09:00',
    timezone: 'UTC',
    checkExternalLinks: true,
  },
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue; // ignore unknown keys
    const cur = out[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) out[k] = deepMerge(cur, v);
    else if (typeof v === typeof cur) out[k] = v;
  }
  return out as T;
}

const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 5_000;

export function getSettings<K extends keyof SettingsMap>(group: K): SettingsMap[K] {
  const hit = cache.get(group);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingsMap[K];
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(group) as
    | { value_json: string }
    | undefined;
  let value = deepMerge(DEFAULTS[group], parseJson(row?.value_json, {}));
  value = applyEnvFallbacks(group, value);
  cache.set(group, { at: Date.now(), value });
  return value;
}

export function saveSettings<K extends keyof SettingsMap>(group: K, value: SettingsMap[K]) {
  const clean = deepMerge(DEFAULTS[group], value);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(group, JSON.stringify(clean), nowIso());
  cache.delete(group);
}

function applyEnvFallbacks<K extends keyof SettingsMap>(group: K, value: SettingsMap[K]): SettingsMap[K] {
  if (group === 'ads') {
    const v = value as AdsSettings;
    if (!v.clientId && config.ads.envClientId) return { ...v, clientId: config.ads.envClientId } as SettingsMap[K];
  }
  if (group === 'analytics') {
    const v = value as AnalyticsSettings;
    if (v.provider === 'none' && (config.analytics.provider === 'ga4' || config.analytics.provider === 'plausible')) {
      return {
        ...v,
        provider: config.analytics.provider,
        gaMeasurementId: v.gaMeasurementId || config.analytics.gaMeasurementId,
        plausibleDomain: v.plausibleDomain || config.analytics.plausibleDomain,
      } as SettingsMap[K];
    }
  }
  return value;
}

export const ADSENSE_CLIENT_RE = /^ca-pub-\d{10,20}$/;
export const ADSENSE_SLOT_RE = /^\d{6,20}$/;
export const GA4_ID_RE = /^G-[A-Z0-9]{4,15}$/;
export const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
