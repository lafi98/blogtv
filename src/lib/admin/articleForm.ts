/** Parses and validates the admin article form (server-side; never trust the browser). */
import { SLUG_RE, slugify } from '../content/text';
import { getCategory } from '../repos/categories';
import { getAuthor } from '../repos/authors';
import { getImage } from '../repos/images';
import { slugTaken, type ArticleInput, type FaqItem, type SourceLink, type Article } from '../repos/articles';

const s = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const int = (fd: FormData, k: string) => {
  const n = Number(fd.get(k));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export interface ParsedArticleForm {
  input: ArticleInput;
  errors: string[];
  intent: string;
  override: boolean;
  significantUpdate: boolean;
  scheduleAt: string | null;
}

export function parseArticleForm(fd: FormData, existing: Article | null): ParsedArticleForm {
  const errors: string[] = [];
  const title = s(fd, 'title', 200);
  let slug = s(fd, 'slug', 100).toLowerCase();
  if (!slug) slug = slugify(title);
  if (!SLUG_RE.test(slug)) errors.push('Slug may only contain lowercase letters, numbers and single hyphens.');
  if (slugTaken(slug, existing?.id)) errors.push(`The slug "${slug}" is already used by another article.`);
  if (!title) errors.push('Title is required.');

  const contentMd = s(fd, 'contentMd', 200_000);
  const categoryId = int(fd, 'categoryId');
  if (categoryId && !getCategory(categoryId)) errors.push('Unknown category.');
  const authorId = int(fd, 'authorId');
  if (authorId && !getAuthor(authorId)) errors.push('Unknown author.');
  const featuredImageId = int(fd, 'featuredImageId');
  if (featuredImageId && !getImage(featuredImageId)) errors.push('Unknown featured image.');

  const canonicalUrl = s(fd, 'canonicalUrl', 500);
  if (canonicalUrl && !/^https?:\/\/[^\s]+$/i.test(canonicalUrl)) errors.push('Canonical URL must start with http:// or https://.');

  const tags = [...new Set(s(fd, 'tags', 1000).split(',').map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
  const related = [...new Set(s(fd, 'related', 2000).split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter((t) => SLUG_RE.test(t)))].slice(0, 6);

  const faq: FaqItem[] = [];
  const qs = fd.getAll('faq_q').map((v) => String(v).trim().slice(0, 300));
  const as = fd.getAll('faq_a').map((v) => String(v).trim().slice(0, 2000));
  qs.forEach((q, i) => {
    if (q || as[i]) faq.push({ q, a: as[i] ?? '' });
  });
  if (faq.length > 15) errors.push('Keep the FAQ to 15 questions or fewer.');

  const sources: SourceLink[] = [];
  for (const line of s(fd, 'sources', 5000).split('\n')) {
    if (!line.trim()) continue;
    const [maybeTitle, maybeUrl] = line.includes('|') ? line.split('|').map((x) => x.trim()) : ['', line.trim()];
    if (!/^https?:\/\/\S+$/i.test(maybeUrl)) {
      errors.push(`Source "${line.slice(0, 60)}" needs a valid URL (format: Title | https://…).`);
      continue;
    }
    sources.push({ title: maybeTitle.slice(0, 200), url: maybeUrl.slice(0, 500) });
  }

  const scheduleRaw = s(fd, 'scheduleAt', 30);
  let scheduleAt: string | null = null;
  if (scheduleRaw) {
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(scheduleRaw) ? scheduleRaw : `${scheduleRaw}Z`);
    if (Number.isNaN(d.getTime())) errors.push('Invalid schedule date.');
    else scheduleAt = d.toISOString();
  }

  const input: ArticleInput = {
    slug,
    title,
    excerpt: s(fd, 'excerpt', 500),
    contentMd,
    categoryId,
    authorId,
    featuredImageId,
    status: existing?.status ?? 'draft',
    featured: fd.get('featured') === 'on',
    publishedAt: existing?.publishedAt ?? null,
    contentUpdatedAt: existing?.contentUpdatedAt ?? null,
    scheduledFor: existing?.scheduledFor ?? null,
    seoTitle: s(fd, 'seoTitle', 200),
    metaDescription: s(fd, 'metaDescription', 320),
    canonicalUrl,
    noindex: fd.get('noindex') === 'on',
    tags,
    faq,
    related: related.filter((r) => r !== slug),
    sources,
    aiAssisted: fd.get('aiAssisted') === 'on',
    reviewedBy: s(fd, 'reviewedBy', 120),
    primaryKeyword: s(fd, 'primaryKeyword', 120),
    relatedKeywords: [...new Set(s(fd, 'relatedKeywords', 1000).split(',').map((t) => t.trim().toLowerCase().slice(0, 80)).filter(Boolean))].slice(0, 12),
    ogTitle: s(fd, 'ogTitle', 120),
    ogDescription: s(fd, 'ogDescription', 300),
    aiRunId: existing?.aiRunId ?? null,
  };
  return {
    input,
    errors,
    intent: s(fd, 'intent', 30),
    override: fd.get('override') === 'on',
    significantUpdate: fd.get('significantUpdate') === 'on',
    scheduleAt,
  };
}
