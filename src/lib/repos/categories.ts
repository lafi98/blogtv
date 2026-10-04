import { getDb, nowIso } from '../db';

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string;
  introMd: string;
  seoTitle: string | null;
  metaDescription: string | null;
  sortOrder: number;
  publishedCount?: number;
}

interface Row {
  id: number;
  slug: string;
  name: string;
  description: string;
  intro_md: string;
  seo_title: string | null;
  meta_description: string | null;
  sort_order: number;
  published_count?: number;
}

const map = (r: Row): Category => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  introMd: r.intro_md,
  seoTitle: r.seo_title,
  metaDescription: r.meta_description,
  sortOrder: r.sort_order,
  publishedCount: r.published_count,
});

const PUBLISHED_COUNT = `(SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id AND a.status = 'published' AND a.published_at <= ?) AS published_count`;

export function listCategories(): Category[] {
  return (
    getDb()
      .prepare(`SELECT c.*, ${PUBLISHED_COUNT} FROM categories c ORDER BY c.sort_order, c.name`)
      .all(nowIso()) as Row[]
  ).map(map);
}

export function getCategoryBySlug(slug: string): Category | null {
  const r = getDb()
    .prepare(`SELECT c.*, ${PUBLISHED_COUNT} FROM categories c WHERE c.slug = ?`)
    .get(nowIso(), slug) as Row | undefined;
  return r ? map(r) : null;
}

export function getCategory(id: number | null | undefined): Category | null {
  if (!id) return null;
  const r = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id) as Row | undefined;
  return r ? map(r) : null;
}

export interface CategoryInput {
  slug: string;
  name: string;
  description: string;
  introMd: string;
  seoTitle: string;
  metaDescription: string;
  sortOrder: number;
}

export function upsertCategory(input: CategoryInput, id?: number): number {
  const db = getDb();
  const now = nowIso();
  if (id) {
    db.prepare(
      `UPDATE categories SET slug=?, name=?, description=?, intro_md=?, seo_title=?, meta_description=?, sort_order=?, updated_at=? WHERE id=?`,
    ).run(input.slug, input.name, input.description, input.introMd, input.seoTitle || null, input.metaDescription || null, input.sortOrder, now, id);
    return id;
  }
  const res = db
    .prepare(
      `INSERT INTO categories (slug, name, description, intro_md, seo_title, meta_description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.slug, input.name, input.description, input.introMd, input.seoTitle || null, input.metaDescription || null, input.sortOrder, now, now);
  return Number(res.lastInsertRowid);
}

export function deleteCategory(id: number): { ok: boolean; reason?: string } {
  const used = getDb().prepare('SELECT COUNT(*) n FROM articles WHERE category_id = ?').get(id) as { n: number };
  if (used.n > 0) return { ok: false, reason: `Category is used by ${used.n} article(s). Move them first.` };
  getDb().prepare('DELETE FROM categories WHERE id = ?').run(id);
  return { ok: true };
}
