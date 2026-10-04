/**
 * Automated tests for the keyword → article AI publisher.
 * Runs against a throwaway SQLite database with a simulated Claude client (no network, no cost).
 *   npm test
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── isolated environment (must be set before the app modules load) ───────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-ai-test-'));
Object.assign(process.env, {
  DATA_DIR: tmp,
  DATABASE_PATH: path.join(tmp, 'test.db'),
  UPLOADS_DIR: path.join(tmp, 'uploads'),
  ENV_FILE: path.join(tmp, 'no-env-file'),
  CRON_SECRET: 'test-cron-secret-0123456789abcdef',
  SITE_URL: 'http://localhost:4321',
  NODE_ENV: 'test',
});
delete process.env.ANTHROPIC_API_KEY;
delete process.env.AI_SIMULATE;

const { getDb } = await import('../src/lib/db');
const { upsertCategory } = await import('../src/lib/repos/categories');
const { upsertAuthor } = await import('../src/lib/repos/authors');
const { getArticle, getArticleBySlug, getPublishedBySlug, deleteArticle, saveArticle } = await import('../src/lib/repos/articles');
const { getKeyword, insertKeyword, listKeywords } = await import('../src/lib/repos/keywords');
const { getRun, getSlot, listRuns } = await import('../src/lib/repos/aiRuns');
const { saveSettings, DEFAULTS } = await import('../src/lib/settings');
const { startDailyRun, startManualRun, addKeywordToQueue } = await import('../src/lib/publishing/publisher');
const { createSimulatedClient, fixtureDraft } = await import('../src/lib/publishing/simulated');
const { normalizeKeyword } = await import('../src/lib/publishing/keywords');
const { publishDueArticles } = await import('../src/lib/publishing/scheduler');
const { importMarkdownFile, readMarkdown } = await import('../scripts/lib/importer');
const { handleArticlePost } = await import('../src/lib/admin/articleActions');
const { config } = await import('../src/lib/config');
const dailyEndpoint = await import('../src/pages/api/cron/daily-publish');
const publishEndpoint = await import('../src/pages/api/cron/publish');

type StartResult = ReturnType<typeof startDailyRun>;
type Draft = ReturnType<typeof fixtureDraft>;

// ── base content: categories, author, a few published articles ──────────────
const CATS = ['crochet-for-beginners', 'crochet-patterns', 'crochet-tutorials', 'crochet-stitches', 'crochet-bags', 'crochet-home-decor', 'crochet-gifts', 'crochet-for-kids', 'seasonal-crochet', 'crochet-tips'];
CATS.forEach((slug, i) => upsertCategory({ slug, name: slug.replace(/-/g, ' '), description: 'Test category description.', introMd: '', seoTitle: '', metaDescription: '', sortOrder: i }));
upsertAuthor({ slug: 'editorial-team', name: 'Test Editors', role: '', bio: 'Test bio.', avatarImageId: null, websiteUrl: '', sameAs: [] });
const SEED = path.resolve('content/seed/articles');
for (const f of ['classic-granny-square-pattern.md', 'how-to-make-a-magic-ring.md', 'basic-crochet-stitches.md', 'round-crochet-coasters-pattern.md']) {
  await importMarkdownFile(path.join(SEED, f), { publish: true, validate: false });
}

const NOW = new Date('2026-10-04T10:00:00Z'); // after the default 09:00 UTC publishing time
const deps = (client: ReturnType<typeof createSimulatedClient>, extra: object = {}) => ({ client, now: () => NOW, ...extra });

function resetAi() {
  const db = getDb();
  for (const r of db.prepare("SELECT id FROM articles WHERE ai_run_id IS NOT NULL OR slug LIKE 'test-%'").all() as { id: number }[]) deleteArticle(r.id);
  db.exec("DELETE FROM ai_runs; DELETE FROM keywords; DELETE FROM ai_publication_slots; DELETE FROM ai_locks; DELETE FROM settings WHERE key IN ('automation','cron_state');");
  saveSettings('automation', { ...DEFAULTS.automation, dailyEnabled: true, publishTime: '09:00', timezone: 'UTC', checkExternalLinks: false });
}

/** A distinct, genuinely written article (from the seed set, not in the test DB) for publish tests. */
function draftFromSeed(file: string, keyword: string): Draft {
  const { fm, body } = readMarkdown(path.join(SEED, file));
  return {
    title: fm.title, slug: fm.slug, excerpt: fm.excerpt, seoTitle: fm.seoTitle ?? fm.title, metaDescription: fm.metaDescription ?? '',
    ogTitle: fm.title, ogDescription: fm.excerpt, primaryKeyword: keyword, relatedKeywords: ['related phrase'], categorySlug: fm.category,
    tags: fm.tags ?? [], contentMarkdown: body, faq: fm.faq ?? [], relatedSlugs: [], coverMotif: fm.cover ?? 'yarn-hook', sourceUrlsUsed: [],
  };
}

