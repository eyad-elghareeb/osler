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

## Production hardening

Three recommended follow-ups after the first deploy. The first is already wired into the repo; the other two are dashboard tasks that only an account owner can complete.

### 1. Content-Security-Policy (wired, verify in prod)

`public/_headers` now ships a CSP on every page response. It intentionally allows:

- `script-src 'unsafe-inline'` — required by Next.js static export (inline RSC hydration scripts; there is no server to mint nonces).
- `script-src 'unsafe-eval'` — required by the Mermaid renderer (library diagrams + admin editor). If you remove mermaid support you can drop it.
- `connect-src https://*.workers.dev` — the Worker backend. **If you host the Worker on a custom domain, add that origin to `connect-src`.**
- `connect-src wss://0.peerjs.com` / `wss://broker.emqx.io:8084` — P2P sync (PeerJS signaling + MQTT relay).
- `connect-src https://generativelanguage.googleapis.com` + `wss://…` — AI assistant.
- `frame-src https:` — YouTube + Invidious embeds (the Invidious host is configurable, so a scheme source is used). Tighten to your fixed hosts once they're stable.

Verify with a browser console: no CSP violations on a normal browse (login → QBank → a library article with a diagram → a video → sync). The single biggest residual risk is that inline + eval scripts are allowed, so CSP here blocks externally-hosted script injection rather than inline payloads — that is the honest ceiling for a nonce-less static export.

### 2. Turnstile (CAPTCHA on auth)

The plumbing is wired: `public/osler.config.json` → `cloud.turnstileSiteKey` exists (empty) and the client only renders the widget when a real key is present. To enable in production, in this order:

1. Cloudflare Dashboard → Turnstile → Add site → widget for `your-app.pages.dev` (or your custom domain). Copy the **site key** and **secret key**.
2. Set the Worker secret: `npx wrangler secret put TURNSTILE_SECRET_KEY` (in `cloudflare/worker/`).
3. Put the site key in `public/osler.config.json`:
   ```jsonc
   "cloud": { "...": "...", "turnstileSiteKey": "0x4AAAAAAA..." }
   ```
4. Flip the flag in `cloudflare/worker/wrangler.toml`: `TURNSTILE_ENABLED = "true"`.
5. Redeploy the Worker (`npm run deploy:worker`) and rebuild/redeploy Pages (`npm run build && npm run deploy:pages`).

> ⚠️ Do not flip `TURNSTILE_ENABLED` to `"true"` until `TURNSTILE_SECRET_KEY` is set — with the flag on and no secret, **every** register/login/reset is rejected. Keep the flag off (default) during local dev.

### 3. Cloudflare Rate Limiting + Access (dashboard)

The Worker has a built-in in-memory per-IP limiter (login 12/min, register 6/min, global 240/min, HTTP 429). For harder guarantees:

