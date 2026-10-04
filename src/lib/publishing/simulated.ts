/**
 * Simulated Claude client — for automated tests and for trying the admin workflow locally
 * without an API key (AI_SIMULATE=true, refused in production builds). It never calls the
 * network and always returns the same hand-written article about an easy crochet flower.
 *
 * The fixture deliberately contains one link to an article that does not exist and one
 * invented external URL, so tests can prove the link sanitizer removes them.
 */
import { ANALYST_RULES, EDITORIAL_RULES, REVIEWER_RULES } from './prompts';
import type { Analysis, ArticleDraft, PipelineClient } from './generator';
import type { ReviewerFinding } from './validator';

export const FIXTURE_BODY = `Crochet flowers are one of the most satisfying first projects: they use scraps of yarn, take minutes rather than hours, and teach you how to work into a ring and into chain spaces. This guide walks you through a simple five-petal flower worked in three rounds, with stitch counts for every round.

You only need to know how to chain, slip stitch and make single and double crochet. If those are new, start with [the basic crochet stitches](/blog/basic-crochet-stitches) and come back when you feel comfortable.

## What you'll need

- Worsted-weight (#4) cotton or acrylic yarn — about 5–8 yd (5–7 m) per flower, approximately
- 4.5 mm (US 7) or 5 mm (US H-8) crochet hook
- Tapestry needle for weaving in ends
- Scissors

Cotton gives crisp, well-defined petals; acrylic is softer and a little fuzzier. Either works.

## Abbreviations (US terms)

- **ch** — chain
- **sl st** — slip stitch
- **sc** — single crochet (UK double crochet)
- **hdc** — half double crochet (UK half treble crochet)
- **dc** — double crochet (UK treble crochet)
- **sp** — space

## How to crochet the flower

The flower starts in a magic ring so the centre closes tightly. If you prefer, chain 4 and join with a slip stitch to form a small ring instead. Our [magic ring tutorial](/blog/how-to-make-a-magic-ring) shows both methods.

1. **Round 1:** Make a magic ring. Work 10 sc into the ring, then pull the tail to close it. Join with a sl st to the first sc. (10 sc)
2. **Round 2:** \\*Ch 3, skip the next sc, sl st in the following sc\\*; repeat from \\* 4 more times. The last sl st lands in the stitch where you joined Round 1. (5 ch-3 spaces)
3. **Round 3:** Sl st into the first ch-3 space. In each ch-3 space work (sc, hdc, 3 dc, hdc, sc). Join with a sl st to the first sc. (5 petals)
4. Fasten off, leaving a 6 in (15 cm) tail if you plan to sew the flower onto something.

Each petal is built from seven stitches, so the finished flower has 35 stitches in its last round. It measures about 2.5–3 in (6–8 cm) across in worsted yarn, depending on your tension.

## Finishing

Weave in the starting tail through the back of Round 1 and the ending tail through the back of the petals. If the petals curl, lay the flower flat, mist it with water and let it dry. For a two-colour flower, work Rounds 1–2 in one colour, fasten off, and join the second colour in a ch-3 space for Round 3.

## Tips

- Count your 10 stitches in Round 1 before closing the ring — it is much harder to fix later.
- Keep your ch-3 loops relaxed. Tight loops squeeze the petals and make them cup.
- Use the tails to attach flowers to hats, bags or headbands, rather than cutting them short.
- Make a few and join them into a garland or use them as appliqués; a [granny square](/blog/crochet-leaf-pattern) border also suits them.

## Common mistakes (and how to fix them)

- **The centre has a hole.** The magic ring was not pulled tight, or the tail slipped. Pull the tail firmly and weave it back through Round 1 in a different direction.
- **Only four petals fit.** You probably worked into every stitch in Round 2 instead of skipping one. Each repeat should use two stitches of Round 1.
- **Petals look uneven.** Check that every petal has exactly (sc, hdc, 3 dc, hdc, sc). A missing hdc makes one petal narrower.

## Where to go from here

Once this flower feels easy, try changing the petal stitches — use treble crochet in the middle of each petal for longer petals — or add a second layer of smaller petals worked into the back of Round 2. For more ideas, see this [flower guide](https://example.com/flower-guide-not-verified).
`;

