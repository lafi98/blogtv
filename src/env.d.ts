/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Per-request CSP nonce; every <script> we render must carry it. */
    nonce: string;
    /** Signed-in admin user (only set on /admin routes). */
    user: import('./lib/auth/session').SessionUser | null;
    csrfToken: string;
    /** One-time admin notice carried across a redirect. */
    flash: import('./lib/admin/flash').Flash | null;
  }
}
