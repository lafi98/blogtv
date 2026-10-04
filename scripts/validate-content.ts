/** Re-validate every article (or one with --slug) and print a report. --external also checks external links live. */
import { getArticle, setValidation, corpusForValidation } from '../src/lib/repos/articles';
import { articleToValidationInput, buildValidationContext } from '../src/lib/publishing/context';
import { validateArticle } from '../src/lib/publishing/validator';
import { arg, flag } from './_bootstrap';

const only = arg('slug');
const ctx = buildValidationContext();
let failed = 0;
for (const d of corpusForValidation()) {
  if (only && d.slug !== only) continue;
  const a = getArticle(d.id)!;
  const report = await validateArticle(articleToValidationInput(a), ctx, { checkExternalLinks: flag('external'), requireFeaturedImage: true });
  setValidation(a.id, report);
  if (report.status === 'fail') failed++;
  console.log(`${report.status.toUpperCase().padEnd(4)} ${a.slug}  (${report.errors}E/${report.warnings}W, ${report.metrics.wordCount} words, ease ${report.metrics.readingEase}, top "${report.metrics.topPhrase?.phrase}" ${report.metrics.topPhrase?.density}%, overlap ${report.metrics.maxSimilarity?.score ?? 0})`);
  for (const c of report.checks.filter((c) => c.level !== 'info')) {
    console.log(`     ${c.level === 'error' ? '✗' : '!'} ${c.message}`);
    for (const det of c.details ?? []) console.log(`         ${det}`);
  }
}
process.exit(failed ? 1 : 0);