export function fixtureDraft(keyword: string): ArticleDraft {
  return {
    title: 'Easy Crochet Flower for Beginners: A Five-Petal Pattern',
    slug: 'easy-crochet-flower-for-beginners',
    excerpt: 'Make a simple five-petal crochet flower in three rounds, with stitch counts for every round, finishing tips and fixes for common beginner mistakes.',
    seoTitle: 'Easy Crochet Flower for Beginners (5-Petal Pattern)',
    metaDescription: 'Learn to crochet an easy five-petal flower in three rounds. Includes materials, stitch counts, finishing tips and fixes for common beginner mistakes.',
    ogTitle: 'An easy five-petal crochet flower for beginners',
    ogDescription: 'A quick, scrap-friendly crochet flower worked in three rounds — with stitch counts and beginner tips.',
    primaryKeyword: keyword,
    relatedKeywords: ['simple crochet flower', 'five petal crochet flower', 'crochet flower pattern'],
    categorySlug: 'crochet-patterns',
    tags: ['flowers', 'beginner pattern', 'magic ring', 'scrap yarn'],
    contentMarkdown: FIXTURE_BODY,
    faq: [
      { q: 'How long does it take to crochet one flower?', a: 'Once you know the stitches, most people finish one in 10 to 20 minutes. Your first may take longer while you learn the rounds.' },
      { q: 'Can I make the flower bigger?', a: 'Use a thicker yarn with a larger hook, or replace the 3 dc in each petal with treble crochet for longer petals.' },
      { q: 'Which yarn is best for crochet flowers?', a: 'Smooth cotton shows the petal shapes most clearly. Fuzzy or textured yarns hide the stitches and are harder to count.' },
    ],
    relatedSlugs: ['how-to-make-a-magic-ring', 'basic-crochet-stitches', 'not-a-real-article'],
    coverMotif: 'flower',
    sourceUrlsUsed: [],
  };
}

export function fixtureAnalysis(keyword: string, overrides: Partial<Analysis> = {}): Analysis {
  return {
    isCrochetTopic: true,
    isSafeTopic: true,
    rejectionReason: '',
    searchIntent: `Beginners searching "${keyword}" want a simple flower they can finish quickly with basic stitches.`,
    format: 'pattern',
    workingTitle: keyword.replace(/\b\w/g, (c) => c.toUpperCase()),
    categorySlug: 'crochet-patterns',
    angle: 'A three-round flower with counts for every round and fixes for common mistakes.',
    readerQuestions: ['What do I need?', 'How do I make the petals?', 'How do I finish it?'],
    relatedKeywords: ['simple crochet flower'],
    targetLength: 'short',
    needsMaterialsList: true,
    needsSteps: true,
    overlapsExistingSlug: '',
    overlapReason: '',
    ...overrides,
  };
}

export interface SimulatedOptions {
  analysis?: Partial<Analysis>;
  draft?: (keyword: string) => ArticleDraft;
  reviewFindings?: ReviewerFinding[];
  /** Pretend the research step's web search returned these pages. */
  researchSources?: { url: string; title: string }[];
  /** Throw an API-style error at this stage. */
  failAt?: 'analysis' | 'research' | 'write' | 'review';
  delayMs?: number;
}

export class SimulatedApiError extends Error {
  status = 529;
  constructor(stage: string) {
    super(`Simulated Claude API failure during ${stage} (overloaded).`);
  }
}

/** Builds a fake client that implements just the calls the pipeline makes. `calls` counts requests. */
export function createSimulatedClient(opts: SimulatedOptions = {}): PipelineClient & { calls: number } {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const state = { calls: 0 };
  const wait = () => new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
  let keyword = '';
  const client = {
    get calls() {
      return state.calls;
    },
    beta: {
      messages: {
        create: async () => {
          state.calls++;
          await wait();
          if (opts.failAt === 'research') throw new SimulatedApiError('research');
          const results = (opts.researchSources ?? []).map((s) => ({ type: 'web_search_result', url: s.url, title: s.title, page_age: null, encrypted_content: '' }));
          return {
            content: [
              ...(results.length ? [{ type: 'web_search_tool_result', tool_use_id: 'sim', content: results }] : []),
              { type: 'text', text: '- Five-petal flowers are worked into chain spaces.\n- Magic ring closes the centre.', citations: null },
            ],
            stop_reason: 'end_turn',
            usage,
          };
        },
        parse: async (params: { system?: string; messages: { content: string }[] }) => {
          state.calls++;
          await wait();
          if (params.system === ANALYST_RULES) {
            if (opts.failAt === 'analysis') throw new SimulatedApiError('analysis');
            keyword = /Keyword: "([^"]+)"/.exec(String(params.messages[0]?.content))?.[1] ?? 'easy crochet flower for beginners';
            return { parsed_output: fixtureAnalysis(keyword, opts.analysis), stop_reason: 'end_turn', usage };
          }
          if (params.system === EDITORIAL_RULES) {
            if (opts.failAt === 'write') throw new SimulatedApiError('write');
            return { parsed_output: (opts.draft ?? fixtureDraft)(keyword), stop_reason: 'end_turn', usage };
          }
          if (params.system === REVIEWER_RULES) {
            if (opts.failAt === 'review') throw new SimulatedApiError('review');
            return { parsed_output: { verdict: 'publishable', summary: 'ok', findings: opts.reviewFindings ?? [] }, stop_reason: 'end_turn', usage };
          }
          throw new Error('Simulated client: unexpected request');
        },
      },
    },
  };
  return client as unknown as PipelineClient & { calls: number };
}
