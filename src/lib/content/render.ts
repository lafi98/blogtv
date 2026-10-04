/** Cached article rendering (keyed by id + modification time). */
import { renderMarkdown, type RenderedMarkdown } from './markdown';
import { findImageByVariantFile } from '../repos/images';
import type { Article } from '../repos/articles';

const cache = new Map<string, RenderedMarkdown>();
const MAX = 200;

export function resolveMediaImage(src: string) {
  if (!src.startsWith('/media/')) return null;
  const file = src.slice(7);
  const img = findImageByVariantFile(file);
  const v = img?.variants.find((x) => x.file === file);
  return v ? { width: v.w, height: v.h } : null;
}

export function renderArticle(a: Pick<Article, 'id' | 'modifiedAt' | 'contentMd'>, opts: { cache?: boolean } = { cache: true }): RenderedMarkdown {
  const key = `${a.id}:${a.modifiedAt}`;
  const hit = opts.cache ? cache.get(key) : undefined;
  if (hit) return hit;
  const out = renderMarkdown(a.contentMd, { resolveImage: resolveMediaImage });
  if (opts.cache) {
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, out);
  }
  return out;
}
