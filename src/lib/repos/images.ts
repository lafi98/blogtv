import { getDb, nowIso, parseJson } from '../db';

export interface ImageVariant {
  w: number;
  h: number;
  file: string;
}

export interface ImageRecord {
  id: number;
  fileKey: string;
  originalName: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  credit: string;
  license: string;
  sourceUrl: string;
  variants: ImageVariant[];
  ogFile: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  file_key: string;
  original_name: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  credit: string;
  license: string;
  source_url: string;
  variants_json: string;
  og_file: string | null;
  created_at: string;
}

const map = (r: Row): ImageRecord => ({
  id: r.id,
  fileKey: r.file_key,
  originalName: r.original_name,
  width: r.width,
  height: r.height,
  alt: r.alt,
  caption: r.caption,
  credit: r.credit,
  license: r.license,
  sourceUrl: r.source_url,
  variants: parseJson<ImageVariant[]>(r.variants_json, []).sort((a, b) => a.w - b.w),
  ogFile: r.og_file,
  createdAt: r.created_at,
});

export const mediaUrl = (file: string) => `/media/${file}`;

export function getImage(id: number | null | undefined): ImageRecord | null {
  if (!id) return null;
  const r = getDb().prepare('SELECT * FROM images WHERE id = ?').get(id) as Row | undefined;
  return r ? map(r) : null;
}

export function getImagesByIds(ids: number[]): Map<number, ImageRecord> {
  const out = new Map<number, ImageRecord>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return out;
  const rows = getDb()
    .prepare(`SELECT * FROM images WHERE id IN (${unique.map(() => '?').join(',')})`)
    .all(...unique) as Row[];
  for (const r of rows) out.set(r.id, map(r));
  return out;
}

export function listImages(limit = 200): ImageRecord[] {
  return (getDb().prepare('SELECT * FROM images ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(map);
}

export function findImageByVariantFile(file: string): ImageRecord | null {
  const key = file.replace(/-(\d+|og)\.(webp|jpg|jpeg|png)$/i, '');
  const r = getDb().prepare('SELECT * FROM images WHERE file_key = ?').get(key) as Row | undefined;
  return r ? map(r) : null;
}

export function insertImage(input: Omit<ImageRecord, 'id' | 'createdAt'>): number {
  const res = getDb()
    .prepare(
      `INSERT INTO images (file_key, original_name, width, height, alt, caption, credit, license, source_url, variants_json, og_file, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.fileKey,
      input.originalName,
      input.width,
      input.height,
      input.alt,
      input.caption,
      input.credit,
      input.license,
      input.sourceUrl,
      JSON.stringify(input.variants),
      input.ogFile,
      nowIso(),
    );
  return Number(res.lastInsertRowid);
}

export function updateImageMeta(id: number, meta: Pick<ImageRecord, 'alt' | 'caption' | 'credit' | 'license' | 'sourceUrl'>) {
  getDb()
    .prepare('UPDATE images SET alt = ?, caption = ?, credit = ?, license = ?, source_url = ? WHERE id = ?')
    .run(meta.alt, meta.caption, meta.credit, meta.license, meta.sourceUrl, id);
}

export function imageUsage(id: number): number {
  const a = getDb().prepare('SELECT COUNT(*) n FROM articles WHERE featured_image_id = ?').get(id) as { n: number };
  const b = getDb().prepare('SELECT COUNT(*) n FROM authors WHERE avatar_image_id = ?').get(id) as { n: number };
  const c = getDb()
    .prepare("SELECT COUNT(*) n FROM articles WHERE content_md LIKE ?")
    .get(`%/media/${getImage(id)?.fileKey ?? '__none__'}%`) as { n: number };
  return a.n + b.n + c.n;
}

export function deleteImageRecord(id: number) {
  getDb().prepare('DELETE FROM images WHERE id = ?').run(id);
}
