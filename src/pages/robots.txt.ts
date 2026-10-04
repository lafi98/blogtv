import type { APIRoute } from 'astro';
import { config } from '../lib/config';

export const GET: APIRoute = () => {
  const body = config.allowIndexing
    ? `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /search
Disallow: /newsletter/

Sitemap: ${config.siteUrl}/sitemap.xml
`
    : `# Indexing is disabled (ALLOW_INDEXING is not "true"). Enable it at launch.
User-agent: *
Disallow: /
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
