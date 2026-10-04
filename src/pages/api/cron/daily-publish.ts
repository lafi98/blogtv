/**
 * Daily AI publishing — call this from your host's scheduler (e.g. every 15 minutes).
 * It also publishes any due SCHEDULED articles, so this is the only cron entry you need.
 * It does nothing unless daily publishing is ON, today's local publishing time has passed,
 * no AI article was published today, and the keyword queue is not empty. Safe to call
 * repeatedly: a database-backed daily slot + run lock guarantee at most one publication per day.
 *
 *   GET or POST /api/cron/daily-publish
 *   Authorization: Bearer <CRON_SECRET>
 *   ?wait=1  → wait for the run to finish and return its result (for long-timeout schedulers)
 */
import type { APIRoute } from 'astro';
import { cronAuthorized, cronAuthResponse } from '../../../lib/security/cron';
import { startDailyRun } from '../../../lib/publishing/publisher';
import { publishDueArticles } from '../../../lib/publishing/scheduler';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const ALL: APIRoute = async ({ request, url }) => {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const auth = cronAuthorized(request);
  if (auth !== 'ok') return cronAuthResponse(auth);
  // One cron entry does everything: first publish due scheduled articles, then the daily AI run.
  const scheduled = publishDueArticles();
  const r = startDailyRun({ trigger: 'cron' });
  if (r.kind === 'noop') return json(200, { status: 'noop', reason: r.reason, message: r.message, scheduled });
  if (r.kind === 'error') return json(503, { status: 'error', code: r.code, message: r.message });
  if (r.kind === 'duplicate') return json(200, { status: 'skipped_duplicate', runId: r.runId, message: r.message });
  if (url.searchParams.get('wait') === '1') {
    const outcome = await r.done;
    return json(200, { status: outcome.status.toLowerCase(), runId: outcome.runId, message: outcome.message, articleId: outcome.articleId ?? null });
  }
  r.done.catch((err) => console.error('[daily-publish] run crashed:', err));
  return json(202, { status: 'started', runId: r.runId, keyword: r.keyword, publishDay: r.publishDay });
};
