# Deployment

The app is a single Node.js process with a SQLite file and an uploads folder, so it needs a host with a
**persistent disk** and a **long-running process**: a small VPS, a dedicated server, or a PaaS with persistent
volumes (e.g. Fly.io, Render, Railway). Serverless/edge platforms are not a good fit (no persistent SQLite file,
no background jobs).

## 1. Server setup (Ubuntu example)

```bash
# Node.js 22.12+ (24 LTS recommended)
sudo adduser --system --group crochet
sudo mkdir -p /srv/crochet-blog && sudo chown crochet:crochet /srv/crochet-blog
# copy the project (git clone or rsync), then as the crochet user:
cd /srv/crochet-blog
npm ci
npm run build
```

Create `/srv/crochet-blog/.env` (mode 600, owned by `crochet`) or use your platform's secret manager:

```ini
SITE_URL=https://www.your-domain.com
APP_SECRET=<48 random bytes, base64url>
ALLOW_INDEXING=true          # only on the real launch
TRUST_PROXY=true             # behind nginx/Caddy/a CDN
CRON_SECRET=<random, if you use HTTP cron>
ANTHROPIC_API_KEY=<if using AI drafts>
EMAIL_PROVIDER=resend|postmark
EMAIL_API_KEY=...
EMAIL_FROM="Your Site <hello@your-domain.com>"
```

Then:

```bash
npm run db:seed                       # first deploy only (or copy your existing data/ folder)
npm run admin:create -- --email you@your-domain.com --name "Your Name"
```

## 2. systemd service

`/etc/systemd/system/crochet-blog.service`:

```ini
[Unit]
Description=Crochet blog
After=network.target

[Service]
User=crochet
WorkingDirectory=/srv/crochet-blog
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=4321
ExecStart=/usr/bin/node --env-file-if-exists=.env dist/server/entry.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/srv/crochet-blog/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now crochet-blog
```

## 3. Reverse proxy + HTTPS (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name www.your-domain.com;
  # ssl_certificate … (e.g. from certbot)
  client_max_body_size 12m;           # image uploads

  location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
server { listen 80; server_name your-domain.com www.your-domain.com; return 301 https://www.your-domain.com$request_uri; }
```

Keep the `Host` header intact. The app's same-origin check compares the browser's `Origin` with `SITE_URL`
and the request host.

## 4. Scheduled jobs

```cron
# Daily AI publisher + due scheduled posts (the app decides when the day's article is due)
*/15 * * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://www.your-domain.com/api/cron/daily-publish > /dev/null
# Database backup
15 3 * * *   cd /srv/crochet-blog && sqlite3 data/site.db ".backup 'data/backups/site-$(date +\%F).db'"
```

(Create `data/backups/` first and copy backups plus `data/uploads/` off the server regularly. Other hosts:
see [PUBLISHING.md](PUBLISHING.md#host-specific-setups).)

## 5. Updating

```bash
git pull            # or rsync the new code
npm ci && npm run build
sudo systemctl restart crochet-blog   # migrations run automatically on start
```

## 6. Health check

`GET /api/health` returns `{"ok":true}` when the database is reachable — use it for uptime monitoring.
