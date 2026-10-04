/** SEO helpers: canonical URLs, robots directives and JSON-LD structured data. */
import { absoluteUrl, config } from '../config';
import { getSettings } from '../settings';
import type { Article } from '../repos/articles';
import type { Author } from '../repos/authors';
import type { ImageRecord } from '../repos/images';

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  canonical?: string;
  image?: { url: string; alt: string; width: number; height: number } | null;
  type?: 'website' | 'article';
  noindex?: boolean;
  publishedTime?: string | null;
  modifiedTime?: string | null;
  section?: string | null;
  tags?: string[];
  /** Open Graph / Twitter overrides (default: title / description). */
  ogTitle?: string;
  ogDescription?: string;
}

export function robotsContent(noindex?: boolean): string {
  if (!config.allowIndexing || noindex) return 'noindex, follow';
  return 'index, follow, max-image-preview:large';
}

export const DEFAULT_OG_IMAGE = { url: '/og-default.jpg', alt: 'Hook & Hearth — crochet tutorials and patterns', width: 1200, height: 630 };

export function ogImageFor(img: ImageRecord | null): PageMeta['image'] {
  if (!img?.ogFile) return null;
  return { url: `/media/${img.ogFile}`, alt: img.alt, width: 1200, height: 630 };
}

/** Serialise JSON-LD safely for embedding in a <script> element. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function organizationLd() {
  const site = getSettings('site');
  const sameAs = Object.values(site.social).filter((u) => /^https:\/\//.test(u));
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': absoluteUrl('/#organization'),
    name: site.name,
    url: absoluteUrl('/'),
    logo: { '@type': 'ImageObject', url: absoluteUrl('/logo-512.png'), width: 512, height: 512 },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteLd() {
  const site = getSettings('site');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': absoluteUrl('/#website'),
    name: site.name,
    description: site.description,
    url: absoluteUrl('/'),
    inLanguage: 'en',
    publisher: { '@id': absoluteUrl('/#organization') },
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
  };
}

export function articleLd(a: Article, author: Author | null, image: ImageRecord | null) {
  const url = absoluteUrl(`/blog/${a.slug}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: url,
    headline: a.title.slice(0, 110),
    description: a.metaDescription || a.excerpt,
    ...(image
      ? {
          image: [
            ...image.variants.slice(-1).map((v) => absoluteUrl(`/media/${v.file}`)),
            ...(image.ogFile ? [absoluteUrl(`/media/${image.ogFile}`)] : []),
          ],
        }
      : {}),
    datePublished: a.publishedAt,
    dateModified: a.contentUpdatedAt || a.publishedAt,
    author: author
      ? {
          '@type': author.slug === 'editorial-team' ? 'Organization' : 'Person',
          name: author.name,
          url: absoluteUrl(`/about#author-${author.slug}`),
          ...(author.sameAs.length ? { sameAs: author.sameAs } : {}),
        }
      : { '@id': absoluteUrl('/#organization') },
    publisher: { '@id': absoluteUrl('/#organization') },
    articleSection: a.categoryName ?? undefined,
    keywords: [...new Set([a.primaryKeyword, ...a.relatedKeywords, ...a.tags].filter(Boolean))].join(', ') || undefined,
    wordCount: a.wordCount,
    inLanguage: 'en',
    isPartOf: { '@id': absoluteUrl('/#website') },
  };
}

/** FAQPage markup is valid schema; note Google currently shows FAQ rich results only for well-known authoritative sites. */
export function faqLd(faq: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}
