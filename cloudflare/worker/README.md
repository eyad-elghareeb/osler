# Osler Cloud Worker

This Worker provides optional email/password & Google accounts, role-ready authorization (`student` | `content_admin` | `admin`), password reset, account management (profile updates, password changes, data export, account deletion), admin API (user & R2-backed content management with draft/pending/published workflow + audit log + session management), and local-first QBank & flashcard sync. It runs entirely on Cloudflare's free tier (Workers + D1 + R2).

For the **full HTTP API reference**, see [`../../docs/api-reference.md`](../../docs/api-reference.md). For the **security model and hardening notes**, see [`../../docs/security.md`](../../docs/security.md). For **deployment options** (Cloudflare, Vercel, Docker, VPS), see [`../../docs/hosting.md`](../../docs/hosting.md).

## Deployment Steps

### Method 1: Automated Deploy via Tauri Admin

Deploy directly from **Tauri Admin** → **Deploy** tab. Choosing Cloudflare automatically deploys **everything** (Pages site + Worker backend).

### Method 2: Manual CLI Deploy

```bash
npm install
cp .env.example .dev.vars         # edit .dev.vars with your secrets

# 1. Create the D1 database
npx wrangler d1 create osler-cloud
# Paste the returned database_id into wrangler.toml

# 2. Set the JWT secret (and other secrets as needed)
npx wrangler secret put JWT_SECRET

# 3. (Optional) Configure Google Sign-In
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Set WORKER_URL in wrangler.toml to the deployed Worker URL

# 4. (Optional) Configure password reset email via Resend
npx wrangler secret put RESEND_API_KEY
# Set EMAIL_FROM and APP_ORIGIN in wrangler.toml

# 5. (Optional) Configure Turnstile anti-bot
npx wrangler secret put TURNSTILE_SECRET_KEY
# Set TURNSTILE_ENABLED="true" in wrangler.toml

# 6. Apply all D1 migrations (0001, 0002, 0003, 0004)
npm run db:migrate

# 7. Deploy
npm run deploy
```

After deployment:

- Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact Osler web app origin.
- Set `public/osler.config.json` -> `cloud.apiUrl` to the deployed Worker URL.
- (Optional) Create an R2 bucket: `npx wrangler r2 bucket create osler-content`. The `[[r2_buckets]]` binding is already in `wrangler.toml`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run the worker locally with `wrangler dev` (defaults to `http://localhost:8787`). |
| `npm run deploy` | Deploy to Cloudflare Workers (production). |
| `npm run db:migrate` | Apply pending D1 migrations to the remote database. |
| `npm run db:migrate:local` | Apply pending D1 migrations to the local dev database. |
| `npm run db:list` | List applied and pending migrations. |
| `npm run tail` | Tail live logs from the deployed Worker (`wrangler tail`). |
| `npm run secret:list` | List configured Worker secrets (names only, not values). |

## File Layout

```
cloudflare/worker/
├── src/
│   └── index.mjs              # Worker entry point (single file, zero deps)
├── migrations/
│   ├── 0001_initial.sql       # users, sessions, password_reset_tokens, progress_documents
│   ├── 0002_accounts_and_google.sql  # auth_identities, oauth_states, auth_handoffs
│   ├── 0003_admin.sql         # content_objects, admin_audit
│   └── 0004_security_indexes.sql     # performance & security indexes
├── .dev.vars.example          # local secrets template (gitignored)
├── .env.example               # documentation reference for env vars
├── package.json
├── wrangler.toml              # Workers + D1 + R2 + cron config
└── README.md                  # this file
```

## Quick Health Check

After deploy, verify the worker is reachable:

```bash
curl https://<your-worker-domain>/v1/health
# → { "ok": true, "googleEnabled": true|false, "turnstileEnabled": true|false }
```

## Operational Notes

- **Cron trigger**: `[triggers] crons = ["0 * * * *"]` runs hourly to prune expired sessions, OAuth states, handoffs, reset tokens, and audit-log entries older than 1 year.
- **Session cap**: 12 concurrent sessions per user. The oldest is revoked when a 13th is issued.
- **Rate limit**: 12 logins / 6 registrations / 6 resets / 12 google-consume per IP per minute; global per-IP cap of 240 across all rate-limited routes. Returns HTTP 429 when exceeded. For harder guarantees, front the Worker with Cloudflare Rate Limiting Rules.
- **Audit retention**: 1 year. Tune `AUDIT_RETENTION_MS` in `src/index.ts` if your jurisdiction requires a different window.
- **R2 not configured**: Admin content endpoints return HTTP 503 with `{error: "Content storage not configured"}` until the R2 bucket binding is added.

See [`../../docs/cloudflare-backend.md`](../../docs/cloudflare-backend.md) for the full deployment guide and [`../../docs/api-reference.md`](../../docs/api-reference.md) for the complete API reference.