const started = (r: StartResult) => {
  assert.equal(r.kind, 'started', `expected a started run, got ${JSON.stringify(r)}`);
  return r as Extract<StartResult, { kind: 'started' }>;
};
const aiArticlesPublished = () =>
  (getDb().prepare("SELECT COUNT(*) n FROM articles WHERE ai_run_id IS NOT NULL AND status = 'published'").get() as { n: number }).n;

beforeEach(resetAi);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ── 1 ────────────────────────────────────────────────────────────────────────
test('1. valid keyword → complete article generated (Generate Draft)', async () => {
  const client = createSimulatedClient();
  const r = started(startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'draft', deps: deps(client) }));
  const out = await r.done;
  assert.equal(out.status, 'DRAFT');
  const a = getArticle(out.articleId!)!;
  assert.equal(a.status, 'draft');
  assert.equal(a.primaryKeyword, 'easy crochet flower for beginners');
  assert.ok(a.title && a.seoTitle && a.metaDescription && a.ogTitle && a.ogDescription, 'SEO + OG fields present');
  assert.match(a.slug, /^[a-z0-9-]+$/);
  assert.ok(a.relatedKeywords.length > 0, 'related keywords');
  assert.ok(a.featuredImageId, 'featured image assigned');
  assert.ok(a.categoryId, 'category assigned');
  assert.equal(a.aiAssisted, true);
  assert.equal(a.validation?.errors, 0, JSON.stringify(a.validation?.checks.filter((c) => c.level === 'error')));
  const run = getRun(out.runId)!;
  assert.equal(run.claudeStatus, 'ok');
  assert.ok(run.completedAt);
  assert.equal(run.publicationResult, 'not_published (Generate Draft mode)');
  assert.equal(client.calls, 4, 'analysis + research + write + review');
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test('2. duplicate keyword → skipped (queue and existing article keyword)', async () => {
  assert.equal(addKeywordToQueue('crochet baby blanket ideas').added, true);
  const again = addKeywordToQueue('Crochet  Baby Blanket Ideas!');
  assert.equal(again.added, false);
  assert.match(again.reason!, /already waiting in the keyword queue/);

  const first = await started(startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'publish', deps: deps(createSimulatedClient()) })).done;
  assert.equal(first.status, 'PUBLISHED');
  const client = createSimulatedClient();
  const dup = startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'publish', deps: deps(client) });
  assert.equal(dup.kind, 'duplicate');
  assert.equal(client.calls, 0, 'no Claude call for a duplicate');
  const run = getRun((dup as { runId: number }).runId)!;
  assert.equal(run.status, 'SKIPPED_DUPLICATE');
  assert.match(run.duplicateReason!, /exact keyword/);
});

// ── 3 ────────────────────────────────────────────────────────────────────────
test('3. duplicate topic → skipped, existing article shown with explanation', async () => {
  const client = createSimulatedClient();
  const r = startManualRun({ keyword: 'crochet granny square for beginners', mode: 'publish', deps: deps(client) });
  assert.equal(r.kind, 'duplicate');
  const d = r as Extract<StartResult, { kind: 'duplicate' }>;
  assert.equal(d.articleSlug, 'classic-granny-square-pattern');
  assert.match(d.message, /granny, square/);
  assert.equal(client.calls, 0);
  assert.equal(addKeywordToQueue('easy crochet coaster pattern').added, false, 'coaster topic already covered');
  // A duplicate that slipped into the queue is skipped at run time and the next keyword is used.
  insertKeyword({ keyword: 'how to crochet a magic circle', normalized: normalizeKeyword('how to crochet a magic circle'), source: 'queue' });
  insertKeyword({ keyword: 'easy crochet flower for beginners', normalized: normalizeKeyword('easy crochet flower for beginners'), source: 'queue' });
  const daily = started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) }));
  assert.equal(daily.keyword, 'easy crochet flower for beginners');
  await daily.done;
  const skipped = listKeywords().find((k) => k.keyword === 'how to crochet a magic circle')!;
  assert.equal(skipped.status, 'skipped_duplicate');
  assert.ok(listRuns().some((x) => x.status === 'SKIPPED_DUPLICATE' && x.duplicateOfSlug === 'how-to-make-a-magic-ring'));
});

