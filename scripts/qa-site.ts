/**
 * Automated pre-launch QA against a running server.
 *   npm run qa -- --base http://localhost:4321
 * Crawls every internal link from the homepage + sitemap and checks: status codes, one <h1>,
 * title/description/canonical/OG/Twitter tags, valid JSON-LD, image alt text, broken links,
 * security headers, ad markup (none while ads are off), no publisher ID leakage, robots/sitemap/RSS,
 * admin protection, cron endpoint protection and the 404 page.
 */
import { arg } from './_bootstrap';

const base = (arg('base') ?? process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');
const problems: string[] = [];
const notes: string[] = [];
const fail = (m: string) => problems.push(m);

async function get(path: string, init?: RequestInit) {
  return fetch(base + path, { redirect: 'manual', ...init });
}

const seen = new Map<string, number>();
const queue: string[] = ['/'];
const htmlPages: string[] = [];

function extractLinks(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

function checkHtml(path: string, html: string, headers: Headers) {
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) fail(`${path}: expected 1 <h1>, found ${h1}`);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  if (!title) fail(`${path}: missing <title>`);
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  if (desc.length < 50) fail(`${path}: meta description missing/short (${desc.length})`);
  if (!/<link rel="canonical" href="https?:\/\/[^"]+"/.test(html)) fail(`${path}: missing absolute canonical`);
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) if (!html.includes(`property="${p}"`)) fail(`${path}: missing ${p}`);
  if (!html.includes('name="twitter:card"')) fail(`${path}: missing twitter:card`);
  if (!/<html lang="en"/.test(html)) fail(`${path}: missing lang attribute`);
  if (!html.includes('href="#main"')) fail(`${path}: missing skip link`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(m[1]);
    } catch {
      fail(`${path}: invalid JSON-LD`);
    }
  }
  for (const m of html.matchAll(/<img\s[^>]*>/g)) if (!/\salt(=|\s|>)/.test(m[0])) fail(`${path}: <img> without alt: ${m[0].slice(0, 80)}`);
  for (const m of html.matchAll(/<img\s[^>]*>/g)) if (!/\swidth="\d+"/.test(m[0])) fail(`${path}: <img> without width/height (CLS risk): ${m[0].slice(0, 80)}`);
  if (/adsbygoogle|pagead2\.googlesyndication/.test(html)) fail(`${path}: ad markup present while ads are disabled`);
  if (/ca-pub-\d/.test(html)) fail(`${path}: an AdSense publisher ID appears in the page`);
  if (/ANTHROPIC|sk-ant-|APP_SECRET|CRON_SECRET/.test(html)) fail(`${path}: possible secret/env name leaked into HTML`);
  for (const m of html.matchAll(/<script(?![^>]*application\/(?:ld\+)?json)[^>]*>/g)) if (!/nonce="/.test(m[0])) fail(`${path}: <script> without nonce: ${m[0].slice(0, 80)}`);
  for (const h of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy'])
    if (!headers.get(h)) fail(`${path}: missing ${h} header`);
  // Labels for form fields
  for (const m of html.matchAll(/<(input|textarea|select)\s([^>]*)>/g)) {
    const attrs = m[2];
    if (/type="(hidden|submit|button)"/.test(attrs)) continue;
    const id = attrs.match(/(?:^|\s)id="([^"]+)"/)?.[1];
    const wrapped = new RegExp(`<label[^>]*>(?:(?!</label>)[\\s\\S])*<${m[1]}\\s${attrs.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(html);
    if (!wrapped && (!id || !html.includes(`for="${id}"`))) fail(`${path}: form field without a <label>: <${m[1]} ${attrs.slice(0, 60)}`);
  }
}

// 1. Crawl
const sitemap = await (await get('/sitemap.xml')).text();
for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) queue.push(new URL(m[1]).pathname);
while (queue.length) {
  const path = queue.shift()!;
  if (seen.has(path)) continue;
  const res = await get(path);
  seen.set(path, res.status);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) queue.push(new URL(loc, base).pathname);
    continue;
  }
  if (res.status !== 200) {
    fail(`${path}: HTTP ${res.status}`);
    continue;
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) continue;
  const html = await res.text();
  htmlPages.push(path);
  checkHtml(path, html, res.headers);
  for (const href of extractLinks(html)) {
    if (/^(mailto:|https?:\/\/(?!localhost)|#)/.test(href)) continue;
    const u = new URL(href, base + path);
    if (u.origin !== new URL(base).origin) continue;
    if (u.pathname.startsWith('/admin') || u.pathname === '/search') continue;
    if (!seen.has(u.pathname) && !queue.includes(u.pathname)) queue.push(u.pathname);
  }
}
notes.push(`Crawled ${seen.size} URLs (${htmlPages.length} HTML pages).`);

// 2. Special endpoints
const robots = await (await get('/robots.txt')).text();
notes.push(`robots.txt: ${robots.includes('Disallow: /\n') ? 'blocks all (ALLOW_INDEXING=false)' : 'allows crawling'}`);
if (!/^<\?xml/.test(sitemap) || !sitemap.includes('<urlset')) fail('sitemap.xml is not a valid urlset');
const rss = await get('/rss.xml');
if (rss.status !== 200 || !(await rss.text()).includes('<rss')) fail('rss.xml broken');
const ads = await get('/ads.txt');
notes.push(`ads.txt: HTTP ${ads.status} (404 expected until a publisher ID is configured)`);
const nf = await get('/this-page-does-not-exist');
if (nf.status !== 404) fail(`unknown URL returned ${nf.status}, expected 404`);
const nfArticle = await get('/blog/not-a-real-article');
if (nfArticle.status !== 404) fail(`unknown article returned ${nfArticle.status}, expected 404`);
const admin = await get('/admin');
if (admin.status !== 303 || !admin.headers.get('location')?.startsWith('/admin/login')) fail(`/admin not protected (HTTP ${admin.status})`);
const cron = await get('/api/cron/publish', { method: 'POST' });
if (![401, 404].includes(cron.status)) fail(`/api/cron/publish without secret returned ${cron.status}`);
const media = await get('/media/..%2F..%2Fsite.db');
if (media.status !== 404) fail(`media path traversal returned ${media.status}`);
// Attribute break-out + element injection attempt: quotes and brackets must come back escaped.
const xss = await (await get('/search?q=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
if (xss.includes('"><script>alert(1)') || />[^<"]*<script>alert\(1\)/.test(xss.replace(/content="[^"]*"/g, '').replace(/value="[^"]*"/g, '')))
  fail('search reflects unescaped HTML (XSS)');
const crossSite = await get('/contact', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }, body: 'name=a' });
if (crossSite.status !== 403) fail(`cross-site form POST returned ${crossSite.status}, expected 403`);
const noOrigin = await get('/contact', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=a' });
if (noOrigin.status !== 403) fail(`form POST without Origin/Referer returned ${noOrigin.status}, expected 403`);

// 3. Required pages
for (const p of ['/about', '/contact', '/privacy-policy', '/cookie-policy', '/terms', '/disclaimer', '/sitemap', '/categories', '/blog', '/newsletter'])
  if (seen.get(p) !== 200) fail(`required page ${p} not reachable (status ${seen.get(p) ?? 'not linked'})`);

console.log(notes.join('\n'));
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' ✗ ' + p);
  process.exit(1);
}
console.log('\nAll checks passed.');
