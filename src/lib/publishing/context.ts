/** Builds the validation context (corpus, link targets…) from the database. */
import { config } from '../config';
import { corpusForValidation, publishedSlugs, type Article } from '../repos/articles';
import { listCategories } from '../repos/categories';
import { getImage, listImages } from '../repos/images';
import type { ValidationContext, ValidationInput } from './validator';

export function buildValidationContext(): ValidationContext {
  const corpus = corpusForValidation();
  const media = new Set<string>();
  for (const img of listImages(5000)) {
    for (const v of img.variants) media.add(v.file);
    if (img.ogFile) media.add(img.ogFile);
  }
  let siteHost = '';
  try {
    siteHost = new URL(config.siteUrl).host;
  } catch {
    /* ignore */
  }
  return {
    corpus,
    categorySlugs: new Set(listCategories().map((c) => c.slug)),
    publishedSlugs: publishedSlugs(),
    allSlugs: new Set(corpus.map((d) => d.slug)),
    topicTitles: [],
    mediaFiles: media,
    siteHost,
  };
}

export function articleToValidationInput(a: Article): ValidationInput {
  const img = getImage(a.featuredImageId);
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt,
    contentMd: a.contentMd,
    seoTitle: a.seoTitle,
    metaDescription: a.metaDescription,
    canonicalUrl: a.canonicalUrl,
    categorySlug: a.categorySlug,
    authorId: a.authorId,
    tags: a.tags,
    faq: a.faq,
    related: a.related,
    featuredImage: img ? { alt: img.alt, license: img.license } : null,
    aiAssisted: a.aiAssisted,
    reviewedBy: a.reviewedBy,
    primaryKeyword: a.primaryKeyword,
    ogTitle: a.ogTitle,
    ogDescription: a.ogDescription,
  };
}