- **Rate Limiting Rules** (WAF → Rate limiting rules) need a zone, so they apply when the Worker is behind a custom domain on your zone. Add a rule on the Worker's route: e.g. `POST /v1/auth/*` and `POST /v1/account/*` → 20 requests / 10 s, action Block. Free plan includes basic rules.
- **Cloudflare Access** on `/admin*` (Pages) and `/v1/admin/*` (Worker): see [Optional: Cloudflare Access for `/admin`](#optional-cloudflare-access-for-admin) above. Free Zero Trust includes up to 50 users.

**Prerequisites (verified against a fresh account, Aug 2026):** a standard `wrangler login` OAuth token has `zone:read` and no Zero Trust scopes — it **cannot** create Rate Limiting rules or Access apps, and Rate Limiting additionally requires a zone (a bare `workers.dev`/`pages.dev` origin has none). To finish these two via the API later, you need:

1. A **zone** (custom domain added in the dashboard, e.g. `osler.example.com` pointing at Pages + the Worker).
2. An **API token** with at least:
   - `Zone → WAF → Edit` (Rate Limiting rules)
   - `Access: Apps and Policies → Edit` (Cloudflare Access; requires Zero Trust to be enabled once)
3. Then, e.g.:
   ```bash
   export CLOUDFLARE_API_TOKEN=<token>
   # Rate limiting rule on the Worker route (zone_id = your zone)
   curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rate_limits" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
     -d '{"match":{"request":{"url":"<worker-origin>/v1/auth/*","methods":["POST"]}},"action":{"mode":"block","timeout":10},"threshold":20,"period":10}'
   ```

Until those two preconditions exist, the in-memory limiter remains the only rate control — which is acceptable for a free-tier instance.

## Static export details

### Dynamic routes

Next.js `output: "export"` requires `generateStaticParams` for dynamic routes. Each dynamic route emits one placeholder page (e.g. `/qbank/_/index.html`).

A post-build script (`scripts/copy-spa-placeholders.js`) copies each placeholder to a top-level `/_spa/<name>/index.html` path, and `public/_redirects` tells Cloudflare Pages to serve that placeholder for ANY UID:

```
/qbank/*           /_spa/qbank/           200
/flashcards/*      /_spa/flashcards/      200
/osce/*            /_spa/osce/            200
/library/*         /_spa/library/         200
/videos/*          /_spa/videos/          200
/settings/*        /_spa/settings/        200
/admin/users/*     /_spa/admin-users/     200
/admin/content/*   /_spa/admin-content/   200
/admin/review/*    /_spa/admin-review/    200
```

**Why the `/_spa/` copy step exists.** Cloudflare Pages' redirect engine has two quirks that silently break dynamic routes if the placeholder is served from its original path:

1. **Infinite-loop detection.** The engine strips `.html` and `/index` from the destination URL before re-checking it against the source pattern. A rule like `/admin/content/* → /admin/content/_/index.html` gets its destination stripped to `/admin/content/_/`, which still matches the source `/admin/content/*` — so Pages flags the rule as an infinite loop and **silently ignores it**. The dynamic URL then falls through to the catch-all and returns 404.

2. **Clean-URL 308 redirects.** If the destination is a `name.html` file, Pages 308-redirects to the clean URL `name` (stripping `.html`), which breaks the `200` rewrite semantics. Directory-style destinations (`name/index.html`) are already "clean" and are served directly without a redirect.

Copying the placeholders to `/_spa/<name>/index.html` solves both problems: the destination path doesn't match any source pattern (no infinite loop), and the directory-style URL is served directly without a 308 redirect.

Cloudflare Pages serves real files BEFORE applying redirects, so known paths (e.g. `/settings/account/` which has its own `index.html`, or `/admin/content/raw/`) are served directly. Only unmatched paths fall through to the placeholder.

There is intentionally **no catch-all rule**. Cloudflare Pages automatically serves `/404.html` with HTTP 404 for any URL that doesn't match a static file or a redirect rule. Adding `/* /404.html 404` does not work because `404` is not a valid redirect status code (valid: 200, 301, 302, 303, 307, 308) — the rule would be silently ignored.

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
- [ ] **Deep-link test (hard refresh, not client-side nav):**
  - [ ] `https://your-app.pages.dev/admin/content/<any-uuid>` returns 200 (not 404) and loads the admin shell
  - [ ] `https://your-app.pages.dev/qbank/<any-uid>` returns 200 and loads the QBank studio
  - [ ] `https://your-app.pages.dev/library/<any-article>` returns 200 and loads the library article viewer
  - [ ] `https://your-app.pages.dev/admin/users/<any-uuid>` returns 200
  - [ ] `https://your-app.pages.dev/admin/review/<any-uuid>` returns 200
- [ ] **Static content test:** `https://your-app.pages.dev/osler-content/library/manifest.json` returns 200 with JSON
- [ ] **404 test:** `https://your-app.pages.dev/nonexistent-path` returns 404 (the Next.js 404 page renders)
- [ ] `https://your-app.pages.dev/sw.js` returns the built service worker
- [ ] `https://your-app.pages.dev/manifest.webmanifest` returns valid JSON
- [ ] If Turnstile enabled: register/login shows the challenge widget
- [ ] If Cloudflare Access enabled: `/admin` redirects to Access login
