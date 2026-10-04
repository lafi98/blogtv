/**
 * Import Markdown article(s) with YAML front matter (same format as content/seed/articles).
 *   npm run content:import -- path/to/article.md [more.md…] [--publish]
 * Imported articles are validated; without --publish they are saved as drafts for review.
 */
import { importMarkdownFile } from './lib/importer';
import { flag } from './_bootstrap';

const files = process.argv.slice(2).filter((a) => a.endsWith('.md'));
if (!files.length) {
  console.error('Usage: npm run content:import -- file.md [--publish]');
  process.exit(1);
}
for (const f of files) {
  const r = await importMarkdownFile(f, { publish: flag('publish') });
  console.log(`${r.status.padEnd(9)} ${r.slug} — ${r.message}`);
}
