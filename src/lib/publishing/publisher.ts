/**
 * AI publisher: KEYWORD → topic analysis → duplicate check → research → article → SEO metadata
 * → featured image → internal-link sanitising → validation → save → publish/schedule → audit log.
 *
 * Safety guarantees (all enforced server-side in SQLite):
 * • MAX_AI_PUBLICATIONS_PER_DAY = 1 — `ai_publication_slots` has one row per publishing day
 *   (PRIMARY KEY). A run can only publish into a day it claimed inside an IMMEDIATE
 *   transaction, so concurrent or repeated cron calls cannot publish twice.
 * • One AI run at a time (`ai_locks`), so a repeated cron call cannot start a second
 *   generation or consume a second keyword.
 * • A keyword is consumed (published/scheduled) only in the same transaction that publishes
 *   its article. Claude failures, validation failures and publication failures never consume it.
 * • Validation errors ⇒ the article is saved as DRAFT and nothing is published.
 */
import { audit, getDb, nowIso } from '../db';
import { config } from '../config';
import { getSettings } from '../settings';
import { randomToken } from '../security/crypto';
import { slugify, truncate } from '../content/text';
import { corpusForValidation, getArticle, publishedSlugs, saveArticle, setValidation, slugTaken, type ArticleStatus } from '../repos/articles';
import { listCategories } from '../repos/categories';
import { listAuthors } from '../repos/authors';
import { getImage } from '../repos/images';
import {
  endOfQueuePosition,
  findActiveKeyword,
  findReusableKeyword,
  getKeyword,
  insertKeyword,
  MAX_KEYWORD_ATTEMPTS,
  nextQueuedKeyword,
  queuedKeywords,
  updateKeyword,
  type Keyword,
} from '../repos/keywords';
import {
  activeRuns,
  createRun,
  getRun,
  getSlot,
  setCronState,
  tryLock,
  unlock,
  updateRun,
  updateSlot,
  writeSlotClaim,
  type ClaudeStatus,
  type RunLogEntry,
  type RunStatus,
} from '../repos/aiRuns';
import { COVER_MOTIFS, coverAlt, coverSvg } from '../images/covers';
import { storeImage } from '../images/process';
import { aiAvailable, describeApiError, emptyUsage, getClient, RefusalError } from './claude';
import { analyzeKeyword, researchKeyword, reviewArticle, writeArticle, type PipelineClient } from './generator';
import { checkKeywordDuplicate, COVERING_STATUSES, normalizeKeyword, rankByRelevance, type ExistingArticle } from './keywords';
import { sanitizeLinks } from './links';
import { TRUSTED_REFERENCE_URLS } from './prompts';
import { isTrustedExternalUrl } from './trust';
import { buildValidationContext } from './context';
import { validateArticle, type ValidationInput, type ValidationReport } from './validator';
import { addDays, localDateTime, zonedToUtc } from './time';
import { createSimulatedClient } from './simulated';

/** Hard server-side limit. Do not raise without a very good reason. */
export const MAX_AI_PUBLICATIONS_PER_DAY = 1;
/** Failed/invalid attempts allowed per publishing day before the day is given up (cost control). */
export const MAX_ATTEMPTS_PER_DAY = 3;
const RUN_LOCK = 'ai-run';
const LOCK_TTL_MS = 45 * 60_000;
const STALE_AFTER_MS = 45 * 60_000;

export type Mode = 'draft' | 'publish';

export interface PublisherDeps {
  /** Injected Claude client (tests / simulation). Defaults to the real server-side client. */
  client?: PipelineClient;
  now?: () => Date;
  hooks?: {
    /** Called inside the publish transaction (tests use it to simulate a publication failure). */
    beforePublish?: () => void;
  };
}

export interface RunOutcome {
  runId: number;
  status: RunStatus;
  message: string;
  articleId?: number;
  articleSlug?: string;
}

export type StartResult =
  | { kind: 'noop'; reason: string; message: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'duplicate'; runId: number; message: string; articleSlug?: string; articleId?: number }
  | { kind: 'started'; runId: number; keyword: string; publishDay: string | null; done: Promise<RunOutcome> };

interface RunContext {
  runId: number;
  keyword: Keyword;
  mode: Mode;
  publishDay: string | null;
  lockHolder: string;
  deps: PublisherDeps;
  /** Daily-queue keywords go back to the queue on transient failure; manual ones become "failed". */
  requeueOnFailure: boolean;
}

