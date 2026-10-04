/** Keyword queue for the AI publisher. */
import { getDb, nowIso } from '../db';

export type KeywordStatus = 'queued' | 'generating' | 'published' | 'scheduled' | 'draft' | 'failed' | 'skipped_duplicate';

export interface Keyword {
  id: number;
  keyword: string;
  normalized: string;
  categorySlug: string;
  notes: string;
  position: number;
  source: 'queue' | 'manual';
  status: KeywordStatus;
  attempts: number;
  articleId: number | null;
  lastRunId: number | null;
  lastError: string;
  createdAt: string;
  updatedAt: string;
  usedAt: string | null;
}

interface Row {
  id: number;
  keyword: string;
  normalized: string;
  category_slug: string;
  notes: string;
  position: number;
  source: 'queue' | 'manual';
  status: KeywordStatus;
  attempts: number;
  article_id: number | null;
  last_run_id: number | null;
  last_error: string;
  created_at: string;
  updated_at: string;
  used_at: string | null;
}

const map = (r: Row): Keyword => ({
  id: r.id,
  keyword: r.keyword,
  normalized: r.normalized,
  categorySlug: r.category_slug,
  notes: r.notes,
  position: r.position,
  source: r.source,
  status: r.status,
  attempts: r.attempts,
  articleId: r.article_id,
  lastRunId: r.last_run_id,
  lastError: r.last_error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  usedAt: r.used_at,
});

/** Keywords that have been tried this many times without success stop being retried automatically. */
export const MAX_KEYWORD_ATTEMPTS = 3;

export function getKeyword(id: number | null | undefined): Keyword | null {
  if (!id) return null;
  const r = getDb().prepare('SELECT * FROM keywords WHERE id = ?').get(id) as Row | undefined;
  return r ? map(r) : null;
}

export function listKeywords(limit = 500): Keyword[] {
  return (getDb()
    .prepare(
      `SELECT * FROM keywords
       ORDER BY CASE status WHEN 'generating' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                CASE WHEN status IN ('queued','generating') THEN position ELSE 0 END, updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Row[]).map(map);
}

export function queuedKeywords(): Keyword[] {
  return (getDb().prepare("SELECT * FROM keywords WHERE status = 'queued' ORDER BY position, id").all() as Row[]).map(map);
}

export function nextQueuedKeyword(): Keyword | null {
  const r = getDb().prepare("SELECT * FROM keywords WHERE status = 'queued' ORDER BY position, id LIMIT 1").get() as Row | undefined;
  return r ? map(r) : null;
}

export function findActiveKeyword(normalized: string): Keyword | null {
  const r = getDb()
    .prepare("SELECT * FROM keywords WHERE normalized = ? AND status IN ('queued','generating') LIMIT 1")
    .get(normalized) as Row | undefined;
  return r ? map(r) : null;
}

/** A keyword row that can be re-run (queued, or a previous draft/failed attempt) — reused instead of duplicated. */
export function findReusableKeyword(normalized: string): Keyword | null {
  const r = getDb()
    .prepare(
      `SELECT * FROM keywords WHERE normalized = ? AND status IN ('queued','generating','draft','failed')
       ORDER BY CASE status WHEN 'generating' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, id DESC LIMIT 1`,
    )
    .get(normalized) as Row | undefined;
  return r ? map(r) : null;
}

export function endOfQueuePosition(): number {
  return (getDb().prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM keywords').get() as { p: number }).p;
}

/** The keyword behind an article is consumed only when that article is actually published. */
export function consumeKeywordForArticle(articleId: number) {
  getDb()
    .prepare(
      `UPDATE keywords SET status = 'published', used_at = COALESCE(used_at, @now), last_error = '', updated_at = @now
       WHERE article_id = @id AND status IN ('scheduled','queued','draft','failed')`,
    )
    .run({ id: articleId, now: nowIso() });
}

/** A scheduled AI article that could not be published gives its keyword back (queue keywords go to the end of the queue). */
export function releaseKeywordForArticle(articleId: number, reason: string) {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM keywords WHERE article_id = ? AND status = 'scheduled'").all(articleId) as Row[];
  for (const r of rows) {
    const attempts = r.attempts + 1;
    const status: KeywordStatus = r.source === 'queue' ? (attempts < MAX_KEYWORD_ATTEMPTS ? 'queued' : 'failed') : 'draft';
    updateKeyword(r.id, { status, attempts, lastError: reason, position: status === 'queued' ? endOfQueuePosition() : undefined });
  }
}

export function insertKeyword(k: { keyword: string; normalized: string; categorySlug?: string; notes?: string; source: 'queue' | 'manual'; status?: KeywordStatus }): number {
  const db = getDb();
  const now = nowIso();
  const { p } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM keywords').get() as { p: number };
  const res = db
    .prepare(
      `INSERT INTO keywords (keyword, normalized, category_slug, notes, position, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(k.keyword, k.normalized, k.categorySlug ?? '', k.notes ?? '', p, k.source, k.status ?? 'queued', now, now);
  return Number(res.lastInsertRowid);
}

export function updateKeyword(
  id: number,
  patch: Partial<{ status: KeywordStatus; articleId: number | null; lastRunId: number | null; lastError: string; attempts: number; position: number; used: boolean }>,
) {
  const sets = ['updated_at = @now'];
  const params: Record<string, unknown> = { id, now: nowIso() };
  if (patch.status !== undefined) (sets.push('status = @status'), (params.status = patch.status));
  if (patch.articleId !== undefined) (sets.push('article_id = @articleId'), (params.articleId = patch.articleId));
  if (patch.lastRunId !== undefined) (sets.push('last_run_id = @lastRunId'), (params.lastRunId = patch.lastRunId));
  if (patch.lastError !== undefined) (sets.push('last_error = @lastError'), (params.lastError = patch.lastError.slice(0, 2000)));
  if (patch.attempts !== undefined) (sets.push('attempts = @attempts'), (params.attempts = patch.attempts));
  if (patch.position !== undefined) (sets.push('position = @position'), (params.position = patch.position));
  if (patch.used) sets.push('used_at = @now');
  getDb().prepare(`UPDATE keywords SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function moveKeywordToTop(id: number) {
  const { p } = getDb().prepare('SELECT COALESCE(MIN(position), 1) - 1 AS p FROM keywords').get() as { p: number };
  updateKeyword(id, { position: p });
}

export function deleteKeyword(id: number) {
  getDb().prepare("DELETE FROM keywords WHERE id = ? AND status != 'generating'").run(id);
}

export function countKeywordsByStatus(): Record<KeywordStatus, number> {
  const out = { queued: 0, generating: 0, published: 0, scheduled: 0, draft: 0, failed: 0, skipped_duplicate: 0 } as Record<KeywordStatus, number>;
  for (const r of getDb().prepare('SELECT status, COUNT(*) n FROM keywords GROUP BY status').all() as { status: KeywordStatus; n: number }[]) out[r.status] = r.n;
  return out;
}
