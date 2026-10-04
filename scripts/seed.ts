/**
 * Seed the database: categories, an editorial byline and the original seed articles in
 * content/seed/articles. (The AI keyword queue starts empty — add keywords in Admin → AI Publisher.)
 *   npm run db:seed              — idempotent; existing rows are left alone
 *   npm run db:seed -- --reset   — DELETE the database file first (asks no questions; dev only)
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/lib/config';
import { flag } from './_bootstrap';

if (flag('reset')) {
  if (config.isProd) {
    console.error('Refusing to --reset in production.');
    process.exit(1);
  }
  for (const f of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) fs.rmSync(f, { force: true });
  fs.rmSync(config.uploadsDir, { recursive: true, force: true });
  console.log('Database and uploads reset.');
}

const { getDb } = await import('../src/lib/db');
const { upsertCategory, listCategories } = await import('../src/lib/repos/categories');
const { listAuthors, upsertAuthor } = await import('../src/lib/repos/authors');
const { importMarkdownFile, readMarkdown } = await import('./lib/importer');
const { articleToValidationInput, buildValidationContext } = await import('../src/lib/publishing/context');
const { validateArticleSync } = await import('../src/lib/publishing/validator');
const { getArticle, setValidation, getArticleBySlug } = await import('../src/lib/repos/articles');

getDb();

const CATEGORIES = [
  {
    slug: 'crochet-for-beginners',
    name: 'Crochet for Beginners',
    description: 'Start here: your first stitches, the tools you need and simple practice projects, explained one step at a time.',
    introMd:
      'New to crochet? These guides assume you have never held a hook. Start with the first lesson, practise the chain and single crochet until they feel comfortable, then move on to the basic stitches and your first small project. Everything uses US terms with UK equivalents in brackets.',
  },
  {
    slug: 'crochet-patterns',
    name: 'Crochet Patterns',
    description: 'Free, beginner-friendly patterns with stitch counts for every row or round, approximate sizes and notes on adjusting them.',
    introMd:
      'Every pattern here lists the yarn weight and hook size, gives a stitch count at the end of each row or round, and explains how to make it bigger or smaller. Sizes and yarn amounts are estimates — check your gauge before you start a project where fit matters.',
  },
  {
    slug: 'crochet-tutorials',
    name: 'Crochet Tutorials',
    description: 'Step-by-step techniques — magic rings, reading patterns, gauge swatches and more — so you can follow any pattern with confidence.',
    introMd:
      'Tutorials focus on one technique at a time, with the reasons behind each step so you can troubleshoot on your own. If a pattern asks for something you have not done before, look for it here.',
  },
  {
    slug: 'crochet-stitches',
    name: 'Crochet Stitches',
    description: 'How each stitch is made, how tall it is, its chart symbol and its UK name — from the chain to the treble and beyond.',
    introMd:
      'Most crochet is built from a handful of basic stitches. These guides show how each one is worked, compare their heights, and translate between US and UK terminology so patterns from anywhere make sense.',
  },
  {
    slug: 'crochet-bags',
    name: 'Crochet Bags',
    description: 'Pouches, totes and market bags, plus advice on choosing sturdy yarns and making straps that hold their shape.',
    introMd:
      'Bags need sturdier fabric than scarves or blankets. Alongside the patterns you will find guidance on fibre choice, tension and reinforcing handles so your bag lasts.',
  },
  {
    slug: 'crochet-home-decor',
    name: 'Crochet Home Decor',
    description: 'Coasters, baskets, cushions and other practical pieces for the home, with tips on choosing fibres that suit each use.',
    introMd:
      'Home decor projects are a great way to practise new stitches on small, useful items. Each pattern explains which fibres work best — for example, absorbent cotton for coasters.',
  },
  {
    slug: 'crochet-gifts',
    name: 'Crochet Gifts',
    description: 'Quick, thoughtful projects to make for friends and family, with realistic time estimates and presentation tips.',
    introMd:
      'Handmade gifts are lovely to give, but deadlines are real. These ideas favour small projects you can finish in an evening or two, with notes on care labels and presentation.',
  },
  {
    slug: 'crochet-for-kids',
    name: 'Crochet for Kids',
    description: 'Teaching children to crochet and making safe items for little ones, with age-aware advice for parents and carers.',
    introMd:
      'Guides for parents, carers and teachers. They cover readiness, the easiest first steps, and safety points such as avoiding small parts on items for babies and toddlers.',
  },
  {
    slug: 'seasonal-crochet',
    name: 'Seasonal Crochet',
    description: 'Autumn, winter and holiday projects, plus planning help so your seasonal makes are finished on time.',
    introMd:
      'Seasonal projects and planning guides to help you get festive makes finished without the last-minute rush.',
  },
  {
    slug: 'crochet-tips',
    name: 'Crochet Tips',
    description: 'Fixes for common problems — uneven edges, tension, reading yarn labels — and small habits that make crochet easier.',
    introMd:
      'Short, practical answers to the problems every crocheter runs into, from wobbly edges to working out how much yarn to buy.',
  },
];

const existingCats = new Set(listCategories().map((c) => c.slug));
CATEGORIES.forEach((c, i) => {
  if (!existingCats.has(c.slug)) upsertCategory({ ...c, seoTitle: '', metaDescription: '', sortOrder: i });
});
console.log(`Categories: ${listCategories().length}`);

if (!listAuthors().length) {
  upsertAuthor({
    slug: 'editorial-team',
    name: 'Hook & Hearth Editorial Team',
    role: 'Crochet tutorials and patterns',
    bio: 'Guides from the Hook & Hearth editorial desk: beginner-friendly crochet tutorials and patterns written with standard US terms and their UK equivalents.',
    avatarImageId: null,
    websiteUrl: '',
    sameAs: [],
  });
  console.log('Created the generic editorial byline — replace it with real author profiles before launch (Admin → Authors).');
}

const dir = path.resolve('content/seed/articles');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
// Seed articles are published "now" (ordered a minute apart) — no back-dating.
const base = Date.now() - files.length * 60_000;
const featuredSlug = 'how-to-crochet-for-beginners';
let imported = 0;
for (const [i, f] of files.entries()) {
  const { fm } = readMarkdown(path.join(dir, f));
  if (getArticleBySlug(fm.slug)) continue;
  const r = await importMarkdownFile(path.join(dir, f), {
    publish: true,
    publishedAt: new Date(base + i * 60_000).toISOString(),
    aiAssisted: true,
    validate: false,
  });
  if (r.status === 'error') console.error(`  ✗ ${f}: ${r.message}`);
  else imported++;
}
if (imported) {
  getDb().prepare('UPDATE articles SET featured = CASE WHEN slug = ? THEN 1 ELSE 0 END').run(featuredSlug);
  // Validate after everything is imported so internal links resolve.
  const ctx = buildValidationContext();
  for (const row of getDb().prepare('SELECT id FROM articles').all() as { id: number }[]) {
    const a = getArticle(row.id)!;
    setValidation(a.id, validateArticleSync(articleToValidationInput(a), ctx, { requireFeaturedImage: true }));
  }
}
console.log(`Seed articles imported: ${imported} (of ${files.length} files).`);
