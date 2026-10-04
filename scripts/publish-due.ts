/** Publish scheduled articles whose time has come (re-validating each). Run from cron every 5–15 minutes. */
import { publishDueArticles } from '../src/lib/publishing/scheduler';
const r = publishDueArticles();
console.log(`[publish:due] published ${r.published.length}${r.published.length ? `: ${r.published.join(', ')}` : ''}; held back ${r.heldBack.length}`);
for (const h of r.heldBack) console.log(`  held back ${h.slug}: ${h.reason}`);
