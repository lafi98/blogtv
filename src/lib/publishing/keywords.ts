/**
 * Keyword normalisation and duplicate-topic detection.
 *
 * A keyword is compared with every non-archived article (title, slug, primary keyword) and
 * with the active queue. The rule is deliberately conservative — the site should not grow
 * near-identical articles that target tiny keyword variations:
 *   • generic words ("easy", "crochet", "beginner", "pattern", "how to"…) are ignored;
 *   • if every remaining *core* word of the keyword already appears in an existing article's
 *     title/slug/primary keyword, the keyword is treated as already covered.
 */
import { STOPWORDS } from '../content/text';

export const GENERIC_WORDS = new Set(
  `crochet crocheting crocheted crocheter easy easiest simple quick quickest fast free pattern tutorial guide how
   step idea diy basic basics learn learning make making best cute pretty beautiful modern fun great perfect ultimate
   complete tip trick technique project beginner beginners newbie absolute first new day way thing using use step-by-step
   instruction instructions video written chart diagram printable pdf`.split(/\s+/),
);

export function normalizeKeyword(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

function tokens(text: string): string[] {
  return normalizeKeyword(text.replace(/-/g, ' '))
    .split(' ')
    .filter(Boolean)
    .map(stem)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function coreTokens(text: string): Set<string> {
  return new Set(tokens(text).filter((w) => !GENERIC_WORDS.has(w) && !/^\d+$/.test(w)));
}

function allTokens(text: string): Set<string> {
  return new Set(tokens(text));
}

export interface ExistingArticle {
  id: number;
  slug: string;
  title: string;
  status: string;
  primaryKeyword: string;
  /** Related keywords the article already targets (AI articles store these). */
  relatedKeywords?: string[];
}

/** Statuses that count as an existing article for duplicate checks (unpublished drafts don't). */
export const COVERING_STATUSES = new Set(['published', 'scheduled', 'review']);

export interface QueuedKeyword {
  id: number;
  keyword: string;
  normalized: string;
}

export type DuplicateCheck =
  | { ok: true; closest: { slug: string; title: string; overlap: number } | null }
  | {
      ok: false;
      kind: 'too_generic' | 'exact_keyword' | 'related_keyword' | 'covered_topic' | 'similar_topic' | 'queued';
      reason: string;
      article?: ExistingArticle;
      queued?: QueuedKeyword;
    };

const list = (s: Set<string>) => [...s].join(', ');

export function checkKeywordDuplicate(keyword: string, articles: ExistingArticle[], queue: QueuedKeyword[] = []): DuplicateCheck {
  const normalized = normalizeKeyword(keyword);
  const core = coreTokens(normalized);
  if (normalized.length < 3 || !core.size) {
    return {
      ok: false,
      kind: 'too_generic',
      reason: `"${keyword}" is too general — after ignoring words like "easy", "crochet" and "beginners" nothing specific is left. Add the project, stitch or problem you want the article to cover.`,
    };
  }
  for (const q of queue) {
    if (q.normalized === normalized) {
      return { ok: false, kind: 'queued', queued: q, reason: `"${q.keyword}" is already waiting in the keyword queue.` };
    }
    const qc = coreTokens(q.normalized);
    if (qc.size === core.size && [...core].every((w) => qc.has(w))) {
      return {
        ok: false,
        kind: 'queued',
        queued: q,
        reason: `The queued keyword "${q.keyword}" covers the same topic (${list(core)}). Queue only one of them.`,
      };
    }
  }

  let closest: { slug: string; title: string; overlap: number } | null = null;
  for (const a of articles) {
    if (!COVERING_STATUSES.has(a.status)) continue;
    const label = `"${a.title}" (/blog/${a.slug}, ${a.status})`;
    if (a.primaryKeyword && normalizeKeyword(a.primaryKeyword) === normalized) {
      return { ok: false, kind: 'exact_keyword', article: a, reason: `${label} already targets the exact keyword "${keyword}".` };
    }
    const related = (a.relatedKeywords ?? []).find((rk) => normalizeKeyword(rk) === normalized);
    if (related) {
      return {
        ok: false,
        kind: 'related_keyword',
        article: a,
        reason: `${label} already covers the search intent "${keyword}" (it is one of that article's related keywords).`,
      };
    }
    const ac = coreTokens(`${a.title} ${a.slug} ${a.primaryKeyword}`);
    const shared = new Set([...core].filter((w) => ac.has(w)));
    const containment = shared.size / core.size;
    if (containment === 1) {
      return {
        ok: false,
        kind: 'covered_topic',
        article: a,
        reason: `Every specific word in your keyword (${list(core)}) already appears in ${label}. A second article would cover the same topic and compete with it in search. Choose a more specific angle that the existing article doesn't cover.`,
      };
    }
    if (core.size >= 4 && containment >= 0.75) {
      return {
        ok: false,
        kind: 'similar_topic',
        article: a,
        reason: `Most of your keyword's specific words (${list(shared)} of ${list(core)}) already appear in ${label}, so the topics substantially overlap.`,
      };
    }
    const at = allTokens(`${a.title} ${a.primaryKeyword}`);
    const kt = allTokens(normalized);
    const inter = [...kt].filter((w) => at.has(w)).length;
    const jac = inter / (kt.size + at.size - inter || 1);
    if (jac >= 0.6) {
      return { ok: false, kind: 'similar_topic', article: a, reason: `Your keyword and ${label} share most of their words (similarity ${jac.toFixed(2)}).` };
    }
    if (!closest || containment > closest.overlap) closest = { slug: a.slug, title: a.title, overlap: Number(containment.toFixed(2)) };
  }
  return { ok: true, closest };
}

/** Rank existing articles by relevance to a keyword (for internal-link candidates). */
export function rankByRelevance<T extends { title: string; slug: string; primaryKeyword?: string; tags?: string[]; excerpt?: string }>(
  keyword: string,
  items: T[],
  limit = 12,
): T[] {
  const kAll = allTokens(keyword);
  const kCore = coreTokens(keyword);
  return items
    .map((it) => {
      const t = allTokens(`${it.title} ${it.slug} ${it.primaryKeyword ?? ''} ${(it.tags ?? []).join(' ')} ${it.excerpt ?? ''}`);
      let score = 0;
      for (const w of kAll) if (t.has(w)) score += kCore.has(w) ? 3 : 1;
      return { it, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}
