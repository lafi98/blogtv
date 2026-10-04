/**
 * Article quality & policy validation.
 *
 * Every article (hand-written or AI-drafted) is checked before it can be scheduled or
 * published. Errors block publication (automated publishing can never override them;
 * an admin can, explicitly, and that override is audit-logged). Warnings send AI drafts
 * to manual review unless the admin allows warnings for auto-publish.
 *
 * Heuristics here are deliberately conservative and explainable — they flag things for
 * a human to look at; they do not prove an article is good or bad.
 */
import fs from 'node:fs';
import path from 'node:path';
import { COVERING_STATUSES, coreTokens } from './keywords';
import { isTrustedExternalUrl } from './trust';
import {
  jaccard,
  markdownToPlain,
  significantTokens,
  SLUG_RE,
  STOPWORDS,
  words,
} from '../content/text';

export type CheckLevel = 'error' | 'warning' | 'info';

export interface ValidationCheck {
  id: string;
  group: 'metadata' | 'images' | 'structure' | 'originality' | 'quality' | 'facts' | 'policy' | 'links' | 'review';
  level: CheckLevel;
  message: string;
  details?: string[];
}

export interface ValidationReport {
  status: 'pass' | 'warn' | 'fail';
  checkedAt: string;
  errors: number;
  warnings: number;
  checks: ValidationCheck[];
  metrics: {
    wordCount: number;
    readingEase: number;
    avgSentenceWords: number;
    maxSimilarity: { slug: string; score: number } | null;
    maxTitleSimilarity: { title: string; score: number } | null;
    topPhrase: { phrase: string; density: number } | null;
    internalLinks: number;
    externalLinks: number;
  };
}

export interface ValidationInput {
  id?: number;
  slug: string;
  title: string;
  excerpt: string;
  contentMd: string;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  categorySlug: string | null;
  authorId: number | null;
  tags: string[];
  faq: { q: string; a: string }[];
  related: string[];
  featuredImage: { alt: string; license: string } | null;
  aiAssisted: boolean;
  reviewedBy: string;
  primaryKeyword?: string;
  ogTitle?: string;
  ogDescription?: string;
}

export interface CorpusDoc {
  id: number;
  slug: string;
  title: string;
  contentMd: string;
  /** Only published/scheduled/review articles count for duplicate checks; unpublished drafts don't. */
  status?: string;
}

export interface ValidationContext {
  corpus: CorpusDoc[];
  categorySlugs: Set<string>;
  publishedSlugs: Set<string>;
  allSlugs: Set<string>;
  /** Titles of queued topics (excluded: the topic this article was written from). */
  topicTitles?: string[];
  mediaFiles: Set<string>;
  siteHost: string;
}

export interface ReviewerFinding {
  kind: 'factual' | 'policy' | 'quality';
  severity: 'high' | 'medium' | 'low';
  claim: string;
  problem: string;
}

export interface ValidateOptions {
  checkExternalLinks?: boolean;
  requireFeaturedImage?: boolean;
  reviewerFindings?: ReviewerFinding[];
  fetchImpl?: typeof fetch;
  /**
   * Strict mode (used for AI-generated articles): unsupported/misleading claims, missing
   * introduction or conclusion, poor readability, keyword stuffing and links to unpublished
   * articles become blocking errors instead of warnings.
   */
  strict?: boolean;
}

/** Categories whose articles are expected to contain step-by-step instructions or pattern rows. */
const STEP_CATEGORIES = new Set(['crochet-patterns', 'crochet-tutorials']);

const CLOSING_HEADING =
  /(conclusion|final|wrap|next|where to go|summary|recap|keep |make it your own|build your|start small|scale up|ready to|happy (crocheting|hooking|making)|before you go|over to you|putting it|go(ing)? further|in short|bottom line|enjoy)/;

export const STATIC_PATHS = new Set([
  '/',
  '/blog',
  '/categories',
  '/about',
  '/contact',
  '/privacy-policy',
  '/cookie-policy',
  '/terms',
  '/disclaimer',
  '/sitemap',
  '/search',
  '/newsletter',
]);

// ── helpers ─────────────────────────────────────────────────────────────────

/** Lines that are pattern instructions or tables — legitimately repetitive, excluded from prose metrics. */
const PATTERN_LINE =
  /^\s*(\||(?:[-*+]|\d+[.)])?\s*\*\*(?:round|rnd|row|rows|rounds|r)\b|(?:[-*+]|\d+[.)])?\s*(?:round|rnd|row)s?\s+\d)/i;

function proseOnly(md: string): string {
  return md
    .split('\n')
    .filter((l) => !PATTERN_LINE.test(l))
    .join('\n');
}

function sentences(plain: string): string[] {
  return plain
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 3);
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function shingles(text: string, n = 5): Set<string> {
  const toks = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= toks.length; i++) out.add(toks.slice(i, i + n).join(' '));
  return out;
}

function extractLinks(md: string): { text: string; href: string; image: boolean }[] {
  const out: { text: string; href: string; image: boolean }[] = [];
  const re = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.push({ image: m[1] === '!', text: m[2], href: m[3] });
  return out;
}

// ── crochet fact rules ───────────────────────────────────────────────────────

