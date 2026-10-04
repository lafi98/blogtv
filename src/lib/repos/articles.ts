import { getDb, nowIso, parseJson } from '../db';
import { markdownToPlain, readingMinutes, wordCount } from '../content/text';
import { getImagesByIds, type ImageRecord } from './images';
import type { ValidationReport } from '../publishing/validator';

export type ArticleStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'archived';
export const ARTICLE_STATUSES: ArticleStatus[] = ['draft', 'review', 'scheduled', 'published', 'archived'];

export interface FaqItem {
  q: string;
  a: string;
}
export interface SourceLink {
  title: string;
  url: string;
}

export interface Article {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  contentMd: string;
  categoryId: number | null;
  authorId: number | null;
  featuredImageId: number | null;
  status: ArticleStatus;
  featured: boolean;
  publishedAt: string | null;
  /** Visible "Updated" date — only set for significant content updates. */
  contentUpdatedAt: string | null;
  scheduledFor: string | null;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  noindex: boolean;
  tags: string[];
  faq: FaqItem[];
  related: string[];
  sources: SourceLink[];
  aiAssisted: boolean;
  reviewedBy: string;
  primaryKeyword: string;
  relatedKeywords: string[];
  ogTitle: string;
  ogDescription: string;
  aiRunId: number | null;
  validation: ValidationReport | null;
  validationStatus: 'pass' | 'warn' | 'fail' | null;
  wordCount: number;
  readingMinutes: number;
  createdAt: string;
  modifiedAt: string;
  categorySlug: string | null;
  categoryName: string | null;
  authorName: string | null;
}

export interface ArticleCard {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  contentUpdatedAt: string | null;
  readingMinutes: number;
  categorySlug: string | null;
  categoryName: string | null;
  authorName: string | null;
  image: ImageRecord | null;
  status: ArticleStatus;
}

interface Row {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content_md: string;
  category_id: number | null;
  author_id: number | null;
  featured_image_id: number | null;
  status: ArticleStatus;
  featured: number;
  published_at: string | null;
  content_updated_at: string | null;
  scheduled_for: string | null;
  seo_title: string;
  meta_description: string;
  canonical_url: string;
  noindex: number;
  tags_json: string;
  faq_json: string;
  related_json: string;
  sources_json: string;
  ai_assisted: number;
  reviewed_by: string;
  primary_keyword: string;
  related_keywords_json: string;
  og_title: string;
  og_description: string;
  ai_run_id: number | null;
  validation_json: string | null;
  validation_status: 'pass' | 'warn' | 'fail' | null;
  word_count: number;
  reading_minutes: number;
  created_at: string;
  modified_at: string;
  category_slug: string | null;
  category_name: string | null;
  author_name: string | null;
}

const SELECT = `SELECT a.*, c.slug AS category_slug, c.name AS category_name, au.name AS author_name
  FROM articles a
  LEFT JOIN categories c ON c.id = a.category_id
  LEFT JOIN authors au ON au.id = a.author_id`;

/** An article is public only when published AND its publish time has passed. */
const PUBLIC = `a.status = 'published' AND a.published_at IS NOT NULL AND a.published_at <= @now`;

