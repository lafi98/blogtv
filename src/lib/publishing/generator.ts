/**
 * Claude stages of the keyword → article pipeline. Server-side only.
 *   analyzeKeyword → researchKeyword → writeArticle → reviewArticle
 * All calls go through the official SDK client from ./claude (or an injected client in tests).
 */
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type Anthropic from '@anthropic-ai/sdk';
import { addUsage, modelOptions, RefusalError, type Usage } from './claude';
import { ANALYST_RULES, DIAGRAMS, EDITORIAL_RULES, REVIEWER_RULES, TRUSTED_REFERENCE_URLS } from './prompts';
import { COVER_MOTIFS } from '../images/covers';
import type { ReviewerFinding } from './validator';

/** The subset of the Anthropic client the pipeline uses (injectable for tests). */
export type PipelineClient = Pick<Anthropic, 'beta'>;

export const AnalysisSchema = z.object({
  isCrochetTopic: z.boolean(),
  isSafeTopic: z.boolean(),
  rejectionReason: z.string(),
  searchIntent: z.string(),
  format: z.enum(['step-by-step tutorial', 'pattern', 'list of ideas', 'explainer', 'troubleshooting guide', 'comparison']),
  workingTitle: z.string(),
  categorySlug: z.string(),
  angle: z.string(),
  readerQuestions: z.array(z.string()),
  relatedKeywords: z.array(z.string()),
  targetLength: z.enum(['short', 'medium', 'long']),
  needsMaterialsList: z.boolean(),
  needsSteps: z.boolean(),
  overlapsExistingSlug: z.string(),
  overlapReason: z.string(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const ArticleSchema = z.object({
  title: z.string(),
  slug: z.string(),
  excerpt: z.string(),
  seoTitle: z.string(),
  metaDescription: z.string(),
  ogTitle: z.string(),
  ogDescription: z.string(),
  primaryKeyword: z.string(),
  relatedKeywords: z.array(z.string()),
  categorySlug: z.string(),
  tags: z.array(z.string()),
  contentMarkdown: z.string(),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  relatedSlugs: z.array(z.string()),
  coverMotif: z.string(),
  sourceUrlsUsed: z.array(z.string()),
});
export type ArticleDraft = z.infer<typeof ArticleSchema>;

export const ReviewSchema = z.object({
  verdict: z.enum(['publishable', 'needs_changes', 'reject']),
  summary: z.string(),
  findings: z.array(
    z.object({
      kind: z.enum(['factual', 'policy', 'quality']),
      severity: z.enum(['high', 'medium', 'low']),
      claim: z.string(),
      problem: z.string(),
    }),
  ),
});

export interface Research {
  brief: string;
  sources: { title: string; url: string }[];
}

export interface LinkCandidate {
  slug: string;
  title: string;
  excerpt: string;
}

const LENGTH_GUIDE: Record<Analysis['targetLength'], string> = {
  short: 'short — roughly 500–900 words; answer the question completely and stop',
  medium: 'medium — roughly 900–1,500 words',
  long: 'long — roughly 1,500–2,200 words, only because the topic genuinely needs it',
};

function guard(res: { stop_reason: string | null; stop_details?: { category?: string | null } | null }, stage: string) {
  if (res.stop_reason === 'refusal') throw new RefusalError(res.stop_details?.category);
  if (res.stop_reason === 'max_tokens') throw new Error(`${stage}: the model output was cut off (max_tokens).`);
}

export async function analyzeKeyword(
  client: PipelineClient,
  keyword: string,
  ctx: { categories: { slug: string; name: string }[]; existing: { slug: string; title: string }[]; today: string },
  usage: Usage,
): Promise<Analysis> {
  const opts = modelOptions();
  const res = await client.beta.messages.parse({
    ...opts,
    max_tokens: 8000,
    system: ANALYST_RULES,
    messages: [
      {
        role: 'user',
        content: `Keyword: "${keyword}"
Today: ${ctx.today}

Categories (slug — name): ${ctx.categories.map((c) => `${c.slug} — ${c.name}`).join('; ')}

Existing articles (slug — title):
${ctx.existing.map((a) => `- ${a.slug} — ${a.title}`).join('\n') || '(none)'}`,
      },
    ],
    output_config: { ...(opts.output_config ?? {}), format: betaZodOutputFormat(AnalysisSchema) },
  });
  addUsage(usage, res.usage);
  guard(res, 'Topic analysis');
  if (!res.parsed_output) throw new Error('Topic analysis could not be parsed from the model output.');
  return res.parsed_output;
}

export async function researchKeyword(client: PipelineClient, keyword: string, analysis: Analysis, withWebSearch: boolean, usage: Usage): Promise<Research> {
  const opts = modelOptions();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: `Prepare a concise research brief for a crochet article targeting the search keyword "${keyword}".
Search intent: ${analysis.searchIntent}. Planned format: ${analysis.format}. Angle: ${analysis.angle}
Questions readers have: ${analysis.readerQuestions.join(' | ')}
Cover the accurate, standard techniques and terminology (US with UK equivalents), typical materials and size ranges,
common mistakes and fixes, safety considerations if any, and points where reputable sources disagree. Bullet points.
${withWebSearch ? 'Use web search to check facts against reputable sources (e.g. Craft Yarn Council standards, established crochet education sites) and cite them.' : 'Rely on well-established knowledge and flag anything uncertain.'}`,
    },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = withWebSearch ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] : [];
  const blocks: Anthropic.Beta.BetaContentBlock[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      ...opts,
      max_tokens: 16000,
      system: 'You are a careful research assistant for a crochet education website. Accuracy over breadth.',
      messages,
      tools,
    });
    addUsage(usage, res.usage);
    if (res.stop_reason === 'refusal') throw new RefusalError(res.stop_details?.category);
    blocks.push(...res.content);
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  const sources = new Map<string, string>();
  let brief = '';
  for (const b of blocks) {
    if (b.type === 'text') {
      brief += b.text;
      for (const c of b.citations ?? []) if (c.type === 'web_search_result_location') sources.set(c.url, c.title ?? c.url);
    } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === 'web_search_result') sources.set(r.url, r.title);
    }
  }
  return { brief: brief.trim(), sources: [...sources].map(([url, title]) => ({ url, title })) };
}

