# Osler Cloud Worker

This Worker provides optional email/password & Google accounts, role-ready authorization (`student` | `admin`), password reset, account management (profile updates, password changes, data export, account deletion), and local-first QBank & flashcard sync. It runs entirely on Cloudflare's free tier (Workers + D1).

## Deployment Steps

### Method 1: Automated Deploy via Tauri Admin
Deploy directly from **Tauri Admin** → **Deploy** tab. Choosing Cloudflare automatically deploys **everything** (Pages site + Worker backend).

### Method 2: Manual CLI Deploy
1. Create the D1 database: `npx wrangler d1 create osler-cloud`, then update `database_id` in `wrangler.toml`.
2. Copy `.env.example` or `.dev.vars.example` to `.dev.vars`, set `JWT_SECRET`, and push it to Cloudflare: `npx wrangler secret put JWT_SECRET`.
3. (Optional - Google Sign-In) Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: `npx wrangler secret put GOOGLE_CLIENT_ID`, `npx wrangler secret put GOOGLE_CLIENT_SECRET`, and set `WORKER_URL` in `wrangler.toml`.
4. Apply D1 migrations: `npm run db:migrate` (runs `0001_initial.sql` and `0002_accounts_and_google.sql`).
5. Deploy: `npm run deploy` (or `npx wrangler deploy`).
6. Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact Osler web app origin, and set `public/osler.config.json` -> `cloud.apiUrl` to the deployed Worker URL.

Turnstile is recommended for public registration. Set `TURNSTILE_ENABLED=true`, configure `TURNSTILE_SECRET_KEY`, and set `turnstileSiteKey` in `osler.config.json`. Password-reset email uses Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`).

Sync batches progress into two documents (QBank & flashcards) and merges records by timestamp to minimize D1 writes while keeping IndexedDB fully functional offline.
