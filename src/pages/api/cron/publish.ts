/** Publishes due SCHEDULED articles (after re-validation). Call every 5–15 minutes. GET or POST with the cron secret. */
import type { APIRoute } from 'astro';
import { cronAuthorized, cronAuthResponse } from '../../../lib/security/cron';
import { publishDueArticles } from '../../../lib/publishing/scheduler';

export const ALL: APIRoute = ({ request }) => {
  if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405 });
  const auth = cronAuthorized(request);
  if (auth !== 'ok') return cronAuthResponse(auth);
  const result = publishDueArticles();
  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
