# Hosting Osler

Osler is a standard Next.js 16 standalone app plus an optional Cloudflare Worker backend. This guide walks you through **every** hosting option, from one-click Cloudflare deploy to fully self-hosted on a VPS, including Docker, reverse-proxy TLS, environment configuration, custom domains, and post-deploy verification.

> **Source repository:** <https://github.com/eyad-elghareeb/osler>
> **License:** MIT — see [LICENSE](../LICENSE).
> **Related guides:** [`forking.md`](./forking.md) · [`deployment.md`](./deployment.md) · [`security.md`](./security.md) · [`environment.md`](./environment.md)

---

## Table of Contents

1. [Hosting decision matrix](#1-hosting-decision-matrix)
2. [Prerequisites](#2-prerequisites)
3. [Option A: Cloudflare Pages + Worker (recommended)](#3-option-a-cloudflare-pages--worker-recommended)
4. [Option B: Vercel (frontend) + Cloudflare Worker (backend)](#4-option-b-vercel-frontend--cloudflare-worker-backend)
5. [Option C: Self-hosted VPS with Caddy](#5-option-c-self-hosted-vps-with-caddy)
6. [Option D: Docker container](#6-option-d-docker-container)
7. [Option E: Static export to GitHub Pages / Netlify (no cloud backend)](#7-option-e-static-export-to-github-pages--netlify-no-cloud-backend)
8. [Configuring custom domains](#8-configuring-custom-domains)
9. [Environment variables](#9-environment-variables)
10. [Post-deploy verification checklist](#10-post-deploy-verification-checklist)
11. [Operating & monitoring](#11-operating--monitoring)
12. [Upgrading your instance](#12-upgrading-your-instance)

---

## 1. Hosting decision matrix

| Need | Recommended host | Why |
| --- | --- | --- |
| Easiest, free-tier friendly, full-stack | **Cloudflare Pages + Worker** | Same vendor for frontend + backend + D1 + R2. Free tier covers ~100k requests/day. |
| Frontend on Vercel, backend on Cloudflare | **Vercel + Cloudflare Worker** | Vercel has best-in-class Next.js DX. Worker still free for backend. |
| Full control, on-prem, or no vendor lock-in | **Self-hosted VPS with Caddy** | Run on Hetzner / DigitalOcean / your own metal. Caddy handles TLS automatically. |
| Container orchestration | **Docker container** | One image, runs anywhere (k8s, ECS, Nomad). |
| Just the static frontend (no accounts) | **GitHub Pages / Netlify** | No backend, no D1, no R2 — just static export. |

### Free tier limits to be aware of

| Vendor | Limit | Notes |
| --- | --- | --- |
| Cloudflare Workers | 100,000 requests/day | Cron triggers: 5 maximum. |
| Cloudflare D1 | 5 GB storage, 5M rows read/day | Easily covers a school of ~500 students. |
| Cloudflare R2 | 10 GB storage, 1M Class A ops/month | Plenty for content objects. |
| Vercel (Hobby) | 100 GB bandwidth, 100 GB-Hours compute | Adequate for small instances. |
| Resend (free) | 100 emails/day, 3000/month | Enough for password resets. |

---

## 2. Prerequisites

For all options:

- **Node.js 22** (see `.nvmrc`)
- **Git** to clone the repo
- A fork of the repo on GitHub (see [`forking.md`](./forking.md))

For options that use the Cloudflare Worker backend:

- A **Cloudflare account** (free tier works)
- A **D1 database** created in your Cloudflare account
- An **R2 bucket** if you want admin content management (optional but recommended)

For self-hosted / Docker:

- A Linux server (Ubuntu 22.04+ recommended) with at least 1 GB RAM
- A domain name with DNS A/AAAA records pointing to your server
- Ports 80 and 443 open inbound

---

## 3. Option A: Cloudflare Pages + Worker (recommended)

This is the simplest full-stack option and stays within Cloudflare's free tier for most small-to-medium deployments.

### Step 1: Deploy the Worker backend

```bash
cd cloudflare/worker
npm install

# Create D1 database
npx wrangler d1 create osler-cloud
# → Paste the returned database_id into wrangler.toml

# Set secrets
npx wrangler secret put JWT_SECRET
# → Paste a long random string (openssl rand -base64 48)

# Apply migrations
npm run db:migrate

# (Optional) Configure Google Sign-In
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# (Optional) Configure password reset email
npx wrangler secret put RESEND_API_KEY

# Deploy
npm run deploy
```

Update `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "https://your-app.pages.dev"   # or your custom domain
WORKER_URL      = "https://osler-cloud.<your-subdomain>.workers.dev"
TURNSTILE_ENABLED = "false"                     # set "true" after configuring Turnstile
APP_ORIGIN      = "https://your-app.pages.dev"  # for password-reset links
```

### Step 2: Deploy the frontend to Cloudflare Pages

Either via the dashboard (connect your GitHub fork → new project → framework preset: Next.js) or via Wrangler:

```bash
npm install
npm run build
npx wrangler pages deploy .next/standalone --project-name osler
```

Set the Pages environment variable `NEXT_PUBLIC_CLOUD_API_URL` to your Worker URL, **or** edit `public/osler.config.json`:

```jsonc
"cloud": {
  "enabled": true,
  "apiUrl": "https://osler-cloud.<your-subdomain>.workers.dev",
  "syncQbank": true,
  "syncFlashcards": true
}
```

### Step 3: Create your first admin user

Because the admin role is not granted at registration time, you need to promote a user manually after first signup:

```bash
# Sign up via the UI at least once, then:
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE users SET role = 'admin' WHERE username = '<your-username>';"
```

After this, sign in at `https://your-app.pages.dev/admin` with your account.

### Step 4: (Recommended) Put the admin panel behind Cloudflare Access

The admin shell reads the `cf-access-authenticated-user-email` header (set by Cloudflare Zero Trust Access) and refuses to render in production if the header is missing. To enable:

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add Application → Self-hosted
2. Application domain: `your-app.pages.dev` (or path `/admin*`)
3. Identity provider: Email OTP / Google Workspace / Okta / etc.
4. Save. Visiting `/admin` will now require Cloudflare Access authentication before reaching the Next.js app.

---

## 4. Option B: Vercel (frontend) + Cloudflare Worker (backend)

Use this option if you want Vercel's superior Next.js DX (preview deployments, edge functions, analytics) but keep the Cloudflare Worker for the account backend.

### Frontend on Vercel

1. Push your fork to GitHub.
2. Vercel dashboard → New Project → import the repo.
3. Framework preset: **Next.js**. Build command: `npm run build`. Output: leave default.
4. Environment variables: `NEXT_PUBLIC_CLOUD_API_URL=https://osler-cloud.<your-subdomain>.workers.dev`.
5. Deploy.

### Backend on Cloudflare Worker

Follow the same steps as [Option A, Step 1](#step-1-deploy-the-worker-backend). Update `wrangler.toml` → `ALLOWED_ORIGIN` to your Vercel domain (e.g. `https://your-app.vercel.app`).

> **Note**: Vercel preview deployments have unique URLs (`your-app-git-feature-username.vercel.app`). The Worker's CORS only allows a single `ALLOWED_ORIGIN`, so preview deployments will not be able to reach the Worker. Use Vercel's production URL or set up a custom domain per environment.

---

## 5. Option C: Self-hosted VPS with Caddy

For maximum control, run on your own VPS. Caddy handles TLS automatically via Let's Encrypt.

### Step 1: Provision the server

```bash
# On a fresh Ubuntu 22.04+ VPS:
sudo apt update && sudo apt install -y nodejs npm caddy

# Use Node 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22 && nvm use 22 && nvm alias default 22
```

### Step 2: Clone and build

```bash
git clone https://github.com/<your-username>/osler.git /opt/osler
cd /opt/osler
npm ci
npm run build
# Output: .next/standalone/ + .next/static/ + public/
```

### Step 3: Run the standalone server

Create a systemd service at `/etc/systemd/system/osler.service`:

```ini
[Unit]
Description=Osler Next.js standalone server
After=network.target

[Service]
Type=simple
User=osler
WorkingDirectory=/opt/osler
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node /opt/osler/.next/standalone/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /bin/false osler
sudo chown -R osler:osler /opt/osler
sudo systemctl daemon-reload
sudo systemctl enable --now osler
sudo systemctl status osler
```

### Step 4: Configure Caddy

`/etc/caddy/Caddyfile`:

```caddyfile
your-domain.com {
    encode gzip zstd

    # Static assets bypass Node for speed
    @static path /_next/static/* /fonts/* /assets/* /osler-content/*
    handle @static {
        root * /opt/osler
        file_server
    }

    # Everything else proxied to the Next.js standalone server
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Cross-Origin-Opener-Policy same-origin
        Cross-Origin-Resource-Policy same-origin
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy will auto-provision a Let's Encrypt TLS certificate on first request.

### Step 5: Backend (Cloudflare Worker or local SQLite)

For self-hosted deployments you have two backend choices:

1. **Cloudflare Worker** — same as Option A. Point `ALLOWED_ORIGIN` to your VPS domain.
2. **No backend** — set `cloud.enabled = false` in `osler.config.json`. The app runs entirely offline; no accounts, no sync.

### Step 6: Updating

```bash
cd /opt/osler
git pull
npm ci
npm run build
sudo systemctl restart osler
```

---

## 6. Option D: Docker container

A minimal Dockerfile (save as `Dockerfile` in the repo root):

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run:

```bash
docker build -t osler:latest .
docker run -d \
  --name osler \
  -p 3000:3000 \
  -e NEXT_PUBLIC_CLOUD_API_URL=https://osler-cloud.example.workers.dev \
  --restart unless-stopped \
  osler:latest
```

For Docker Compose with Caddy as TLS terminator:

```yaml
# docker-compose.yml
services:
  osler:
    build: .
    restart: unless-stopped
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_CLOUD_API_URL: https://osler-cloud.example.workers.dev
    expose:
      - "3000"

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

`Caddyfile`:

```caddyfile
your-domain.com {
    reverse_proxy osler:3000
    encode gzip zstd
}
```

```bash
docker compose up -d
docker compose logs -f
```

---

## 7. Option E: Static export to GitHub Pages / Netlify (no cloud backend)

If you don't need accounts, sync, or admin content management, Osler can run as a pure static site.

1. Set `cloud.enabled = false` in `public/osler.config.json`.
2. Build with `npm run build`.
3. Deploy `.next/` to GitHub Pages or Netlify.

> **Note**: Osler's video engine, AI assistant, and P2P sync work fine without the Cloudflare backend. Only accounts, cross-device progress sync, and the admin panel are disabled.

For GitHub Pages, use the Tauri admin's Deploy view → GitHub Pages provider, which writes a `.github/workflows/deploy.yml` for you.

---

## 8. Configuring custom domains

### Cloudflare Pages

1. Cloudflare Dashboard → Pages → your project → Custom domains → Set up a custom domain.
2. Cloudflare auto-provisions TLS via its Universal SSL.
3. Update `wrangler.toml` → `ALLOWED_ORIGIN` and `APP_ORIGIN` to your custom domain.
4. Redeploy the Worker: `npm run deploy`.

### Vercel

1. Vercel dashboard → your project → Settings → Domains → Add.
2. Follow the DNS instructions Vercel provides (typically an A record or CNAME).
3. Update Worker `ALLOWED_ORIGIN` and `APP_ORIGIN`.

### Self-hosted

Just point your DNS A/AAAA record at your server's IP. Caddy will auto-provision TLS via Let's Encrypt on first request.

---

## 9. Environment variables

See [`environment.md`](./environment.md) for the complete reference. The short version:

| Variable | Required | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_CLOUD_API_URL` | If cloud backend enabled | Frontend — Worker URL |
| `NEXT_PUBLIC_INVIDIOUS_HOST` | Optional | Frontend — alternative YouTube frontend |
| `JWT_SECRET` | Yes (Worker) | Backend — HMAC signing |
| `ALLOWED_ORIGIN` | Yes (Worker) | Backend — CORS |
| `WORKER_URL` | For Google Sign-In | Backend — OAuth callback |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Google Sign-In | Backend |
| `RESEND_API_KEY` / `EMAIL_FROM` / `APP_ORIGIN` | For password reset | Backend |
| `TURNSTILE_ENABLED` / `TURNSTILE_SECRET_KEY` | Optional | Backend — anti-bot |

---

## 10. Post-deploy verification checklist

After deploying, run through this checklist to confirm everything works:

- [ ] Visit `https://your-domain/` — page loads, no console errors
- [ ] Visit `https://your-domain/api/route` — returns expected response (or 404 in production)
- [ ] If cloud backend enabled:
  - [ ] `curl https://<worker-domain>/v1/health` returns `{ok:true, ...}`
  - [ ] Register a test account from the UI
  - [ ] Login / logout works
  - [ ] Settings → Sync shows "Synced" status after a few seconds
- [ ] If admin role configured:
  - [ ] Visit `/admin` — login prompt appears
  - [ ] Sign in — admin shell loads with sidebar nav
  - [ ] Dashboard shows real stats
  - [ ] Users tab lists registered users
  - [ ] Content tab shows empty state (or existing content)
  - [ ] Audit tab loads (may be empty if no admin actions yet)
- [ ] PWA install prompt works (Chrome address bar shows install icon)
- [ ] Lighthouse PWA audit passes
- [ ] `https://your-domain/manifest.webmanifest` returns valid JSON
- [ ] If Turnstile enabled: register/login shows the challenge widget

---

## 11. Operating & monitoring

### Logs

| Host | How to view logs |
| --- | --- |
| Cloudflare Worker | `cd cloudflare/worker && npm run tail` |
| Cloudflare Pages | Dashboard → Pages → your project → Functions → Logs |
| Vercel | Dashboard → your project → Logs |
| VPS / systemd | `journalctl -u osler -f` |
| Docker | `docker compose logs -f osler` |

### Database inspection (Cloudflare D1)

```bash
cd cloudflare/worker
npx wrangler d1 execute osler-cloud --remote --command "SELECT COUNT(*) FROM users;"
npx wrangler d1 execute osler-cloud --remote --command "SELECT id, username, role, created_at FROM users ORDER BY created_at DESC LIMIT 10;"
npx wrangler d1 execute osler-cloud --remote --command "SELECT action, COUNT(*) FROM admin_audit GROUP BY action;"
```

### R2 inspection

```bash
npx wrangler r2 object list osler-content --remote
npx wrangler r2 object get osler-content/content/library/abc123/published.json /tmp/out.json
```

### Backups

- **D1**: `npx wrangler d1 export osler-cloud --remote --output=backup.sql`
- **R2**: Use `r2 object get` per object or a script that walks the prefix tree
- **VPS / Docker**: back up the entire `/opt/osler/.next/standalone/` directory plus any local SQLite

### Scheduling cron

The Worker's hourly cron is defined in `wrangler.toml`:

```toml
[triggers]
crons = ["0 * * * *"]
```

This runs the `scheduled` handler which prunes expired sessions, OAuth states, reset tokens, and audit-log entries older than 1 year. Verify cron is firing by checking Workers → your worker → Triggers → Cron triggers in the dashboard.

---

## 12. Upgrading your instance

To pull in upstream changes (see [`forking.md`](./forking.md) for the full forking workflow):

```bash
git fetch upstream
git merge upstream/main           # or rebase
# Resolve conflicts in osler.config.json (usually keep yours)
npm ci                            # in case deps changed
npm run build
# Re-apply migrations if any
cd cloudflare/worker && npm run db:migrate && npm run deploy && cd ../..
# Re-deploy the frontend (Pages auto-deploys on push; for VPS, restart systemd unit)
```

Always review the [`CHANGELOG.md`](../CHANGELOG.md) for breaking changes before upgrading.
