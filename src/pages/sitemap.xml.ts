import type { APIRoute } from 'astro';
import { absoluteUrl, config } from '../lib/config';
import { listForSitemap } from '../lib/repos/articles';
import { listCategories } from '../lib/repos/categories';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = () => {
  const articles = listForSitemap();
  const latest = new Map<string, string>();
  let newest = '';
  for (const a of articles) {
    const d = a.content_updated_at ?? a.published_at;
    if (d > newest) newest = d;
    if (a.category_slug && d > (latest.get(a.category_slug) ?? '')) latest.set(a.category_slug, d);
  }
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: absoluteUrl('/'), lastmod: newest },
    { loc: absoluteUrl('/blog'), lastmod: newest },
    { loc: absoluteUrl('/categories') },
    { loc: absoluteUrl('/about') },
    { loc: absoluteUrl('/contact') },
    { loc: absoluteUrl('/privacy-policy') },
    { loc: absoluteUrl('/cookie-policy') },
    { loc: absoluteUrl('/terms') },
    { loc: absoluteUrl('/disclaimer') },
  ];
  for (const c of listCategories()) if ((c.publishedCount ?? 0) > 0) urls.push({ loc: absoluteUrl(`/category/${c.slug}`), lastmod: latest.get(c.slug) });
  for (const a of articles) {
    if (a.noindex) continue;
    if (a.canonical_url && !a.canonical_url.startsWith(config.siteUrl)) continue;
    urls.push({ loc: absoluteUrl(`/blog/${a.slug}`), lastmod: a.content_updated_at ?? a.published_at });
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