// ── 4 ────────────────────────────────────────────────────────────────────────
test('4. Claude failure → nothing published, keyword kept', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const r = started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient({ failAt: 'write' })) }));
  const out = await r.done;
  assert.equal(out.status, 'FAILED');
  const run = getRun(out.runId)!;
  assert.equal(run.claudeStatus, 'error');
  assert.match(run.claudeDetail, /write/);
  assert.equal(run.articleId, null);
  assert.equal(aiArticlesPublished(), 0);
  const k = getKeyword(run.keywordId)!;
  assert.equal(k.status, 'queued');
  assert.equal(k.attempts, 1);
  assert.equal(getSlot('2026-10-04')!.status, 'released');
});

// ── 5 ────────────────────────────────────────────────────────────────────────
test('5. validation failure → saved as DRAFT only, errors recorded', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const thin = (k: string): Draft => ({
    ...fixtureDraft(k),
    slug: 'test-thin-flower',
    contentMarkdown: 'Please click the ads below to support us. This method is 100% foolproof.\n\n## Steps\n\nCrochet a flower.',
    faq: [],
  });
  const r = started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient({ draft: thin })) }));
  const out = await r.done;
  assert.equal(out.status, 'DRAFT');
  const a = getArticle(out.articleId!)!;
  assert.equal(a.status, 'draft');
  const ids = a.validation!.checks.filter((c) => c.level === 'error').map((c) => c.id);
  for (const id of ['length', 'ad-clicks', 'suspicious-claims']) assert.ok(ids.includes(id), `expected ${id} in ${ids}`);
  assert.equal(getRun(out.runId)!.validationStatus, 'fail');
  const k = getKeyword(getRun(out.runId)!.keywordId)!;
  assert.equal(k.status, 'queued', 'keyword NOT consumed — stays in the queue');
  assert.equal(k.attempts, 1);
  assert.equal(k.usedAt, null);
  assert.equal(k.articleId, a.id, 'draft linked for review');
  assert.equal(aiArticlesPublished(), 0);
  assert.equal(getSlot('2026-10-04')!.status, 'released');
});

// ── 6 ────────────────────────────────────────────────────────────────────────
test('6. successful validation → published', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const out = await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) })).done;
  assert.equal(out.status, 'PUBLISHED', out.message);
  const a = getArticle(out.articleId!)!;
  assert.equal(a.status, 'published');
  assert.ok(getPublishedBySlug(a.slug), 'publicly visible');
  assert.equal(getSlot('2026-10-04')!.status, 'published');
  assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'ai.published' AND entity_id = ?").get(a.id), 'audit log entry');
});

// ── 7 ────────────────────────────────────────────────────────────────────────
test('7. daily limit → a second publication the same day is blocked', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  addKeywordToQueue('how to read a yarn label');
  await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) })).done;
  const second = startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) });
  assert.equal(second.kind, 'noop');
  assert.equal((second as { reason: string }).reason, 'daily_limit_reached');
  // Manual "Generate & Publish" can't publish today either — it is scheduled for the next free day.
  const manual = await started(
    startManualRun({ keyword: 'how to read a yarn label', mode: 'publish', deps: deps(createSimulatedClient({ draft: (k) => draftFromSeed('how-to-read-a-yarn-label.md', k) })) }),
  ).done;
  assert.equal(manual.status, 'SCHEDULED', manual.message);
  assert.equal(getArticle(manual.articleId!)!.scheduledFor, '2026-10-05T09:00:00.000Z');
  assert.equal(aiArticlesPublished(), 1, 'still exactly one AI publication today');
});

