import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { uploadsDir } from '../../lib/images/process';

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg' };

export const GET: APIRoute = ({ params, request }) => {
  const file = params.file ?? '';
  // Strict allow-list of generated file names — no path traversal possible.
  const m = file.match(/^[a-z0-9-]{1,120}\.(webp|jpg)$/);
  if (!m) return new Response('Not found', { status: 404 });
  const full = path.join(uploadsDir(), file);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': TYPES[m[1]],
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(fs.readFileSync(full), { headers: { ...headers, 'Content-Length': String(stat.size) } });
};