// ── configuration ────────────────────────────────────────────────────────────

export function simulationEnabled(): boolean {
  return process.env.AI_SIMULATE === 'true' && !config.isProd;
}

/** Clear, actionable configuration error — or null when Claude can be used. */
export function aiConfigError(deps: PublisherDeps = {}): { code: string; message: string } | null {
  if (deps.client || simulationEnabled() || aiAvailable()) return null;
  return {
    code: 'ANTHROPIC_API_KEY_MISSING',
    message:
      'ANTHROPIC_API_KEY is not configured on the server. Add it to the server environment (your host’s secret settings or the git-ignored .env file) and restart the app. The key is only used server-side and is never sent to browsers.',
  };
}

function resolveClient(deps: PublisherDeps): PipelineClient {
  if (deps.client) return deps.client;
  if (simulationEnabled()) return createSimulatedClient({ delayMs: 400 });
  return getClient();
}

const nowOf = (deps: PublisherDeps) => deps.now?.() ?? new Date();

export function publishingClock(deps: PublisherDeps = {}) {
  const a = getSettings('automation');
  const { day, time } = localDateTime(nowOf(deps), a.timezone);
  return { day, time, publishTime: a.publishTime, timezone: a.timezone, enabled: a.dailyEnabled };
}

// ── housekeeping ─────────────────────────────────────────────────────────────

/** Runs interrupted by a crash/restart are marked FAILED and their keyword/slot freed. */
export function recoverStaleRuns(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const db = getDb();
  for (const r of activeRuns()) {
    if (r.startedAt > cutoff) continue;
    db.transaction(() => {
      updateRun(r.id, { status: 'FAILED', error: 'Run was interrupted (server restart or crash) and timed out.', publicationResult: 'not_published', completed: true });
      const k = getKeyword(r.keywordId);
      if (k?.status === 'generating') updateKeyword(k.id, { status: k.source === 'queue' && k.attempts + 1 < MAX_KEYWORD_ATTEMPTS ? 'queued' : 'failed', attempts: k.attempts + 1, lastError: 'interrupted' });
      if (r.publishDay) {
        const s = getSlot(r.publishDay);
        if (s?.status === 'claimed' && s.runId === r.id) updateSlot(r.publishDay, { status: 'released' });
      }
    })();
  }
}

function existingArticles(): ExistingArticle[] {
  return corpusForValidation().map((a) => ({
    id: a.id, slug: a.slug, title: a.title, status: a.status, primaryKeyword: a.primaryKeyword, relatedKeywords: a.relatedKeywords,
  }));
}

function activeQueue(excludeId?: number) {
  return queuedKeywords()
    .filter((k) => k.id !== excludeId)
    .map((k) => ({ id: k.id, keyword: k.keyword, normalized: k.normalized }));
}

// ── keyword queue management ─────────────────────────────────────────────────

export interface AddKeywordResult {
  keyword: string;
  added: boolean;
  id?: number;
  reason?: string;
  articleSlug?: string;
}

export function validateKeywordText(raw: string): string | null {
  const k = raw.trim();
  if (k.length < 3) return 'Keyword is too short.';
  if (k.length > 120) return 'Keyword is too long (max 120 characters).';
  if (!/[a-z]/i.test(k)) return 'Keyword must contain words.';
  if (/https?:\/\/|www\./i.test(k)) return 'Enter a search phrase, not a URL.';
  return null;
}

/** Add one keyword to the daily queue, unless it duplicates an existing article or queued keyword. */
export function addKeywordToQueue(raw: string, opts: { categorySlug?: string; notes?: string } = {}): AddKeywordResult {
  const keyword = raw.trim().replace(/\s+/g, ' ');
  const invalid = validateKeywordText(keyword);
  if (invalid) return { keyword, added: false, reason: invalid };
  const dup = checkKeywordDuplicate(keyword, existingArticles(), activeQueue());
  if (!dup.ok) return { keyword, added: false, reason: dup.reason, articleSlug: dup.article?.slug };
  try {
    const id = insertKeyword({ keyword, normalized: normalizeKeyword(keyword), categorySlug: opts.categorySlug, notes: opts.notes, source: 'queue' });
    audit('keyword.added', { entity: 'keyword', entityId: id, details: keyword });
    return { keyword, added: true, id };
  } catch {
    return { keyword, added: false, reason: 'This keyword is already in the queue.' };
  }
}

