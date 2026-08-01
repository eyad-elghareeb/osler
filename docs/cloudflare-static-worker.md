# Osler — Cloudflare Free-Tier Deployment Guide

Osler is architected as a **static site + Worker** duo designed to fit entirely within Cloudflare's free tier. There are exactly **two deployable layers**:

1. **Layer 1 — Static client-side site** (Cloudflare Pages): the entire app is a Next.js `output: "export"` build — pure HTML/JS/CSS, service worker, and content packs. No SSR, no server runtime.
2. **Layer 2 — Server-side backend** (Cloudflare Worker): a single dependency-free Worker (`cloudflare/worker/src/index.ts`) handles **all** backend concerns — auth (email/password + Google OAuth), sessions, D1 (users, progress sync, audit), R2 (admin content), rate limiting, cron cleanup, and analytics.

The browser loads the static site from Pages, then talks to the Worker over CORS for every dynamic request.

| Component | Hosting | Free-tier limits |
| --- | --- | --- |
| Frontend (Next.js static export) | Cloudflare Pages (`.pages.dev`) | Unlimited requests, 500 builds/month |
| Backend (auth, sync, content, admin) | Cloudflare Worker (`.workers.dev`) | 100,000 requests/day, 10ms CPU/req |
| Database | Cloudflare D1 | 5 GB storage, 5 M rows read/day, 100 K rows written/day |
| Object storage (content) | Cloudflare R2 | 10 GB storage, 1 M Class A ops/month |
| Scheduled cleanup | Worker cron trigger | 5 cron triggers max |

## Architecture

```
                ┌─────────────────────────────────────────────┐
                │              Cloudflare Pages               │
                │         (your-app.pages.dev)                │
                │                                             │
   browser  ───▶│  Static HTML/JS/CSS (Next.js export)        │
                │  Service worker (/sw.js)                    │
                │  Content packs (/osler-content/*)            │
                │                                             │
                └────────────┬────────────────────────────────┘
                             │
                             │ Cross-origin fetch (CORS)
                             ▼
                ┌─────────────────────────────────────────────┐
                │           Cloudflare Worker                 │
                │        (your-worker.workers.dev)            │
                │                                             │
                │  /v1/auth/*      — auth, sessions           │
                │  /v1/sync        — QBank + flashcard sync   │
                │  /v1/content/*   — R2-backed content serving │
                │  /v1/admin/*     — admin APIs (role-gated)  │
                │  /v1/analytics/* — RUM ingestion            │
                │                                             │
                │  Bindings:                                  │
                │    D1  (DB)      — users, sessions, audit   │
                │    R2  (CONTENT) — content objects + files  │
                │    Cron (hourly) — prune stale rows          │
                └─────────────────────────────────────────────┘
```

**No SSR.** No middleware. No Next.js server runtime. The Pages site is pure static HTML/JS — the browser loads it, then talks directly to the Worker for any dynamic data.

## Project layout

```
osler/
├── src/                      # Next.js app (client components only)
│   ├── app/                  # App Router pages (all static-export compatible)
│   ├── components/osler/     # UI components
│   └── lib/osler/            # Client-side libs (cloud.ts, session-context.tsx, etc.)
├── public/                   # Static assets served as-is
│   ├── _headers              # Cloudflare Pages security + cache headers
│   ├── _redirects            # SPA fallback for dynamic routes
│   ├── sw.js                 # Built by scripts/build-sw.js (esbuild)
│   └── osler.config.json     # Cloud URL + feature flags
├── cloudflare/worker/        # Standalone Worker project (separate deploy)
│   ├── src/index.ts          # All Worker endpoints
│   ├── migrations/           # D1 schema migrations
│   └── wrangler.toml         # Worker config (D1, R2, cron)
├── scripts/build-sw.js       # esbuild script: src/sw.ts → public/sw.js
├── next.config.ts            # output: "export", no SSR
└── package.json              # Frontend scripts (build, deploy:pages, deploy:worker)
```

## Build & deploy

### Zero-config: one-command full-stack deploy (recommended)

`scripts/cloudflare-init.js` initializes and deploys **both layers** in a single run. It creates the D1 database and patches its ID into `wrangler.toml`, creates the R2 bucket, generates + sets the `JWT_SECRET` (and any optional secrets from an env file), applies all D1 migrations, deploys the Worker, builds the static site, deploys it to Pages, and wires `cloud.apiUrl` in `public/osler.config.json`. It is idempotent — safe to re-run.

Prerequisite: authenticate once with Cloudflare — `npx wrangler login` (browser flow) or export `CLOUDFLARE_API_TOKEN`.

```bash
# Minimal: everything auto-generated (random JWT_SECRET, auto-detected Worker URL)
node scripts/cloudflare-init.js --origin https://osler.your-domain.com

# Full control: fixed Worker URL + optional secrets (Google, Resend, Turnstile)
node scripts/cloudflare-init.js \
  --origin https://osler.your-domain.com \
  --worker-url https://osler-cloud.<account-subdomain>.workers.dev \
  --project osler \
  --env-file ./cloudflare-secrets.env
```

