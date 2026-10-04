import type { AstroCookies } from 'astro';

export interface Flash {
  type: 'success' | 'error';
  text: string;
}

const NAME = 'hh_flash';

export function setFlash(cookies: AstroCookies, type: Flash['type'], text: string) {
  cookies.set(NAME, JSON.stringify({ type, text: text.slice(0, 1500) }), { path: '/admin', httpOnly: true, sameSite: 'lax', maxAge: 60 });
}

export function takeFlash(cookies: AstroCookies): Flash | null {
  const raw = cookies.get(NAME)?.value;
  if (!raw) return null;
  cookies.delete(NAME, { path: '/admin' });
  try {
    const f = JSON.parse(raw) as Flash;
    return f.type === 'success' || f.type === 'error' ? f : null;
  } catch {
    return null;
  }
}