// ── starting runs ───────────────────────────────────────────────────────────

/**
 * Daily scheduler entry point (cron). Does nothing unless: daily publishing is ON, the local
 * publishing time has passed, today has no AI publication yet, and a keyword is queued.
 */
export function startDailyRun(opts: { trigger: string; deps?: PublisherDeps; ignoreTime?: boolean } = { trigger: 'cron' }): StartResult {
  const deps = opts.deps ?? {};
  const now = nowOf(deps);
  recoverStaleRuns(now);
  const clock = publishingClock(deps);
  const result = ((): StartResult => {
    if (!clock.enabled) return { kind: 'noop', reason: 'daily_publishing_off', message: 'Daily publishing is OFF.' };
    if (!opts.ignoreTime && clock.time < clock.publishTime)
      return { kind: 'noop', reason: 'before_publish_time', message: `Waiting for ${clock.publishTime} (${clock.timezone}); it is ${clock.time} there.` };
    const slot = getSlot(clock.day);
    if (slot && (slot.status === 'published' || slot.status === 'scheduled'))
      return { kind: 'noop', reason: 'daily_limit_reached', message: `Today's AI publication (${clock.day}) already happened — limit is ${MAX_AI_PUBLICATIONS_PER_DAY} per day.` };
    if (!nextQueuedKeyword()) return { kind: 'noop', reason: 'queue_empty', message: 'The keyword queue is empty — nothing to do.' };
    const cfg = aiConfigError(deps);
    if (cfg) return { kind: 'error', ...cfg };

    const holder = `run-${randomToken(8)}`;
    const db = getDb();
    const claim = db.transaction((): { noop: string; message: string } | { runId: number; keyword: Keyword } | { duplicates: number } => {
      const s = getSlot(clock.day);
      if (s && (s.status === 'published' || s.status === 'scheduled')) return { noop: 'daily_limit_reached', message: 'Today’s publication already happened.' };
      if (s && s.status === 'claimed') return { noop: 'already_running', message: 'Today’s publication is already in progress.' };
      if (s && s.attempts >= MAX_ATTEMPTS_PER_DAY)
        return { noop: 'max_attempts_reached', message: `Gave up for today after ${MAX_ATTEMPTS_PER_DAY} unsuccessful attempts; will try again tomorrow.` };
      // Skip queued keywords that duplicate existing articles (recorded in the audit log), then claim.
      let skipped = 0;
      for (let i = 0; i < 200; i++) {
        const kw = nextQueuedKeyword();
        if (!kw) return skipped ? { duplicates: skipped } : { noop: 'queue_empty', message: 'The keyword queue is empty — nothing to do.' };
        const dup = checkKeywordDuplicate(kw.keyword, existingArticles(), activeQueue(kw.id));
        if (!dup.ok) {
          const runId = createRun({
            keywordId: kw.id, keyword: kw.keyword, trigger: opts.trigger, mode: 'publish', status: 'SKIPPED_DUPLICATE',
            duplicateOfSlug: dup.article?.slug ?? null, duplicateReason: dup.reason, completed: true,
          });
          updateRun(runId, { publicationResult: 'not_published (duplicate)' });
          updateKeyword(kw.id, { status: 'skipped_duplicate', lastRunId: runId, lastError: dup.reason, articleId: dup.article?.id ?? null });
          audit('ai.skipped_duplicate', { entity: 'keyword', entityId: kw.id, details: dup.reason });
          skipped++;
          continue;
        }
        if (!tryLock(RUN_LOCK, holder, LOCK_TTL_MS)) return { noop: 'busy', message: 'Another AI run is in progress.' };
        writeSlotClaim(clock.day, kw.id);
        const runId = createRun({ keywordId: kw.id, keyword: kw.keyword, trigger: opts.trigger, mode: 'publish', status: 'QUEUED', publishDay: clock.day });
        updateSlot(clock.day, { runId });
        updateKeyword(kw.id, { status: 'generating', lastRunId: runId });
        return { runId, keyword: { ...kw, status: 'generating' } };
      }
      return { noop: 'queue_empty', message: 'No usable keyword found.' };
    }).immediate();

    if ('noop' in claim) return { kind: 'noop', reason: claim.noop, message: claim.message };
    if ('duplicates' in claim)
      return { kind: 'noop', reason: 'queue_empty', message: `Skipped ${claim.duplicates} duplicate keyword(s); the queue is now empty.` };
    const ctx: RunContext = { runId: claim.runId, keyword: claim.keyword, mode: 'publish', publishDay: clock.day, lockHolder: holder, deps, requeueOnFailure: true };
    return { kind: 'started', runId: claim.runId, keyword: claim.keyword.keyword, publishDay: clock.day, done: executeRun(ctx) };
  })();
  try {
    setCronState({ at: now.toISOString(), result: result.kind, reason: 'reason' in result ? result.reason : 'code' in result ? result.code : result.kind === 'started' ? `run #${result.runId}` : '' });
  } catch {
    /* non-critical */
  }
  return result;
}

