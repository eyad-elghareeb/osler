# Cloudflare backend, accounts, and progress sync

Osler remains local-first by default. When `cloud.enabled` is `false`, the app behaves as a local-only guest session: IndexedDB stores QBank answers and flashcard schedules. When `cloud.enabled` is `true`, the app integrates an optional Cloudflare Worker account backend supporting email/password registration, Google Sign-In (OAuth 2.0), account management, two-document background progress sync, role-based admin panel, and an R2-backed content workflow with draft/pending/published/rejected states.

For the **full HTTP API reference**, see [`api-reference.md`](./api-reference.md). For the **security model and hardening notes**, see [`security.md`](./security.md). For **deployment options** (Cloudflare, Vercel, Docker, VPS), see [`hosting.md`](./hosting.md).

## What is included

`cloudflare/worker/` is a deployable, dependency-free Worker project:

| File | Purpose |
| --- | --- |
| `src/index.ts` | Email/password & Google OAuth authentication, PBKDF2 password hashing, HMAC-signed session tokens with server-side revocation, roles (`student` / `content_admin` / `admin`), password reset, account management, content management (R2-backed draft/pending/published workflow), admin audit log, rate limiting, security headers, and sync API. |
| `migrations/0001_initial.sql` | Base D1 schema for users, sessions, password-reset tokens, and progress documents. |
| `migrations/0002_accounts_and_google.sql` | Google identity links (`auth_identities`), OAuth state tokens (`oauth_states`), and single-use handoffs (`auth_handoffs`). |
| `migrations/0003_admin.sql` | R2-backed content objects (`content_objects` with draft/pending/published/rejected workflow) and admin audit log (`admin_audit`). |
| `migrations/0004_security_indexes.sql` | Performance & security indexes for session enumeration, audit-log reads, and per-user content listing. |
| `wrangler.toml` | Workers, D1 + R2 config, and hourly cron trigger for cleanup. |
| `.dev.vars.example` | Secret names template (never commit `.dev.vars`). |
| `.env.example` | Same reference, suitable for documentation purposes. |
| `README.md` | Quick deployment summary. |

The Tauri Admin instance generator opt-in Cloudflare section writes `cloud` config to `public/osler.config.json` and scaffolds the Worker project, migrations, and backend guide.

## Deployment Options

### Option A: One-Click Full Stack via Tauri Admin (Recommended)

In **Tauri Admin** (under the **Deploy** tab):
1. Enter your Cloudflare **API token** and **Account ID**.
2. Click **Deploy**. Tauri Admin deploys **everything**:
   - Cloudflare Pages (Frontend Web Application)
   - Cloudflare Worker (Backend & Progress Sync API from `cloudflare/worker`)

Tauri Admin handles worker deployment via Wrangler CLI (or direct Cloudflare REST API fallback if Wrangler is uninstalled), with zero manual terminal commands required.

### Option B: Manual CLI Deployment

For manual deployment from `cloudflare/worker`:

```bash
npm install
# Copy secrets template reference
cp .env.example .dev.vars
npx wrangler d1 create osler-cloud
# Paste the returned database_id into wrangler.toml
npx wrangler secret put JWT_SECRET
npm run db:migrate          # applies migrations 0001, 0002, 0003, 0004
npm run deploy
```

Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact origin hosting the Osler web application. Update `public/osler.config.json`:

```jsonc
"cloud": {
  "enabled": true,
  "apiUrl": "https://osler-cloud.example.workers.dev",
  "turnstileSiteKey": "0x4AAAAAA...",
  "syncQbank": true,
  "syncFlashcards": true
}
```

## Google Sign-In Configuration

To enable Google Sign-In:

1. Create an OAuth 2.0 Client ID in the Google Cloud Console (Web Application).
2. Set Authorized Redirect URI: `https://<your-worker-domain>.workers.dev/v1/auth/google/callback`.
3. Set secrets on Cloudflare Worker:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
4. Set `WORKER_URL = "https://<your-worker-domain>.workers.dev"` in `wrangler.toml`.

When a user clicks "Continue with Google", the Worker generates a cryptographically signed OAuth state with PKCE nonce, redirects to Google's consent screen, verifies Google's ID token server-side upon return, links or creates the account, and performs a single-use secure ticket handoff back to the app.