// ── 8 ────────────────────────────────────────────────────────────────────────
test('8. repeated/concurrent cron calls → one run, one publication, one keyword', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  addKeywordToQueue('crochet baby blanket ideas');
  const a = startDailyRun({ trigger: 'cron', deps: deps(createSimulatedClient({ delayMs: 30 })) });
  const b = startDailyRun({ trigger: 'cron', deps: deps(createSimulatedClient({ delayMs: 30 })) });
  assert.equal(a.kind, 'started');
  assert.equal(b.kind, 'noop');
  assert.match((b as { reason: string }).reason, /already_running|busy/);
  await (a as { done: Promise<unknown> }).done;
  const c = startDailyRun({ trigger: 'cron', deps: deps(createSimulatedClient()) });
  assert.equal((c as { reason: string }).reason, 'daily_limit_reached');
  assert.equal(aiArticlesPublished(), 1);
  assert.equal(listRuns().filter((r) => r.status !== 'SKIPPED_DUPLICATE').length, 1);
  assert.equal(listKeywords().find((k) => k.keyword === 'crochet baby blanket ideas')!.status, 'queued', 'second keyword untouched');
});

// ── 9 ────────────────────────────────────────────────────────────────────────
test('9. empty queue → no action', () => {
  const client = createSimulatedClient();
  const r = startDailyRun({ trigger: 'cron', deps: deps(client) });
  assert.deepEqual([r.kind, (r as { reason: string }).reason], ['noop', 'queue_empty']);
  assert.equal(client.calls, 0);
  assert.equal(listRuns().length, 0);
});

// ── 10 ───────────────────────────────────────────────────────────────────────
test('10. Daily Publishing OFF → no action', () => {
  addKeywordToQueue('easy crochet flower for beginners');
  saveSettings('automation', { ...DEFAULTS.automation, dailyEnabled: false });
  const client = createSimulatedClient();
  const r = startDailyRun({ trigger: 'cron', deps: deps(client) });
  assert.deepEqual([r.kind, (r as { reason: string }).reason], ['noop', 'daily_publishing_off']);
  assert.equal(client.calls, 0);
  assert.equal(listKeywords()[0].status, 'queued');
});

// ── 11 ───────────────────────────────────────────────────────────────────────
test('11. invalid or missing CRON_SECRET → 401', async () => {
  const call = async (mod: typeof dailyEndpoint, headers: Record<string, string>, method = 'POST') => {
    const request = new Request('http://localhost:4321/api/cron/daily-publish', { method, headers });
    return (mod.ALL as (ctx: unknown) => Promise<Response> | Response)({ request, url: new URL(request.url) });
  };
  assert.equal((await call(dailyEndpoint, {})).status, 401);
  assert.equal((await call(dailyEndpoint, { authorization: 'Bearer wrong-secret' })).status, 401);
  assert.equal((await call(dailyEndpoint, { 'x-cron-secret': 'nope' }, 'GET')).status, 401);
  assert.equal((await call(publishEndpoint as typeof dailyEndpoint, { authorization: 'Bearer wrong-secret' })).status, 401);
  saveSettings('automation', { ...DEFAULTS.automation, dailyEnabled: false });
  const ok = await call(dailyEndpoint, { authorization: `Bearer ${process.env.CRON_SECRET}` });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { reason: string }).reason, 'daily_publishing_off');
});

// ── 12 ───────────────────────────────────────────────────────────────────────
test('12. missing ANTHROPIC_API_KEY → clear configuration error, nothing consumed', async () => {
  const manual = startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'publish' });
  assert.equal(manual.kind, 'error');
  assert.equal((manual as { code: string }).code, 'ANTHROPIC_API_KEY_MISSING');
  assert.match((manual as { message: string }).message, /ANTHROPIC_API_KEY is not configured/);
  addKeywordToQueue('crochet baby blanket ideas');
  const daily = startDailyRun({ trigger: 'cron', deps: { now: () => NOW } });
  assert.equal((daily as { code: string }).code, 'ANTHROPIC_API_KEY_MISSING');
  assert.equal(listKeywords()[0].status, 'queued');
  assert.equal(getSlot('2026-10-04'), null, 'no slot claimed');
  const res = await (dailyEndpoint.ALL as (ctx: unknown) => Promise<Response>)({
    request: new Request('http://localhost:4321/api/cron/daily-publish?x', { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }),
    url: new URL('http://localhost:4321/api/cron/daily-publish'),
  });
  // The endpoint has no injected clock, so it may answer "before publishing time" depending on the real hour;
  // when it does reach the configuration check it must report the clear error code.
  const body = (await res.json()) as { code?: string; reason?: string };
  assert.ok(body.code === 'ANTHROPIC_API_KEY_MISSING' || body.reason === 'before_publish_time', JSON.stringify(body));
  if (body.code) assert.equal(res.status, 503);
});

