import { getSettings } from './settings';

/** Parses a /page/N segment. Returns null for invalid input (→ 404). Page 1 must use the base URL. */
export function parsePage(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  if (!/^[1-9]\d{0,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 2 ? n : null;
}

export function perPage(): number {
  return Math.min(Math.max(getSettings('site').postsPerPage || 9, 3), 30);
}
