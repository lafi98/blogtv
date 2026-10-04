/** AI run audit log, daily publication slots and run locks. */
import { getDb, nowIso, parseJson } from '../db';
import type { ValidationReport } from '../publishing/validator';

export type RunStatus = 'QUEUED' | 'GENERATING' | 'VALIDATING' | 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED' | 'SKIPPED_DUPLICATE';
export const ACTIVE_RUN_STATUSES: RunStatus[] = ['QUEUED', 'GENERATING', 'VALIDATING'];
export type ClaudeStatus = 'not_called' | 'ok' | 'error' | 'refused' | 'not_configured';

export interface RunLogEntry {
  at: string;
  stage: string;
  message: string;
}

export interface AiRun {
  id: number;
  keywordId: number | null;
  keyword: string;
  trigger: string;
  mode: 'draft' | 'publish';
  status: RunStatus;
  publishDay: string | null;
  articleId: number | null;
  claudeStatus: ClaudeStatus;
  claudeDetail: string;
  validationStatus: 'pass' | 'warn' | 'fail' | null;
  validationErrors: number | null;
  validationWarnings: number | null;
  validation: ValidationReport | null;
  publicationResult: string;
  duplicateOfSlug: string | null;
  duplicateReason: string | null;
  error: string;
  log: RunLogEntry[];
  usage: { input_tokens?: number; output_tokens?: number; calls?: number };
  startedAt: string;
  completedAt: string | null;
}

interface Row {
  id: number;
  keyword_id: number | null;
  keyword: string;
  trigger: string;
  mode: 'draft' | 'publish';
  status: RunStatus;
  publish_day: string | null;
  article_id: number | null;
  claude_status: ClaudeStatus;
  claude_detail: string;
  validation_status: 'pass' | 'warn' | 'fail' | null;
  validation_errors: number | null;
  validation_warnings: number | null;
  validation_json: string | null;
  publication_result: string;
  duplicate_of_slug: string | null;
  duplicate_reason: string | null;
  error: string;
  log_json: string;
  usage_json: string;
  started_at: string;
  completed_at: string | null;
}

const map = (r: Row): AiRun => ({
  id: r.id,
  keywordId: r.keyword_id,
  keyword: r.keyword,
  trigger: r.trigger,
  mode: r.mode,
  status: r.status,
  publishDay: r.publish_day,
  articleId: r.article_id,
  claudeStatus: r.claude_status,
  claudeDetail: r.claude_detail,
  validationStatus: r.validation_status,
  validationErrors: r.validation_errors,
  validationWarnings: r.validation_warnings,
  validation: parseJson<ValidationReport | null>(r.validation_json, null),
  publicationResult: r.publication_result,
  duplicateOfSlug: r.duplicate_of_slug,
  duplicateReason: r.duplicate_reason,
  error: r.error,
  log: parseJson<RunLogEntry[]>(r.log_json, []),
  usage: parseJson(r.usage_json, {}),
  startedAt: r.started_at,
  completedAt: r.completed_at,
});

// ── runs ─────────────────────────────────────────────────────────────────────

