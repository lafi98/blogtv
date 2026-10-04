import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

export const GET: APIRoute = () => {
  let db = false;
  try {
    db = (getDb().prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  } catch {
    db = false;
  }
  return new Response(JSON.stringify({ ok: db }), { status: db ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
};
