/**
 * Scheduled publication. Articles in status "scheduled" go live once `scheduled_for`
 * has passed — but only after re-validation. If validation now fails (e.g. a linked
 * article was deleted), the article drops back to "draft" instead of publishing.
 *
 * Triggered by: the cron endpoint, the CLI (`npm run publish:due`), and — as a safety
 * net when no cron is configured — lazily by incoming requests at most once a minute.
 */
import { audit, getDb, nowIso } from '../db';
import { dueScheduled, setStatus, setValidation } from '../repos/articles';
import { consumeKeywordForArticle, releaseKeywordForArticle } from '../repos/keywords';
import { articleToValidationInput, buildValidationContext } from './context';
import { validateArticleSync } from './validator';

export interface PublishResult {
  published: string[];
  heldBack: { slug: string; reason: string }[];
}

export function publishDueArticles(): PublishResult {
  const due = dueScheduled();
  const result: PublishResult = { published: [], heldBack: [] };
  if (!due.length) return result;
  const ctx = buildValidationContext();
  for (const a of due) {
    const isAi = a.aiRunId !== null;
    const report = validateArticleSync(articleToValidationInput(a), ctx, { requireFeaturedImage: true, strict: isAi });
    setValidation(a.id, report);
    const db = getDb();
    if (report.errors > 0) {
      setStatus(a.id, 'draft', { scheduledFor: null });
      if (isAi) {
        // Not published ⇒ free the day's AI slot and do not count the keyword as used.
        db.prepare("UPDATE ai_publication_slots SET status = 'released', updated_at = ? WHERE article_id = ? AND status = 'scheduled'").run(nowIso(), a.id);
        releaseKeywordForArticle(a.id, 'Held back at publish time: validation errors');
      }
      audit('publish.held_back', { entity: 'article', entityId: a.id, details: `${report.errors} validation error(s)` });
      result.heldBack.push({ slug: a.slug, reason: `${report.errors} validation error(s)` });
      continue;
    }
    // Keep the original date for re-published articles; otherwise the scheduled time is the publish date.
    setStatus(a.id, 'published', { publishedAt: a.publishedAt ?? a.scheduledFor ?? nowIso(), scheduledFor: null });
    if (isAi) {
      db.prepare("UPDATE ai_publication_slots SET status = 'published', updated_at = ? WHERE article_id = ? AND status = 'scheduled'").run(nowIso(), a.id);
      consumeKeywordForArticle(a.id);
      db.prepare("UPDATE ai_runs SET status = 'PUBLISHED', publication_result = 'published (from schedule)' WHERE article_id = ? AND status = 'SCHEDULED'").run(a.id);
    }
    audit('publish.scheduled', { entity: 'article', entityId: a.id });
    result.published.push(a.slug);
  }
  return result;
}

let lastRun = 0;
export function maybePublishDue() {
  const now = Date.now();
  if (now - lastRun < 60_000) return;
  lastRun = now;
  try {
    publishDueArticles();
  } catch (err) {
    console.error('[scheduler] publishDueArticles failed:', err);
  }
}