/**
 * Manual mode from the admin: "Generate Draft" (mode=draft) or "Generate & Publish" (mode=publish).
 * Publish mode uses today's slot if free, otherwise schedules for the next free day — it never
 * exceeds one AI publication per day.
 */
export function startManualRun(opts: { keyword: string; mode: Mode; trigger?: string; deps?: PublisherDeps; userId?: number }): StartResult {
  const deps = opts.deps ?? {};
  const trigger = opts.trigger ?? `manual-${opts.mode}`;
  recoverStaleRuns(nowOf(deps));
  const text = opts.keyword.trim().replace(/\s+/g, ' ');
  const invalid = validateKeywordText(text);
  if (invalid) return { kind: 'error', code: 'INVALID_KEYWORD', message: invalid };
  const normalized = normalizeKeyword(text);
  // Re-use the keyword's existing row (queued, or a previous draft/failed attempt) so a retry updates its own draft.
  const queued = findActiveKeyword(normalized) ?? findReusableKeyword(normalized);
  if (queued?.status === 'generating') return { kind: 'noop', reason: 'busy', message: 'This keyword is already being generated.' };

  const dup = checkKeywordDuplicate(text, existingArticles(), activeQueue(queued?.id));
  if (!dup.ok) {
    const db = getDb();
    const runId = db.transaction(() => {
      const kwId = queued?.id ?? insertKeyword({ keyword: text, normalized, source: 'manual', status: 'skipped_duplicate' });
      const id = createRun({
        keywordId: kwId, keyword: text, trigger, mode: opts.mode, status: 'SKIPPED_DUPLICATE',
        duplicateOfSlug: dup.article?.slug ?? null, duplicateReason: dup.reason, completed: true,
      });
      updateRun(id, { publicationResult: 'not_published (duplicate)' });
      updateKeyword(kwId, { status: 'skipped_duplicate', lastRunId: id, lastError: dup.reason, articleId: dup.article?.id ?? null });
      audit('ai.skipped_duplicate', { userId: opts.userId, entity: 'keyword', entityId: kwId, details: dup.reason });
      return id;
    })();
    return { kind: 'duplicate', runId, message: dup.reason, articleSlug: dup.article?.slug, articleId: dup.article?.id };
  }

  const cfg = aiConfigError(deps);
  if (cfg) return { kind: 'error', ...cfg };

  const holder = `run-${randomToken(8)}`;
  const clock = publishingClock(deps);
  const db = getDb();
  const claim = db.transaction((): { busy: true } | { runId: number; keyword: Keyword; day: string | null } => {
    if (!tryLock(RUN_LOCK, holder, LOCK_TTL_MS)) return { busy: true };
    let day: string | null = null;
    if (opts.mode === 'publish') {
      for (let i = 0; i < 90 && !day; i++) {
        const d = addDays(clock.day, i);
        const s = getSlot(d);
        if (!s || (s.status === 'released' && s.attempts < MAX_ATTEMPTS_PER_DAY)) day = d;
      }
      if (!day) throw new Error('No free publishing day in the next 90 days.');
    }
    const kwId = queued?.id ?? insertKeyword({ keyword: text, normalized, source: 'manual', status: 'generating' });
    if (day) writeSlotClaim(day, kwId);
    const runId = createRun({ keywordId: kwId, keyword: text, trigger, mode: opts.mode, status: 'QUEUED', publishDay: day });
    if (day) updateSlot(day, { runId });
    updateKeyword(kwId, { status: 'generating', lastRunId: runId });
    return { runId, keyword: getKeyword(kwId)!, day };
  }).immediate();
  if ('busy' in claim) return { kind: 'noop', reason: 'busy', message: 'Another AI run is in progress — wait for it to finish.' };

  audit('ai.run_started', { userId: opts.userId, entity: 'ai_run', entityId: claim.runId, details: `${opts.mode}: ${text}` });
  const ctx: RunContext = {
    runId: claim.runId, keyword: claim.keyword, mode: opts.mode, publishDay: claim.day, lockHolder: holder, deps,
    requeueOnFailure: claim.keyword.source === 'queue',
  };
  return { kind: 'started', runId: claim.runId, keyword: text, publishDay: claim.day, done: executeRun(ctx) };
}