/** Standard US hook sizes (Craft Yarn Council). Value = accepted US numbers for that mm size. */
const HOOK_SIZES: Record<string, { letters: string[]; num: string }> = {
  '2.25': { letters: ['B'], num: '1' },
  '2.75': { letters: ['C'], num: '2' },
  '3.25': { letters: ['D'], num: '3' },
  '3.5': { letters: ['E'], num: '4' },
  '3.75': { letters: ['F'], num: '5' },
  '4': { letters: ['G'], num: '6' },
  '4.5': { letters: [], num: '7' },
  '5': { letters: ['H'], num: '8' },
  '5.5': { letters: ['I'], num: '9' },
  '6': { letters: ['J'], num: '10' },
  '6.5': { letters: ['K'], num: '10.5' },
  '8': { letters: ['L'], num: '11' },
  '9': { letters: ['M', 'N', 'M/N'], num: '13' },
  '10': { letters: ['N', 'P', 'N/P'], num: '15' },
};

function normMm(s: string): string {
  return String(Number(s.replace(',', '.')));
}

function checkHookLabel(mm: string, us: string): string | null {
  const spec = HOOK_SIZES[normMm(mm)];
  if (!spec) return null; // size we don't have a reliable mapping for — skip
  const label = us.replace(/\s+/g, '').replace('½', '.5').replace('1/2', '.5').toUpperCase();
  const m = label.match(/^([A-Z](?:\/[A-Z])?)?-?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const [, letter, num] = m;
  const numOk = Number(num) === Number(spec.num);
  const letterOk = !letter || spec.letters.includes(letter);
  return numOk && letterOk ? null : `${mm} mm is US ${spec.letters[0] ? spec.letters[0] + '-' : ''}${spec.num}, not "${us}"`;
}

const US_TO_UK: Record<string, string[]> = {
  'single crochet': ['double crochet', 'double'],
  'half double crochet': ['half treble crochet', 'half treble'],
  'double crochet': ['treble crochet', 'treble'],
  'treble crochet': ['double treble crochet', 'double treble'],
  'triple crochet': ['double treble crochet', 'double treble'],
  'double treble crochet': ['triple treble crochet', 'triple treble'],
  'slip stitch': ['slip stitch'],
};
const UK_TO_US: Record<string, string[]> = {
  'double crochet': ['single crochet'],
  'half treble crochet': ['half double crochet'],
  'half treble': ['half double crochet'],
  'treble crochet': ['double crochet'],
  'treble': ['double crochet'],
  'double treble crochet': ['treble crochet', 'triple crochet'],
  'double treble': ['treble crochet', 'triple crochet'],
  'triple treble crochet': ['double treble crochet'],
  'triple treble': ['double treble crochet'],
};
const ABBR_US_TO_UK: Record<string, string[]> = {
  sc: ['dc'],
  hdc: ['htr'],
  dc: ['tr'],
  tr: ['dtr'],
  dtr: ['trtr', 'ttr'],
};

const YARN_WEIGHTS: [RegExp, number[]][] = [
  [/^lace$/, [0]],
  [/^(super fine|fingering|sock)$/, [1]],
  [/^baby$/, [1, 2]],
  [/^(fine|sport)$/, [2]],
  [/^(light worsted|light|dk)$/, [3]],
  [/^(medium|worsted|aran|afghan)$/, [4]],
  [/^(bulky|chunky|craft|rug)$/, [5]],
  [/^(super bulky|super chunky|roving)$/, [6]],
  [/^jumbo$/, [7]],
];

function factChecks(plain: string): string[] {
  const issues: string[] = [];
  // Hook sizes: "5 mm (US H-8)" and ranges "5.5–6.5 mm (US I-9 to K-10.5)"
  const single = /(\d+(?:[.,]\d+)?)\s?mm\s*\((?:US\s*)?([A-Z](?:\/[A-Z])?\s?-?\s?\d+(?:[.,]\d+|½|\s1\/2)?|\d+(?:\.\d+)?)\)/g;
  for (const m of plain.matchAll(single)) {
    const p = checkHookLabel(m[1], m[2]);
    if (p) issues.push(`Hook size: ${p} ("${m[0]}")`);
  }
  const range =
    /(\d+(?:[.,]\d+)?)\s?(?:–|-|to)\s?(\d+(?:[.,]\d+)?)\s?mm\s*\((?:US\s*)?([A-Z](?:\/[A-Z])?-?\d+(?:[.,]\d+|½)?)\s*(?:–|-|to)\s*([A-Z](?:\/[A-Z])?-?\d+(?:[.,]\d+|½)?)\)/g;
  for (const m of plain.matchAll(range)) {
    for (const p of [checkHookLabel(m[1], m[3]), checkHookLabel(m[2], m[4])]) if (p) issues.push(`Hook size: ${p} ("${m[0]}")`);
  }
  // US → UK stitch names
  const usUk =
    /\b(half double crochet|double treble crochet|single crochet|double crochet|treble crochet|triple crochet|slip stitch)(?:es|s)?\s*\((?:in\s+)?UK(?:\s+terms?)?[:,]?\s+(?:a\s+|the\s+)?([a-z][a-z ]{2,30}?)\)/gi;
  for (const m of plain.matchAll(usUk)) {
    const us = m[1].toLowerCase();
    const uk = m[2].toLowerCase().replace(/\s*(stitch(es)?|s)$/, '').trim();
    const ok = US_TO_UK[us]?.some((x) => uk === x || uk.startsWith(x));
    if (!ok) issues.push(`US/UK terms: US "${us}" is UK "${US_TO_UK[us]?.[0]}", not "${m[2]}"`);
  }
  const ukUs =
    /\b(half treble crochet|half treble|triple treble crochet|triple treble|double treble crochet|double treble|double crochet|treble crochet)(?:es|s)?\s*\((?:in\s+)?US(?:\s+terms?)?[:,]?\s+([a-z][a-z ]{2,30}?)\)/gi;
  for (const m of plain.matchAll(ukUs)) {
    const uk = m[1].toLowerCase();
    const us = m[2].toLowerCase().replace(/\s*(stitch(es)?|s)$/, '').trim();
    const ok = UK_TO_US[uk]?.some((x) => us === x || us.startsWith(x));
    if (!ok) issues.push(`US/UK terms: UK "${uk}" is US "${UK_TO_US[uk]?.[0]}", not "${m[2]}"`);
  }
  for (const m of plain.matchAll(/\b(sc|hdc|dc|tr|dtr)\s*\(UK\s+(dc|htr|tr|dtr|trtr|ttr)\)/g)) {
    if (!ABBR_US_TO_UK[m[1]]?.includes(m[2])) issues.push(`US/UK abbreviations: US ${m[1]} is UK ${ABBR_US_TO_UK[m[1]][0]}, not ${m[2]}`);
  }
  // Yarn weight categories: "worsted (#4)", "bulky #5", "medium (category 4)"
  const yw =
    /\b(super fine|super bulky|super chunky|light worsted|lace|fingering|sock|baby|fine|sport|light|dk|medium|worsted|aran|afghan|bulky|chunky|craft|rug|roving|jumbo)(?:[- ]weight)?\s*\(?\s*(?:#\s?|category\s+|cyc\s+)(\d)\b/gi;
  for (const m of plain.matchAll(yw)) {
    const name = m[1].toLowerCase();
    const n = Number(m[2]);
    const rule = YARN_WEIGHTS.find(([re]) => re.test(name));
    if (rule && !rule[1].includes(n)) issues.push(`Yarn weight: "${m[1]}" is category ${rule[1].join(' or ')}, not ${n} ("${m[0].trim()}")`);
  }
  return [...new Set(issues)];
}

// ── suspicious claims & policy ───────────────────────────────────────────────

const AD_CLICK_PATTERNS = [
  /\bclick (?:on )?(?:the |our |these |this |some )?(?:ads?|advertisements?|sponsored links?|banners?)\b/i,
  /\bsupport (?:us|this (?:site|blog)) by (?:clicking|visiting|checking out) (?:our |the )?(?:ads?|sponsors?)\b/i,
  /\b(?:ads?|advertisements?) (?:below|above) (?:help|support)\b/i,
];

const SUSPICIOUS: [RegExp, string][] = [
  [/\bguarantee[ds]?\b/i, 'guarantee'],
  [/\b100\s?%(?!\s*(?:cotton|wool|acrylic|linen|silk|bamboo|merino|alpaca|polyester|nylon|hemp|jute|viscose|mohair|cashmere|recycled|natural|of the yarn))/i, '"100%" claim'],
  [/\bfoolproof\b/i, '"foolproof"'],
  [/\bnever fails?\b/i, '"never fails"'],
  [/\bmiracle\b/i, '"miracle"'],
  [/\bscientifically proven\b/i, '"scientifically proven"'],
  [/\b(?:studies|research|science) (?:show|shows|prove|proves|has shown|have shown|suggests?)\b/i, 'unsourced research claim'],
  [/\bexperts? (?:agree|say|recommend)\b/i, 'appeal to unnamed experts'],
  [/\bdoctors? (?:recommend|say|agree)\b/i, 'medical endorsement claim'],
  [/\bclinically\b/i, '"clinically"'],
  [/\b(?:cures?|heals?|treats?|prevents?|reduces?) (?:your |the )?(?:anxiety|depression|arthritis|dementia|alzheimer'?s?|stress|pain|insomnia|adhd)\b/i, 'health/medical claim'],
  [/\b(?:therapy|therapeutic) (?:for|against)\b/i, 'therapeutic claim'],
  [/\b(?:make|earn) (?:\$|£|€)\s?\d/i, 'income claim'],
  [/\b(?:get rich|passive income|make money fast)\b/i, 'income claim'],
  [/\bbest (?:in the world|ever)\b/i, 'superlative claim'],
  [/\b\d{1,3}(?:\.\d+)?\s?% of (?:people|crocheters|knitters|beginners|makers|crafters|americans|adults|children|kids)\b/i, 'unsourced statistic'],
];

interface PolicyRule {
  re: RegExp;
  label: string;
  level: CheckLevel;
  except?: RegExp;
}

const POLICY_RULES: PolicyRule[] = [
  { re: /\b(?:porn\w*|xxx|erotic\w*|fetish\w*|explicit sex\w*|sexual(?:ly)? explicit)\b/i, label: 'sexual content', level: 'error' },
  { re: /\b(?:gore|gory|mutilat\w*|decapitat\w*|tortur\w*)\b/i, label: 'graphic violence', level: 'error' },
  {
    re: /\b(?:firearms?|guns?|ammunition|ammo|explosives?|bombs?|grenades?)\b/i,
    except: /\b(?:glue|heat|hot glue|gun ?metal|yarn|bath)\s+(?:guns?|bombs?|bombing)\b|\bgunmetal\b|\byarn[- ]bomb\w*/i,
    label: 'weapons',
    level: 'error',
  },
  { re: /\b(?:cocaine|heroin|methamphetamine|marijuana|cannabis|cbd|thc|vap(?:e|es|ing)|recreational drugs?)\b/i, label: 'drugs', level: 'error' },
  { re: /\b(?:cigarettes?|cigars?|tobacco)\b/i, label: 'tobacco', level: 'warning' },
  { re: /\b(?:casinos?|gambling|sports betting|poker|lottery)\b/i, label: 'gambling', level: 'error' },
  { re: /\b(?:self-harm|suicid\w*)\b/i, label: 'self-harm', level: 'error' },
  { re: /\b(?:pirated|piracy|torrent|cracked pdf|free pdf of)\b/i, label: 'copyright infringement', level: 'error' },
  { re: /\b(?:beer|wine|liquor|vodka|whiske?y|alcohol\w*)\b/i, label: 'alcohol (restricted for ads — fine in context, e.g. bottle cozies)', level: 'info' },
];

function policyMatches(plain: string): { label: string; level: CheckLevel; samples: string[] }[] {
  const out: { label: string; level: CheckLevel; samples: string[] }[] = [];
  for (const rule of POLICY_RULES) {
    const re = new RegExp(rule.re.source, 'gi');
    const samples: string[] = [];
    for (const m of plain.matchAll(re)) {
      const ctx = plain.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40);
      if (rule.except && rule.except.test(ctx)) continue;
      samples.push(`…${ctx.replace(/\s+/g, ' ').trim()}…`);
      if (samples.length >= 3) break;
    }
    if (samples.length) out.push({ label: rule.label, level: rule.level, samples });
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────

export function validateArticleSync(input: ValidationInput, ctx: ValidationContext, opts: ValidateOptions = {}): ValidationReport {
  const checks: ValidationCheck[] = [];
  const add = (c: ValidationCheck) => checks.push(c);
  const strictLevel: CheckLevel = opts.strict ? 'error' : 'warning';
  const md = input.contentMd || '';
  const plain = markdownToPlain(md);
  const prose = markdownToPlain(proseOnly(md));
  const allWords = words(plain);
  const wc = allWords.length;

  // ── metadata
  const title = input.title.trim();
  if (title.length < 10) add({ id: 'title', group: 'metadata', level: 'error', message: 'Title is missing or too short.' });
  else if (title.length > 110) add({ id: 'title', group: 'metadata', level: 'error', message: `Title is very long (${title.length} chars).` });
  else if (title.length > 80) add({ id: 'title', group: 'metadata', level: 'warning', message: `Title is long (${title.length} chars); aim for under 80.` });

  if (!SLUG_RE.test(input.slug) || input.slug.length > 80)
    add({ id: 'slug', group: 'metadata', level: 'error', message: 'Slug must be lowercase words separated by hyphens (max 80 chars).' });
  const slugOwner = ctx.corpus.find((d) => d.slug === input.slug && d.id !== input.id);
  if (slugOwner) add({ id: 'slug-unique', group: 'metadata', level: 'error', message: `Slug "${input.slug}" is already used by another article.` });

  const ex = input.excerpt.trim();
  if (ex.length < 50) add({ id: 'excerpt', group: 'metadata', level: 'error', message: 'Excerpt is missing or too short (min 50 chars).' });
  else if (ex.length > 260) add({ id: 'excerpt', group: 'metadata', level: 'warning', message: `Excerpt is long (${ex.length} chars).` });

  const seoTitle = input.seoTitle.trim() || title;
  if (!input.seoTitle.trim()) add({ id: 'seo-title', group: 'metadata', level: 'info', message: 'No SEO title set — the article title will be used.' });
  if (seoTitle.length > 70) add({ id: 'seo-title-length', group: 'metadata', level: 'warning', message: `SEO title is ${seoTitle.length} chars; search results usually show about 60.` });

  const md2 = input.metaDescription.trim();
  if (!md2) add({ id: 'meta-description', group: 'metadata', level: 'error', message: 'Meta description is missing.' });
  else if (md2.length < 70 || md2.length > 165)
    add({ id: 'meta-description', group: 'metadata', level: 'warning', message: `Meta description is ${md2.length} chars; 120–160 works best.` });

  if (input.ogTitle && input.ogTitle.length > 95)
    add({ id: 'og-title', group: 'metadata', level: 'warning', message: `Open Graph title is ${input.ogTitle.length} chars; keep it under ~90.` });
  if (input.ogDescription && input.ogDescription.length > 220)
    add({ id: 'og-description', group: 'metadata', level: 'warning', message: `Open Graph description is ${input.ogDescription.length} chars; keep it under ~200.` });

  if (!input.categorySlug || !ctx.categorySlugs.has(input.categorySlug))
    add({ id: 'category', group: 'metadata', level: 'error', message: 'Choose a valid category.' });
  if (!input.authorId) add({ id: 'author', group: 'metadata', level: 'error', message: 'Assign an author.' });

  if (input.canonicalUrl) {
    try {
      const u = new URL(input.canonicalUrl);
      if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
      if (ctx.siteHost && u.host !== ctx.siteHost)
        add({
          id: 'canonical',
          group: 'metadata',
          level: 'warning',
          message: 'Canonical URL points to another site — only do this when the article is republished from there.',
        });
    } catch {
      add({ id: 'canonical', group: 'metadata', level: 'error', message: 'Canonical URL must be an absolute http(s) URL (or left empty).' });
    }
  }
  if (!input.tags.length) add({ id: 'tags', group: 'metadata', level: 'warning', message: 'Add a few tags (used for related articles and search).' });
  if (input.tags.length > 10) add({ id: 'tags', group: 'metadata', level: 'warning', message: 'More than 10 tags — keep tags focused.' });
  const lowerTags = input.tags.map((t) => t.toLowerCase());
  if (new Set(lowerTags).size !== lowerTags.length) add({ id: 'tags-dup', group: 'metadata', level: 'warning', message: 'Duplicate tags.' });

  // ── images
  if (!input.featuredImage) {
    add({
      id: 'featured-image',
      group: 'images',
      level: opts.requireFeaturedImage ? 'error' : 'warning',
      message: 'No featured image. It is used on cards, social shares and structured data.',
    });
  } else {
    const alt = input.featuredImage.alt.trim();
    if (alt.length < 10 || /\.(jpe?g|png|webp|gif|svg)$/i.test(alt) || /^(image|photo|picture|img[_-]?\d*)$/i.test(alt))
      add({ id: 'featured-alt', group: 'images', level: 'error', message: 'Featured image needs descriptive alt text (what does the image show?).' });
    if (!input.featuredImage.license.trim())
      add({ id: 'featured-license', group: 'images', level: 'error', message: 'Record the licence/rights for the featured image in the media library.' });
  }
  const links = extractLinks(md);
  for (const img of links.filter((l) => l.image)) {
    if (img.text.trim().length < 5)
      add({ id: 'img-alt', group: 'images', level: 'error', message: `Image is missing descriptive alt text: ${img.href}` });
    if (/^https?:\/\//i.test(img.href) || img.href.startsWith('//'))
      add({
        id: 'img-external',
        group: 'images',
        level: 'error',
        message: `External image ${img.href} — upload images you have the rights to via the media library instead of hot-linking.`,
      });
    else if (img.href.startsWith('/media/') && !ctx.mediaFiles.has(img.href.slice(7)))
      add({ id: 'img-missing', group: 'images', level: 'error', message: `Image not found in media library: ${img.href}` });
    else if (img.href.startsWith('/images/') && !fs.existsSync(path.resolve('public' + img.href)) && !fs.existsSync(path.resolve('dist/client' + img.href)))
      add({ id: 'img-missing', group: 'images', level: 'error', message: `Image file not found: ${img.href}` });
  }

  // ── structure
  // No arbitrary length target: a short, complete answer beats padding. Only genuinely thin pages fail.
  if (wc < 300) add({ id: 'length', group: 'structure', level: 'error', message: `Only ${wc} words — too thin to fully answer the topic.` });
  else if (wc < 450) add({ id: 'length', group: 'structure', level: 'info', message: `${wc} words — fine if the topic is genuinely simple; otherwise add practical detail.` });

  const headings = [...md.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((m) => ({ level: m[1].length, text: m[2] }));
  // The article title is the page's only H1 (rendered by the template); the body starts at H2.
  if (headings.some((h) => h.level === 1)) add({ id: 'h1', group: 'structure', level: strictLevel, message: 'Body contains an H1 — the article title is the page’s only H1; use ## (H2) for sections.' });
  const firstSection = headings.find((h) => h.level >= 2);
  if (firstSection && firstSection.level > 2)
    add({ id: 'heading-order', group: 'structure', level: strictLevel, message: `The first section heading is H${firstSection.level} ("${firstSection.text}") — sections must start with an H2, with H3 only inside an H2 section.` });
  const h2 = headings.filter((h) => h.level === 2);
  if (h2.length === 0) add({ id: 'headings', group: 'structure', level: strictLevel, message: 'Add H2 section headings so readers can scan the article.' });
  else if (h2.length < 2) add({ id: 'headings', group: 'structure', level: strictLevel, message: 'Use at least two H2 sections (main content + a closing section) so readers can scan the article.' });
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) {
      add({ id: 'heading-skip', group: 'structure', level: strictLevel, message: `Heading level jumps from H${headings[i - 1].level} to H${headings[i].level} at "${headings[i].text}".` });
      break;
    }
  }
  const firstH2 = md.search(/^##\s/m);
  const intro = firstH2 === -1 ? md : md.slice(0, firstH2);
  if (words(markdownToPlain(intro)).length < 25)
    add({ id: 'intro', group: 'structure', level: strictLevel, message: 'Add a short introduction before the first section.' });
  const lastH2 = h2.length ? h2[h2.length - 1].text.toLowerCase() : '';
  if (h2.length && !CLOSING_HEADING.test(lastH2))
    add({ id: 'conclusion', group: 'structure', level: opts.strict ? 'error' : 'info', message: `Add a short closing section (e.g. "Where to go from here") — the last section is "${h2[h2.length - 1].text}".` });
  for (const m of md.matchAll(/^##\s+(.+)\n+(?=##\s)/gm)) add({ id: 'empty-section', group: 'structure', level: 'warning', message: `Section "${m[1]}" is empty.` });

  const headingText = headings.map((h) => h.text.toLowerCase()).join(' | ');
  const hasSteps = /^\s*\d+[.)]\s/m.test(md) || /\*\*(?:round|rnd|row)s?\s+\d/i.test(md);
  if (!/tip/.test(headingText)) add({ id: 'section-tips', group: 'structure', level: 'warning', message: 'No "Tips" section found.' });
  if (!/(mistake|troubleshoot|problem|fix|wrong)/.test(headingText))
    add({ id: 'section-mistakes', group: 'structure', level: 'warning', message: 'No "Common mistakes" / troubleshooting section found.' });
  if (hasSteps && !/(what you('|’)?ll need|materials|supplies|tools|you need)/.test(headingText))
    add({ id: 'section-materials', group: 'structure', level: 'warning', message: 'Step-by-step content should list materials/tools ("What you\'ll need").' });
  if (STEP_CATEGORIES.has(input.categorySlug ?? '') && !hasSteps)
    add({ id: 'section-steps', group: 'structure', level: 'warning', message: 'Tutorials and patterns should include numbered steps or pattern rows/rounds.' });

  if (input.faq.length) {
    if (input.faq.length < 2) add({ id: 'faq', group: 'structure', level: 'warning', message: 'An FAQ with a single question looks thin — add more or remove it.' });
    if (input.faq.length > 8) add({ id: 'faq', group: 'structure', level: 'warning', message: 'More than 8 FAQs — keep only genuinely useful questions.' });
    input.faq.forEach((f, i) => {
      if (!f.q.trim() || f.a.trim().length < 20)
        add({ id: 'faq-item', group: 'structure', level: 'error', message: `FAQ #${i + 1} needs both a question and a real answer.` });
      else if (!/\?\s*$/.test(f.q)) add({ id: 'faq-item', group: 'structure', level: 'info', message: `FAQ #${i + 1} question doesn't end with "?".` });
    });
  }

  // ── originality
  // Titles are compared on their *specific* words — generic words such as "easy", "crochet",
  // "beginners" or "pattern" appear in most titles on a crochet site and say nothing about overlap.
  let maxTitleSim: { title: string; score: number } | null = null;
  const titleWords = (t: string) => {
    const core = coreTokens(t);
    return core.size ? core : new Set(significantTokens(t));
  };
  const myTitleTokens = titleWords(title);
  const covering = ctx.corpus.filter((d) => !d.status || COVERING_STATUSES.has(d.status));
  for (const d of covering) {
    if (d.id === input.id) continue;
    const s = jaccard(myTitleTokens, titleWords(d.title));
    if (!maxTitleSim || s > maxTitleSim.score) maxTitleSim = { title: d.title, score: Number(s.toFixed(2)) };
  }
  for (const t of ctx.topicTitles ?? []) {
    const s = jaccard(myTitleTokens, titleWords(t));
    if (!maxTitleSim || s > maxTitleSim.score) maxTitleSim = { title: `(queued topic) ${t}`, score: Number(s.toFixed(2)) };
  }
  if (maxTitleSim && maxTitleSim.score >= 0.6)
    add({ id: 'duplicate-topic', group: 'originality', level: 'error', message: `Topic looks like a duplicate of "${maxTitleSim.title}" (similarity ${maxTitleSim.score}).` });
  else if (maxTitleSim && maxTitleSim.score >= 0.4)
    add({ id: 'duplicate-topic', group: 'originality', level: 'warning', message: `Topic overlaps with "${maxTitleSim.title}" (similarity ${maxTitleSim.score}). Make sure it adds something new.` });

  let maxSim: { slug: string; score: number } | null = null;
  const mine = shingles(prose);
  if (mine.size > 20) {
    for (const d of covering) {
      if (d.id === input.id) continue;
      const theirs = shingles(markdownToPlain(proseOnly(d.contentMd)));
      let inter = 0;
      for (const s of mine) if (theirs.has(s)) inter++;
      const containment = inter / mine.size;
      if (!maxSim || containment > maxSim.score) maxSim = { slug: d.slug, score: Number(containment.toFixed(3)) };
    }
  }
  if (maxSim && maxSim.score >= 0.2)
    add({ id: 'duplicate-content', group: 'originality', level: 'error', message: `${Math.round(maxSim.score * 100)}% of passages also appear in /blog/${maxSim.slug}.` });
  else if (maxSim && maxSim.score >= 0.08)
    add({ id: 'duplicate-content', group: 'originality', level: 'warning', message: `${Math.round(maxSim.score * 100)}% of passages overlap with /blog/${maxSim.slug}.` });

  // ── quality: repetition, keyword stuffing, readability
  const sents = sentences(prose);
  const paragraphProse = markdownToPlain(
    proseOnly(md)
      .split('\n')
      .filter((l) => !/^\s*([-*+]|\d+[.)]|\|)\s/.test(l))
      .join('\n'),
  );
  const seen = new Map<string, number>();
  for (const s of sentences(paragraphProse)) {
    const key = words(s).join(' ');
    if (key.split(' ').length < 10) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupSentences = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupSentences.length >= 4)
    add({ id: 'repetition', group: 'quality', level: 'error', message: `${dupSentences.length} sentences are repeated word-for-word.`, details: dupSentences.slice(0, 5).map(([s]) => s) });
  else if (dupSentences.length >= 1)
    add({ id: 'repetition', group: 'quality', level: 'warning', message: `${dupSentences.length} sentence(s) repeated word-for-word.`, details: dupSentences.map(([s]) => s) });

  const proseWords = words(prose);
  const pw = proseWords.length || 1;
  let topPhrase: { phrase: string; density: number } | null = null;
  const bigrams = new Map<string, number>();
  for (let i = 0; i + 1 < proseWords.length; i++) {
    const a = proseWords[i];
    const b = proseWords[i + 1];
    if (STOPWORDS.has(a) || STOPWORDS.has(b) || a.length < 3 || b.length < 3 || /\d/.test(a + b)) continue;
    const k = `${a} ${b}`;
    bigrams.set(k, (bigrams.get(k) ?? 0) + 1);
  }
  for (const [k, n] of bigrams) {
    const density = Number((((n * 2) / pw) * 100).toFixed(2)); // percent
    if (!topPhrase || density > topPhrase.density) topPhrase = { phrase: k, density };
  }
  if (topPhrase && pw > 300) {
    if (topPhrase.density > 6)
      add({ id: 'keyword-stuffing', group: 'quality', level: 'error', message: `"${topPhrase.phrase}" makes up ${topPhrase.density}% of the text — reads as keyword stuffing.` });
    else if (topPhrase.density > 4)
      add({ id: 'keyword-stuffing', group: 'quality', level: strictLevel, message: `"${topPhrase.phrase}" makes up ${topPhrase.density}% of the text — vary the wording.` });
  }
  const pk = words(input.primaryKeyword ?? '').join(' ');
  if (pk && pk.split(' ').length >= 2 && wc > 0) {
    const occ = words(plain).join(' ').split(pk).length - 1;
    const density = (occ * pk.split(' ').length * 100) / wc;
    if (occ > Math.max(6, Math.ceil(wc / 180)) || density > 3)
      add({ id: 'primary-keyword-stuffing', group: 'quality', level: strictLevel, message: `The exact keyword "${pk}" appears ${occ} times (${density.toFixed(1)}% of words) — write naturally instead of repeating it.` });
  }
  const titlePhrase = words(title).join(' ');
  if (titlePhrase.split(' ').length >= 4) {
    const occurrences = words(plain).join(' ').split(titlePhrase).length - 1;
    if (occurrences > 2) add({ id: 'title-repeat', group: 'quality', level: 'warning', message: `The exact title phrase appears ${occurrences} times in the body.` });
  }

  const sylls = proseWords.reduce((s, w) => s + syllables(w), 0);
  const sentenceCount = Math.max(1, sents.length);
  const avgSentence = pw / sentenceCount;
  const readingEase = Number((206.835 - 1.015 * avgSentence - 84.6 * (sylls / pw)).toFixed(1));
  if (readingEase < 30) add({ id: 'readability', group: 'quality', level: strictLevel, message: `Very hard to read (Flesch reading ease ${readingEase}). Use shorter sentences and plainer words.` });
  else if (readingEase < 40) add({ id: 'readability', group: 'quality', level: 'warning', message: `Hard to read (Flesch reading ease ${readingEase}). Use shorter sentences and plainer words.` });
  if (avgSentence > 30) add({ id: 'sentence-length', group: 'quality', level: strictLevel, message: `Average sentence is ${avgSentence.toFixed(1)} words — far too long; aim for under 20.` });
  else if (avgSentence > 24) add({ id: 'sentence-length', group: 'quality', level: 'warning', message: `Average sentence is ${avgSentence.toFixed(1)} words — aim for under 20.` });
  const longParas = md.split(/\n{2,}/).filter((p) => !PATTERN_LINE.test(p) && !/^\s*([|#>*+-]|\d+[.)]\s)/.test(p) && words(p).length > 140).length;
  if (longParas) add({ id: 'paragraphs', group: 'quality', level: 'warning', message: `${longParas} paragraph(s) over 140 words — break them up for mobile readers.` });

  // ── suspicious claims (policy: ad-click encouragement is an error)
  const adClick = AD_CLICK_PATTERNS.filter((re) => re.test(plain));
  if (adClick.length) add({ id: 'ad-clicks', group: 'policy', level: 'error', message: 'Text encourages clicking ads — prohibited by AdSense policies.' });
  const suspicious = SUSPICIOUS.filter(([re]) => re.test(plain + ' ' + input.faq.map((f) => `${f.q} ${f.a}`).join(' '))).map(([, label]) => label);
  if (suspicious.length)
    add({ id: 'suspicious-claims', group: 'quality', level: strictLevel, message: 'Possible exaggerated, unsupported or misleading claims — verify or rephrase.', details: suspicious });

  // ── facts (crochet-specific consistency rules)
  const facts = factChecks(plain + '\n' + input.faq.map((f) => `${f.q} ${f.a}`).join('\n'));
  if (facts.length) add({ id: 'facts', group: 'facts', level: 'error', message: 'Possible factual errors in crochet terminology/sizes.', details: facts });

  // ── policy-sensitive content
  for (const p of policyMatches(`${title}\n${plain}`)) {
    add({
      id: `policy-${p.label.split(' ')[0]}`,
      group: 'policy',
      level: p.level,
      message:
        p.level === 'info'
          ? `Mentions ${p.label}.`
          : `Policy-sensitive content (${p.label}) — needs human review before publishing with ads.`,
      details: p.samples,
    });
  }
  if (/\b(baby|babies|toddlers?|infants?|under 3)\b/i.test(plain) && /\b(safety eyes|buttons|beads)\b/i.test(plain) && !/chok|small(?:,? hard)? parts|swallow/i.test(plain))
    add({ id: 'child-safety', group: 'policy', level: 'warning', message: 'Mentions toys/items for babies with eyes/buttons/beads but no choking-hazard note.' });

  if (input.aiAssisted && !input.reviewedBy.trim())
    add({ id: 'ai-review', group: 'review', level: 'info', message: 'AI-assisted draft with no named human reviewer yet.' });

  // ── links (offline part)
  const textLinks = links.filter((l) => !l.image);
  let internal = 0;
  let external = 0;
  for (const l of textLinks) {
    const href = l.href;
    if (/^(javascript|data|vbscript|file):/i.test(href)) {
      add({ id: 'link-unsafe', group: 'links', level: 'error', message: `Unsafe link: ${href}` });
      continue;
    }
    if (/^(click here|here|this|link|read more)$/i.test(l.text.trim()))
      add({ id: 'link-text', group: 'links', level: 'warning', message: `Link text "${l.text}" isn't descriptive (accessibility).` });
    if (href.startsWith('#') || href.startsWith('mailto:')) continue;
    if (href.startsWith('/')) {
      internal++;
      const p = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
      const blog = p.match(/^\/blog\/([a-z0-9-]+)$/);
      const cat = p.match(/^\/category\/([a-z0-9-]+)$/);
      if (blog) {
        if (!ctx.allSlugs.has(blog[1])) add({ id: 'link-broken', group: 'links', level: 'error', message: `Broken internal link: ${href}` });
        else if (!ctx.publishedSlugs.has(blog[1]))
          add({ id: 'link-unpublished', group: 'links', level: strictLevel, message: `Links to an article that isn't published yet: ${href}` });
      } else if (cat) {
        if (!ctx.categorySlugs.has(cat[1])) add({ id: 'link-broken', group: 'links', level: 'error', message: `Broken category link: ${href}` });
      } else if (!STATIC_PATHS.has(p) && !p.startsWith('/images/') && !p.startsWith('/media/')) {
        add({ id: 'link-broken', group: 'links', level: 'error', message: `Unknown internal path: ${href}` });
      }
    } else if (/^https?:\/\//i.test(href)) {
      external++;
      try {
        const u = new URL(href);
        if (u.protocol === 'http:') add({ id: 'link-http', group: 'links', level: 'warning', message: `Insecure http link: ${href}` });
        else if (!isTrustedExternalUrl(href))
          add({ id: 'link-untrusted', group: 'links', level: opts.strict ? 'error' : 'warning', message: `External link to a site that isn't a trustworthy reference (social network, marketplace or shortener): ${href}` });
      } catch {
        add({ id: 'link-malformed', group: 'links', level: 'error', message: `Malformed URL: ${href}` });
      }
    } else {
      add({ id: 'link-malformed', group: 'links', level: 'error', message: `Unrecognised link target: ${href}` });
    }
  }
  if (internal < 2 && wc > 600) add({ id: 'internal-links', group: 'links', level: 'warning', message: 'Add a couple of links to related articles on this site.' });
  if (external > (opts.strict ? 5 : 12))
    add({ id: 'external-links', group: 'links', level: 'warning', message: `${external} external links — keep only the references that genuinely help the reader.` });
  for (const slug of input.related) {
    if (!ctx.allSlugs.has(slug)) add({ id: 'related', group: 'links', level: 'warning', message: `Related article "${slug}" doesn't exist.` });
  }

  // ── reviewer (LLM) findings, if any
  for (const f of opts.reviewerFindings ?? []) {
    add({
      id: `review-${f.kind}`,
      group: f.kind === 'policy' ? 'policy' : f.kind === 'factual' ? 'facts' : 'review',
      level: f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'info',
      message: `Reviewer: ${f.problem}`,
      details: f.claim ? [f.claim] : undefined,
    });
  }

  return finalize(checks, {
    wordCount: wc,
    readingEase,
    avgSentenceWords: Number(avgSentence.toFixed(1)),
    maxSimilarity: maxSim,
    maxTitleSimilarity: maxTitleSim,
    topPhrase,
    internalLinks: internal,
    externalLinks: external,
  });
}

function finalize(checks: ValidationCheck[], metrics: ValidationReport['metrics']): ValidationReport {
  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warning').length;
  return {
    status: errors ? 'fail' : warnings ? 'warn' : 'pass',
    checkedAt: new Date().toISOString(),
    errors,
    warnings,
    checks,
    metrics,
  };
}

/** Full validation including live external link checks. */
export async function validateArticle(input: ValidationInput, ctx: ValidationContext, opts: ValidateOptions = {}): Promise<ValidationReport> {
  const report = validateArticleSync(input, ctx, opts);
  if (!opts.checkExternalLinks) return report;
  const externals = [...new Set(extractLinks(input.contentMd).filter((l) => !l.image && /^https:\/\//i.test(l.href)).map((l) => l.href))];
  const results = await Promise.all(externals.slice(0, 20).map((u) => probeUrl(u, opts.fetchImpl ?? fetch)));
  for (const r of results) {
    if (r.status === 'broken') report.checks.push({ id: 'link-external-broken', group: 'links', level: 'error', message: `Broken external link (${r.code}): ${r.url}` });
    else if (r.status === 'unknown')
      report.checks.push({ id: 'link-external-unverified', group: 'links', level: 'warning', message: `Could not verify external link (${r.code}): ${r.url}` });
  }
  return finalize(report.checks, report.metrics);
}

async function probeUrl(url: string, f: typeof fetch): Promise<{ url: string; status: 'ok' | 'broken' | 'unknown'; code: string }> {
  const attempt = async (method: 'HEAD' | 'GET') =>
    f(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; HookAndHearthLinkCheck/1.0)' },
    });
  try {
    let res = await attempt('HEAD');
    if ([403, 405, 429, 501].includes(res.status)) res = await attempt('GET');
    if (res.ok) return { url, status: 'ok', code: String(res.status) };
    if ([404, 410].includes(res.status)) return { url, status: 'broken', code: String(res.status) };
    return { url, status: 'unknown', code: String(res.status) };
  } catch (err) {
    return { url, status: 'unknown', code: (err as Error).name };
  }
}
