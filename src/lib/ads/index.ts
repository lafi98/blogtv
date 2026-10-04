/**
 * Advertising runtime. Ads are OFF unless ALL of these hold:
 *   1. env ADS_DISABLED is not "true" (global kill switch),
 *   2. the admin toggle (Admin → Settings → Ads) is on,
 *   3. a real AdSense publisher ID (ca-pub-…) is configured,
 *   4. the slot for that position has an ad unit ID,
 *   5. the page is eligible (articles and listings only — never legal pages, contact,
 *      search results, error pages or the admin area),
 *   6. the visitor's consent state allows it (enforced client-side before the script loads).
 * No publisher ID is shipped with this code.
 */
import { config } from '../config';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE, getSettings, type AdPosition } from '../settings';

export interface AdRuntime {
  live: boolean;
  placeholders: boolean;
  clientId: string;
  slots: Record<AdPosition, string>;
  minWordsForInContent: number;
  reason: string;
}

export function adRuntime(): AdRuntime {
  const s = getSettings('ads');
  const clientOk = ADSENSE_CLIENT_RE.test(s.clientId);
  let reason = '';
  if (config.ads.killSwitch) reason = 'Disabled by ADS_DISABLED environment variable.';
  else if (!s.enabled) reason = 'Ads are switched off in Admin → Settings → Ads.';
  else if (!clientOk) reason = 'No valid AdSense publisher ID configured.';
  const live = !reason;
  return {
    live,
    // Placeholders are a development aid only — never rendered in production builds.
    placeholders: !live && s.showPlaceholders && !config.isProd,
    clientId: live ? s.clientId : '',
    slots: s.slots,
    minWordsForInContent: s.minWordsForInContent,
    reason,
  };
}

export function slotState(rt: AdRuntime, position: AdPosition): 'live' | 'placeholder' | 'off' {
  if (rt.live && ADSENSE_SLOT_RE.test(rt.slots[position] ?? '')) return 'live';
  if (rt.placeholders) return 'placeholder';
  return 'off';
}

/** Body of /ads.txt — only served once a publisher ID is configured. */
export function adsTxt(): string | null {
  const s = getSettings('ads');
  if (!ADSENSE_CLIENT_RE.test(s.clientId)) return null;
  const pub = s.clientId.replace(/^ca-/, '');
  // f08c47fec0942fa0 is Google's published TAG certification authority ID for AdSense.
  return `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
}
