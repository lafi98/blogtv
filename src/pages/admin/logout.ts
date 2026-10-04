import type { APIRoute } from 'astro';
import { clearSessionCookie, destroySession, sessionCookieName } from '../../lib/auth/session';

// CSRF token is verified by the middleware for every admin POST.
export const POST: APIRoute = ({ cookies, redirect }) => {
  destroySession(cookies.get(sessionCookieName())?.value);
  clearSessionCookie(cookies);
  return redirect('/admin/login', 303);
};
