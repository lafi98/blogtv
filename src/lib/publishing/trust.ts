/**
 * Which external references an AI article may cite. Sources must come from the research step
 * (or the trusted reference list) AND pass this check: HTTPS, a real domain, and not a social
 * network, marketplace, link shortener or user-generated Q&A site — those are not trustworthy
 * references and are often unstable or commercial.
 */
const UNTRUSTED_HOSTS = [
  'pinterest.', 'pin.it', 'facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'threads.net', 'reddit.com', 'quora.com', 'amazon.', 'amzn.', 'etsy.com', 'ebay.', 'aliexpress.', 'temu.com', 'shein.',
  'walmart.com', 'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'linktr.ee', 'ow.ly', 'buff.ly',
];

export function isTrustedExternalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' || !host.includes('.')) return false;
  const bare = host.replace(/^www\./, '');
  return !UNTRUSTED_HOSTS.some((d) => (d.endsWith('.') ? bare.startsWith(d) || bare.includes(`.${d}`) : bare === d || bare.endsWith(`.${d}`)));
}