export async function writeArticle(
  client: PipelineClient,
  keyword: string,
  analysis: Analysis,
  research: Research,
  ctx: { linkCandidates: LinkCandidate[]; categories: string[]; takenSlugs: string[] },
  usage: Usage,
): Promise<ArticleDraft> {
  const opts = modelOptions();
  const externals = [...research.sources.map((s) => s.url), ...TRUSTED_REFERENCE_URLS];
  const res = await client.beta.messages.parse({
    ...opts,
    max_tokens: 32000,
    system: EDITORIAL_RULES,
    messages: [
      {
        role: 'user',
        content: `Primary keyword: "${keyword}"
Search intent: ${analysis.searchIntent}
Format: ${analysis.format}. Working title: ${analysis.workingTitle}. Angle: ${analysis.angle}
Questions the article must answer: ${analysis.readerQuestions.map((q) => `\n- ${q}`).join('')}
Target length: ${LENGTH_GUIDE[analysis.targetLength]}.
Materials list needed: ${analysis.needsMaterialsList ? 'yes' : 'only if useful'}. Step-by-step needed: ${analysis.needsSteps ? 'yes' : 'only if useful'}.
Related phrases you may use where natural: ${analysis.relatedKeywords.join(', ') || '(none)'}

Research brief (use it; never copy sentences from sources):
<research>
${research.brief || '(no brief — rely on standard, well-established knowledge only)'}
</research>

Published articles you MAY link to (only if genuinely relevant; use exactly these URLs):
${ctx.linkCandidates.map((c) => `- /blog/${c.slug} — ${c.title}: ${c.excerpt}`).join('\n') || '(none — do not add internal article links)'}

Allowed external URLs (optional, max 3):
${externals.map((u) => `- ${u}`).join('\n')}

Diagrams you may embed with ![descriptive alt](path) if genuinely helpful:
${DIAGRAMS.map((d) => `- ${d.path} (${d.about})`).join('\n')}

Field rules:
- slug: lowercase-hyphenated, ≤ 60 chars, not one of: ${ctx.takenSlugs.slice(0, 400).join(', ')}
- seoTitle ≤ 60 chars; metaDescription 120–158 chars; ogTitle ≤ 70 chars; ogDescription ≤ 200 chars — all natural, no keyword lists
- primaryKeyword: the keyword above; relatedKeywords: 3–8 natural variations actually covered by the article
- excerpt: 1–2 plain-text sentences, 120–220 chars
- categorySlug: one of ${ctx.categories.join(', ')}
- tags: 3–6 lowercase tags
- faq: 0–5 genuinely useful Q&As that do not repeat the body (empty if not useful)
- relatedSlugs: up to 3 slugs from the published list above (empty if none fit)
- coverMotif: one of ${COVER_MOTIFS.join(', ')}
- sourceUrlsUsed: external URLs you relied on (allowed list only)`,
      },
    ],
    output_config: { ...(opts.output_config ?? {}), format: betaZodOutputFormat(ArticleSchema) },
  });
  addUsage(usage, res.usage);
  guard(res, 'Article generation');
  if (!res.parsed_output) throw new Error('Article could not be parsed from the model output.');
  return res.parsed_output;
}

export async function reviewArticle(client: PipelineClient, draft: ArticleDraft, research: Research, usage: Usage): Promise<ReviewerFinding[]> {
  const opts = modelOptions();
  const res = await client.beta.messages.parse({
    ...opts,
    max_tokens: 16000,
    system: REVIEWER_RULES,
    messages: [
      {
        role: 'user',
        content: `Research brief the writer had:\n<research>\n${research.brief}\n</research>\n\nTitle: ${draft.title}\nPrimary keyword: ${draft.primaryKeyword}\n\nDraft (Markdown):\n<draft>\n${draft.contentMarkdown}\n</draft>\n\nFAQ:\n${draft.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n')}`,
      },
    ],
    output_config: { ...(opts.output_config ?? {}), format: betaZodOutputFormat(ReviewSchema) },
  });
  addUsage(usage, res.usage);
  guard(res, 'Review');
  const review = res.parsed_output;
  if (!review) throw new Error('Review could not be parsed.');
  const findings: ReviewerFinding[] = [...review.findings];
  if (review.verdict === 'reject') findings.push({ kind: 'quality', severity: 'high', claim: '', problem: `Reviewer rejected the draft: ${review.summary}` });
  return findings;
}