The env file is a plain `NAME=value` list; each name is set as a Worker secret:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
RESEND_API_KEY=...
TURNSTILE_SECRET_KEY=...
GEMINI_ENCRYPTION_KEY=...
```

Flags: `--project` (Pages project name, default `osler`), `--d1` (default `osler-cloud`), `--r2` (default `osler-content`), `--skip-build` (reuse existing `out/`), `--skip-pages` (Worker only), `--skip-worker` (Pages only). After it finishes, promote your first user to admin with the printed SQL.

### Manual deploy

#### Frontend (Cloudflare Pages)

```bash
npm install
npm run build           # builds SW + static export → out/
npm run deploy:pages    # wrangler pages deploy out --project-name osler
```

Or connect your GitHub fork in the Cloudflare dashboard → Pages → New project → Framework preset: Next.js. Set the build command to `npm run build` and the output directory to `out`.

### Backend (Cloudflare Worker)

```bash
cd cloudflare/worker
npm install

# One-time setup
npx wrangler d1 create osler-cloud
# → Paste the returned database_id into wrangler.toml
npx wrangler secret put JWT_SECRET
# → Paste a long random string (openssl rand -base64 48)

# Apply migrations
npm run db:migrate

# Deploy
npm run deploy           # or: npm run deploy:worker from repo root
```

### Configuration

1. **Worker URL** — set in `public/osler.config.json`:
   ```jsonc
   "cloud": {
     "enabled": true,
     "apiUrl": "https://osler-cloud.<your-subdomain>.workers.dev",
     "syncQbank": true,
     "syncFlashcards": true
   }
   ```

2. **Worker `ALLOWED_ORIGIN`** — set in `cloudflare/worker/wrangler.toml`:
   ```toml
   [vars]
   ALLOWED_ORIGIN = "https://your-app.pages.dev"
   WORKER_URL = "https://osler-cloud.<your-subdomain>.workers.dev"
   APP_ORIGIN = "https://your-app.pages.dev"
   ```

3. **Promote first user to admin**:
   ```bash
   cd cloudflare/worker
   npx wrangler d1 execute osler-cloud --remote --command \
     "UPDATE users SET role = 'admin' WHERE username = '<your-username>';"
   ```

### Optional: Cloudflare Access for `/admin`

The admin shell probes `GET /v1/admin/access` on the Worker to read the `CF-Access-Authenticated-User-Email` header. To enable the "protected" gate:

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add Application → Self-hosted
2. Add two hostnames to the same Access app:
   - `your-app.pages.dev` with path `/admin*`
   - `your-worker.workers.dev` with path `/v1/admin/*`
3. Pick an identity provider (Email OTP, Google Workspace, etc.)
4. Save. Both the Pages `/admin` and the Worker `/v1/admin/*` now require Access auth.

In dev (NODE_ENV !== production) the "protected" screen is skipped so you can preview the admin UI without Access.

## Static export details

### Dynamic routes

Next.js `output: "export"` requires `generateStaticParams` for dynamic routes. Each dynamic route emits one placeholder page (e.g. `/qbank/_/index.html`), and `public/_redirects` tells Cloudflare Pages to serve that placeholder for ANY UID:

```
/qbank/*           /qbank/_/index.html           200
/flashcards/*      /flashcards/_/index.html      200
/osce/*            /osce/_/index.html            200
/library/*         /library/_/index.html         200
/videos/*          /videos/_/index.html          200
/settings/*        /settings/index.html          200
/admin/users/*     /admin/users/_/index.html     200
/admin/content/*   /admin/content/_/index.html   200
/admin/review/*    /admin/review/_/index.html    200
```

Cloudflare Pages serves real files BEFORE applying redirects, so known paths (e.g. `/settings/account/` which has its own `index.html`) are served directly. Only unmatched paths fall through to the placeholder.

### Route guarding (no middleware)

There is no Next.js middleware (it doesn't work with `output: "export"`). Route gating is enforced client-side by `RouteGuard` (`src/components/osler/route-guard.tsx`):

- On mount, it checks `useOslerSession()` for a valid session.
- If unauthenticated and on a protected route, it redirects to `/login?next=<path>`.
- The `/admin/*` paths are exempt — admin auth is enforced separately by `AdminShell` via a bearer token + role check (`/v1/admin/me`).

The trade-off vs server-side middleware: a user can navigate directly to a protected URL and briefly see the page render before the redirect fires. Mitigation: the AppShell renders a loading spinner until the session is restored, so the redirect usually fires before any real UI is painted. The actual data is gated by the Worker (no bearer token = no API access), so the brief flash is just the chrome, not actual content.

### Service worker

The SW is built separately by `scripts/build-sw.js` (esbuild) — `@serwist/turbopack` was removed because it doesn't support `output: "export"`.

- Source: `src/sw.ts` (uses `serwist` runtime directly)
- Build: `npm run build:sw` → `public/sw.js`
- Loaded by `SerwistProvider` at `/sw.js` (production only)

The SW caches content packs (`/osler-content/*` + Worker `/v1/content/*`) network-first so users can download content for offline use. Static assets under `/_next/static/*` are cached by the browser via HTTP cache headers (see `public/_headers`).

## Verifying the deploy

After deploying, run through this checklist:

- [ ] Visit `https://your-app.pages.dev/` — page loads, no console errors
- [ ] Visit `https://your-worker.workers.dev/v1/health` — returns `{ok:true, ...}`
- [ ] Register a test account from the UI
- [ ] Login / logout works (sessionStorage + Worker session)
- [ ] Settings → Sync shows "Synced" status after a few seconds
- [ ] `/admin` shows login prompt → sign in with admin account → admin shell loads
- [ ] `https://your-app.pages.dev/sw.js` returns the built service worker
- [ ] `https://your-app.pages.dev/manifest.webmanifest` returns valid JSON
- [ ] If Turnstile enabled: register/login shows the challenge widget
- [ ] If Cloudflare Access enabled: `/admin` redirects to Access login