// ── execution ────────────────────────────────────────────────────────────────

async function selectFeaturedImage(motif: string, slug: string, log: (s: string, m: string) => void): Promise<number | null> {
  const chosen = COVER_MOTIFS.includes(motif) ? motif : 'yarn-hook';
  const license = 'Original illustration generated by this website’s own cover generator (no third-party rights).';
  try {
    return await storeImage(Buffer.from(coverSvg(chosen)), { alt: coverAlt(chosen), license, originalName: `${slug}-cover` }, { trustedSvg: true });
  } catch (err) {
    log('image', `Cover generation failed (${(err as Error).message}); using the site fallback image.`);
  }
  try {
    return await storeImage(Buffer.from(coverSvg('yarn-hook')), { alt: coverAlt('yarn-hook'), license, originalName: 'cover-fallback' }, { trustedSvg: true });
  } catch (err) {
    log('image', `Fallback image unavailable (${(err as Error).message}).`);
    return null;
  }
}

function uniqueSlug(base: string, exceptId?: number): string {
  const root = slugify(base).slice(0, 70).replace(/-+$/, '') || 'crochet-article';
  let slug = root;
  for (let i = 2; slugTaken(slug, exceptId); i++) slug = `${root.slice(0, 64)}-${i}`;
  return slug;
}