// ── 13 ───────────────────────────────────────────────────────────────────────
test('13. internal links kept only when they point to published articles; invented URLs removed', async () => {
  saveArticle({
    slug: 'test-draft-only', title: 'A draft that is not public yet', excerpt: 'x'.repeat(60), contentMd: 'Draft.', categoryId: null, authorId: null,
    featuredImageId: null, status: 'draft', featured: false, publishedAt: null, contentUpdatedAt: null, scheduledFor: null, seoTitle: '',
    metaDescription: '', canonicalUrl: '', noindex: false, tags: [], faq: [], related: [], sources: [], aiAssisted: false, reviewedBy: '',
  });
  const withDraftLink = (k: string): Draft => ({ ...fixtureDraft(k), contentMarkdown: fixtureDraft(k).contentMarkdown + '\nSee also [this unpublished guide](/blog/test-draft-only).\n' });
  const out = await started(startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'draft', deps: deps(createSimulatedClient({ draft: withDraftLink })) })).done;
  const a = getArticle(out.articleId!)!;
  assert.match(a.contentMd, /\]\(\/blog\/how-to-make-a-magic-ring\)/, 'valid published link kept');
  assert.match(a.contentMd, /\]\(\/blog\/basic-crochet-stitches\)/, 'valid published link kept');
  assert.doesNotMatch(a.contentMd, /crochet-leaf-pattern/, 'non-existent article link removed');
  assert.doesNotMatch(a.contentMd, /test-draft-only/, 'unpublished article link removed');
  assert.doesNotMatch(a.contentMd, /example\.com/, 'invented external URL removed');
  assert.ok(a.contentMd.includes('this unpublished guide'), 'link text kept as plain text');
  assert.deepEqual(a.related.filter((s) => s === 'not-a-real-article'), []);
  assert.equal(a.validation!.checks.filter((c) => c.group === 'links' && c.level === 'error').length, 0);
  assert.ok(getRun(out.runId)!.log.some((l) => l.message.startsWith('Removed link')));
});

// ── 14 ───────────────────────────────────────────────────────────────────────
test('14. failed publication does not consume the keyword', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const boom = { beforePublish: () => { throw new Error('disk full (simulated)'); } };
  const out = await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient(), { hooks: boom }) })).done;
  assert.equal(out.status, 'FAILED');
  const run = getRun(out.runId)!;
  assert.match(run.publicationResult, /^failed: .*disk full/);
  assert.equal(run.articleId, null);
  assert.equal((getDb().prepare('SELECT COUNT(*) n FROM articles WHERE ai_run_id = ?').get(out.runId) as { n: number }).n, 0, 'transaction rolled back');
  const k = getKeyword(run.keywordId)!;
  assert.equal(k.status, 'queued');
  assert.equal(k.usedAt, null);
  assert.equal(getSlot('2026-10-04')!.status, 'released');
});

// ── 15 ───────────────────────────────────────────────────────────────────────
test('15. successful publication consumes the keyword', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const out = await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) })).done;
  const k = getKeyword(getRun(out.runId)!.keywordId)!;
  assert.equal(k.status, 'published');
  assert.ok(k.usedAt);
  assert.equal(k.articleId, out.articleId);
  assert.equal(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) }).kind, 'noop', 'nothing left today');
});

// ── extra coverage ───────────────────────────────────────────────────────────
test('publishing time and time zone are respected', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  saveSettings('automation', { ...DEFAULTS.automation, dailyEnabled: true, publishTime: '11:00', timezone: 'UTC' });
  const early = startDailyRun({ trigger: 'cron', deps: deps(createSimulatedClient()) });
  assert.equal((early as { reason: string }).reason, 'before_publish_time');
  // 10:00 UTC is 12:00 in Paris (CEST) in October → past 11:00 local.
  saveSettings('automation', { ...DEFAULTS.automation, dailyEnabled: true, publishTime: '11:00', timezone: 'Europe/Paris' });
  const r = startDailyRun({ trigger: 'cron', deps: deps(createSimulatedClient()) });
  assert.equal(r.kind, 'started');
  await (r as { done: Promise<unknown> }).done;
});

