# Cloudflare backend, accounts, and progress sync

Osler remains local-first by default. When `cloud.enabled` is `false`, the app behaves as a local-only guest session: IndexedDB stores QBank answers and flashcard schedules. When `cloud.enabled` is `true`, the app integrates an optional Cloudflare Worker account backend supporting email/password registration, Google Sign-In (OAuth 2.0), account management, and two-document background progress sync.

## What is included

`cloudflare/worker/` is a deployable, dependency-free Worker project:

- `src/index.mjs` — email/password & Google OAuth authentication, PBKDF2 password hashing, session tokens with server-side revocation, roles (`student` | `admin`), password reset, account management (profile update, password change, data export, account deletion), CORS, Turnstile verification, and sync API.
- `migrations/0001_initial.sql` — base D1 schema for users, sessions, password reset tokens, and progress documents.
- `migrations/0002_accounts_and_google.sql` — schema additions for Google identity links (`auth_identities`), OAuth PKCE/state tokens (`oauth_states`), and single-use handoffs (`auth_handoffs`).
- `wrangler.toml` — Workers & D1 configuration.
- `.dev.vars.example` — secret names template (never commit `.dev.vars`).
- `README.md` — deployment summary.

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
npm run db:migrate
npm run deploy
```

Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact origin hosting the Osler web application. Update `public/osler.config.json`:

```json
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
- **Account Management**: Users can update their display name and email, set/change password, export account data as JSON, and permanently delete their account with password confirmation.
- **Roles**: `student` (default) and `admin`. Admin role allows accessing administrative features.
- **Sessions**: HMAC-SHA-256 signed session tokens with server-side revocation in D1. Session tokens are kept in session storage.
- **Password Recovery**: Supported via optional Resend API key (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`).

## API Contract

All API routes are prefixed with `/v1`. Authenticated requests carry `Authorization: Bearer <token>`.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | Public | System health check and feature capabilities. |
| `POST` | `/v1/auth/register` | Public | Create new account with email/password. |
| `POST` | `/v1/auth/login` | Public | Authenticate with username or email. |
| `GET` | `/v1/auth/username-available` | Public | Live check if username is available. |
| `GET` | `/v1/auth/google/start` | Public | Initiate Google OAuth redirect flow. |
| `GET` | `/v1/auth/google/callback` | Public | Google OAuth callback handler. |
| `POST` | `/v1/auth/google/consume` | Public | Consume single-use OAuth ticket for session. |
| `POST` | `/v1/auth/logout` | Session | Revoke active session token. |
| `GET` | `/v1/auth/me` | Session | Get active user profile, role, and auth providers. |
| `PATCH` | `/v1/account` | Session | Update display name and email. |
| `POST` | `/v1/account/password` | Session | Change or set account password. |
| `GET` | `/v1/account/export` | Session | Export full profile and progress as JSON. |
| `DELETE` | `/v1/account` | Session | Delete user account and all cloud data. |
| `POST` | `/v1/auth/reset/request` | Public | Request password reset email. |
| `POST` | `/v1/auth/reset/confirm` | Public | Confirm token and update password. |
| `GET` | `/v1/sync` | Session | Fetch QBank and flashcards progress documents. |
| `PUT` | `/v1/sync` | Session | Upload and merge QBank and flashcards progress. |

## Sync Behavior & Conflict Resolution

Local IndexedDB remains the primary offline storage. While online, progress events automatically trigger a debounced background sync. Newer records (determined by timestamps on QBank questions and flashcard review records) overwrite older ones. On-demand manual sync can also be triggered via the UI.