async function executeRun(ctx: RunContext): Promise<RunOutcome> {
  const { runId, keyword, mode, deps } = ctx;
  const usage = emptyUsage();
  const log: RunLogEntry[] = [];
  const say = (stage: string, message: string) => {
    log.push({ at: nowIso(), stage, message });
    updateRun(runId, { log, usage: { ...usage } });
  };
  let claudeStatus: ClaudeStatus = 'not_called';
  let stage = 'start';
  const db = getDb();

  const finishFailure = (message: string, publicationResult: string, opts: { consumeAsFailed?: boolean } = {}): RunOutcome => {
    db.transaction(() => {
      updateRun(runId, { status: 'FAILED', error: message, claudeStatus, publicationResult, log, usage: { ...usage }, completed: true });
      const k = getKeyword(keyword.id);
      if (k) {
        const attempts = k.attempts + 1;
        const back = ctx.requeueOnFailure && !opts.consumeAsFailed && attempts < MAX_KEYWORD_ATTEMPTS;
        // Not consumed: queue keywords go back to the END of the queue (so the next keyword gets its turn).
        updateKeyword(k.id, { status: back ? 'queued' : 'failed', attempts, lastError: message, lastRunId: runId, position: back ? endOfQueuePosition() : undefined });
      }
      if (ctx.publishDay) {
        const s = getSlot(ctx.publishDay);
        if (s?.status === 'claimed' && s.runId === runId) updateSlot(ctx.publishDay, { status: 'released' });
      }
      audit('ai.failed', { entity: 'ai_run', entityId: runId, details: message });
    })();
    return { runId, status: 'FAILED', message };
  };

  try {
    updateRun(runId, { status: 'GENERATING' });
    const client = resolveClient(deps);
    const categories = listCategories();
    const corpus = corpusForValidation();
    const published = publishedSlugs();
    const now = nowOf(deps);

    // 1. Topic analysis
    stage = 'analysis';
    claudeStatus = 'error'; // until each Claude call succeeds
    say('analysis', `Analysing keyword “${keyword.keyword}”…`);
    const analysis = await analyzeKeyword(
      client,
      keyword.keyword,
      { categories, existing: corpus.filter((a) => a.status !== 'archived').map((a) => ({ slug: a.slug, title: a.title })), today: now.toISOString().slice(0, 10) },
      usage,
    );
    claudeStatus = 'ok';
    say('analysis', `Intent: ${analysis.searchIntent} Format: ${analysis.format}, length: ${analysis.targetLength}.`);
    if (!analysis.isCrochetTopic || !analysis.isSafeTopic) {
      return finishFailure(`Keyword rejected: ${analysis.rejectionReason || 'not a suitable crochet topic for this site.'}`, 'not_published (rejected topic)', { consumeAsFailed: true });
    }
    const skipAsDuplicate = (article: { id: number; slug: string }, reason: string): RunOutcome => {
      db.transaction(() => {
        updateRun(runId, { status: 'SKIPPED_DUPLICATE', duplicateOfSlug: article.slug, duplicateReason: reason, claudeStatus, publicationResult: 'not_published (duplicate)', log, usage: { ...usage }, completed: true });
        updateKeyword(keyword.id, { status: 'skipped_duplicate', lastError: reason, articleId: article.id });
        if (ctx.publishDay) {
          const s = getSlot(ctx.publishDay);
          if (s?.status === 'claimed' && s.runId === runId) updateSlot(ctx.publishDay, { status: 'released' });
        }
        audit('ai.skipped_duplicate', { entity: 'ai_run', entityId: runId, details: reason });
      })();
      return { runId, status: 'SKIPPED_DUPLICATE', message: reason, articleSlug: article.slug };
    };
    // Overlapping search intent (judged by the topic analysis) — only against real, existing articles.
    const overlap = analysis.overlapsExistingSlug
      ? corpus.find((a) => a.slug === analysis.overlapsExistingSlug && COVERING_STATUSES.has(a.status))
      : undefined;
    if (overlap) {
      return skipAsDuplicate(
        overlap,
        `The search intent of "${keyword.keyword}" is already answered by "${overlap.title}" (/blog/${overlap.slug}): ${analysis.overlapReason}`,
      );
    }
    // Similar title: the article Claude plans to write must not duplicate an existing title either.
    const titleDup = checkKeywordDuplicate(analysis.workingTitle, existingArticles(), []);
    if (!titleDup.ok && titleDup.article && (titleDup.kind === 'covered_topic' || titleDup.kind === 'exact_keyword' || titleDup.kind === 'related_keyword')) {
      return skipAsDuplicate(titleDup.article, `The planned article "${analysis.workingTitle}" would duplicate an existing one. ${titleDup.reason}`);
    }

    // 2. Research
    stage = 'research';
    claudeStatus = 'error';
    say('research', 'Researching…');
    const research = await researchKeyword(client, keyword.keyword, analysis, config.ai.webSearch, usage);
    claudeStatus = 'ok';
    say('research', `Brief ready (${research.sources.length} source(s)).`);

    // 3. Article (internal-link candidates = published articles ranked by relevance)
    stage = 'write';
    claudeStatus = 'error';
    const publishedCorpus = corpus.filter((a) => published.has(a.slug));
    const candidates = rankByRelevance(keyword.keyword, publishedCorpus, 12).map((a) => ({ slug: a.slug, title: a.title, excerpt: truncate(a.excerpt, 140) }));
    say('write', `Writing the article (${candidates.length} internal-link candidates)…`);
    const draft = await writeArticle(
      client,
      keyword.keyword,
      analysis,
      research,
      { linkCandidates: candidates, categories: categories.map((c) => c.slug), takenSlugs: corpus.map((a) => a.slug) },
      usage,
    );
    claudeStatus = 'ok';

    // 4. Reviewer pass
    stage = 'review';
    claudeStatus = 'error';
    say('review', 'Reviewer pass (facts, claims, policy)…');
    const findings = await reviewArticle(client, draft, research, usage);
    claudeStatus = 'ok';
    say('review', `${findings.length} reviewer finding(s).`);

    // 5. SEO metadata
    stage = 'seo';
    updateRun(runId, { status: 'VALIDATING', claudeStatus: 'ok', claudeDetail: `${usage.calls} request(s) OK` });
    // A retry of the same keyword overwrites its own earlier AI draft instead of piling up drafts.
    const previous = keyword.articleId ? getArticle(keyword.articleId) : null;
    const reuseId = previous && previous.status === 'draft' && previous.aiRunId !== null ? previous.id : undefined;
    if (reuseId) say('seo', `Updating this keyword's earlier draft (article #${reuseId}).`);
    const slug = uniqueSlug(draft.slug || draft.title, reuseId);
    const validCats = new Set(categories.map((c) => c.slug));
    const categorySlug = [draft.categorySlug, analysis.categorySlug, keyword.categorySlug].find((c) => c && validCats.has(c)) ?? null;
    const category = categories.find((c) => c.slug === categorySlug) ?? null;
    const title = draft.title.trim().slice(0, 110);
    const seoTitle = truncate(draft.seoTitle.trim() || title, 65);
    const metaDescription = truncate(draft.metaDescription.trim(), 160);
    const relatedKeywords = [...new Set([...draft.relatedKeywords, ...analysis.relatedKeywords].map((k) => k.toLowerCase().trim()))]
      .filter((k) => k && normalizeKeyword(k) !== keyword.normalized)
      .slice(0, 8);
    say('seo', `Slug /blog/${slug}, category ${categorySlug ?? '(none)'}.`);

    // 6. Internal/external link hygiene
    stage = 'links';
    const allowedExternal = new Set([...research.sources.map((s) => s.url), ...TRUSTED_REFERENCE_URLS].filter(isTrustedExternalUrl));
    const nonEmptyCats = new Set(listCategories().filter((c) => (c.publishedCount ?? 0) > 0).map((c) => c.slug));
    const clean = sanitizeLinks(draft.contentMarkdown.trim(), { publishedSlugs: published, categorySlugs: nonEmptyCats, allowedExternal });
    for (const r of clean.removed) say('links', `Removed link “${r.text}” → ${r.href} (${r.reason}).`);
    if (clean.removed.length)
      findings.push({
        kind: 'quality',
        severity: 'medium',
        claim: clean.removed.map((r) => `${r.text} → ${r.href}`).join('; '),
        problem: `${clean.removed.length} unverified link(s) were removed and left as plain text — check that the surrounding sentence still reads naturally.`,
      });
    const related = draft.relatedSlugs.filter((s) => published.has(s) && s !== slug).slice(0, 3);
    say('links', `${clean.keptInternal.length} internal link(s) kept: ${clean.keptInternal.join(', ') || 'none'}.`);

    // 7. Featured image (original illustration; safe fallback)
    stage = 'image';
    const imageId = await selectFeaturedImage(draft.coverMotif, slug, say);
    const image = getImage(imageId);
    say('image', image ? `Featured image: ${image.alt}` : 'No featured image could be created.');

    // 8. Validation (strict mode for AI articles)
    stage = 'validate';
    const author = listAuthors()[0] ?? null;
    const sources = research.sources.filter((s) => draft.sourceUrlsUsed.includes(s.url) && allowedExternal.has(s.url));
    const input: ValidationInput = {
      id: reuseId,
      slug, title, excerpt: draft.excerpt.trim(), contentMd: clean.markdown, seoTitle, metaDescription, canonicalUrl: '',
      categorySlug, authorId: author?.id ?? null,
      tags: [...new Set(draft.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))].slice(0, 8),
      faq: draft.faq.filter((f) => f.q.trim() && f.a.trim()), related,
      featuredImage: image ? { alt: image.alt, license: image.license } : null,
      aiAssisted: true, reviewedBy: '', primaryKeyword: keyword.keyword,
      ogTitle: truncate(draft.ogTitle.trim() || seoTitle, 90), ogDescription: truncate(draft.ogDescription.trim() || metaDescription, 200),
    };
    const automation = getSettings('automation');
    const report: ValidationReport = await validateArticle(input, buildValidationContext(), {
      checkExternalLinks: automation.checkExternalLinks, requireFeaturedImage: true, reviewerFindings: findings, strict: true,
    });
    updateRun(runId, { validation: report });
    say('validate', `Validation ${report.status.toUpperCase()}: ${report.errors} error(s), ${report.warnings} warning(s).`);

    // 9. Save + publish/schedule/draft — all-or-nothing.
    stage = 'publish';
    const passes = report.errors === 0;
    const wantPublish = mode === 'publish' && passes;
    const today = localDateTime(nowOf(deps), automation.timezone).day;
    const publishNow = wantPublish && ctx.publishDay === today;
    const scheduledFor = wantPublish && !publishNow && ctx.publishDay ? zonedToUtc(ctx.publishDay, automation.publishTime, automation.timezone).toISOString() : null;
    const articleStatus: ArticleStatus = publishNow ? 'published' : scheduledFor ? 'scheduled' : 'draft';
    const runStatus: RunStatus = publishNow ? 'PUBLISHED' : scheduledFor ? 'SCHEDULED' : 'DRAFT';
    const publicationResult = publishNow
      ? 'published'
      : scheduledFor
        ? `scheduled for ${scheduledFor}`
        : mode === 'draft'
          ? 'not_published (Generate Draft mode)'
          : `not_published (validation failed: ${report.errors} error(s))`;

    const articleId = db.transaction(() => {
      if (wantPublish) deps.hooks?.beforePublish?.();
      const id = saveArticle({
        ...input,
        contentMd: clean.markdown,
        categoryId: category?.id ?? null,
        featuredImageId: imageId,
        status: articleStatus,
        featured: false,
        publishedAt: publishNow ? nowIso() : null,
        contentUpdatedAt: null,
        scheduledFor,
        noindex: false,
        sources,
        relatedKeywords,
        aiRunId: runId,
      }, reuseId);
      setValidation(id, report);
      // The keyword is consumed ONLY by a real publication. Scheduled = reserved until it actually goes live.
      const attempts = keyword.attempts + (passes || mode === 'draft' ? 0 : 1);
      const requeue = !publishNow && !scheduledFor && mode === 'publish' && ctx.requeueOnFailure;
      updateKeyword(keyword.id, {
        status: publishNow ? 'published' : scheduledFor ? 'scheduled' : requeue ? (attempts < MAX_KEYWORD_ATTEMPTS ? 'queued' : 'failed') : 'draft',
        articleId: id,
        lastRunId: runId,
        attempts,
        lastError: passes ? '' : `Validation failed (${report.errors} error(s)) — see run #${runId}`,
        used: publishNow,
        position: requeue && attempts < MAX_KEYWORD_ATTEMPTS ? endOfQueuePosition() : undefined,
      });
      if (ctx.publishDay) updateSlot(ctx.publishDay, wantPublish ? { status: publishNow ? 'published' : 'scheduled', articleId: id } : { status: 'released' });
      updateRun(runId, { status: runStatus, articleId: id, publicationResult, claudeStatus, log, usage: { ...usage }, completed: true });
      audit(`ai.${runStatus.toLowerCase()}`, { entity: 'article', entityId: id, details: `${keyword.keyword} — ${publicationResult}` });
      return id;
    })();
    log.push({ at: nowIso(), stage: 'done', message: publicationResult });
    updateRun(runId, { log });
    const message =
      runStatus === 'PUBLISHED'
        ? 'Published.'
        : runStatus === 'SCHEDULED'
          ? `Validated and scheduled for ${scheduledFor} (today's AI publication slot was already used).`
          : passes
            ? 'Saved as draft (Generate Draft mode).'
            : `Saved as DRAFT — ${report.errors} validation error(s); not published. ` +
              (!ctx.requeueOnFailure
                ? 'The keyword was not consumed.'
                : keyword.attempts + 1 < MAX_KEYWORD_ATTEMPTS
                  ? 'The keyword was not consumed and goes back to the end of the queue.'
                  : `The keyword was not consumed; after ${MAX_KEYWORD_ATTEMPTS} attempts it is parked as "failed" — fix the draft or re-queue it.`);
    return { runId, status: runStatus, message, articleId, articleSlug: slug };
  } catch (err) {
    const isClaudeStage = ['analysis', 'research', 'write', 'review'].includes(stage);
    if (isClaudeStage) claudeStatus = err instanceof RefusalError ? 'refused' : 'error';
    const detail = describeApiError(err);
    if (isClaudeStage) updateRun(runId, { claudeStatus, claudeDetail: `${stage}: ${detail}` });
    const message = isClaudeStage ? `Claude request failed during ${stage}: ${detail}` : `Failed during ${stage}: ${detail}`;
    return finishFailure(message, stage === 'publish' ? `failed: ${detail}` : 'not_published');
  } finally {
    unlock(RUN_LOCK, ctx.lockHolder);
  }
}

export function runSummary(runId: number) {
  return getRun(runId);
}
