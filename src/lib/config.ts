/**
 * Server-side runtime configuration.
 *
 * Everything sensitive comes from environment variables and is only ever read on
 * the server. Editable, non-secret settings (site name, ad toggles, consent mode…)
 * live in the database — see src/lib/settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Load .env for local development and CLI scripts. Existing environment variables
// (e.g. set by the host in production) always win — loadEnvFile never overrides them.
const envFile = process.env.ENV_FILE || '.env';
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.warn(`[config] could not load ${envFile}:`, (err as Error).message);
  }
}

const str = (name: string, fallback = ''): string => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v.trim();
};
const bool = (name: string, fallback = false): boolean => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
};

// The built server (`astro build`) is always production; CLI scripts use NODE_ENV.
// Keep the exact `import.meta.env.PROD` form: the bundler replaces just that flag. Any other form (a cast,
// `?.`) makes it inline the whole build-time environment, secrets included. Outside Vite (tsx) it throws.
function builtForProduction(): boolean {
  try {
    return import.meta.env.PROD === true;
  } catch {
    return false;
  }
}
const isProd = process.env.NODE_ENV === 'production' || builtForProduction();
const dataDir = path.resolve(str('DATA_DIR', './data'));

function resolveAppSecret(): string {
  const fromEnv = str('APP_SECRET');
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
    return fromEnv;
  }
  if (isProd) {
    throw new Error('APP_SECRET is required in production. See .env.example.');
  }
  // Development convenience: persist a random secret so sessions survive restarts.
  const file = path.join(dataDir, '.dev-secret');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

let cachedSecret: string | null = null;

export const config = {
  isProd,
  siteUrl: str('SITE_URL', 'http://localhost:4321').replace(/\/+$/, ''),
  allowIndexing: bool('ALLOW_INDEXING', false),
  trustProxy: bool('TRUST_PROXY', false),
  dataDir,
  databasePath: path.resolve(str('DATABASE_PATH', path.join(dataDir, 'site.db'))),
  uploadsDir: path.resolve(str('UPLOADS_DIR', path.join(dataDir, 'uploads'))),
  get appSecret(): string {
    if (!cachedSecret) cachedSecret = resolveAppSecret();
    return cachedSecret;
  },
  cronSecret: str('CRON_SECRET'),
  ai: {
    apiKeyConfigured: Boolean(str('ANTHROPIC_API_KEY')),
    model: str('AI_MODEL', 'claude-opus-5-5'),
    effort: str('AI_EFFORT', 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    webSearch: bool('AI_WEB_SEARCH', true),
  },
  ads: {
    killSwitch: bool('ADS_DISABLED', false),
    envClientId: str('ADSENSE_CLIENT_ID'),
  },
  analytics: {
    provider: str('ANALYTICS_PROVIDER', 'none'),
    gaMeasurementId: str('GA_MEASUREMENT_ID'),
    plausibleDomain: str('PLAUSIBLE_DOMAIN'),
    plausibleScriptUrl: str('PLAUSIBLE_SCRIPT_URL', 'https://plausible.io/js/script.js'),
  },
  email: {
    provider: str('EMAIL_PROVIDER', 'none') as 'none' | 'resend' | 'postmark',
    apiKey: str('EMAIL_API_KEY'),
    from: str('EMAIL_FROM', 'Hook & Hearth <hello@example.com>'),
    contactNotifyTo: str('CONTACT_NOTIFY_TO'),
  },
  turnstile: {
    siteKey: str('TURNSTILE_SITE_KEY'),
    secretKey: str('TURNSTILE_SECRET_KEY'),
    get enabled() {
      return Boolean(this.siteKey && this.secretKey);
    },
  },
};

/** Absolute URL for a site path. */
export function absoluteUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return config.siteUrl + (pathname.startsWith('/') ? pathname : `/${pathname}`);
}
