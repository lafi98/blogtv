import type { APIRoute } from 'astro';
import { listSubscribers } from '../../lib/repos/subscribers';

// Auth is enforced by the middleware for everything under /admin.
export const GET: APIRoute = () => {
  const rows = listSubscribers().filter((s) => s.status === 'confirmed');
  // Prefix cells that could be read as spreadsheet formulas.
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  const csv = ['email,confirmed_at', ...rows.map((r) => `${cell(r.email)},${cell(r.confirmedAt ?? '')}`)].join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="subscribers.csv"' } });
};