## Accounts & Security

- **PBKDF2 Password Hashing**: Passwords use Web Crypto PBKDF2-SHA-256 with 16-byte random salt and 310,000 iterations.
- **Password Policy**: Minimum 10 characters, must contain at least 2 character classes (lowercase / uppercase / digit / symbol). Same policy enforced on registration, password change, password reset, and admin-initiated reset.
- **Account Management**: Users can update their display name and email, set/change password, export account data as JSON, and permanently delete their account with password confirmation.
- **Roles**: `student` (default), `content_admin` (can create and edit their own content but not approve/publish), and `admin` (full access: manage users, approve/reject/publish content, view audit logs, revoke sessions). Admin role allows accessing administrative features.
- **Sessions**: HMAC-SHA-256 signed session tokens with server-side revocation in D1. Session tokens are kept in `sessionStorage`. Per-user session cap of 12 concurrent sessions; oldest is auto-revoked when the cap is exceeded. Separately, the Next.js app sets an httpOnly `osler-session` cookie (HMAC-signed, no bearer token) so its middleware can gate route access — see [`security.md`](./security.md#route-gating-cookie-nextjs-middleware).
- **Password Recovery**: Supported via optional Resend API key (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`). Reset links are valid for 30 minutes and single-use.
- **Rate Limiting**: Auth endpoints (login, register, reset, google/consume, username-available) are rate-limited per IP using an in-memory LRU bucket. Global per-IP cap of 240 requests/min across all rate-limited routes. Returns HTTP 429 when exceeded. For harder guarantees, front the Worker with Cloudflare Rate Limiting Rules in the dashboard.
- **Audit Log**: Every administrative action (role change, user delete, password reset, session revocation, content create/submit/approve/reject/publish/unpublish/delete) is recorded in `admin_audit`. Retained for 1 year (365 days), pruned by the hourly cron trigger. Viewable at `/admin/audit`.
- **CORS**: Restricted to a single `ALLOWED_ORIGIN`. Empty Origin (server-to-server / curl) is treated as the allowed origin so the worker can be tested locally; browsers always send Origin.
- **Security Headers**: Every JSON response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`, and `Cache-Control: no-store` for authenticated responses. **Exception:** the public content endpoints (`/v1/content/*`, `/v1/content-manifests/*`) override `Cross-Origin-Resource-Policy` to `cross-origin` and set `Cache-Control: public` so the Pages site can read R2-backed content cross-origin.
- **Turnstile**: Optional anti-bot challenge on register/login/reset. Enable by setting `TURNSTILE_ENABLED=true` in `wrangler.toml` and configuring `TURNSTILE_SECRET_KEY` plus `turnstileSiteKey` in `osler.config.json`.

## API Contract Summary

All API routes are prefixed with `/v1`. Authenticated requests carry `Authorization: Bearer <token>`. See [`api-reference.md`](./api-reference.md) for the full request/response schema and examples.

### Auth & Account

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | Public | System health check and feature capabilities (`googleEnabled`, `turnstileEnabled`). |
| `GET` | `/v1/content/<category>/<path>` | Public | Serve a single R2-backed content file cross-origin (`CORP: cross-origin`). |
| `GET` | `/v1/content-manifests/<category>/manifest.json` | Public | Serve a generated category manifest from R2. |
| `POST` | `/v1/auth/register` | Public + Turnstile | Create new account with email/password. |
| `POST` | `/v1/auth/login` | Public + Turnstile | Authenticate with username or email. |
| `GET` | `/v1/auth/username-available` | Public | Live check if username is available. |
| `GET` | `/v1/auth/google/start` | Public | Initiate Google OAuth redirect flow with PKCE nonce. |
| `GET` | `/v1/auth/google/callback` | Public | Google OAuth callback handler (server-side). |
| `POST` | `/v1/auth/google/consume` | Public | Consume single-use handoff ticket for session. |
| `POST` | `/v1/auth/logout` | Session | Revoke active session token. |
| `GET` | `/v1/auth/me` | Session | Get active user profile, role, and auth providers. |
| `PATCH` | `/v1/account` | Session | Update display name and email. |
| `POST` | `/v1/account/password` | Session | Change or set account password. |
| `GET` | `/v1/account/export` | Session | Export full profile and progress as JSON. |
| `DELETE` | `/v1/account` | Session | Delete user account and all cloud data. |
| `POST` | `/v1/auth/reset/request` | Public | Request password reset email (Resend). Always returns `{ok:true}` to prevent email enumeration. |
| `POST` | `/v1/auth/reset/confirm` | Public | Confirm reset token and update password. |

### Sync

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/sync` | Session | Fetch QBank and flashcards progress documents. |
| `PUT` | `/v1/sync` | Session | Upload and merge QBank and flashcards progress. UTF-8 byte size cap of 900 KB per document. |

### Admin — Identity & Stats

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/admin/me` | Session (`admin`/`content_admin`) | Get admin profile with capabilities bitmask (includes `viewAudit`, `manageSessions`). |
| `GET` | `/v1/admin/stats` | Session (`admin`) | Aggregate counts: users, active sessions, content, pending, published, drafts. |
| `GET` | `/v1/admin/audit?page=&action=` | Session (`admin`) | Paginated audit log (50 entries/page) with optional action filter. |

### Analytics — Performance & Usage Telemetry

Privacy-preserving RUM (Real User Monitoring) collected from the browser. The
client-side `AnalyticsProvider` captures Core Web Vitals (LCP, INP, CLS, TTFB,
FCP), route changes, JS errors, and cloud-backend API timings, then POSTs them
in batches. **No PII is stored** — only a per-tab `session_id` that rotates
every 30 min, the pathname (query/hash stripped), browser family, device class,
and effective connection type. Rows are pruned after 30 days by the hourly cron.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/v1/analytics/events` | Session (any signed-in user) | Ingest a batch of up to 50 events. Rate-limited 60/min per IP. |
| `GET` | `/v1/admin/analytics/overview?range=24h\|7d\|30d` | Session (`admin`) | KPI totals + 24h comparison. |
| `GET` | `/v1/admin/analytics/timeseries?range=` | Session (`admin`) | Event counts bucketed by hour (24h) / 6h (7d) / day (30d). |
| `GET` | `/v1/admin/analytics/web-vitals?range=` | Session (`admin`) | p50/p75/p95/min/max for each Core Web Vital metric. |
| `GET` | `/v1/admin/analytics/top-pages?range=&limit=` | Session (`admin`) | Top N paths by views, with unique-session counts. |
| `GET` | `/v1/admin/analytics/errors?range=&limit=` | Session (`admin`) | JS errors grouped by message, with affected paths/sessions. |
| `GET` | `/v1/admin/analytics/api-performance?range=&limit=` | Session (`admin`) | p50/p95/count/max for each cloud-backend endpoint. |

The dashboard UI lives at `/admin/analytics` (super-admin only). To opt out of
collection client-side, set `localStorage.osler_analytics_opt_out = "1"`; the
provider also respects `navigator.doNotTrack === "1"` automatically. In
`NODE_ENV !== "production"` collection is disabled unless explicitly forced
via `localStorage.osler_analytics_force = "1"`.

### Admin — User Management

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/admin/users?page=&q=` | Session (`admin`) | List users (25/page) with optional `q` search across username / display_name / email. LIKE wildcards (`%`, `_`) are escaped. |
| `GET` | `/v1/admin/users/:id` | Session (`admin`) | Get single user profile, active session count, and recent content (up to 25 items). |
| `PATCH` | `/v1/admin/users/:id` | Session (`admin`) | Update user role or display name. **Cannot demote self** — returns 400. |
| `DELETE` | `/v1/admin/users/:id` | Session (`admin`) | Delete user account and all associated data. **Cannot delete self** — returns 400. Content objects are **reassigned to the acting admin** so published content stays live. |
| `POST` | `/v1/admin/users/:id/reset-password` | Session (`admin`) | Reset user password (revokes all their sessions). Same password policy as registration. |
| `GET` | `/v1/admin/users/:id/sessions` | Session (`admin`) | List up to 100 sessions for the user (including revoked/expired for audit). |
| `DELETE` | `/v1/admin/users/:id/sessions` | Session (`admin`) | Revoke all active sessions for the user. |

### Admin — Content Management (R2-backed)

Content objects follow a 4-state workflow: `draft` → `submit` → `pending` → `approve` → `published`, or `reject` → `rejected`. Content can also be published directly skipping review (`publish`), or reverted from published back to draft (`unpublish`). R2 stores the body at `content/<type>/<id>/{draft,pending,published}.json`.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/admin/content?status=&q=` | Session (`admin`/`content_admin`) | List content objects, filtered by status and optional title search. `content_admin` sees only their own non-published content + all published. |
| `GET` | `/v1/admin/content/pending` | Session (`admin`) | List all objects awaiting review, ordered by submission time. |
| `POST` | `/v1/admin/content` | Session (`admin`/`content_admin`) | Create new content object. Requires R2 bucket. Body: `{ contentType, title?, language?, content? }`. |
| `GET` | `/v1/admin/content/:id` | Session (`admin`/`content_admin`) | Get content object metadata + body. Title auto-updated from draft body's `title` field on save. |
| `PUT` | `/v1/admin/content/:id/draft` | Session (`admin`/`content_admin`) | Save draft body to R2. Max 1 MB. |
| `POST` | `/v1/admin/content/:id/submit` | Session (`admin`/`content_admin`) | Snapshot draft → pending for admin review. Clears prior review metadata. |
| `POST` | `/v1/admin/content/:id/approve` | Session (`admin`) | Approve pending content → published. |
| `POST` | `/v1/admin/content/:id/reject` | Session (`admin`) | Reject pending content with reason. |
| `POST` | `/v1/admin/content/:id/publish` | Session (`admin`) | Direct publish skipping review (draft → published). |
| `POST` | `/v1/admin/content/:id/unpublish` | Session (`admin`) | Revert published → draft (R2 published copy is retained for re-publishing). |
| `GET` | `/v1/admin/content/:id/diff` | Session (`admin`) | Get pending vs published diff. |
| `DELETE` | `/v1/admin/content/:id` | Session (`admin`) | Delete content object and all R2 artifacts (draft/pending/published). |

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | HMAC-SHA-256 signing key for session tokens. Generate with `openssl rand -base64 48`. |
| `ALLOWED_ORIGIN` | Yes | Exact origin of the Osler web app (set in `wrangler.toml`). Single origin only. |
| `GOOGLE_CLIENT_ID` | For Google Sign-In | OAuth 2.0 Client ID from Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | For Google Sign-In | OAuth 2.0 Client Secret from Google Cloud Console. |
| `WORKER_URL` | For Google Sign-In | Deployed Worker URL, e.g. `https://osler-cloud.example.workers.dev` (set in `wrangler.toml`). |
| `RESEND_API_KEY` | For password reset | Resend API key for sending password-reset emails. |
| `EMAIL_FROM` | For password reset | Sender address for password-reset emails. |
| `APP_ORIGIN` | For password reset | App origin for password-reset link construction (set in `wrangler.toml`). |
| `TURNSTILE_ENABLED` | Optional | Set to `"true"` to enable Turnstile CAPTCHA on register/login/reset. |
| `TURNSTILE_SECRET_KEY` | If Turnstile enabled | Cloudflare Turnstile secret key. |

## Sync Behavior & Conflict Resolution

Local IndexedDB remains the primary offline storage. While online, progress events automatically trigger a debounced background sync. Newer records (determined by timestamps on QBank questions and flashcard review records) overwrite older ones. On-demand manual sync can also be triggered via the UI. Sync documents are capped at 900 KB UTF-8 bytes each (calculated from `new TextEncoder().encode(...).length`, not string character count, to correctly account for non-ASCII content).

## Cron Trigger

The `[triggers] crons = ["0 * * * *"]` entry in `wrangler.toml` runs the `scheduled` handler hourly. The handler:

1. Deletes expired `oauth_states`, `auth_handoffs`, `password_reset_tokens`.
2. Deletes expired or revoked `sessions`.
3. Deletes `admin_audit` entries older than 1 year (365 days).

This keeps D1 row counts within free-tier limits without affecting active users.

## Migration Management

Apply migrations locally and remotely:

```bash
npm run db:migrate:local     # apply to local D1 (for `wrangler dev`)
npm run db:migrate           # apply to remote D1 (production)
npm run db:list              # list applied/pending migrations
```

Always run `npm run db:migrate:local` first when developing new migrations to catch syntax errors before touching production.
