/**
 * Link hygiene for generated articles: the model may only link to URLs we gave it.
 * Anything else is unwrapped to plain text (never left broken, never invented).
 */
import fs from 'node:fs';
import path from 'node:path';
import { STATIC_PATHS } from './validator';
import { isTrustedExternalUrl } from './trust';

export interface LinkPolicy {
  /** Slugs of PUBLISHED articles that may be linked (excluding the article itself). */
  publishedSlugs: Set<string>;
  /** Category slugs that have published articles. */
  categorySlugs: Set<string>;
  /** Exact external URLs that came from research or the trusted reference list. */
  allowedExternal: Set<string>;
}

export interface SanitizeResult {
  markdown: string;
  removed: { text: string; href: string; reason: string }[];
  keptInternal: string[];
}

function diagramExists(href: string): boolean {
  if (!/^\/images\/diagrams\/[a-z0-9-]+\.svg$/.test(href)) return false;
  return fs.existsSync(path.resolve('public' + href)) || fs.existsSync(path.resolve('dist/client' + href));
}

export function sanitizeLinks(markdown: string, policy: LinkPolicy): SanitizeResult {
  const removed: SanitizeResult['removed'] = [];
  const keptInternal: string[] = [];
  // Images first: only the site's own diagrams are allowed in generated content.
  let md = markdown.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (whole, alt: string, href: string) => {
    if (diagramExists(href) && alt.trim().length >= 5) return whole;
    removed.push({ text: alt, href, reason: 'image not from the site’s diagram library' });
    return '';
  });
  md = md.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (whole, text: string, href: string) => {
    const keep = () => whole;
    const drop = (reason: string) => {
      removed.push({ text, href, reason });
      return text;
    };
    if (href.startsWith('/')) {
      const p = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
      const blog = p.match(/^\/blog\/([a-z0-9-]+)$/);
      const cat = p.match(/^\/category\/([a-z0-9-]+)$/);
      if (blog) {
        if (policy.publishedSlugs.has(blog[1])) {
          keptInternal.push(blog[1]);
          return keep();
        }
        return drop('internal article does not exist or is not published');
      }
      if (cat) return policy.categorySlugs.has(cat[1]) ? keep() : drop('category does not exist or is empty');
      return STATIC_PATHS.has(p) ? keep() : drop('unknown internal path');
    }
    if (/^https:\/\//i.test(href)) {
      if (!policy.allowedExternal.has(href)) return drop('external URL was not among the verified sources');
      return isTrustedExternalUrl(href) ? keep() : drop('external site is not a trustworthy reference (social, marketplace or shortener)');
    }
    return drop('unsupported link');
  });
  return { markdown: md.replace(/\n{3,}/g, '\n\n'), removed, keptInternal: [...new Set(keptInternal)] };
}
