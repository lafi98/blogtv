/** Handles article editor submissions: save / validate / review / schedule / publish / unpublish / archive / delete. */
import type { AstroCookies } from 'astro';
import { audit, nowIso } from '../db';
import { deleteArticle, getArticle, saveArticle, setValidation, type Article, type ArticleInput } from '../repos/articles';
import { getCategory } from '../repos/categories';
import { getImage } from '../repos/images';
import { buildValidationContext } from '../publishing/context';
import { validateArticle, type ValidationInput, type ValidationReport } from '../publishing/validator';
import { parseArticleForm } from './articleForm';
import { setFlash } from './flash';
import { consumeKeywordForArticle } from '../repos/keywords';
import type { SessionUser } from '../auth/session';

export interface ArticleActionResult {
  redirect?: string;
  errors?: string[];
  report?: ValidationReport;
  values?: ArticleInput;
}

function toValidationInput(input: ArticleInput, id?: number): ValidationInput {
  const img = getImage(input.featuredImageId);
  return {
    id,
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    contentMd: input.contentMd,
    seoTitle: input.seoTitle,
    metaDescription: input.metaDescription,
    canonicalUrl: input.canonicalUrl,
    categorySlug: getCategory(input.categoryId)?.slug ?? null,
    authorId: input.authorId,
    tags: input.tags,
    faq: input.faq,
    related: input.related,
    featuredImage: img ? { alt: img.alt, license: img.license } : null,
    aiAssisted: input.aiAssisted,
    reviewedBy: input.reviewedBy,
    primaryKeyword: input.primaryKeyword,
    ogTitle: input.ogTitle,
    ogDescription: input.ogDescription,
  };
}

export async function handleArticlePost(fd: FormData, existing: Article | null, user: SessionUser, cookies: AstroCookies): Promise<ArticleActionResult> {
  const intent = String(fd.get('intent') ?? 'save');

  if (intent === 'delete' && existing) {
    deleteArticle(existing.id);
    audit('article.deleted', { userId: user.id, entity: 'article', entityId: existing.id, details: existing.slug });
    setFlash(cookies, 'success', `Deleted “${existing.title}”.`);
    return { redirect: '/admin/articles' };
  }

  const parsed = parseArticleForm(fd, existing);
  if (parsed.errors.length) return { errors: parsed.errors, values: parsed.input };

  const strict = ['publish', 'schedule', 'validate'].includes(intent);
  const report = await validateArticle(toValidationInput(parsed.input, existing?.id), buildValidationContext(), {
    checkExternalLinks: strict,
    requireFeaturedImage: intent === 'publish' || intent === 'schedule' || existing?.status === 'published',
  });
  const blocked = report.errors > 0 && !parsed.override;
  const now = nowIso();
  const input: ArticleInput = { ...parsed.input };
  const messages: string[] = [];
  let ok = true;

  switch (intent) {
    case 'publish':
      if (blocked) {
        ok = false;
        messages.push(`Not published: ${report.errors} validation error(s). Fix them, or tick the override box if you have reviewed them.`);
      } else {
        input.status = 'published';
        input.publishedAt = existing?.publishedAt ?? now;
        input.scheduledFor = null;
        messages.push('Published.');
      }
      break;
    case 'schedule':
      if (!parsed.scheduleAt || parsed.scheduleAt <= now) {
        ok = false;
        messages.push('Choose a publication date and time in the future to schedule.');
      } else if (blocked) {
        ok = false;
        messages.push(`Not scheduled: ${report.errors} validation error(s).`);
      } else {
        input.status = 'scheduled';
        input.scheduledFor = parsed.scheduleAt;
        messages.push(`Scheduled for ${parsed.scheduleAt.replace('T', ' ').slice(0, 16)} UTC. It will be re-validated before going live.`);
      }
      break;
    case 'draft':
      input.status = 'draft';
      input.scheduledFor = null;
      messages.push(existing?.status === 'published' ? 'Unpublished — the article is now a draft.' : 'Saved as draft.');
      break;
    case 'review':
      input.status = 'review';
      input.scheduledFor = null;
      messages.push('Saved and marked as awaiting review.');
      break;
    case 'archive':
      input.status = 'archived';
      input.scheduledFor = null;
      messages.push('Archived (hidden from the site).');
      break;
    default: // save / validate
      if (existing?.status === 'published' && blocked) {
        return {
          errors: [`Changes not saved: the live article would have ${report.errors} validation error(s). Fix them, unpublish it first, or tick the override box.`],
          report,
          values: input,
        };
      }
      messages.push(intent === 'validate' ? `Saved and validated: ${report.status.toUpperCase()} (${report.errors} errors, ${report.warnings} warnings).` : 'Saved.');
  }

  if (parsed.significantUpdate && input.status === 'published' && existing?.publishedAt) input.contentUpdatedAt = now;

  const id = saveArticle(input, existing?.id);
  setValidation(id, report);
  // Publishing an AI draft by hand also uses up the keyword it was generated from.
  if (input.status === 'published') consumeKeywordForArticle(id);
  if (parsed.override && report.errors > 0 && (intent === 'publish' || intent === 'schedule' || existing?.status === 'published'))
    audit('article.validation_override', { userId: user.id, entity: 'article', entityId: id, details: `${report.errors} errors overridden` });
  audit(`article.${intent}`, { userId: user.id, entity: 'article', entityId: id, details: getArticle(id)?.status });
  setFlash(cookies, ok ? 'success' : 'error', messages.join(' '));
  return { redirect: `/admin/articles/${id}` };
}
