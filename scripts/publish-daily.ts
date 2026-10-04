/**
 * Daily AI publisher for command-based schedulers (crontab, systemd timers, Render/Railway cron jobs…).
 *   npm run publish:daily            — respects ON/OFF, publishing time, queue and the 1-per-day limit
 *   npm run publish:daily -- --now   — ignore the publishing time (still ON/OFF + limit + queue)
 * Also publishes any due scheduled articles first. Safe to run repeatedly.
 */
import { startDailyRun } from '../src/lib/publishing/publisher';
import { publishDueArticles } from '../src/lib/publishing/scheduler';
import { flag } from './_bootstrap';

const due = publishDueArticles();
if (due.published.length || due.heldBack.length) console.log(`[scheduled] published ${due.published.length}, held back ${due.heldBack.length}`);
const r = startDailyRun({ trigger: 'cli', ignoreTime: flag('now') });
if (r.kind === 'noop') {
  console.log(`[daily] nothing to do: ${r.reason} — ${r.message}`);
  process.exit(0);
}
if (r.kind === 'error') {
  console.error(`[daily] ${r.code}: ${r.message}`);
  process.exit(2);
}
if (r.kind === 'duplicate') {
  console.log(`[daily] skipped duplicate: ${r.message}`);
  process.exit(0);
}
console.log(`[daily] run #${r.runId} started for “${r.keyword}”…`);
const outcome = await r.done;
console.log(`[daily] run #${outcome.runId}: ${outcome.status} — ${outcome.message}`);
process.exit(outcome.status === 'FAILED' ? 1 : 0);
