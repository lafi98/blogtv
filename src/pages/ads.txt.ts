import type { APIRoute } from 'astro';
import { adsTxt } from '../lib/ads';

/** Served only once a real AdSense publisher ID is configured in Admin → Settings → Ads. */
export const GET: APIRoute = () => {
  const body = adsTxt();
  if (!body) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
