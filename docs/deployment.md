# Deploying Osler

This guide is the **operational runbook** for getting an Osler instance from a fresh `git clone` to a live, monitored URL. It complements [`hosting.md`](./hosting.md) (which explains the *what* and *why*) by walking through the *how* — step-by-step runbooks for every supported host, plus pre-deploy checks, post-deploy smoke tests, rollback procedures, CI/CD pipelines, advanced blue/green & canary patterns, and per-host monitoring setup.

If you just want the short version of "which host should I pick?", read [`hosting.md`](./hosting.md) §1 first, then come back here for the runbook.

> **Source repository:** <https://github.com/eyad-elghareeb/osler>
> **License:** MIT — see [LICENSE](../LICENSE).
> **Related guides:** [`hosting.md`](./hosting.md) · [`forking.md`](./forking.md) · [`environment.md`](./environment.md) · [`tauri-admin.md`](./tauri-admin.md) · [`security.md`](./security.md)

---

## Table of Contents

1. [Deployment decision matrix](#1-deployment-decision-matrix)
2. [Pre-deploy checklist](#2-pre-deploy-checklist)
3. [Cloudflare Pages + Worker runbook](#3-cloudflare-pages--worker-runbook)
4. [Vercel + Cloudflare Worker runbook](#4-vercel--cloudflare-worker-runbook)
5. [Self-hosted VPS runbook](#5-self-hosted-vps-runbook)
6. [Docker runbook](#6-docker-runbook)
7. [GitHub Pages runbook](#7-github-pages-runbook)
8. [Netlify runbook](#8-netlify-runbook)
9. [Custom domain configuration](#9-custom-domain-configuration)
10. [Post-deploy verification](#10-post-deploy-verification)
11. [Rollback procedures](#11-rollback-procedures)
12. [CI/CD pipelines](#12-cicd-pipelines)
13. [Blue/green and canary deployments](#13-bluegreen-and-canary-deployments)
14. [Monitoring & alerting setup](#14-monitoring--alerting-setup)

---

## 1. Deployment decision matrix

Osler ships as a Next.js **static export** (`output: "export"` → `out/`) plus an **optional** Cloudflare Worker backend (accounts, cross-device sync, admin panel). Pick a host that matches your needs along the axes below.

### Decision matrix

| Host | Cost (free tier) | Complexity | Scalability | Stack | Custom domains | Edge functions | Best for |
|---|---|---|---|---|---|---|---|
| **Cloudflare Pages + Worker** | Free to ~$5/mo | Low | Auto (global edge) | Full-stack (FE + Worker + D1 + R2) | Yes (auto-TLS) | Yes (Workers) | Recommended default. Single-vendor full-stack. |
| **Vercel + Cloudflare Worker** | Free Hobby / $20 Pro | Low–Medium | Auto | Split (Vercel FE + CF Worker BE) | Yes (auto-TLS) | Yes (Edge / Serverless) | Teams already on Vercel; preview deploys per PR. |
| **Self-hosted VPS (Caddy)** | ~$5–10/mo | Medium–High | Vertical only | FE on VPS + Worker or local | Yes (Let's Encrypt) | No | Full control, on-prem, air-gapped, no vendor lock-in. |
| **Docker** | Host-dependent | Medium | Orchestrator-driven | Single image, anywhere | Via reverse proxy | No | Kubernetes / ECS / Nomad / on-prem clusters. |
| **GitHub Pages** | Free | Low | Static-only | Frontend-only (no cloud backend) | Yes (Let's Encrypt) | No | Open-source demo instances; personal study sites. |
| **Netlify** | Free Starter / $19 Pro | Low | Auto | Frontend-only by default; Functions optional | Yes (auto-TLS) | Yes (Functions) | Marketing-style sites; alternative to Vercel. |

### Choosing by feature need

| If you need… | Pick… |
|---|---|
| Accounts, sync, admin content management | Cloudflare Pages + Worker **or** Vercel + Worker **or** VPS + Worker |
| Pure offline PWA, no accounts | Any frontend-only host (Pages, Vercel, GH Pages, Netlify) with `cloud.enabled = false` |
| Per-PR preview deploys | Vercel (best DX) or Netlify |
| Maximum control + on-prem | Self-hosted VPS with Caddy |
| Container orchestration (k8s/ECS/Nomad) | Docker |
| Cheapest possible public demo | GitHub Pages (free, custom domain supported) |
| Cloudflare Zero Trust Access for admin | Cloudflare Pages + Worker (one-click integration) |
| Arabic-first PWA install with full RTL | Any host — RTL is content-driven, not host-driven |

### Free-tier limits to be aware of

| Vendor | Limit | Notes |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day | Cron triggers: 5 maximum. |
| Cloudflare D1 | 5 GB storage, 5M rows read/day | Covers ~500 active students easily. |
| Cloudflare R2 | 10 GB storage, 1M Class A ops/month | Plenty for content objects. |
| Cloudflare Pages | 500 builds/month, unlimited bandwidth | Hobby-tier generous. |
| Vercel (Hobby) | 100 GB bandwidth, 100 GB-Hours compute | Adequate for small instances. |
| Netlify (Starter) | 100 GB bandwidth, 300 build minutes/month | Similar to Vercel Hobby. |
| GitHub Pages | 100 GB bandwidth/month, 1 GB repo | Static-only. |
| Resend (free) | 100 emails/day, 3000/month | Enough for password resets. |

---

## 2. Pre-deploy checklist

Run through this checklist **every** time you deploy, whether it's the first deploy or the hundredth. Most production incidents come from skipping one of these.

### Code & content

- [ ] Local `npm run build` passes with no errors
- [ ] `npm run lint` reports no errors (warnings are tolerable but should be reviewed)
- [ ] `npx tsc --noEmit` passes (TypeScript strict mode)
- [ ] `npm run generate-manifests` has been run after any content change — `public/osler-content/*/manifest.json` reflects the current tree
- [ ] No `console.log` debug statements left in committed code (search for `console\.(log|debug)` before deploying)
- [ ] No hardcoded `localhost` URLs in `src/` (search for `localhost:3000` and `127.0.0.1`)
- [ ] No `TODO` / `FIXME` / `XXX` comments introduced in this deploy's diff

### Configuration

- [ ] `public/osler.config.json` validates against the schema in `src/lib/osler/config.ts`
- [ ] `site.name`, `site.shortName`, `site.githubRepo`, `site.organisation` all set correctly
- [ ] `engines.*` matches the engines you actually want enabled
- [ ] `cloud.enabled` matches your deployment choice (true if using Worker, false otherwise)
- [ ] `cloud.apiUrl` points at the production Worker URL (not the `*.workers.dev` dev subdomain if you've set up a custom domain)
- [ ] `themes.default` is a real theme id (built-in `dark`/`light` or one of your `themes.custom[].id`)
- [ ] `defaults.language.ui` is `"en"` or `"ar"` — never anything else
- [ ] `wizard.completed` is `true` for production (so end users don't see the setup wizard)

### Secrets & environment

- [ ] `JWT_SECRET` (Worker) is a fresh, long random string — generate with `openssl rand -base64 48`
- [ ] `ALLOWED_ORIGIN` (Worker) matches the exact frontend origin (scheme + host + port) — including `https://`
- [ ] If Google Sign-In enabled: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set as Worker secrets
- [ ] If password reset enabled: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN` set as Worker secrets
- [ ] If Turnstile enabled: `TURNSTILE_ENABLED="true"` and `TURNSTILE_SECRET_KEY` set
- [ ] `NEXT_PUBLIC_CLOUD_API_URL` (frontend) matches Worker URL — either set via host env vars or baked into `osler.config.json`
- [ ] `NEXT_PUBLIC_INVIDIOUS_HOST` set only if you want the privacy-friendly YouTube alternative (otherwise leave unset)
- [ ] **No** secrets committed to git — `.env`, `.env.local`, `cloudflare/worker/.dev.vars` all in `.gitignore`

### DNS & TLS

- [ ] DNS A/AAAA (or CNAME) record points at your host — propagated via `dig your-domain.com` or `nslookup`
- [ ] If using Cloudflare proxy (orange cloud): proxy is enabled, SSL mode is "Full (strict)"
- [ ] If self-hosted: ports 80 and 443 are open inbound; Caddy/nginx will auto-provision TLS via Let's Encrypt
- [ ] If using Cloudflare Pages/Vercel/Netlify: TLS auto-provisioned; no action needed

### Admin & first user

- [ ] First admin user has been promoted via D1 SQL (`UPDATE users SET role = 'admin' WHERE username = '...'`) — admin role is not granted at registration time
- [ ] If using Cloudflare Pages: Cloudflare Access policy gates `/admin*` (recommended)
- [ ] If self-hosted: `/admin` is reachable but ideally behind an IP allow-list or basic auth at the reverse proxy

### Backup & rollback plan

- [ ] **Before** the deploy: D1 database exported (`npx wrangler d1 export osler-cloud --remote --output=backup-YYYY-MM-DD.sql`)
- [ ] If self-hosted: `out/` from the previous working build is preserved (e.g. `/opt/osler.prev`)
- [ ] Previous deploy's git SHA recorded so you can roll back via `git reset --hard <sha>` if needed
- [ ] Maintenance communication plan ready (status page, Discord/Slack announcement) if this is a high-risk change

---

## 3. Cloudflare Pages + Worker runbook

This is the **recommended default**: one vendor for frontend, backend, database, and object storage. The free tier covers a small-to-medium medical school easily.

> **Frontend hosting note:** Osler ships as a Next.js **static export** (`output: "export"` → `out/`) deployed to **Cloudflare Pages** (`.pages.dev`). There is no server runtime, middleware, or `/api/*` route handlers. The browser talks directly to the Worker for any dynamic data. The repo is pre-configured — see Steps 6–7.

### Step 1: Provision Cloudflare resources

```bash
# 1. Sign in to Cloudflare, then:
cd cloudflare/worker
npm install

# 2. Create the D1 database
npx wrangler d1 create osler-cloud
# → Copy the returned database_id into wrangler.toml → [[d1_databases]]

# 3. (Optional) Create the R2 bucket for admin content management
npx wrangler r2 bucket create osler-content
```

### Step 2: Set Worker secrets

```bash
# Required: JWT signing secret
npx wrangler secret put JWT_SECRET
# → Paste: openssl rand -base64 48

# Required: CORS origin (your eventual frontend URL)
# Set this in wrangler.toml → [vars] ALLOWED_ORIGIN (see Step 4)

# Optional: Google Sign-In
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Optional: Password reset email
npx wrangler secret put RESEND_API_KEY

# Optional: Cloudflare Turnstile anti-bot
npx wrangler secret put TURNSTILE_SECRET_KEY
```

### Step 3: Apply D1 migrations

```bash
npm run db:migrate
# → Runs every .sql file in cloudflare/worker/migrations/ in order
```

Verify the schema:

```bash
npx wrangler d1 execute osler-cloud --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table';"
```

You should see `users`, `sessions`, `oauth_states`, `reset_tokens`, `admin_audit`, and any future tables added by migrations.

### Step 4: Configure `wrangler.toml`

```toml
name = "osler-cloud"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[vars]
ALLOWED_ORIGIN    = "https://your-app.pages.dev"   # update to custom domain later
WORKER_URL        = "https://osler-cloud.<your-subdomain>.workers.dev"
APP_ORIGIN        = "https://your-app.pages.dev"   # used in password-reset email links
TURNSTILE_ENABLED = "false"                         # set "true" after Turnstile setup
EMAIL_FROM        = "Osler <no-reply@your-domain>"  # if Resend configured

[[d1_databases]]
binding       = "DB"
database_name = "osler-cloud"
database_id   = "<paste-from-step-1>"

[[r2_buckets]]
binding       = "CONTENT"
bucket_name   = "osler-content"

[triggers]
crons = ["0 * * * *"]   # hourly cleanup of expired sessions/tokens/audit logs
```

### Step 5: Deploy the Worker

```bash
npm run deploy
# → Wrangler uploads the worker; prints https://osler-cloud.<your-subdomain>.workers.dev
```

Verify:

```bash
curl https://osler-cloud.<your-subdomain>.workers.dev/v1/health
# → {"ok":true,"version":"...","time":...}
```

### Step 6: Deploy the frontend to Cloudflare Pages

Osler is a **Next.js static export** (`output: "export"` → `out/`). There is no server runtime, no middleware, and no `/api/*` route handlers — the Pages site is pure static HTML/JS that talks directly to the Worker. This is pre-configured in the repo:

- `next.config.ts` — `output: "export"`, `trailingSlash: true`, `images.unoptimized: true`
- `public/_headers` — security + cache headers for static assets, fonts, content, SW, manifest
- `src/sw.ts` + `scripts/build-sw.js` — the service worker is built separately (esbuild) to `public/sw.js`

There is **no `public/_redirects`** — the app has no dynamic path-segment routes. Pack/reader/settings/admin detail navigation uses query params (`/qbank?uid=<pack>`, `/admin/content?id=<uuid>`, …) on real static files, so no SPA-fallback rewrite is needed (see `docs/cloudflare-static-worker.md` § Dynamic content).

```bash
# From the repo root:
npm install
npm run build
# → node scripts/build-sw.js && next build
# → Output: out/  (Next.js static export)
npm run deploy:pages
# → wrangler pages deploy out --project-name osler
# → prints https://osler-web.<your-subdomain>.pages.dev
```

To preview locally:

```bash
npm run preview:pages
# → wrangler pages dev out --port 3000
```

The full architecture + deployment guide lives in [`cloudflare-static-worker.md`](./cloudflare-static-worker.md).

### Step 7: Wire the frontend to the Worker

The frontend resolves the backend URL from `NEXT_PUBLIC_CLOUD_API_URL` (baked at build time) first, then falls back to `public/osler.config.json` → `cloud.apiUrl`. Pick one:

**Option A — build-time env (recommended for CI):** set `NEXT_PUBLIC_CLOUD_API_URL` to the Worker URL when building, e.g. as a GitHub secret consumed by the CI workflow in §12.

**Option B — config file:** edit `public/osler.config.json`:

```jsonc
"cloud": {
  "enabled": true,
  "apiUrl": "https://osler-cloud.<your-subdomain>.workers.dev",
  "syncQbank": true,
  "syncFlashcards": true
}
```

If you edit `osler.config.json`, commit and let CI rebuild on push.

### Step 8: Promote your first admin user

```bash
# Sign up via the UI at least once, then:
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE users SET role = 'admin' WHERE username = '<your-username>';"
```

Sign in at `https://your-app.pages.dev/admin`.

### Step 9: (Recommended) Put the admin panel behind Cloudflare Access

The admin shell fetches `GET /v1/admin/access` from the Worker, which reads the `CF-Access-Authenticated-User-Email` header (set by Cloudflare Zero Trust Access) and refuses to render in production if the header is missing.

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add Application → **Self-hosted**
2. Add two hostnames to the same Access app:
   - `your-app.pages.dev` with path `/admin*`
   - `your-worker.workers.dev` with path `/v1/admin/*`
3. Identity provider: Email OTP / Google Workspace / Okta / etc.
4. Save

Visiting `/admin` will now require Cloudflare Access authentication before reaching the app.

### Step 10: Smoke-test

Jump to [§10 Post-deploy verification](#10-post-deploy-verification) and run through the checklist before declaring victory.

---

## 4. Vercel + Cloudflare Worker runbook

Use this option if you want Vercel's superior Next.js DX (preview deployments per PR, edge functions, analytics) but keep the Cloudflare Worker for the account backend.

### Step 1: Deploy the Worker

Follow [§3 Steps 1–5](#3-cloudflare-pages--worker-runbook) exactly. The Worker setup is identical.

### Step 2: Provision the frontend on Vercel

1. Push your fork to GitHub.
2. Vercel dashboard → New Project → import the repo.
3. Framework preset: **Next.js**
4. Build command: `npm run build` (leave output default — Vercel auto-detects Next.js standalone)
5. Environment variables (Project Settings → Environment Variables):
   - `NEXT_PUBLIC_CLOUD_API_URL` = `https://osler-cloud.<your-subdomain>.workers.dev` (Production + Preview + Development)
   - `NEXT_PUBLIC_INVIDIOUS_HOST` (optional)
6. Deploy

### Step 3: Update Worker CORS for Vercel

Edit `cloudflare/worker/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "https://your-app.vercel.app"
APP_ORIGIN     = "https://your-app.vercel.app"
```

Then redeploy the Worker:

```bash
cd cloudflare/worker
npm run deploy
```

### Step 4: (Optional) Custom domain on Vercel

1. Vercel dashboard → your project → Settings → Domains → Add
2. Follow Vercel's DNS instructions (typically an A record or CNAME)
3. Update Worker `ALLOWED_ORIGIN` and `APP_ORIGIN` to your custom domain, redeploy Worker

> **Note on preview deploys:** Vercel preview deploys have unique URLs (`your-app-git-feature-username.vercel.app`). The Worker's CORS only allows a single `ALLOWED_ORIGIN`, so preview deployments will not be able to reach the production Worker. Options:
>
> - Use the production URL for testing the cloud backend
> - Set up a separate preview Worker per branch with its own `ALLOWED_ORIGIN`
> - Add a comma-separated allow-list by editing the Worker's CORS handler in `src/index.ts`

### Step 5: Smoke-test

See [§10](#10-post-deploy-verification).

---

## 5. Self-hosted VPS runbook

For maximum control, run on your own VPS. Caddy handles TLS automatically via Let's Encrypt. This runbook assumes Ubuntu 22.04+ but works on any modern Linux.

### Step 1: Provision the server

Pick a provider — Hetzner (best price/perf in EU), DigitalOcean, AWS EC2, Linode/Akamai, Vultr, or your own metal.

| Provider | Minimum spec | Approx monthly cost | Notes |
|---|---|---|---|
| Hetzner Cloud | CX22 (2 vCPU, 4 GB) | ~€4 | Best value; EU regions |
| DigitalOcean | Basic $6 droplet (1 vCPU, 1 GB) | $6 | 1 GB RAM is tight — pick 2 GB if running Worker-less |
| AWS EC2 | t3.micro (2 vCPU, 1 GB) | ~$10 | Free tier for 12 months |
| Linode/Akamai | Nanode 1 GB | $5 | Solid network |
| Vultr | Regular Cloud Compute 1 GB | $5 | Similar to DO |

```bash
# On a fresh Ubuntu 22.04+ VPS, as root or sudo-capable user:
sudo apt update && sudo apt install -y curl ca-certificates caddy

# Install Node 22 via nvm (recommended over apt's older Node)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm use 22 && nvm alias default 22
node -v   # should print v22.x.x
```

### Step 2: Create a dedicated user

```bash
sudo useradd -r -m -s /bin/bash osler
sudo usermod -aG sudo osler   # only if you want sudo; otherwise skip
```

### Step 3: Clone and build

```bash
sudo mkdir -p /opt/osler
sudo chown osler:osler /opt/osler
sudo -u osler bash -c '
  cd /opt/osler
  git clone https://github.com/<your-username>/osler.git .
  npm ci
  npm run generate-manifests
  npm run build
'
# Output: /opt/osler/out/  (Next.js static export)
```

### Step 4: Configure `osler.config.json`

```bash
sudo -u osler nano /opt/osler/public/osler.config.json
# Set site.*, engines.*, cloud.enabled, cloud.apiUrl, themes, defaults
```

If running with the Cloudflare Worker backend, set `cloud.enabled = true` and `cloud.apiUrl = "https://osler-cloud.<your-subdomain>.workers.dev"`. If running fully offline, set `cloud.enabled = false`.

### Step 5: Serve the static export

Osler is a static export — there is no Node server process. Serve the `out/` directory directly with `npx serve` behind a systemd service.

Create `/etc/systemd/system/osler.service`:

```ini
[Unit]
Description=Osler static export server
After=network.target

[Service]
Type=simple
User=osler
Group=osler
WorkingDirectory=/opt/osler
Environment=NEXT_PUBLIC_CLOUD_API_URL=https://osler-cloud.example.workers.dev
ExecStart=/usr/bin/npx --yes serve /opt/osler/out -l 3000
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/osler
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
LockPersonality=true
RestrictRealtime=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now osler
sudo systemctl status osler
sudo journalctl -u osler -f --no-pager   # tail logs
```

### Step 6: Configure Caddy

Create `/etc/caddy/Caddyfile` (replaces the default):

```caddyfile
your-domain.com {
    encode gzip zstd
    root * /opt/osler/out
    file_server

    # SPA fallback so client-side routes (/qbank/<uid>, /admin/content/<id>, …) resolve
    try_files {path} {path}/ /index.html

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Cross-Origin-Opener-Policy same-origin
        Cross-Origin-Resource-Policy same-origin
        Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self' https://osler-cloud.example.workers.dev; manifest-src 'self'"
    }

    # Gzip + brotli already handled by `encode` above; this is just logging
    log {
        output file /var/log/caddy/osler.log
        format json
    }
}
```

> Adjust the `connect-src` directive in the CSP to include your Worker URL (and Google Fonts, Gemini API, etc. if needed). The example above is the strictest baseline.

```bash
sudo systemctl reload caddy
sudo systemctl status caddy
```

Caddy will auto-provision a Let's Encrypt TLS certificate on first request. Verify:

```bash
curl -I https://your-domain.com
# Should return 200 with headers including strict-transport-security
```

### Step 7: Backend (Worker or local SQLite)

Two choices:

1. **Cloudflare Worker** — same as [§3 Steps 1–5](#3-cloudflare-pages--worker-runbook). Point `ALLOWED_ORIGIN` to your VPS domain (`https://your-domain.com`).
2. **No backend** — set `cloud.enabled = false` in `osler.config.json`. The app runs entirely offline; no accounts, no sync, no admin panel.

> A local SQLite-backed Worker-compatible shim is **not** currently shipped. If you need on-prem accounts without Cloudflare, you'll need to fork the Worker into a Node.js service — see [`forking.md`](./forking.md) §7 for extension points.

### Step 8: Updating

```bash
# 1. Backup current build
sudo cp -a /opt/osler /opt/osler.prev

# 2. Pull and rebuild
cd /opt/osler
sudo -u osler git pull
sudo -u osler npm ci
sudo -u osler npm run build

# 3. Restart
sudo systemctl restart osler

# 4. Verify
curl -I https://your-domain.com
sudo journalctl -u osler -f --no-pager

# 5. If broken, roll back
sudo systemctl stop osler
sudo rm -rf /opt/osler
sudo mv /opt/osler.prev /opt/osler
sudo systemctl start osler
```

### Step 9: Smoke-test

See [§10](#10-post-deploy-verification).

---

## 6. Docker runbook

A single Docker image that runs anywhere — k8s, ECS, Nomad, local Docker, Podman. Below is the canonical Dockerfile, a docker-compose for local dev, and notes on container registries.

### Step 1: Create the Dockerfile

Save as `Dockerfile` in the repo root (already shipped with the repo, but reproduced here for clarity):

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install deps first (cached layer)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run generate-manifests
RUN npm run build

# --- Runtime stage ---
FROM nginx:1.27-alpine AS runner
WORKDIR /usr/share/nginx/html

# Copy static export
COPY --from=builder --chown=nginx:nginx /app/out ./
COPY --from=builder --chown=nginx:nginx /app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

`nginx.conf` (serves the static export — no dynamic path-segment routes, so no rewrite config is needed):

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ $uri/index.html /index.html;
    }

    location /_next/static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Step 2: Build and run locally

```bash
docker build -t osler:latest .

docker run -d \
  --name osler \
  -p 3000:80 \
  -e NEXT_PUBLIC_CLOUD_API_URL=https://osler-cloud.example.workers.dev \
  -e NEXT_PUBLIC_INVIDIOUS_HOST= \
  --restart unless-stopped \
  osler:latest

docker logs -f osler
# → nginx: ready
```

### Step 3: docker-compose with Caddy as TLS terminator

`docker-compose.yml`:

```yaml
services:
  osler:
    build: .
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_CLOUD_API_URL: https://osler-cloud.example.workers.dev
    expose:
      - "80"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - osler

volumes:
  caddy_data:
  caddy_config:
```

`Caddyfile` (alongside `docker-compose.yml`):

```caddyfile
your-domain.com {
    reverse_proxy osler:80
    encode gzip zstd
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

```bash
docker compose up -d
docker compose logs -f
```

### Step 4: Container registry options

| Registry | Free tier | Auth | Use if… |
|---|---|---|---|
| **GitHub Container Registry (ghcr.io)** | 500 MB private, unlimited public | GitHub PAT or `${{ secrets.GITHUB_TOKEN }}` in Actions | Your repo is on GitHub; want simplest CI integration |
| **Docker Hub** | 1 private repo, unlimited public | Docker ID | You want maximum public visibility |
| **Amazon ECR** | Pay per GB stored + data transfer | AWS IAM | You're deploying to ECS/EKS |
| **Google Artifact Registry** | 0.5 GB free/month, then pay-per-use | gcloud auth | You're deploying to GKE/Cloud Run |
| **Cloudflare Container Registry** | Beta — free during beta | Cloudflare API token | You're already on Cloudflare |

Push to ghcr.io:

```bash
echo "$CR_PAT" | docker login ghcr.io -u <your-username> --password-stdin
docker tag osler:latest ghcr.io/<your-username>/osler:latest
docker tag osler:latest ghcr.io/<your-username>/osler:$(git rev-parse --short HEAD)
docker push ghcr.io/<your-username>/osler:latest
docker push ghcr.io/<your-username>/osler:$(git rev-parse --short HEAD)
```

### Step 5: Kubernetes deployment

A minimal k8s manifest (save as `k8s.yaml`):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: osler
  labels:
    app: osler
spec:
  replicas: 3
  selector:
    matchLabels:
      app: osler
  template:
    metadata:
      labels:
        app: osler
    spec:
      containers:
        - name: osler
          image: ghcr.io/<your-username>/osler:latest
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: production
            - name: NEXT_PUBLIC_CLOUD_API_URL
              value: https://osler-cloud.example.workers.dev
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: osler
spec:
  selector:
    app: osler
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: osler
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts: [your-domain.com]
      secretName: osler-tls
  rules:
    - host: your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: osler
                port:
                  number: 80
```

```bash
kubectl apply -f k8s.yaml
kubectl rollout status deployment/osler
```

### Step 6: Smoke-test

See [§10](#10-post-deploy-verification).

---

## 7. GitHub Pages runbook

GitHub Pages is **static-only** — there's no Next.js server process, no Cloudflare Worker. Use this only if you want a pure offline PWA (no accounts, no sync, no admin panel).

> **Prerequisite:** Set `cloud.enabled = false` in `public/osler.config.json` before building. The admin panel and `/admin` route will return 404 — that's expected.

### Step 1: Configure Next.js for static export

Osler's `next.config.ts` already uses `output: "export"`. For GitHub Pages you only need to add a `basePath` matching your repo name (if deploying to `https://<user>.github.io/<repo>`).

Create `next.config.gh-pages.ts` (do not modify the main `next.config.ts`):

```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  output: "export",
  basePath: "/osler",                 // your repo name; omit if deploying to <user>.github.io root
  assetPrefix: "/osler/",
  images: { unoptimized: true },
  trailingSlash: true,
};
export default config;
```

> If your Pages site is at the root domain (`<user>.github.io`), omit `basePath` and `assetPrefix`.

### Step 2: Build and verify locally

```bash
npx next build -c next.config.gh-pages.ts
# → outputs ./out/

# Preview locally (must serve from /osler/ to match basePath):
npx serve -s out -l 3000
# Visit http://localhost:3000/osler/
```

### Step 3: GitHub Actions workflow

Create `.github/workflows/deploy-gh-pages.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run generate-manifests

      - name: Build (static export)
        run: npx next build -c next.config.gh-pages.ts

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./out

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Step 4: Enable GitHub Pages

1. Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**
2. Push to `main` — the workflow will build and deploy
3. Wait for the action to complete; your site will be live at `https://<user>.github.io/osler/`

### Step 5: Custom domain

1. Repo → Settings → Pages → Custom domain → enter `your-domain.com`
2. DNS: add an `A` record pointing at GitHub's Pages IPs (185.199.108–111.153) or an `ALIAS`/`CNAME` to `<user>.github.io.`
3. Tick "Enforce HTTPS" once the certificate is provisioned (~15 minutes)
4. If using a subdomain (`osler.your-domain.com`), use a CNAME record instead

### Step 6: Smoke-test

See [§10](#10-post-deploy-verification) — skip the cloud-backend and admin checks.

---

## 8. Netlify runbook

Netlify is similar to Vercel — best-in-class DX, per-PR preview deploys. Like GitHub Pages, this runbook assumes you're deploying the frontend only (the Worker stays on Cloudflare).

### Step 1: Deploy the Worker

Follow [§3 Steps 1–5](#3-cloudflare-pages--worker-runbook) to deploy the Cloudflare Worker. Update `ALLOWED_ORIGIN` to your eventual Netlify URL.

### Step 2: Connect repo to Netlify

1. Netlify dashboard → Add new site → Import an existing project → GitHub
2. Pick your fork of `osler`
3. Build settings:
   - Base directory: (leave empty)
   - Build command: `npm run build`
   - Publish directory: `out`
4. Environment variables:
   - `NEXT_PUBLIC_CLOUD_API_URL` = `https://osler-cloud.<your-subdomain>.workers.dev`
   - `NEXT_PUBLIC_INVIDIOUS_HOST` (optional)
5. Deploy site

### Step 3: `netlify.toml` (optional but recommended)

For repeatable builds, commit a `netlify.toml` at the repo root:

```toml
[build]
  command = "npm run build"
  publish = "out"

[build.environment]
  NODE_VERSION = "22"
  NEXT_PUBLIC_CLOUD_API_URL = "https://osler-cloud.example.workers.dev"
```

> Netlify serves the static export directly. The app has no dynamic path-segment routes (navigation uses query params on real static files), so no `_redirects` fallback is needed.

### Step 4: Custom domain

1. Netlify dashboard → your site → Domain management → Add custom domain
2. Follow Netlify's DNS instructions (typically CNAME to `<random>--<site>.netlify.app` or A record to Netlify's load balancer)
3. TLS auto-provisioned via Let's Encrypt
4. Update Worker `ALLOWED_ORIGIN` and `APP_ORIGIN` to your custom domain, redeploy Worker

### Step 5: Smoke-test

See [§10](#10-post-deploy-verification).

---

## 9. Custom domain configuration

### DNS records summary

| Host | Record type | Value | TTL |
|---|---|---|---|
| Cloudflare Pages | `CNAME` or `ALIAS` | `<project>.pages.dev` | Auto |
| Vercel | `A` (root) / `CNAME` (subdomain) | `76.76.21.21` (root) or `cname.vercel-dns.com` | Auto |
| Netlify | `CNAME` or `ALIAS` | `<random>.netlify.app` | Auto |
| GitHub Pages (root) | `A` | `185.199.108.153` (×4: 108–111) | 3600 |
| GitHub Pages (subdomain) | `CNAME` | `<user>.github.io.` | 3600 |
| Self-hosted VPS | `A` (IPv4) / `AAAA` (IPv6) | your server's IP | 3600 |

### TLS options

| Host | TLS provider | Renewal | Notes |
|---|---|---|---|
| Cloudflare Pages | Cloudflare Universal SSL | Auto | Edge certificate; also offers "Advanced Certificate Manager" for custom settings |
| Vercel | Vercel (Let's Encrypt) | Auto | Wildcard on *.vercel.app; custom domains auto-cert |
| Netlify | Let's Encrypt via Netlify | Auto | One click in dashboard |
| GitHub Pages | Let's Encrypt via GitHub | Auto | Enforce HTTPS toggle in Pages settings |
| Self-hosted VPS (Caddy) | Let's Encrypt | Auto (Caddy) | Set `tls { ... }` block for advanced config |
| Self-hosted VPS (nginx) | Let's Encrypt via Certbot | Auto (certbot timer) | `sudo certbot --nginx -d your-domain.com` |

### Cloudflare proxy (orange cloud): pros and cons

If your DNS is hosted on Cloudflare, the "orange cloud" toggle enables Cloudflare's CDN + DDoS protection. This applies whether the origin is Pages, Vercel, Netlify, your VPS, or anywhere else.

| Pros | Cons |
|---|---|
| Free CDN caching at 300+ edge locations | Adds ~10–50ms RTT for non-cacheable responses ( Worker requests, dynamic API calls ) |
| Free DDoS protection | Some HTTP/2 push / Server-Sent Events features may need configuration |
| Free WAF rules (5 on free tier) | Real client IP requires `cf-connecting-ip` header (already handled by Caddy config in §5) |
| Free "Under Attack" mode for surge events | WebSocket support requires explicit enabling (not used by Osler's sync system, which uses WebRTC + MQTT relay) |
| Page rules for redirects/rewrites | TLS mode must be "Full (strict)" — "Flexible" mode is broken (it loops HTTP from CF to origin) |

**Recommended:** enable the orange cloud for the apex domain and any subdomains serving static content. For your Cloudflare Worker subdomain (`osler-cloud.<sub>.workers.dev`), Cloudflare already proxies it — no DNS configuration needed.

### HSTS preload

Once you've confirmed your site works on HTTPS only, submit it to <https://hstspreload.org>:

1. Verify your TLS config scores A+ on <https://www.ssllabs.com/ssltest/analyze.html?d=your-domain.com>
2. Ensure Caddy/nginx sends `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (the Caddy config in §5 already does)
3. Submit at <https://hstspreload.org>
4. Wait ~1–12 weeks for browser inclusion

> ⚠️ Preloading is **irreversible** for at least a year. Test thoroughly first. Do not preload a domain you might want to serve over HTTP for any reason.

---

## 10. Post-deploy verification

After every deploy, run through this checklist. Most issues are caught here.

### Frontend smoke tests

- [ ] `curl -I https://your-domain.com/` returns `200 OK` with `content-type: text/html`
- [ ] Visit `https://your-domain.com/` in a fresh browser (incognito) — page loads, no console errors
- [ ] Visit `https://your-domain.com/manifest.webmanifest` — returns valid JSON with your `site.name`
- [ ] Open DevTools → Application → Service Workers — `sw.js` is registered and active
- [ ] Open DevTools → Application → Installability — no missing PWA criteria
- [ ] Lighthouse PWA audit passes (Chrome DevTools → Lighthouse → PWA category)
- [ ] Toggle UI language EN ↔ AR — entire UI flips including direction (no LTR flash, no missing strings)
- [ ] Toggle theme Dark ↔ Light — both look correct, no color contrast issues
- [ ] Navigate to each enabled engine's hub (Dashboard → Learn → QBank/Flashcards/OSCE/Library/Videos) — content loads

### Cloud backend smoke tests (if `cloud.enabled = true`)

- [ ] `curl https://<worker-domain>/v1/health` returns `{"ok":true, ...}`
- [ ] Register a test account from the UI
- [ ] Login → logout → login again — session persists
- [ ] Settings → Sync → "Synced" status appears within ~10 seconds
- [ ] Settings → Sync → "Synced" status appears within ~10 seconds
- [ ] (If Google Sign-In enabled) Sign in with Google → reaches OAuth consent → returns to app logged in
- [ ] (If Turnstile enabled) Challenge widget appears on register/login screens

### Admin panel smoke tests (if admin user promoted)

- [ ] Visit `https://your-domain/admin` — login prompt or Cloudflare Access screen appears
- [ ] Sign in — admin shell loads with sidebar nav
- [ ] Dashboard shows real stats (user count, content count)
- [ ] Users tab lists registered users; roles display correctly
- [ ] Content tab shows the content tree from R2 (or empty state if no admin content yet)
- [ ] Audit tab loads — any admin actions already taken appear

### Security checks

- [ ] `curl -I https://your-domain.com/` includes `strict-transport-security` header
- [ ] `curl -I https://your-domain.com/` includes `x-content-type-options: nosniff`
- [ ] `curl -I https://your-domain.com/` includes `x-frame-options: DENY` (or equivalent CSP `frame-ancestors 'none'`)
- [ ] `curl -I https://your-domain.com/` includes `referrer-policy: strict-origin-when-cross-origin`
- [ ] Visit `https://your-domain.com/api/route` — returns expected response (or 404 in production)
- [ ] Visit `https://your-domain.com/.env` — returns 404, NOT the file contents
- [ ] Visit `https://your-domain.com/.git/config` — returns 404
- [ ] `npx ssllabs-cli analyze --host your-domain.com` (or web version) — score A or A+
- [ ] If Cloudflare proxy enabled: SSL/TLS mode is "Full (strict)", not "Flexible"

### Performance checks

- [ ] Lighthouse Performance score ≥ 80 on mobile (initial load)
- [ ] First Contentful Paint < 2.0s on a throttled 3G connection
- [ ] No requests to `localhost` or `.onion` domains in DevTools Network tab
- [ ] Static assets gzipped/brotlied (response headers include `content-encoding: gzip` or `br`)
- [ ] Fonts served with `cache-control: public, max-age=31536000, immutable`

### Functional smoke test (manual)

Pick one workflow per engine and complete it end-to-end:

- [ ] **Quiz:** Dashboard → QBank → Create Test → answer 5 questions → submit → results dashboard loads
- [ ] **Bank:** Dashboard → QBank → pick a passage-based pack → complete → results
- [ ] **Flashcard:** Learn → Flashcards → pick a deck → flip 3 cards → mark one as "Again"
- [ ] **OSCE:** Learn → OSCE → pick a scenario → start a 1-minute session → exit
- [ ] **Library:** Learn → Library → open an article → highlight a sentence → add a sticky note → close
- [ ] **Video:** Learn → Videos → open a folder → play a video for 10 seconds → exit
- [ ] **PDF export:** QBank → results → Export PDF → downloads a valid `.pdf` (open in a PDF reader to confirm)

If any of these fail, see [`troubleshooting.md`](./troubleshooting.md).

---

## 11. Rollback procedures

Rollbacks are host-specific. The general principle: **preserve the previous working build before deploying the new one**, so rolling back is a config change, not a rebuild.

### Cloudflare

```bash
# Backend Worker (osler-cloud)
cd cloudflare/worker
npx wrangler deployments list
npx wrangler rollback <version-id>
```

Frontend rollback for Cloudflare Pages is done via the dashboard (Deployments → ⋮ → "Rollback to this deployment") or the Cloudflare API.

### Vercel

```bash
# 1. List deployments
vercel ls

# 2. Promote a previous deployment to production (instant)
vercel promote <deployment-url>
```

Or via dashboard: Project → Deployments → ⋮ on the previous working deployment → "Promote to Production".

### Netlify

Via dashboard only: Site → Deploys → find the previous working deploy → "Publish deploy".

### Self-hosted VPS

See [§5 Step 8](#step-8-updating) — the `/opt/osler.prev` directory preserves the previous build. To roll back:

```bash
sudo systemctl stop osler
sudo rm -rf /opt/osler
sudo mv /opt/osler.prev /opt/osler
sudo systemctl start osler
curl -I https://your-domain.com    # verify
```

If you also need to roll back the database (rare; only for broken migrations), restore from the pre-deploy D1 backup:

```bash
npx wrangler d1 execute osler-cloud --remote --file=backup-YYYY-MM-DD.sql
```

### Docker / Kubernetes

```bash
# Docker — pull previous image tag
docker stop osler
docker rm osler
docker pull ghcr.io/<your-username>/osler:<previous-sha>
docker run -d --name osler -p 3000:3000 ... ghcr.io/<your-username>/osler:<previous-sha>
```

```bash
# Kubernetes — roll back the last rollout
kubectl rollout undo deployment/osler
kubectl rollout status deployment/osler
```

### Git-based rollback (all hosts)

If the deploy was triggered by a bad commit, the cleanest rollback is to revert the commit and let your CI redeploy:

```bash
git revert <bad-commit-sha>
git push origin main
# CI auto-deploys the revert
```

### Database rollback — important caveats

- **D1 migrations are forward-only.** Never edit existing migration files. If a migration broke something, write a new migration that undoes it (e.g. `0006_revert_0005.sql`).
- **IndexedDB on user devices cannot be rolled back.** If a frontend change corrupted local progress, users will need to either restore from a `.osler-backup` file or clear IndexedDB.
- **Cloud sync:** if the Worker rolled out a new sync protocol version, old clients may fail to sync until they reload and pick up the new frontend. Communicate maintenance windows in advance.

---

## 12. CI/CD pipelines

Below are reference GitHub Actions workflows for each host. They are intentionally minimal — extend with caching, Slack notifications, and approval gates as your team needs.

### Cloudflare Pages + Worker — `.github/workflows/deploy-cloudflare.yml`

A working workflow ships in the repo (deploys both the backend `osler-cloud` Worker and the static export `out/` to Cloudflare Pages on every push to `main`). Required GitHub repo secrets:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **Edit Cloudflare Workers** + **Edit Cloudflare Pages** permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CF_JWT_SECRET` | Backend Worker HMAC signing secret (`openssl rand -base64 48`) |
| `CF_WORKER_URL` | Backend Worker URL, e.g. `https://osler-cloud.<sub>.workers.dev` — also baked as `NEXT_PUBLIC_CLOUD_API_URL` |
| `CF_ALLOWED_ORIGIN` | Frontend origin, e.g. `https://osler-web.<sub>.pages.dev` |

Reference shape:

```yaml
name: Deploy to Cloudflare

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy-worker:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: cloudflare/worker
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run db:migrate
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: npx wrangler deploy --var ALLOWED_ORIGIN:${{ secrets.CF_ALLOWED_ORIGIN }} --var WORKER_URL:${{ secrets.CF_WORKER_URL }}
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-frontend:
    needs: deploy-worker
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run generate-manifests
      - run: npm run build
        env:
          NEXT_PUBLIC_CLOUD_API_URL: ${{ secrets.CF_WORKER_URL }}
      - run: npx wrangler pages deploy out --project-name osler
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### Vercel — `.github/workflows/deploy-vercel.yml`

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - name: Install Vercel CLI
        run: npm i -g vercel@latest
      - name: Pull Vercel env
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      - name: Build
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          NEXT_PUBLIC_CLOUD_API_URL: ${{ secrets.CF_WORKER_URL }}
      - name: Deploy
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

> **Simpler alternative:** Connect the repo directly in Vercel's dashboard and skip this workflow entirely. Vercel will auto-deploy on every push to `main`.

### Self-hosted VPS — `.github/workflows/deploy-vps.yml`

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: SSH deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            set -euo pipefail
            cd /opt/osler
            cp -a . /opt/osler.prev
            git pull
            npm ci
            npm run generate-manifests
            npm run build
            sudo systemctl restart osler
            sleep 5
            curl -fsS https://your-domain.com/ | grep -q "<title>" || (echo "Smoke test failed" && exit 1)
```

### Docker — `.github/workflows/deploy-docker.yml`

```yaml
name: Build and push Docker image

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=sha-
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### GitHub Pages — `.github/workflows/deploy-gh-pages.yml`

See [§7 Step 3](#step-3-github-actions-workflow).

### Netlify — `.github/workflows/deploy-netlify.yml`

```yaml
name: Deploy to Netlify

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
        env:
          NEXT_PUBLIC_CLOUD_API_URL: ${{ secrets.CF_WORKER_URL }}
      - name: Deploy to Netlify
        uses: nwtgck/actions-netlify@v3
        with:
          publish-dir: 'out'
          production-deploy: true
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

---

## 13. Blue/green and canary deployments

These patterns are primarily for **self-hosted VPS** and **Docker/Kubernetes** deployments, where you control the load balancer. The managed hosts (Cloudflare Pages, Vercel, Netlify) have their own preview/rollback UX that achieves similar goals.

### Blue/green deployment

Run two production environments ("blue" = current, "green" = new). Switch traffic atomically. If green breaks, switch back instantly.

```
                 ┌──────────┐
                 │  Caddy   │
                 │   LB     │
                 └─────┬────┘
            ┌──────────┴──────────┐
       ┌────▼────┐           ┌────▼────┐
       │  Blue   │           │  Green  │
       │ :3000   │           │ :3001   │
       │ (live)  │           │ (idle)  │
       └─────────┘           └─────────┘
```

**Setup (self-hosted):**

```bash
# Two systemd units
sudo cp /etc/systemd/system/osler.service /etc/systemd/system/osler-blue.service
sudo cp /etc/systemd/system/osler.service /etc/systemd/system/osler-green.service
# Edit osler-blue.service: Environment=PORT=3000
# Edit osler-green.service: Environment=PORT=3001
sudo systemctl daemon-reload
sudo systemctl enable --now osler-blue osler-green
```

**Caddyfile with blue/green switch:**

```caddyfile
your-domain.com {
    # Active upstream — change this line to flip
    reverse_proxy 127.0.0.1:3000   # blue
    # reverse_proxy 127.0.0.1:3001 # green

    encode gzip zstd
    header { /* security headers */ }
}
```

**Deploy script** (`/opt/osler/deploy-blue-green.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail

# Determine which is currently live
LIVE_PORT=$(grep -E '^\s*reverse_proxy 127.0.0.1' /etc/caddy/Caddyfile | head -1 | grep -oE ':[0-9]+' | tr -d ':')

if [ "$LIVE_PORT" = "3000" ]; then
  TARGET=green; TARGET_PORT=3001
else
  TARGET=blue; TARGET_PORT=3000
fi

echo "Deploying to $TARGET (port $TARGET_PORT)"

# 1. Pull latest code
cd /opt/osler-$TARGET
git pull
npm ci
npm run build

# 2. Restart the target instance
sudo systemctl restart osler-$TARGET

# 3. Wait for it to come up
for i in {1..30}; do
  curl -fsS "http://127.0.0.1:$TARGET_PORT/" >/dev/null && break
  sleep 1
done

# 4. Flip Caddy to the target
sudo sed -i "s/reverse_proxy 127.0.0.1:[0-9]\+/reverse_proxy 127.0.0.1:$TARGET_PORT/" /etc/caddy/Caddyfile
sudo systemctl reload caddy

# 5. Smoke test
curl -fsS https://your-domain.com/ | grep -q "<title>" || {
  echo "Smoke test failed! Rolling back…"
  sudo sed -i "s/reverse_proxy 127.0.0.1:[0-9]\+/reverse_proxy 127.0.0.1:$LIVE_PORT/" /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  exit 1
}

echo "Now serving from $TARGET (port $TARGET_PORT). Old instance ($LIVE_PORT) kept warm for rollback."
```

### Canary deployment

Gradually shift traffic to the new version. If metrics degrade, halt the canary.

**Caddyfile with weighted load balancing:**

```caddyfile
your-domain.com {
    # 90% to stable, 10% to canary — adjust to shift traffic
    reverse_proxy 127.0.0.1:3000 127.0.0.1:3001 {
        lb_policy weighted_round_robin 90 10
        health_uri /  health_interval 10s
    }
    encode gzip zstd
}
```

**Canary progression schedule:**

| Step | Stable : Canary | Duration | Watch for |
|---|---|---|---|
| 1 | 99 : 1 | 30 min | Error rate, latency p99 |
| 2 | 95 : 5 | 1 hour | Error rate, latency p99, user feedback |
| 3 | 90 : 10 | 2 hours | Same |
| 4 | 75 : 25 | 4 hours | Same |
| 5 | 50 : 50 | 4 hours | Same |
| 6 | 0 : 100 | — | Promote canary to stable; tear down old |

If any step shows error rate > 1% or p99 latency > 2× baseline, halt and roll back to 100 : 0.

### Kubernetes rolling updates with canary

For k8s, use an Istio / Linkerd / Nginx Ingress traffic split, or `kubectl set image` with a `maxSurge`/`maxUnavailable` strategy:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: osler }
spec:
  replicas: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2          # 2 extra pods during rollout
      maxUnavailable: 0    # never go below 10 ready pods
  # …
```

For finer canary control, use Argo Rollouts or Flagger — both support metric-based progressive delivery.

### Notes on managed hosts

- **Cloudflare Pages** has built-in "non-production branch deploys" that act like canaries (each PR gets its own URL). Use Cloudflare Access to gate them.
- **Vercel** has "Deployment Promotion" — promote a preview deployment to production with one click.
- **Netlify** has "Branch deploys" and "Deploy Previews" — same idea.

These achieve the safety of blue/green without the infrastructure overhead.

---

## 14. Monitoring & alerting setup

### Logging

| Host | How to view logs | How to export |
|---|---|---|
| Cloudflare Worker | `cd cloudflare/worker && npm run tail` | Workers → Logs → Logpush → external destination (Datadog, Splunk, R2) |
| Cloudflare Pages | Dashboard → Pages → project → Functions → Logs | Workers Logpush (same as Worker) |
| Vercel | Dashboard → project → Logs | Log drains → Datadog / Logflare / AWS Kinesis |
| Netlify | Dashboard → site → Functions → Logs | Functions logs via Netlify UI; or use `console.log` + external logging SDK |
| VPS (systemd) | `journalctl -u osler -f` | `journalctl -u osler -o json \| <shipper>` (Vector, Fluent Bit, Promtail) |
| Docker | `docker logs -f osler` | Docker logging driver → Fluent Bit / Logstash / CloudWatch |
| Kubernetes | `kubectl logs -f deployment/osler` | Loki + Promtail, or ELK stack |

### Uptime monitoring

| Tool | Free tier | Notes |
|---|---|---|
| **Cloudflare Workers** (write your own) | Yes | Cron trigger hits your health endpoint, writes to KV on failure |
| **Uptime Robot** | 50 monitors, 5-min interval | Simple, reliable, free |
| **Pingdom** | 1 free monitor | Single check |
| **Better Uptime** | 10 monitors | Includes on-call scheduling |
| **GitHub Actions** (cron) | Yes | Write a `workflow_dispatch:` + `schedule:` workflow that curls your site every 5 min and fails loudly |
| **Cloudflare Workers + Cron** | Yes | Cron triggers `fetch(your-health-url)` and writes to a log |

Example self-hosted health check via GitHub Actions:

```yaml
# .github/workflows/uptime.yml
name: Uptime check
on:
  schedule:
    - cron: '*/5 * * * *'
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          status=$(curl -s -o /dev/null -w "%{http_code}" https://your-domain.com/)
          if [ "$status" != "200" ]; then
            echo "Site returned $status"
            exit 1
          fi
```

### Application performance monitoring (APM)

| Tool | Free tier | Setup |
|---|---|---|
| **Vercel Analytics** | Hobby tier free | Auto-enabled when project is on Vercel |
| **Cloudflare Web Analytics** | Free | Add a JS snippet (privacy-friendly, no cookies) |
| **Sentry** | 5k errors/month free | `npm i @sentry/react` → wrap app in `Sentry.ErrorBoundary` |
| **PostHog** | 1M events/month free | Self-host or cloud; add `posthog-js` |
| **Plausible** | Self-hosted free, cloud $9+/mo | Self-hosted alongside Osler on a VPS |

Sentry integration (frontend):

```ts
// src/app/layout.tsx (add at top)
import * as Sentry from "@sentry/react";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  });
}
```

### Database monitoring (Cloudflare D1)

```bash
# Quick stats
npx wrangler d1 execute osler-cloud --remote --command "
  SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM sessions WHERE expires_at > strftime('%s','now')) AS active_sessions,
    (SELECT COUNT(*) FROM admin_audit WHERE created_at > strftime('%s','now') - 86400) AS admin_actions_24h;
"

# Storage usage
npx wrangler d1 execute osler-cloud --remote --command "PRAGMA page_count;"   # × 4 KB = DB size
```

Set up a Cloudflare Worker cron to alert on:
- `users` count growing abnormally fast (possible spam sign-ups)
- `admin_audit` entries for `role_promote` or `user_delete` (notify security channel)
- `sessions` active count dropping to 0 (outage indicator)

### Alerting channels

| Channel | Setup | Best for |
|---|---|---|
| Email | Resend / SendGrid / SES | Non-urgent alerts |
| Slack | Incoming webhook URL | Team alerts |
| Discord | Webhook URL | Community/open-source projects |
| PagerDuty | API key | On-call rotation |
| SMS (Twilio) | Twilio API | Critical, off-hours alerts |
| Push (Pushover / ntfy) | Mobile push apps | Solo maintainers |

### Recommended alert thresholds

| Metric | Warning | Critical |
|---|---|---|
| Site uptime (5-min check) | 1 failure in 10 min | 3 failures in 10 min |
| Frontend p99 latency | > 2s | > 5s |
| Worker p99 latency | > 500ms | > 2s |
| Worker error rate (5xx) | > 1% | > 5% |
| D1 storage | > 4 GB (80% of 5 GB) | > 4.5 GB |
| R2 storage | > 8 GB | > 9.5 GB |
| Failed login attempts (per IP, 5 min) | > 50 | > 200 |
| New user signups (per hour) | > 100 (likely spam) | > 500 |
| Admin audit: `user_delete` actions | Any | Any (page on-call) |

### Incident response checklist

When an alert fires:

1. **Acknowledge** the alert in your on-call tool (PagerDuty, etc.)
2. **Open the runbook** — this file, plus [`troubleshooting.md`](./troubleshooting.md)
3. **Check status pages** for your host:
   - Cloudflare: <https://www.cloudflarestatus.com/>
   - Vercel: <https://www.vercel-status.com/>
   - Netlify: <https://www.netlifystatus.com/>
   - GitHub: <https://www.githubstatus.com/>
4. **Communicate** — post in your status page / Discord / Slack channel
5. **Diagnose** — pull logs, check metrics, identify root cause
6. **Mitigate** — roll back (see [§11](#11-rollback-procedures)) if needed
7. **Resolve** — fix forward once root cause is understood
8. **Postmortem** — within 48 hours, write a blameless postmortem: timeline, impact, root cause, action items. Commit it to `docs/postmortems/YYYY-MM-DD-<incident>.md`.

### Scheduled maintenance

For planned downtime (rare for Osler since deploys are typically zero-downtime):

1. **24 hours before:** post in your status page / Discord / Slack
2. **During maintenance:** set Cloudflare Access "Maintenance page" or Caddy `respond 503` block:
   ```caddyfile
   your-domain.com {
       @maintenance expression {http.matchers.path.regexp("^/(?!maintenance$)")}
       handle @maintenance {
           respond "Maintenance in progress — back in ~10 minutes." 503
       }
       handle {
           root * /opt/osler-maintenance
           file_server
       }
   }
   ```
3. **After maintenance:** post a "resolved" update with a brief summary of what changed

---

That's the full runbook. If you find a gap or run into an issue not covered here, please open an issue at <https://github.com/eyad-elghareeb/osler/issues> — or, better, a pull request improving this document.