export function createRun(r: {
  keywordId: number | null;
  keyword: string;
  trigger: string;
  mode: 'draft' | 'publish';
  status: RunStatus;
  publishDay?: string | null;
  duplicateOfSlug?: string | null;
  duplicateReason?: string | null;
  completed?: boolean;
}): number {
  const now = nowIso();
  const res = getDb()
    .prepare(
      `INSERT INTO ai_runs (keyword_id, keyword, trigger, mode, status, publish_day, duplicate_of_slug, duplicate_reason, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.keywordId, r.keyword, r.trigger, r.mode, r.status, r.publishDay ?? null, r.duplicateOfSlug ?? null, r.duplicateReason ?? null, now, r.completed ? now : null);
  return Number(res.lastInsertRowid);
}

export function updateRun(
  id: number,
  patch: Partial<{
    status: RunStatus;
    articleId: number | null;
    claudeStatus: ClaudeStatus;
    claudeDetail: string;
    validation: ValidationReport;
    publicationResult: string;
    publishDay: string | null;
    duplicateOfSlug: string | null;
    duplicateReason: string | null;
    error: string;
    log: RunLogEntry[];
    usage: object;
    completed: boolean;
  }>,
) {
  const sets: string[] = [];
  const p: Record<string, unknown> = { id };
  const set = (col: string, key: string, val: unknown) => {
    sets.push(`${col} = @${key}`);
    p[key] = val;
  };
  if (patch.status !== undefined) set('status', 'status', patch.status);
  if (patch.articleId !== undefined) set('article_id', 'articleId', patch.articleId);
  if (patch.claudeStatus !== undefined) set('claude_status', 'claudeStatus', patch.claudeStatus);
  if (patch.claudeDetail !== undefined) set('claude_detail', 'claudeDetail', patch.claudeDetail.slice(0, 2000));
  if (patch.validation !== undefined) {
    set('validation_status', 'vs', patch.validation.status);
    set('validation_errors', 've', patch.validation.errors);
    set('validation_warnings', 'vw', patch.validation.warnings);
    set('validation_json', 'vj', JSON.stringify(patch.validation));
  }
  if (patch.publicationResult !== undefined) set('publication_result', 'pr', patch.publicationResult.slice(0, 500));
  if (patch.publishDay !== undefined) set('publish_day', 'pd', patch.publishDay);
  if (patch.duplicateOfSlug !== undefined) set('duplicate_of_slug', 'dos', patch.duplicateOfSlug);
  if (patch.duplicateReason !== undefined) set('duplicate_reason', 'dr', patch.duplicateReason);
  if (patch.error !== undefined) set('error', 'err', patch.error.slice(0, 4000));
  if (patch.log !== undefined) set('log_json', 'log', JSON.stringify(patch.log));
  if (patch.usage !== undefined) set('usage_json', 'usage', JSON.stringify(patch.usage));
  if (patch.completed) set('completed_at', 'done', nowIso());
  if (!sets.length) return;
  getDb().prepare(`UPDATE ai_runs SET ${sets.join(', ')} WHERE id = @id`).run(p);
}

export function getRun(id: number): AiRun | null {
  const r = getDb().prepare('SELECT * FROM ai_runs WHERE id = ?').get(id) as Row | undefined;
  return r ? map(r) : null;
}

export function listRuns(limit = 30): AiRun[] {
  return (getDb().prepare('SELECT * FROM ai_runs ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(map);
}

export function lastRun(where: string, ...params: unknown[]): AiRun | null {
  const r = getDb().prepare(`SELECT * FROM ai_runs WHERE ${where} ORDER BY id DESC LIMIT 1`).get(...params) as Row | undefined;
  return r ? map(r) : null;
}

export function activeRuns(): AiRun[] {
  return (getDb()
    .prepare(`SELECT * FROM ai_runs WHERE status IN ('QUEUED','GENERATING','VALIDATING') ORDER BY id`)
    .all() as Row[]).map(map);
}

export function countAiPublished(): number {
  return (getDb()
    .prepare("SELECT COUNT(*) n FROM articles WHERE ai_run_id IS NOT NULL AND status = 'published'")
    .get() as { n: number }).n;
}

// ── daily publication slots ──────────────────────────────────────────────────

export type SlotStatus = 'claimed' | 'published' | 'scheduled' | 'released';

export interface Slot {
  day: string;
  status: SlotStatus;
  runId: number | null;
  articleId: number | null;
  keywordId: number | null;
  attempts: number;
  claimedAt: string;
  updatedAt: string;
}

export function getSlot(day: string): Slot | null {
  const r = getDb().prepare('SELECT * FROM ai_publication_slots WHERE day = ?').get(day) as
    | { day: string; status: SlotStatus; run_id: number | null; article_id: number | null; keyword_id: number | null; attempts: number; claimed_at: string; updated_at: string }
    | undefined;
  return r
    ? { day: r.day, status: r.status, runId: r.run_id, articleId: r.article_id, keywordId: r.keyword_id, attempts: r.attempts, claimedAt: r.claimed_at, updatedAt: r.updated_at }
    : null;
}

/** Insert or re-claim a day's slot. Call only inside an IMMEDIATE transaction after checking it is free. */
export function writeSlotClaim(day: string, keywordId: number | null) {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO ai_publication_slots (day, status, keyword_id, attempts, claimed_at, updated_at) VALUES (?, 'claimed', ?, 1, ?, ?)
       ON CONFLICT(day) DO UPDATE SET status = 'claimed', keyword_id = excluded.keyword_id, run_id = NULL, article_id = NULL,
         attempts = attempts + 1, claimed_at = excluded.claimed_at, updated_at = excluded.updated_at`,
    )
    .run(day, keywordId, now, now);
}

export function updateSlot(day: string, patch: { status?: SlotStatus; runId?: number | null; articleId?: number | null }) {
  const sets = ['updated_at = @now'];
  const p: Record<string, unknown> = { day, now: nowIso() };
  if (patch.status) (sets.push('status = @status'), (p.status = patch.status));
  if (patch.runId !== undefined) (sets.push('run_id = @runId'), (p.runId = patch.runId));
  if (patch.articleId !== undefined) (sets.push('article_id = @articleId'), (p.articleId = patch.articleId));
  getDb().prepare(`UPDATE ai_publication_slots SET ${sets.join(', ')} WHERE day = @day`).run(p);
}

export function releaseSlotForArticle(articleId: number) {
  getDb()
    .prepare("UPDATE ai_publication_slots SET status = 'released', updated_at = ? WHERE article_id = ? AND status IN ('scheduled','claimed')")
    .run(nowIso(), articleId);
}

// ── locks ────────────────────────────────────────────────────────────────────

/** Try to take a named lock. Expired locks are taken over. Call inside a transaction for atomicity. */
export function tryLock(name: string, holder: string, ttlMs: number): boolean {
  const db = getDb();
  const now = nowIso();
  db.prepare('DELETE FROM ai_locks WHERE name = ? AND expires_at < ?').run(name, now);
  const res = db
    .prepare('INSERT OR IGNORE INTO ai_locks (name, holder, expires_at) VALUES (?, ?, ?)')
    .run(name, holder, new Date(Date.now() + ttlMs).toISOString());
  return res.changes === 1;
}

export function unlock(name: string, holder: string) {
  getDb().prepare('DELETE FROM ai_locks WHERE name = ? AND holder = ?').run(name, holder);
}

export function currentLock(name: string): { holder: string; expiresAt: string } | null {
  const r = getDb().prepare('SELECT holder, expires_at FROM ai_locks WHERE name = ? AND expires_at >= ?').get(name, nowIso()) as
    | { holder: string; expires_at: string }
    | undefined;
  return r ? { holder: r.holder, expiresAt: r.expires_at } : null;
}

// ── last scheduler call (for the dashboard) ─────────────────────────────────

export interface CronState {
  at: string;
  result: string;
  reason: string;
}

export function setCronState(state: CronState) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES ('cron_state', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(state), nowIso());
}

export function getCronState(): CronState | null {
  const r = getDb().prepare("SELECT value_json FROM settings WHERE key = 'cron_state'").get() as { value_json: string } | undefined;
  return parseJson<CronState | null>(r?.value_json, null);
}
