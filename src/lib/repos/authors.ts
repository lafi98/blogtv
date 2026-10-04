import { getDb, nowIso, parseJson } from '../db';

export interface Author {
  id: number;
  slug: string;
  name: string;
  role: string;
  bio: string;
  avatarImageId: number | null;
  websiteUrl: string;
  sameAs: string[];
}

interface Row {
  id: number;
  slug: string;
  name: string;
  role: string;
  bio: string;
  avatar_image_id: number | null;
  website_url: string;
  same_as_json: string;
}

const map = (r: Row): Author => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  role: r.role,
  bio: r.bio,
  avatarImageId: r.avatar_image_id,
  websiteUrl: r.website_url,
  sameAs: parseJson<string[]>(r.same_as_json, []),
});

export function listAuthors(): Author[] {
  return (getDb().prepare('SELECT * FROM authors ORDER BY name').all() as Row[]).map(map);
}

export function getAuthor(id: number | null | undefined): Author | null {
  if (!id) return null;
  const r = getDb().prepare('SELECT * FROM authors WHERE id = ?').get(id) as Row | undefined;
  return r ? map(r) : null;
}

export type AuthorInput = Omit<Author, 'id'>;

export function upsertAuthor(input: AuthorInput, id?: number): number {
  const db = getDb();
  const now = nowIso();
  const sameAs = JSON.stringify(input.sameAs.filter(Boolean));
  if (id) {
    db.prepare(
      'UPDATE authors SET slug=?, name=?, role=?, bio=?, avatar_image_id=?, website_url=?, same_as_json=?, updated_at=? WHERE id=?',
    ).run(input.slug, input.name, input.role, input.bio, input.avatarImageId, input.websiteUrl, sameAs, now, id);
    return id;
  }
  const res = db
    .prepare(
      `INSERT INTO authors (slug, name, role, bio, avatar_image_id, website_url, same_as_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.slug, input.name, input.role, input.bio, input.avatarImageId, input.websiteUrl, sameAs, now, now);
  return Number(res.lastInsertRowid);
}

export function deleteAuthor(id: number): { ok: boolean; reason?: string } {
  const used = getDb().prepare('SELECT COUNT(*) n FROM articles WHERE author_id = ?').get(id) as { n: number };
  if (used.n > 0) return { ok: false, reason: `Author is credited on ${used.n} article(s). Reassign them first.` };
  getDb().prepare('DELETE FROM authors WHERE id = ?').run(id);
  return { ok: true };
}
