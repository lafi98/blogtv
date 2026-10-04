/**
 * Markdown → HTML for articles and editable pages.
 *
 * Security: raw HTML in Markdown is DISABLED (`html: false`), so any `<script>`,
 * `<iframe>`, event handler etc. typed into an article (or produced by an AI draft)
 * is rendered as harmless escaped text. markdown-it's link validator also rejects
 * `javascript:`, `vbscript:`, `file:` and most `data:` URLs.
 */
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt, { type Token } from 'markdown-it';
import { slugify } from './text';
import { config } from '../config';

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface RenderedMarkdown {
  html: string;
  /** HTML split at top-level H2 boundaries (index 0 = intro), for in-content ad placement. */
  sections: string[];
  toc: TocItem[];
}

type Dimensions = { width: number; height: number };
export type ImageResolver = (src: string) => Dimensions | null;

const md = new MarkdownIt({ html: false, linkify: false, typographer: true, breaks: false });

// Responsive, accessible tables: wrap in a focusable scroll region.
md.renderer.rules.table_open = () =>
  '<div class="table-wrap" role="region" tabindex="0" aria-label="Scrollable table"><table>';
md.renderer.rules.table_close = () => '</table></div>';

const siteHost = (() => {
  try {
    return new URL(config.siteUrl).host;
  } catch {
    return '';
  }
})();

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  const href = String(token.attrGet('href') ?? '');
  if (/^https?:\/\//i.test(href)) {
    try {
      if (new URL(href).host !== siteHost) {
        token.attrSet('rel', 'noopener');
        token.attrJoin('class', 'external');
      }
    } catch {
      /* invalid URL: leave as is, validator reports it */
    }
  }
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = String(token.attrGet('src') ?? '');
  const alt = self.renderInlineAsText(token.children || [], options, env);
  const resolver = (env as { resolveImage?: ImageResolver } | undefined)?.resolveImage;
  const dims = resolver?.(src) ?? diagramDimensions(src);
  const attrs = [
    `src="${md.utils.escapeHtml(src)}"`,
    `alt="${md.utils.escapeHtml(alt)}"`,
    'loading="lazy"',
    'decoding="async"',
  ];
  if (dims) attrs.push(`width="${dims.width}"`, `height="${dims.height}"`);
  const title = token.attrGet('title') == null ? '' : String(token.attrGet('title'));
  const img = `<img ${attrs.join(' ')}>`;
  return title
    ? `<figure>${img}<figcaption>${md.utils.escapeHtml(title)}</figcaption></figure>`
    : img;
};

// Read intrinsic sizes of bundled SVG diagrams so they never cause layout shift.
const diagramCache = new Map<string, Dimensions | null>();
function diagramDimensions(src: string): Dimensions | null {
  if (!src.startsWith('/images/') || !src.endsWith('.svg')) return null;
  if (diagramCache.has(src)) return diagramCache.get(src)!;
  let dims: Dimensions | null = null;
  try {
    const candidates = [path.resolve('public' + src), path.resolve('dist/client' + src)];
    const file = candidates.find((p) => fs.existsSync(p));
    if (file) {
      const head = fs.readFileSync(file, 'utf8').slice(0, 600);
      const vb = head.match(/viewBox="\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/);
      if (vb) dims = { width: Math.round(+vb[1]), height: Math.round(+vb[2]) };
    }
  } catch {
    dims = null;
  }
  diagramCache.set(src, dims);
  return dims;
}

function addHeadingIds(tokens: Token[], toc: TocItem[]) {
  const used = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const level = Number(t.tag.slice(1));
    const inline = tokens[i + 1];
    const text = (inline?.children ?? [])
      .filter((c) => c.type === 'text' || c.type === 'code_inline')
      .map((c) => c.content)
      .join('')
      .trim();
    let id = slugify(text) || `section-${i}`;
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    if (n) id = `${id}-${n + 1}`;
    t.attrSet('id', id);
    if (level === 2 || level === 3) toc.push({ id, text, level: level as 2 | 3 });
  }
}

/** Demote any H1 in body content to H2 — the page template owns the only H1. */
function demoteH1(tokens: Token[]) {
  for (const t of tokens) {
    if ((t.type === 'heading_open' || t.type === 'heading_close') && t.tag === 'h1') t.tag = 'h2';
  }
}

export function renderMarkdown(source: string, opts: { resolveImage?: ImageResolver } = {}): RenderedMarkdown {
  const env = { resolveImage: opts.resolveImage };
  const tokens = md.parse(source || '', env);
  demoteH1(tokens);
  const toc: TocItem[] = [];
  addHeadingIds(tokens, toc);

  const sections: string[] = [];
  let start = 0;
  tokens.forEach((t, i) => {
    if (t.type === 'heading_open' && t.tag === 'h2' && t.level === 0 && i > 0) {
      sections.push(md.renderer.render(tokens.slice(start, i), md.options, env));
      start = i;
    }
  });
  sections.push(md.renderer.render(tokens.slice(start), md.options, env));
  return { html: sections.join(''), sections, toc };
}

/**
 * Minimal templating for the editable legal/about pages:
 *   {{key}}                    — value (Markdown-escaped)
 *   {{#if flag}}…{{/if}}       — conditional block (nestable); {{#if !flag}} negates
 *   lines starting with %%     — editor notes, removed
 */
export type TemplateVars = Record<string, string | boolean | { md: string }>;

export function fillTemplate(template: string, vars: TemplateVars): string {
  let out = template
    .split('\n')
    .filter((l) => !l.startsWith('%%'))
    .join('\n')
    // A tag alone on its line shouldn't leave a blank line behind.
    .replace(/^[ \t]*(\{\{#if !?[\w.]+\}\}|\{\{\/if\}\})[ \t]*\n/gm, '$1');
  const block = /\{\{#if (!?)([\w.]+)\}\}((?:(?!\{\{#if )[\s\S])*?)\{\{\/if\}\}/;
  for (let guard = 0; guard < 500 && block.test(out); guard++) {
    out = out.replace(block, (_, neg: string, key: string, body: string) => {
      const truthy = Boolean(vars[key]);
      return (neg ? !truthy : truthy) ? body : '';
    });
  }
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v && typeof v === 'object') return v.md; // trusted Markdown built in code
    return typeof v === 'string' ? escapeMd(v) : '';
  });
  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export const escapeMd = (v: string) => v.replace(/[\\`*_[\]<>]/g, '\\$&');
