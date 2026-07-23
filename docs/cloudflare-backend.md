# Cloudflare backend, accounts, and progress sync

Osler remains local-first by default. When `cloud.enabled` is `false`, the app behaves exactly as before: local IndexedDB stores QBank answers and flashcard schedules, and users may continue as guests. When enabled, the browser adds an optional Cloudflare Worker account session and syncs only those two data sets.

## What is included

`cloudflare/worker/` is a deployable, dependency-free Worker project:

- `src/index.mjs` — email/password registration and login, signed sessions, roles, password reset, CORS, Turnstile verification, and sync API.
- `migrations/0001_initial.sql` — D1 schema for users, session revocation, reset tokens, and progress documents.
- `wrangler.toml` — Workers/D1 binding configuration.
- `.dev.vars.example` — secret names only; never commit `.dev.vars`.
- `README.md` — short deployment checklist.

The Tauri Admin **New Instance** form has an opt-in Cloudflare section. Enabling it writes `cloud` configuration into `public/osler.config.json` and generates the entire Worker directory into the new instance. It does not write any secret, database id, API token, or password to disk.

## Deploying on the Cloudflare free tier

From `cloudflare/worker`:

```bash
npm install
npx wrangler d1 create osler-cloud
# Copy the returned database_id into wrangler.toml.
npx wrangler secret put JWT_SECRET
npm run db:migrate
npm run deploy
```

Set `ALLOWED_ORIGIN` in `wrangler.toml` to the one exact origin that hosts the Osler web application. Set `public/osler.config.json` to the deployed Worker URL:

```json
"cloud": {
  "enabled": true,
  "apiUrl": "https://osler-cloud.example.workers.dev",
  "syncQbank": true,
  "syncFlashcards": true
}
```

Do not expose `JWT_SECRET`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, or `.dev.vars`. They are Worker secrets. The browser only ever receives the optional public `turnstileSiteKey`.

Cloudflare's current Workers Free plan has a daily request and CPU budget, while D1 has daily read/write limits. The implementation is designed around those limits: one signed session lookup per protected request, two compact documents per user (QBank and flashcards), event-driven debounce, and a 20-second minimum sync interval. It does not use Durable Objects, KV, R2, Queues, or a polling loop.

## Authentication and security

### Accounts

Accounts use a required unique username, a password, a display name, and an optional unique email address. A user may sign in with username or email. Email is optional to support low-friction accounts; accounts without email cannot use password recovery.

The registration screen checks username availability when the field loses focus, and the Worker still enforces the unique constraint at account creation to handle races. Registration requires password confirmation and rejects passwords shorter than ten characters. The interface explicitly warns that an email is optional but required for password recovery.

Passwords are never stored as plaintext. The Worker uses Web Crypto PBKDF2-SHA-256 with a random 16-byte salt and 310,000 iterations. Authentication tokens are HMAC-SHA-256 signed, carry an expiry, and are additionally backed by a hashed, revocable D1 session row. Tokens are stored in browser session storage, not local storage, so closing the browser session removes them. Logging out or completing a password reset revokes the server-side session.

`users.role` is constrained to `student` or `admin`. The initial registration path creates `student` accounts only. Promote the first administrator manually in D1 after verifying the account:

```sql
UPDATE users SET role = 'admin' WHERE username = 'your-admin-username';
```

The role is already included in the signed session and `/v1/auth/me` response, so a future `/admin` route can enforce it without a schema change. This Worker intentionally does not expose an unauthenticated role-escalation endpoint.

### Turnstile and reset email

Turnstile is optional but recommended before allowing public registration. Create a widget in Cloudflare, set `TURNSTILE_ENABLED=true` and `TURNSTILE_SECRET_KEY`, and add its public site key to `cloud.turnstileSiteKey`. The Worker verifies every submitted Turnstile token server-side.

Cloudflare does not provide a general transactional-email sender in this Worker setup. Password reset is therefore implemented through optional [Resend](https://resend.com)'s free tier: set `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_ORIGIN`. Without those three values, reset requests still return a generic success response (preventing account enumeration) but no email is sent. Google/Firebase sign-in is deliberately not enabled because this instance is configured for email/password authentication; the role and session model leaves it possible to add a separate provider later.

### Planned Google sign-in support

Google sign-in should be added as a separate identity provider rather than replacing local accounts. The recommended next phase is a Google OAuth Authorization Code flow with PKCE in the Worker: add an `oauth_identities` table keyed by `(provider, provider_subject)`, verify Google ID tokens against Google's published keys, link a verified Google email to an existing local account only after explicit user confirmation, then issue the same Osler session format. This preserves roles, D1 progress ownership, account deletion, and cloud-sync behavior. Firebase Auth can be used instead only if the product needs multiple social providers and accepts Firebase as the external identity authority; it should still exchange a verified Firebase token for the Worker-issued Osler session. Neither path belongs in the password-only free-tier baseline until its redirect URLs, consent screen, and identity-linking policy are configured.

## API contract

All JSON endpoints are under `/v1`. Except for health and authentication routes, send `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/v1/health` | Deployment health check. |
| `POST` | `/v1/auth/register` | Create a student account and session. |
| `GET` | `/v1/auth/username-available?username=...` | Check whether a valid username is unclaimed. |
| `POST` | `/v1/auth/login` | Sign in using username or email and password. |
| `POST` | `/v1/auth/logout` | Revoke the active session. |
| `GET` | `/v1/auth/me` | Read the signed-in public user and role. |
| `POST` | `/v1/auth/reset/request` | Request a reset email without revealing whether the account exists. |
| `POST` | `/v1/auth/reset/confirm` | Consume a reset token, set a new password, revoke sessions. |
| `GET` | `/v1/sync` | Read QBank and flashcard documents. |
| `PUT` | `/v1/sync` | Merge and save supplied QBank and/or flashcard documents. |

## Sync behavior and conflicts

The local IndexedDB store is always the active offline store. A signed-in cloud user can study while offline. A local QBank answer includes a `timestamp`; a flashcard review includes `lastReviewed`. On reconnect or a local progress event, the client pulls the remote data, merges newer records into IndexedDB, then uploads the two maps. The Worker performs the same per-record merge before persisting it.

For the same QBank question or flashcard on two devices, the newest timestamp wins. Distinct records merge together. This makes progress convergence deterministic while avoiding per-answer server writes. The server rejects documents over approximately 900 KB to protect the Worker/D1 free tier; the selected data is expected to stay comfortably below that for normal study use.

## Operational checklist

1. Deploy the Worker and run the D1 migration before enabling `cloud.enabled` in production.
2. Set the exact production `ALLOWED_ORIGIN`; never use a wildcard for an authenticated API.
3. Generate a unique high-entropy `JWT_SECRET` for each environment and rotate it by re-authenticating users.
4. Use separate D1 databases, Workers, Turnstile widgets, and secrets for development and production.
5. Enable Turnstile before making registration public.
6. Configure Resend only after verifying its sender domain; test reset with a non-admin account.
7. Monitor Worker request count and D1 rows read/written in the Cloudflare dashboard. If free limits are exceeded, cloud requests can fail until the daily reset; local progress remains intact and will retry later.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, provide a development-only `JWT_SECRET`, then run:

```bash
npm install
npm run db:migrate:local
npm run dev
```

Point the app's `cloud.apiUrl` at the local Wrangler URL and set `ALLOWED_ORIGIN` to `http://localhost:3000`. Keep `TURNSTILE_ENABLED=false` locally unless using Cloudflare's documented test keys.