const map = (r: Row): Article => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  excerpt: r.excerpt,
  contentMd: r.content_md,
  categoryId: r.category_id,
  authorId: r.author_id,
  featuredImageId: r.featured_image_id,
  status: r.status,
  featured: !!r.featured,
  publishedAt: r.published_at,
  contentUpdatedAt: r.content_updated_at,
  scheduledFor: r.scheduled_for,
  seoTitle: r.seo_title,
  metaDescription: r.meta_description,
  canonicalUrl: r.canonical_url,
  noindex: !!r.noindex,
  tags: parseJson<string[]>(r.tags_json, []),
  faq: parseJson<FaqItem[]>(r.faq_json, []),
  related: parseJson<string[]>(r.related_json, []),
  sources: parseJson<SourceLink[]>(r.sources_json, []),
  aiAssisted: !!r.ai_assisted,
  reviewedBy: r.reviewed_by,
  primaryKeyword: r.primary_keyword ?? '',
  relatedKeywords: parseJson<string[]>(r.related_keywords_json, []),
  ogTitle: r.og_title ?? '',
  ogDescription: r.og_description ?? '',
  aiRunId: r.ai_run_id ?? null,
  validation: parseJson<ValidationReport | null>(r.validation_json, null),
  validationStatus: r.validation_status,
  wordCount: r.word_count,
  readingMinutes: r.reading_minutes,
  createdAt: r.created_at,
  modifiedAt: r.modified_at,
  categorySlug: r.category_slug,
  categoryName: r.category_name,
  authorName: r.author_name,
});

function toCards(rows: Row[]): ArticleCard[] {
  const images = getImagesByIds(rows.map((r) => r.featured_image_id ?? 0));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    publishedAt: r.published_at,
    contentUpdatedAt: r.content_updated_at,
    readingMinutes: r.reading_minutes,
    categorySlug: r.category_slug,
    categoryName: r.category_name,
    authorName: r.author_name,
    image: r.featured_image_id ? images.get(r.featured_image_id) ?? null : null,
    status: r.status,
  }));
}

// ── Public queries ───────────────────────────────────────────────────────────

export function listPublishedCards(opts: { categoryId?: number; limit: number; offset?: number; excludeIds?: number[] }) {
  const db = getDb();
  const params: Record<string, unknown> = { now: nowIso(), limit: opts.limit, offset: opts.offset ?? 0 };
  let where = PUBLIC;
  if (opts.categoryId) {
    where += ' AND a.category_id = @cat';
    params.cat = opts.categoryId;
  }
  const exclude = (opts.excludeIds ?? []).filter(Number.isInteger);
  if (exclude.length) where += ` AND a.id NOT IN (${exclude.join(',')})`;
  const rows = db
    .prepare(`${SELECT} WHERE ${where} ORDER BY a.published_at DESC, a.id DESC LIMIT @limit OFFSET @offset`)
    .all(params) as Row[];
  const { n } = db.prepare(`SELECT COUNT(*) n FROM articles a WHERE ${where}`).get(params) as { n: number };
  return { items: toCards(rows), total: n };
}

export function getPublishedBySlug(slug: string): Article | null {
  const r = getDb().prepare(`${SELECT} WHERE a.slug = @slug AND ${PUBLIC}`).get({ slug, now: nowIso() }) as Row | undefined;
  return r ? map(r) : null;
}

export function getFeaturedCard(): ArticleCard | null {
  const db = getDb();
  const r = (db
    .prepare(`${SELECT} WHERE ${PUBLIC} ORDER BY a.featured DESC, a.published_at DESC LIMIT 1`)
    .get({ now: nowIso() }) as Row | undefined);
  return r ? toCards([r])[0] : null;
}

