import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/config';
import { getSettings } from '../lib/settings';
import { listPublishedCards } from '../lib/repos/articles';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = () => {
  const site = getSettings('site');
  const { items } = listPublishedCards({ limit: 20 });
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(site.name)}</title>
  <link>${absoluteUrl('/')}</link>
  <description>${esc(site.description)}</description>
  <language>en</language>
  <atom:link href="${absoluteUrl('/rss.xml')}" rel="self" type="application/rss+xml"/>
${items
  .map(
    (a) => `  <item>
    <title>${esc(a.title)}</title>
    <link>${absoluteUrl(`/blog/${a.slug}`)}</link>
    <guid isPermaLink="true">${absoluteUrl(`/blog/${a.slug}`)}</guid>
    <pubDate>${new Date(a.publishedAt!).toUTCString()}</pubDate>
    ${a.categoryName ? `<category>${esc(a.categoryName)}</category>` : ''}
    <description>${esc(a.excerpt)}</description>
  </item>`,
  )
  .join('\n')}
</channel>
</rss>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' } });
};