test('a scheduled AI article is published by the scheduler and the day stays at one publication', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const tomorrow = new Date('2026-10-05T10:00:00Z');
  await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) })).done;
  const sched = await started(
    startManualRun({ keyword: 'how to read a yarn label', mode: 'publish', deps: deps(createSimulatedClient({ draft: (k) => draftFromSeed('how-to-read-a-yarn-label.md', k) })) }),
  ).done;
  assert.equal(sched.status, 'SCHEDULED');
  getDb().prepare('UPDATE articles SET scheduled_for = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', sched.articleId); // make it due now
  publishDueArticles();
  assert.equal(getArticle(sched.articleId!)!.status, 'published');
  assert.equal(getSlot('2026-10-05')!.status, 'published');
  addKeywordToQueue('crochet baby blanket ideas');
  const next = startDailyRun({ trigger: 'cron', deps: { client: createSimulatedClient(), now: () => tomorrow } });
  assert.equal((next as { reason: string }).reason, 'daily_limit_reached', 'tomorrow is already taken by the scheduled article');
});

test('at most 3 attempts per day, then the day is given up', async () => {
  for (const k of ['easy crochet flower for beginners', 'crochet baby blanket ideas', 'crochet market tote bag pattern', 'crochet amigurumi bear pattern']) addKeywordToQueue(k);
  for (let i = 0; i < 3; i++) await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient({ failAt: 'analysis' })) })).done;
  const r = startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) });
  assert.equal((r as { reason: string }).reason, 'max_attempts_reached');
  assert.equal(getArticleBySlug('easy-crochet-flower-for-beginners'), null);
});

// ── additional workflow coverage ─────────────────────────────────────────────
test('duplicate search intent (Claude topic analysis) → skipped before research/writing', async () => {
  const client = createSimulatedClient({ analysis: { overlapsExistingSlug: 'round-crochet-coasters-pattern', overlapReason: 'it already teaches flat crochet circles for mug rests.' } });
  const out = await started(startManualRun({ keyword: 'crochet mug rug for beginners', mode: 'publish', deps: deps(client) })).done;
  assert.equal(out.status, 'SKIPPED_DUPLICATE');
  assert.equal(client.calls, 1, 'only the analysis call — no research, no generation');
  const run = getRun(out.runId)!;
  assert.equal(run.duplicateOfSlug, 'round-crochet-coasters-pattern');
  assert.match(run.duplicateReason!, /search intent/);
  assert.equal(getKeyword(run.keywordId)!.status, 'skipped_duplicate');
});

test("keyword matching an existing article's related keyword → skipped with no Claude call", async () => {
  await started(startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'publish', deps: deps(createSimulatedClient()) })).done;
  const client = createSimulatedClient();
  const r = startManualRun({ keyword: 'Simple crochet flower', mode: 'publish', deps: deps(client) });
  assert.equal(r.kind, 'duplicate');
  assert.match((r as { message: string }).message, /related keywords/);
  assert.equal(client.calls, 0);
});

test('similar planned title (after analysis) → skipped before research/writing', async () => {
  const client = createSimulatedClient({ analysis: { workingTitle: 'Classic Granny Square Pattern' } });
  const out = await started(startManualRun({ keyword: 'vintage crochet motif for blankets', mode: 'draft', deps: deps(client) })).done;
  assert.equal(out.status, 'SKIPPED_DUPLICATE');
  assert.equal(client.calls, 1);
  assert.equal(getRun(out.runId)!.duplicateOfSlug, 'classic-granny-square-pattern');
});

test('an unpublished draft does not block its keyword; a retry overwrites the same draft and can publish', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const thin = (k: string): Draft => ({ ...fixtureDraft(k), contentMarkdown: 'Too short.\n\n## Steps\n\nCrochet.' });
  const first = await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient({ draft: thin })) })).done;
  assert.equal(first.status, 'DRAFT');
  const second = await started(startDailyRun({ trigger: 'test', deps: deps(createSimulatedClient()) })).done;
  assert.equal(second.status, 'PUBLISHED', second.message);
  assert.equal(second.articleId, first.articleId, 'same article updated, no second draft');
  const n = (getDb().prepare('SELECT COUNT(*) n FROM articles WHERE ai_run_id IS NOT NULL').get() as { n: number }).n;
  assert.equal(n, 1);
  const k = getKeyword(getRun(second.runId)!.keywordId)!;
  assert.equal(k.status, 'published');
  assert.equal(k.attempts, 1);
});

