// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Runtime settings (site URL, secrets, feature flags) are read from environment
// variables at request time in src/lib/config.ts — not baked in here.
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  output: 'server',
  adapter: node({ mode: 'standalone', bodySizeLimit: 12 * 1024 * 1024 }),
  trailingSlash: 'never',
  // Origin checking for form POSTs is done in src/middleware.ts instead, so that
  // server-to-server cron calls (Bearer-authenticated, no Origin header) still work.
  security: { checkOrigin: false },
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1', port: 4321 },
  vite: {
    ssr: { external: ['better-sqlite3', 'sharp'] },
  },
});