/** Full-text search over published articles. User input is reduced to plain word tokens, so FTS syntax cannot be injected. */
export function searchPublished(query: string, limit: number, offset = 0) {
  const tokens = (query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((t) => t.toLowerCase());
  if (!tokens.length) return { items: [] as ArticleCard[], total: 0 };
  const match = tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
  const db = getDb();
  const params = { match, now: nowIso(), limit, offset };
  const rows = db
    .prepare(
      `${SELECT} JOIN articles_fts f ON f.rowid = a.id
       WHERE articles_fts MATCH @match AND ${PUBLIC}
       ORDER BY bm25(articles_fts, 10.0, 4.0, 1.0, 3.0) LIMIT @limit OFFSET @offset`,
    )
    .all(params) as Row[];
  const { n } = db
    .prepare(`SELECT COUNT(*) n FROM articles a JOIN articles_fts f ON f.rowid = a.id WHERE articles_fts MATCH @match AND ${PUBLIC}`)
    .get(params) as { n: number };
  return { items: toCards(rows), total: n };
}

/** Manually chosen related articles first, then best automatic matches (same category, shared tags). */
export function getRelatedCards(article: Article, count = 3): ArticleCard[] {
  const db = getDb();
  const now = nowIso();
  const picked: Row[] = [];
  const seen = new Set<number>([article.id]);
  for (const slug of article.related) {
    const r = db.prepare(`${SELECT} WHERE a.slug = @slug AND ${PUBLIC}`).get({ slug, now }) as Row | undefined;
    if (r && !seen.has(r.id)) {
      picked.push(r);
      seen.add(r.id);
    }
    if (picked.length >= count) return toCards(picked);
  }
  const pool = db
    .prepare(`${SELECT} WHERE ${PUBLIC} ORDER BY a.published_at DESC LIMIT 300`)
    .all({ now }) as Row[];
  const myTags = new Set(article.tags.map((t) => t.toLowerCase()));
  const scored = pool
    .filter((r) => !seen.has(r.id))
    .map((r) => {
      const tags = parseJson<string[]>(r.tags_json, []);
      const shared = tags.filter((t) => myTags.has(t.toLowerCase())).length;
      return { r, score: shared * 2 + (r.category_id === article.categoryId ? 3 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const { r } of scored) {
    if (picked.length >= count) break;
    picked.push(r);
  }
  return toCards(picked);
}

export function listForSitemap() {
  return getDb()
    .prepare(
      `SELECT a.slug, a.published_at, a.content_updated_at, a.title, a.noindex, a.canonical_url, c.slug AS category_slug, c.name AS category_name
       FROM articles a LEFT JOIN categories c ON c.id = a.category_id
       WHERE ${PUBLIC} ORDER BY a.published_at DESC`,
    )
    .all({ now: nowIso() }) as {
    slug: string;
    published_at: string;
    content_updated_at: string | null;
    title: string;
    noindex: number;
    canonical_url: string;
    category_slug: string | null;
    category_name: string | null;
  }[];
}

// ── Admin queries ────────────────────────────────────────────────────────────

export function getArticle(id: number): Article | null {
  const r = getDb().prepare(`${SELECT} WHERE a.id = ?`).get(id) as Row | undefined;
  return r ? map(r) : null;
}

export function getArticleBySlug(slug: string): Article | null {
  const r = getDb().prepare(`${SELECT} WHERE a.slug = ?`).get(slug) as Row | undefined;
  return r ? map(r) : null;
}

export function listAdminArticles(opts: { status?: ArticleStatus | ''; q?: string; limit: number; offset: number }) {
  const db = getDb();
  const where: string[] = ['1=1'];
  const params: Record<string, unknown> = { limit: opts.limit, offset: opts.offset };
  if (opts.status) {
    where.push('a.status = @status');
    params.status = opts.status;
  }
  if (opts.q) {
    where.push('(a.title LIKE @q OR a.slug LIKE @q)');
    params.q = `%${opts.q.replace(/[%_]/g, '')}%`;
  }
  const w = where.join(' AND ');
  const rows = db
    .prepare(`${SELECT} WHERE ${w} ORDER BY COALESCE(a.scheduled_for, a.published_at, a.modified_at) DESC LIMIT @limit OFFSET @offset`)
    .all(params) as Row[];
  const { n } = db.prepare(`SELECT COUNT(*) n FROM articles a WHERE ${w}`).get(params) as { n: number };
  return { items: rows.map(map), total: n };
}

export function countByStatus(): Record<ArticleStatus, number> {
  const out = Object.fromEntries(ARTICLE_STATUSES.map((s) => [s, 0])) as Record<ArticleStatus, number>;
  for (const r of getDb().prepare('SELECT status, COUNT(*) n FROM articles GROUP BY status').all() as { status: ArticleStatus; n: number }[]) {
    out[r.status] = r.n;
  }
  return out;
}

export function slugTaken(slug: string, exceptId?: number): boolean {
  const r = getDb().prepare('SELECT id FROM articles WHERE slug = ?').get(slug) as { id: number } | undefined;
  return Boolean(r && r.id !== exceptId);
}

/** Lightweight corpus for duplicate detection in the validator. */
export interface CorpusEntry {
  id: number;
  slug: string;
  title: string;
  contentMd: string;
  status: ArticleStatus;
  primaryKeyword: string;
  relatedKeywords: string[];
  tags: string[];
  excerpt: string;
}

export function corpusForValidation(): CorpusEntry[] {
  return (getDb().prepare('SELECT id, slug, title, content_md, status, primary_keyword, related_keywords_json, tags_json, excerpt FROM articles').all() as {
    id: number;
    slug: string;
    title: string;
    content_md: string;
    status: ArticleStatus;
    primary_keyword: string;
    related_keywords_json: string;
    tags_json: string;
    excerpt: string;
  }[]).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    contentMd: r.content_md,
    status: r.status,
    primaryKeyword: r.primary_keyword ?? '',
    relatedKeywords: parseJson<string[]>(r.related_keywords_json, []),
    tags: parseJson<string[]>(r.tags_json, []),
    excerpt: r.excerpt,
  }));
}

export interface ArticleInput {
  slug: string;
  title: string;
  excerpt: string;
  contentMd: string;
  categoryId: number | null;
  authorId: number | null;
  featuredImageId: number | null;
  status: ArticleStatus;
  featured: boolean;
  publishedAt: string | null;
  contentUpdatedAt: string | null;
  scheduledFor: string | null;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  noindex: boolean;
  tags: string[];
  faq: FaqItem[];
  related: string[];
  sources: SourceLink[];
  aiAssisted: boolean;
  reviewedBy: string;
  primaryKeyword?: string;
  relatedKeywords?: string[];
  ogTitle?: string;
  ogDescription?: string;
  aiRunId?: number | null;
}

export function saveArticle(input: ArticleInput, id?: number): number {
  const db = getDb();
  const now = nowIso();
  const params = {
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    content_md: input.contentMd,
    category_id: input.categoryId,
    author_id: input.authorId,
    featured_image_id: input.featuredImageId,
    status: input.status,
    featured: input.featured ? 1 : 0,
    published_at: input.publishedAt,
    content_updated_at: input.contentUpdatedAt,
    scheduled_for: input.scheduledFor,
    seo_title: input.seoTitle,
    meta_description: input.metaDescription,
    canonical_url: input.canonicalUrl,
    noindex: input.noindex ? 1 : 0,
    tags_json: JSON.stringify(input.tags),
    faq_json: JSON.stringify(input.faq),
    related_json: JSON.stringify(input.related),
    sources_json: JSON.stringify(input.sources),
    ai_assisted: input.aiAssisted ? 1 : 0,
    reviewed_by: input.reviewedBy,
    primary_keyword: input.primaryKeyword ?? '',
    related_keywords_json: JSON.stringify(input.relatedKeywords ?? []),
    og_title: input.ogTitle ?? '',
    og_description: input.ogDescription ?? '',
    ai_run_id: input.aiRunId ?? null,
    word_count: wordCount(input.contentMd),
    reading_minutes: readingMinutes(input.contentMd),
    now,
  };
  const tx = db.transaction(() => {
    let articleId = id;
    if (articleId) {
      db.prepare(
        `UPDATE articles SET slug=@slug, title=@title, excerpt=@excerpt, content_md=@content_md, category_id=@category_id,
          author_id=@author_id, featured_image_id=@featured_image_id, status=@status, featured=@featured, published_at=@published_at,
          content_updated_at=@content_updated_at, scheduled_for=@scheduled_for, seo_title=@seo_title, meta_description=@meta_description,
          canonical_url=@canonical_url, noindex=@noindex, tags_json=@tags_json, faq_json=@faq_json, related_json=@related_json,
          sources_json=@sources_json, ai_assisted=@ai_assisted, reviewed_by=@reviewed_by, primary_keyword=@primary_keyword,
          related_keywords_json=@related_keywords_json, og_title=@og_title, og_description=@og_description,
          ai_run_id=COALESCE(@ai_run_id, ai_run_id), word_count=@word_count,
          reading_minutes=@reading_minutes, modified_at=@now WHERE id=${Number(articleId)}`,
      ).run(params);
    } else {
      const res = db
        .prepare(
          `INSERT INTO articles (slug, title, excerpt, content_md, category_id, author_id, featured_image_id, status, featured,
            published_at, content_updated_at, scheduled_for, seo_title, meta_description, canonical_url, noindex, tags_json, faq_json,
            related_json, sources_json, ai_assisted, reviewed_by, primary_keyword, related_keywords_json, og_title, og_description,
            ai_run_id, word_count, reading_minutes, created_at, modified_at)
           VALUES (@slug, @title, @excerpt, @content_md, @category_id, @author_id, @featured_image_id, @status, @featured,
            @published_at, @content_updated_at, @scheduled_for, @seo_title, @meta_description, @canonical_url, @noindex, @tags_json,
            @faq_json, @related_json, @sources_json, @ai_assisted, @reviewed_by, @primary_keyword, @related_keywords_json, @og_title,
            @og_description, @ai_run_id, @word_count, @reading_minutes, @now, @now)`,
        )
        .run(params);
      articleId = Number(res.lastInsertRowid);
    }
    if (input.featured) db.prepare('UPDATE articles SET featured = 0 WHERE id != ?').run(articleId);
    db.prepare('DELETE FROM articles_fts WHERE rowid = ?').run(articleId);
    db.prepare('INSERT INTO articles_fts (rowid, title, excerpt, body, tags) VALUES (?, ?, ?, ?, ?)').run(
      articleId,
      input.title,
      input.excerpt,
      markdownToPlain(input.contentMd),
      [...input.tags, input.primaryKeyword ?? '', ...(input.relatedKeywords ?? [])].join(' '),
    );
    return articleId!;
  });
  return tx();
}

export function setValidation(id: number, report: ValidationReport) {
  getDb()
    .prepare('UPDATE articles SET validation_json = ?, validation_status = ? WHERE id = ?')
    .run(JSON.stringify(report), report.status, id);
}

export function setStatus(
  id: number,
  status: ArticleStatus,
  fields: { publishedAt?: string | null; scheduledFor?: string | null } = {},
) {
  const sets = ['status = @status', 'modified_at = @now'];
  const params: Record<string, unknown> = { status, now: nowIso(), id };
  if ('publishedAt' in fields) {
    sets.push('published_at = @publishedAt');
    params.publishedAt = fields.publishedAt;
  }
  if ('scheduledFor' in fields) {
    sets.push('scheduled_for = @scheduledFor');
    params.scheduledFor = fields.scheduledFor;
  }
  getDb().prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteArticle(id: number) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM articles_fts WHERE rowid = ?').run(id);
    db.prepare('DELETE FROM articles WHERE id = ?').run(id);
  })();
}

export function dueScheduled(nowIsoStr = nowIso()): Article[] {
  return (getDb()
    .prepare(`${SELECT} WHERE a.status = 'scheduled' AND a.scheduled_for IS NOT NULL AND a.scheduled_for <= ? ORDER BY a.scheduled_for`)
    .all(nowIsoStr) as Row[]).map(map);
}

export function publishedSlugs(): Set<string> {
  return new Set(
    (getDb().prepare(`SELECT slug FROM articles a WHERE ${PUBLIC}`).all({ now: nowIso() }) as { slug: string }[]).map((r) => r.slug),
  );
}