test('publishing an AI draft from the article editor consumes its keyword', async () => {
  addKeywordToQueue('easy crochet flower for beginners');
  const draftRun = await started(startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'draft', deps: deps(createSimulatedClient()) })).done;
  const a = getArticle(draftRun.articleId!)!;
  const fd = new FormData();
  const fields: Record<string, string> = {
    intent: 'publish', title: a.title, slug: a.slug, excerpt: a.excerpt, contentMd: a.contentMd, categoryId: String(a.categoryId),
    authorId: String(a.authorId), featuredImageId: String(a.featuredImageId), seoTitle: a.seoTitle, metaDescription: a.metaDescription,
    tags: a.tags.join(', '), primaryKeyword: a.primaryKeyword, aiAssisted: 'on',
  };
  for (const [key, v] of Object.entries(fields)) fd.set(key, v);
  for (const f of a.faq) (fd.append('faq_q', f.q), fd.append('faq_a', f.a));
  saveSettings('automation', { ...DEFAULTS.automation, dailyEnabled: true, checkExternalLinks: false });
  const cookies = { set() {}, delete() {}, get() { return undefined; } } as never;
  const res = await handleArticlePost(fd, a, { id: 1, email: 'a@b.test', name: 'T', role: 'admin', csrfToken: 'x' }, cookies);
  assert.ok(res.redirect, JSON.stringify(res.errors));
  assert.equal(getArticle(a.id)!.status, 'published');
  const k = listKeywords().find((x) => x.keyword === 'easy crochet flower for beginners')!;
  assert.equal(k.status, 'published');
  assert.ok(k.usedAt);
});

test('H1/H2/H3 structure is validated: extra H1 or H3 before any H2 → DRAFT', async () => {
  const bad = (k: string): Draft => {
    const d = fixtureDraft(k);
    return { ...d, contentMarkdown: '# A second H1\n\n### Subsection before any section\n\nSome text here.\n\n' + d.contentMarkdown };
  };
  const out = await started(startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'publish', deps: deps(createSimulatedClient({ draft: bad })) })).done;
  assert.equal(out.status, 'DRAFT');
  const ids = getArticle(out.articleId!)!.validation!.checks.filter((c) => c.level === 'error').map((c) => c.id);
  assert.ok(ids.includes('h1') && ids.includes('heading-order'), ids.join(','));
});

test('external references: only verified, trustworthy URLs are kept', async () => {
  const cyc = 'https://www.craftyarncouncil.com/standards/crochet-chart-symbols';
  const pin = 'https://www.pinterest.com/pin/123456/';
  const withRefs = (k: string): Draft => ({
    ...fixtureDraft(k),
    contentMarkdown: fixtureDraft(k).contentMarkdown + `\nSee the [Craft Yarn Council symbol chart](${cyc}) or this [Pinterest board](${pin}).\n`,
    sourceUrlsUsed: [cyc, pin],
  });
  const client = createSimulatedClient({ draft: withRefs, researchSources: [{ url: pin, title: 'Flower pins' }, { url: cyc, title: 'Chart symbols' }] });
  const out = await started(startManualRun({ keyword: 'easy crochet flower for beginners', mode: 'draft', deps: deps(client) })).done;
  const a = getArticle(out.articleId!)!;
  assert.ok(a.contentMd.includes(`](${cyc})`), 'trusted reference kept');
  assert.ok(!a.contentMd.includes('pinterest'), 'untrusted reference removed');
  assert.deepEqual(a.sources.map((s) => s.url), [cyc], 'only the trusted source is listed as a reference');
});

test('missing CRON_SECRET on the server → cron endpoints refuse (503)', async () => {
  const saved = config.cronSecret;
  config.cronSecret = '';
  try {
    const request = new Request('http://localhost:4321/api/cron/daily-publish', { method: 'POST', headers: { authorization: 'Bearer anything' } });
    const res = await (dailyEndpoint.ALL as (ctx: unknown) => Promise<Response>)({ request, url: new URL(request.url) });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: string }).error, 'CRON_SECRET_NOT_CONFIGURED');
  } finally {
    config.cronSecret = saved;
  }
});
