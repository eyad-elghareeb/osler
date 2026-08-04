# Osler Cloud Worker — API Reference

This is the complete HTTP API reference for the Osler Cloud Worker backend (`cloudflare/worker/src/index.ts`). Osler is a local-first medical study platform (QBank, flashcards, OSCE practice, written-question practice, library, videos) with an optional Cloudflare Worker account backend supporting email/password and Google Sign-In, cross-device progress sync, role-based admin, and an R2-backed content workflow.

> **Source:** `cloudflare/worker/src/index.ts`
> **Related guides:** [`cloudflare-backend.md`](./cloudflare-backend.md) · [`hosting.md`](./hosting.md) · [`security.md`](./security.md) · [`environment.md`](./environment.md)

---

## Table of Contents

1. [Conventions](#1-conventions)
   - [Base URL & routing](#base-url--routing)
   - [Authentication](#authentication)
   - [Request & response format](#request--response-format)
   - [Security headers](#security-headers)
   - [CORS](#cors)
   - [Rate limiting](#rate-limiting)
   - [Errors](#errors)
2. [Session token lifecycle](#2-session-token-lifecycle)
3. [Public endpoints](#3-public-endpoints)
   - [GET /v1/health](#get-v1health)
   - [GET /v1/content/\<category\>/\<path\>](#get-v1contentcategorypath)
   - [GET /v1/content-manifests/\<category\>/manifest.json](#get-v1content-manifestscategorymanifestjson)
   - [POST /v1/auth/register](#post-v1authregister)
   - [POST /v1/auth/login](#post-v1authlogin)
   - [GET /v1/auth/username-available](#get-v1authusername-available)
   - [GET /v1/auth/google/start](#get-v1authgooglestart)
   - [GET /v1/auth/google/callback](#get-v1authgooglecallback)
   - [POST /v1/auth/google/consume](#post-v1authgoogleconsume)
   - [POST /v1/auth/reset/request](#post-v1authresetrequest)
   - [POST /v1/auth/reset/confirm](#post-v1authresetconfirm)
4. [Authenticated user endpoints](#4-authenticated-user-endpoints)
   - [POST /v1/auth/logout](#post-v1authlogout)
   - [POST /v1/auth/refresh](#post-v1authrefresh)
   - [GET /v1/auth/me](#get-v1authme)
   - [PATCH /v1/account](#patch-v1account)
   - [POST /v1/account/password](#post-v1accountpassword)
   - [GET /v1/account/export](#get-v1accountexport)
   - [DELETE /v1/account](#delete-v1account)
5. [Sync endpoints](#5-sync-endpoints)
   - [GET /v1/sync](#get-v1sync)
   - [PUT /v1/sync](#put-v1sync)
6. [Admin endpoints](#6-admin-endpoints)
   - [Roles & capabilities](#roles--capabilities)
   - [GET /v1/admin/me](#get-v1adminme)
   - [GET /v1/admin/stats](#get-v1adminstats)
   - [GET /v1/admin/audit](#get-v1adminaudit)
   - [GET /v1/admin/users](#get-v1adminusers)
   - [GET /v1/admin/users/:id](#get-v1adminusersid)
   - [PATCH /v1/admin/users/:id](#patch-v1adminusersid)
   - [DELETE /v1/admin/users/:id](#delete-v1adminusersid)
   - [POST /v1/admin/users/:id/reset-password](#post-v1adminusersidreset-password)
   - [GET /v1/admin/users/:id/sessions](#get-v1adminusersidsessions)
   - [DELETE /v1/admin/users/:id/sessions](#delete-v1adminusersidsessions)
   - [GET /v1/admin/content](#get-v1admincontent)
   - [GET /v1/admin/content/pending](#get-v1admincontentpending)
   - [POST /v1/admin/content](#post-v1admincontent)
   - [GET /v1/admin/content/:id](#get-v1admincontentid)
   - [PUT /v1/admin/content/:id/draft](#put-v1admincontentiddraft)
   - [POST /v1/admin/content/:id/submit](#post-v1admincontentidsubmit)
   - [POST /v1/admin/content/:id/approve](#post-v1admincontentidapprove)
   - [POST /v1/admin/content/:id/reject](#post-v1admincontentidreject)
   - [POST /v1/admin/content/:id/publish](#post-v1admincontentidpublish)
   - [POST /v1/admin/content/:id/unpublish](#post-v1admincontentidunpublish)
   - [GET /v1/admin/content/:id/diff](#get-v1admincontentiddiff)
   - [DELETE /v1/admin/content/:id](#delete-v1admincontentid)
7. [Common error patterns & how to handle them](#7-common-error-patterns--how-to-handle-them)
8. [Revision history](#8-revision-history)

---

## 1. Conventions

### Base URL & routing

All API routes are prefixed with `/v1`. The version prefix is fixed; there is no unversioned alias. Any path that does not match a known route returns `404 {"error":"Not found"}`.

```
https://<your-worker-domain>.workers.dev/v1/...
```

Where `<your-worker-domain>` is the domain you deployed the Worker to (set as `WORKER_URL` in `wrangler.toml`). For local development with `wrangler dev`, use `http://127.0.0.1:8787`.

### Authentication

Authenticated requests carry a single header:

```
Authorization: Bearer <token>
```

The token is the `token` field from any session-issuing response (`/v1/auth/register`, `/v1/auth/login`, `/v1/auth/google/consume`, `/v1/account/password`). Tokens are HMAC-SHA-256 signed and validated server-side against the `sessions` table on every authenticated request — see [Session token lifecycle](#2-session-token-lifecycle).

Public endpoints (`/v1/health`, `/v1/content/*`, `/v1/content-manifests/*`, the `/v1/auth/*` family except `logout`, and the Google OAuth `start`/`callback` redirects) do not require a token.

### Request & response format

- **Request body** for `POST`/`PUT`/`PATCH`/`DELETE` routes is JSON (`Content-Type: application/json`), with **one exception**: `PUT /v1/admin/content/:id/draft` accepts a raw text body (see that endpoint for details).
- **Request body size cap**: 1,000,000 bytes per request for JSON parsers. Draft bodies may be up to 1,000,000 bytes (1 MB). Sync documents are capped at 900,000 UTF-8 bytes each.
- **Response body**: always JSON, with `Content-Type: application/json; charset=utf-8`. Even errors. Empty bodies are never returned.
- **Encoding**: UTF-8 throughout. Multi-byte characters in sync documents are measured by byte length (`new TextEncoder().encode(...).length`), not character count, to enforce the 900 KB cap correctly.
- **Dates & timestamps**: all timestamps are integers representing Unix epoch milliseconds (`Date.now()`-style). Example: `1735000000000`.

### Security headers

Every JSON response includes the following security headers:

| Header | Value |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| `Cache-Control` | `no-store` for authenticated responses (see below) |
| `Access-Control-Allow-Origin` | Echoed request `Origin` (or `ALLOWED_ORIGIN` for server-to-server) |
| `Access-Control-Allow-Methods` | `GET, POST, PUT, PATCH, DELETE, OPTIONS` |
| `Access-Control-Allow-Headers` | `authorization, content-type` |
| `Access-Control-Max-Age` | `86400` |
| `Vary` | `Origin` |

`Cache-Control` is set to:

- `no-store` — for all authenticated responses, `/v1/auth/username-available`, and all error responses.
- `public, max-age=60` — for `GET /v1/health` and the public content endpoints' JSON/Markdown responses.
- `public, max-age=86400, immutable` — for the public content endpoints' non-JSON/Markdown assets (images, PDFs, video, CSS/JS).

**CORP exception:** the public content endpoints (`/v1/content/*`, `/v1/content-manifests/*`) override `Cross-Origin-Resource-Policy` to `cross-origin` (the default is `same-origin`) so the Pages site — a different origin — can read R2-backed content. All other endpoints keep `CORP: same-origin`.

OAuth redirect responses (302s from `/v1/auth/google/start` and `/v1/auth/google/callback`) do not carry the JSON security headers because they are not JSON; they rely on the browser to follow the redirect.

### CORS

The Worker is locked to a single `ALLOWED_ORIGIN` (set in `wrangler.toml`). Requests carrying an `Origin` header that does not match are rejected with `403 {"error":"Origin is not allowed"}` before any logic runs.

**Empty Origin** (server-to-server calls, curl without `Origin`) is treated as the allowed origin so you can exercise the API from scripts. Browsers always send `Origin` on cross-origin requests.

`OPTIONS` preflight requests get an empty `204 No Content` response with the CORS headers and never reach route logic.

### Rate limiting

Auth-sensitive routes are rate-limited per IP using an in-memory LRU. Cloudflare Workers recycle isolates so this is **best-effort**; for hard guarantees, front the Worker with Cloudflare Rate Limiting Rules in the dashboard.

| Bucket | Limit | Window | Routes |
| --- | --- | --- | --- |
| `auth:login` | 12 | 60s | `POST /v1/auth/login` |
| `auth:register` | 6 | 60s | `POST /v1/auth/register`, `GET /v1/auth/username-available` |
| `auth:reset` | 6 | 60s | `POST /v1/auth/reset/request`, `POST /v1/auth/reset/confirm` |
| `auth:google:consume` | 12 | 60s | `POST /v1/auth/google/consume` |
| `auth:refresh` | 30 | 60s | `POST /v1/auth/refresh` |
| `admin` | 600 | 60s | `POST /v1/admin/*` content management |
| `ip:global` | 600 | 60s | All rate-limited routes combined |

When any bucket is exceeded, the response is `429 Too Many Requests`:

```json
{ "error": "Too many attempts. Please try again in a minute." }
```

The exact wording varies slightly per route (`"Too many login attempts..."`, `"Too many registration attempts..."`, `"Too many reset attempts..."`, `"Too many attempts"`). Clients should treat any `429` from these routes as a rate-limit hit and back off for at least 60 seconds.

The LRU drops its ~100 oldest entries when the map grows past 2,000 entries, so per-IP tracking does not unboundedly grow memory.

### Errors

All errors return JSON of the form:

```json
{ "error": "Human-readable message" }
```

Common status codes:

| Status | Meaning | Example trigger |
| --- | --- | --- |
| `400` | Invalid input (validation error) | Malformed JSON, invalid username, weak password, missing `confirm: "DELETE"` |
| `401` | Authentication required or invalid credentials | Missing/expired/revoked bearer token, wrong password on login |
| `403` | Authenticated but forbidden | Wrong role (e.g. `student` calling `/v1/admin/*`), `content_admin` reading another user's draft, disallowed `Origin` |
| `404` | Resource not found | Unknown route, unknown user/content ID, content object not in DB |
| `409` | Conflict | Duplicate username or email on register / account update |
| `429` | Rate limited | Per-IP or per-bucket limit exceeded |
| `500` | Internal server error | Unexpected exception (logged via `console.error` to Worker logs) |
| `503` | Service unavailable | `DB`/`JWT_SECRET` not configured, Google Sign-In not configured, R2 (`CONTENT`) not bound |

The 500 path inspects the exception message and returns `400` with the raw message if it looks like a user error (contains "Invalid", "too large", "required", or "already in use"); otherwise it logs the error and returns `{"error":"Internal server error"}`.

---

## 2. Session token lifecycle

Sessions are HMAC-SHA-256 signed tokens stored server-side in the D1 `sessions` table. The format is:

```
<base64url(payload)>.<base64url(hmac-sha256(payload, JWT_SECRET))>
```

where `payload` is a JSON object:

```json
{
  "sub": "user-uuid",
  "sid": "session-uuid",
  "role": "student",
  "exp": 1735000000
}
```

- `sub` — user ID (matches `users.id`)
- `sid` — session ID (matches `sessions.id`, used for revocation lookups)
- `role` — `student` / `content_admin` / `admin` (snapshot at issuance; role changes do not retro-actively change existing tokens)
- `exp` — Unix epoch **seconds** (not ms) at which the token expires

**Validation on every authenticated request** (`requireUser`):

1. Split token on `.`. Reject if either half is missing.
2. Recompute HMAC-SHA-256 of the payload using `JWT_SECRET` and constant-time compare with the signature. Reject on mismatch.
3. Decode payload, ensure `sub` and `sid` are present and `exp * 1000 > Date.now()`.
4. Look up the session row by `sid` and SHA-256 of the full token (so a leaked `sessions` table cannot be replayed without also knowing `JWT_SECRET`).
5. Ensure `revoked_at IS NULL` and `expires_at > now()`.
6. Return the joined `users` row.

### Lifespan & limits

| Property | Value |
| --- | --- |
| Session TTL | 7 days (`SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000`) |
| Max sessions per user | 12 (`MAX_SESSIONS_PER_USER`) |
| Cleanup | Hourly cron prunes sessions where `expires_at < now()` OR `revoked_at IS NOT NULL` |

When a user issues a 13th session, the oldest currently-active session is revoked to make room — users stay signed in on their newest devices.

### Revocation

Sessions are revoked in the following scenarios:

| Trigger | Effect |
| --- | --- |
| `POST /v1/auth/logout` | Current session revoked |
| `POST /v1/auth/refresh` | Presented session revoked, fresh session issued (rotation) |
| `POST /v1/account/password` | All OTHER sessions for the user revoked (the current one is preserved and a new one is issued) |
| `POST /v1/auth/reset/confirm` | ALL sessions for the user revoked |
| `POST /v1/admin/users/:id/reset-password` | ALL sessions for the target user revoked |
| `DELETE /v1/admin/users/:id/sessions` | ALL active sessions for the target user revoked |
| `DELETE /v1/admin/users/:id` | Sessions deleted along with the user (cascade) |
| `DELETE /v1/account` | Sessions deleted along with the user (cascade) |
| Session cap exceeded on new login | Oldest N sessions revoked to maintain cap of 12 |

Revoked sessions are not deleted immediately — they are kept until the next cron run so admins can audit the revocation event via `GET /v1/admin/users/:id/sessions` (which returns revoked and expired sessions too).

### Token storage on the client

The frontend stores session tokens in `sessionStorage` (per-tab fast path) **mirrored to `localStorage`** (cross-tab / cross-restart persistence). This keeps an active account signed in across new tabs and browser restarts instead of silently degrading to a local-only session. Session lifetime is sliding: the client rotates the token via `POST /v1/auth/refresh` before expiry and on 401. See [`security.md`](./security.md#session-storage-client) for the full rationale and trade-offs.

Separately, route gating is enforced client-side by `RouteGuard` (see [`security.md`](./security.md#route-gating-client-side-no-middleware)) — there is no httpOnly cookie and no `/api/auth/session` route, since the frontend is a static export with no server runtime.

---

## 3. Public endpoints

Public endpoints do not require a bearer token. Several (register, login, reset) accept an optional `turnstileToken` field that is verified against Cloudflare Turnstile when `TURNSTILE_ENABLED=true`.

### GET /v1/health

Liveness probe and feature-capability advertisement. Used by the frontend at boot to decide which sign-in options to show.

- **Auth**: none
- **Cache**: `Cache-Control: public, max-age=60` — safe to cache at the edge and in the browser for 60 seconds.
- **Rate limit**: none

#### Query parameters

None.

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/health
```

#### Example success response (200)

```json
{
  "ok": true,
  "googleEnabled": true,
  "turnstileEnabled": false
}
```

`googleEnabled` is `true` only when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `WORKER_URL` are all set. `turnstileEnabled` mirrors the `TURNSTILE_ENABLED` env var (string `"true"`).

#### Errors

This endpoint has no expected error responses in normal operation. If `DB` or `JWT_SECRET` are not configured (the Worker is misconfigured), the global pre-check returns `503 {"error":"Worker is not configured"}`.

---

### GET /v1/content/<category>/<path>

Serves a single R2-backed content file to the frontend cross-origin. Used when the app is configured to read content from the cloud backend (via `cloud.apiUrl`) instead of the static `public/osler-content/` folder.

- **Auth**: none
- **Cache**: `Cache-Control: public, max-age=86400, immutable` for non-JSON/Markdown assets (images, PDFs, video, CSS/JS); `Cache-Control: public, max-age=60` for `.json` and `.md` files.
- **Rate limit**: `content` bucket — 240 req/min per IP (shared global cap; see [Rate limiting](#rate-limiting)).
- **CORP**: `Cross-Origin-Resource-Policy: cross-origin` — overrides the `same-origin` default so the Pages site can read the body.

#### Path parameters

| Parameter | Description |
| --- | --- |
| `category` | Content category — one of `qbank`, `flashcard`, `osce`, `library`, `videos`. |
| `path` | Path of the file within the category, e.g. `Cardiology/questions.json` or `Heart/images/diagram.png`. Double slashes are collapsed. |

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/content/qbank/Cardiology/questions.json
```

#### Example success response (200)

Raw file bytes with the correct `Content-Type` (inferred from the extension, e.g. `application/json`, `image/png`, `application/pdf`) plus the CORS and security headers above.

#### Errors

- `404 {"error":"Not found"}` — the key does not exist in the `content-files/` R2 bucket.
- `503 {"error":"Content storage not configured"}` — the `CONTENT` R2 binding is missing.
- `429 {"error":"Too many requests"}` — rate limit exceeded.

---

### GET /v1/content-manifests/<category>/manifest.json

Serves a single generated manifest file from R2. Manifests map a category's folder tree and are produced by the content-publishing workflow; the frontend fetches them to build the content tree.

- **Auth**: none
- **Cache**: `Cache-Control: public, max-age=60`.
- **Rate limit**: `content` bucket — 240 req/min per IP (see [Rate limiting](#rate-limiting)).
- **CORP**: `Cross-Origin-Resource-Policy: cross-origin`.

#### Path parameters

| Parameter | Description |
| --- | --- |
| `category` | Content category — one of `qbank`, `flashcard`, `osce`, `library`, `videos`. |

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/content-manifests/qbank/manifest.json
```

#### Example success response (200)

The category's `manifest.json` (the same shape `npm run generate-manifests` produces for the static folder). Double slashes in the path are collapsed.

#### Errors

- `404 {"error":"Not found"}` — the manifest does not exist in the `content-manifests/` R2 bucket.
- `503 {"error":"Content storage not configured"}` — the `CONTENT` R2 binding is missing.

---

### POST /v1/auth/register

Create a new student-tier account with username + password (and optionally email). On success, immediately issues a session token so the client does not need a separate login step.

- **Auth**: none
- **Body**: JSON
- **Rate limit**: `auth:register` (6/min/IP) + global cap (600/min/IP)
- **Turnstile**: optional `turnstileToken` field, verified only when `TURNSTILE_ENABLED=true`

#### Request body schema

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `username` | string | yes | Matches `/^[a-zA-Z0-9_.-]{3,32}$/` (3–32 chars; letters, digits, `.`, `_`, `-`) |
| `password` | string | yes | 10–200 chars; must contain at least **2** of: lowercase, uppercase, digit, symbol |
| `email` | string | no | Must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and be ≤254 chars; stored lowercased |
| `displayName` | string | no | Trimmed and truncated to 80 chars; defaults to `username` |
| `turnstileToken` | string | no | Required only when Turnstile is enabled |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/auth/register \
  -H "content-type: application/json" \
  -d '{
    "username": "medstudent2025",
    "email": "alice@medschool.edu",
    "displayName": "Alice (MS2)",
    "password": "Cardiology#2025"
  }'
```

#### Example success response (201 Created)

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9.aeyJzdWIiOi...",
  "expiresAt": 1735606400000,
  "user": {
    "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    "username": "medstudent2025",
    "displayName": "Alice (MS2)",
    "role": "student",
    "email": "alice@medschool.edu"
  }
}
```

#### Example error responses

Invalid input — `400`:

```json
{ "error": "Invalid registration details" }
```

Turnstile failed — `400`:

```json
{ "error": "Verification failed" }
```

Duplicate username or email — `409`:

```json
{ "error": "That username or email is already in use" }
```

Rate limited — `429`:

```json
{ "error": "Too many registration attempts. Please try again in a minute." }
```

---

### POST /v1/auth/login

Authenticate with username **or** email plus password.

- **Auth**: none
- **Body**: JSON
- **Rate limit**: `auth:login` (12/min/IP) + global cap
- **Turnstile**: optional

#### Request body schema

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `identifier` | string | yes | Username or email; case-insensitive match against both columns |
| `password` | string | yes | Must pass the standard password shape check (10+ chars, 2+ classes) — used here only as a quick-reject; the actual check is the PBKDF2 hash compare |
| `turnstileToken` | string | no | Required only when Turnstile is enabled |

> **Enumeration protection**: the response is identical whether the username is unknown or the password is wrong. Both return `401 {"error":"Invalid username or password"}`. Do not change the client UX based on which field failed.

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/auth/login \
  -H "content-type: application/json" \
  -d '{
    "identifier": "alice@medschool.edu",
    "password": "Cardiology#2025"
  }'
```

#### Example success response (200 OK)

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9.aeyJzdWIiOi...",
  "expiresAt": 1735606400000,
  "user": {
    "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    "username": "medstudent2025",
    "displayName": "Alice (MS2)",
    "role": "student",
    "email": "alice@medschool.edu"
  }
}
```

#### Example error responses

Bad credentials (or unknown user) — `401`:

```json
{ "error": "Invalid username or password" }
```

Turnstile failed — `400`:

```json
{ "error": "Verification failed" }
```

Rate limited — `429`:

```json
{ "error": "Too many login attempts. Please try again in a minute." }
```

---

### GET /v1/auth/username-available

Live check whether a username is available for registration. Used by the signup form to give instant feedback as the user types.

- **Auth**: none
- **Rate limit**: `auth:register` (shares bucket with registration) + global cap
- **Cache**: `no-store` — always returns fresh data

#### Query parameters

| Name | Type | Required | Constraints |
| --- | --- | --- | --- |
| `username` | string | yes | Validated against `/^[a-zA-Z0-9_.-]{3,32}$/`; invalid usernames always return `{available:false}` |

#### Example request

```bash
curl -s "https://osler-cloud.example.workers.dev/v1/auth/username-available?username=medstudent2025"
```

#### Example success response (200 OK)

Available:

```json
{ "available": true }
```

Taken:

```json
{ "available": false }
```

Invalid format (also 200, not 400 — so the client can use the same code path):

```json
{ "available": false }
```

#### Example error responses

Rate limited — `429`:

```json
{ "error": "Too many attempts" }
```

---

### GET /v1/auth/google/start

Initiate the Google OAuth 2.0 redirect flow. Generates a state + nonce, persists them to the `oauth_states` table with a 10-minute TTL, and redirects the browser to Google's consent screen.

- **Auth**: none
- **Rate limit**: none
- **Response**: `302 Found` with `Location` header pointing at Google (or an error JSON if Google Sign-In is not configured)

#### Query parameters

| Name | Type | Required | Constraints |
| --- | --- | --- | --- |
| `returnTo` | string | yes | Must be a parseable URL whose `origin` exactly matches `ALLOWED_ORIGIN`. Used to redirect the user back to the app after the OAuth round-trip. |

#### Example request

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -G \
  "https://osler-cloud.example.workers.dev/v1/auth/google/start" \
  --data-urlencode "returnTo=https://osler.example.pages.dev/settings"
```

#### Example success response (302)

```
HTTP/2 302
location: https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&response_type=code&scope=openid+email+profile&state=...&nonce=...&prompt=select_account
```

The OAuth scope is `openid email profile` and `prompt=select_account` is sent so users with multiple Google accounts get a chooser.

#### Example error responses

Google Sign-In not configured — `503`:

```json
{ "error": "Google sign-in is not configured" }
```

Missing or invalid `returnTo` — `400`:

```json
{ "error": "Invalid return URL" }
```

The same `400` is returned if `returnTo`'s origin does not match `ALLOWED_ORIGIN`.

---

### GET /v1/auth/google/callback

OAuth 2.0 redirect endpoint. Google sends the user back here with `?state=&code=` after they consent. The Worker verifies the state, exchanges the code for an ID token, verifies the ID token (RS256 signature, audience, issuer, expiry, nonce, `email_verified`), creates or links the user, generates a single-use handoff ticket, and redirects the browser back to the original `returnTo` URL with `?cloudAuth=<ticket>` appended.

- **Auth**: none
- **Rate limit**: none (state is single-use so brute-force is infeasible)
- **Response**: `302 Found`

This endpoint is **never called directly by clients**. It is the OAuth redirect URI registered with Google. Set Google Cloud Console's Authorized Redirect URI to:

```
https://<your-worker-domain>.workers.dev/v1/auth/google/callback
```

#### Query parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `state` | string | yes | The opaque state token issued by `/v1/auth/google/start`. Single-use. |
| `code` | string | yes | The authorization code from Google. |

#### Example success response (302)

On success:

```
HTTP/2 302
location: https://osler.example.pages.dev/?cloudAuth=<handoff-ticket>
```

The handoff ticket is a single-use, 5-minute-TTL opaque string. The frontend extracts it from the URL and submits it to `POST /v1/auth/google/consume` to obtain a real session token.

#### Example error responses

There are no JSON error responses — on any failure (missing state, expired state, bad code, ID-token verification failure), the Worker redirects to:

```
<ALLOWED_ORIGIN>/?cloudAuthError=google
```

(or `<returnTo>/?cloudAuthError=google` if state was valid but the token exchange failed). The frontend shows a generic "Google sign-in failed" message and lets the user retry.

---

### POST /v1/auth/google/consume

Exchange the single-use handoff ticket (obtained from the OAuth callback redirect) for a real session token.

- **Auth**: none
- **Body**: JSON
- **Rate limit**: `auth:google:consume` (12/min/IP) + global cap

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ticket` | string | yes | The opaque ticket from the `?cloudAuth=` query param |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/auth/google/consume \
  -H "content-type: application/json" \
  -d '{"ticket":"a3f8c1d2...e9b4f6a7"}'
```

#### Example success response (200 OK)

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9.aeyJzdWIiOi...",
  "expiresAt": 1735606400000,
  "user": {
    "id": "b2c1d0e9-...",
    "username": "alice-smith",
    "displayName": "Alice Smith",
    "role": "student",
    "email": "alice@gmail.com"
  }
}
```

#### Example error responses

Invalid, expired, or already-used ticket — `400`:

```json
{ "error": "This sign-in link is invalid or expired" }
```

Rate limited — `429`:

```json
{ "error": "Too many attempts. Please try again in a minute." }
```

---

### POST /v1/auth/reset/request

Request a password reset email. **Always returns `200 {"ok":true}` regardless of whether the email exists in the system**, to prevent email enumeration. The actual email is sent only if (a) the email matches a user, (b) Resend is configured, and (c) Turnstile passes (when enabled).

- **Auth**: none
- **Body**: JSON
- **Rate limit**: `auth:reset` (shares bucket with `/v1/auth/reset/confirm`) + global cap

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes | Validated with the standard email regex |
| `turnstileToken` | string | no | Required only when Turnstile is enabled |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/auth/reset/request \
  -H "content-type: application/json" \
  -d '{"email":"alice@medschool.edu"}'
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

(Identical whether or not the email exists, and whether or not Resend is configured.)

#### Email contents

If the email matches a user and Resend is configured, the Worker sends an HTML email from `EMAIL_FROM` with subject "Reset your Osler password" containing a link of the form:

```
<APP_ORIGIN>/?reset=<token>
```

The token is a single-use, 30-minute-TTL opaque string (sha256-hashed in the `password_reset_tokens` table). The user clicks the link, the frontend extracts `?reset=`, and the user is prompted for a new password which is submitted to `POST /v1/auth/reset/confirm`.

#### Example error responses

Rate limited — `429`:

```json
{ "error": "Too many reset attempts. Please try again in a minute." }
```

---

### POST /v1/auth/reset/confirm

Confirm a password reset by submitting the token (from the email link) and a new password.

- **Auth**: none
- **Body**: JSON
- **Rate limit**: `auth:reset` (shares bucket with `/v1/auth/reset/request`) + global cap

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | yes | The opaque token from the email link |
| `password` | string | yes | Must pass standard password policy (10–200 chars, 2+ character classes) |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/auth/reset/confirm \
  -H "content-type: application/json" \
  -d '{
    "token": "a3f8c1d2e9b4f6a7...",
    "password": "NewCardiology#2025"
  }'
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

Side effects:

1. The user's password hash is updated.
2. The reset token is marked used (cannot be replayed).
3. **All** of the user's existing sessions are revoked (including any that may have been active on a compromised device).

The user must log in fresh with the new password.

#### Example error responses

Invalid or expired token, weak password — `400`:

```json
{ "error": "This reset link is invalid or expired" }
```

or

```json
{ "error": "Invalid reset request" }
```

Rate limited — `429`:

```json
{ "error": "Too many reset attempts. Please try again in a minute." }
```

---

## 4. Authenticated user endpoints

All routes in this section require a valid `Authorization: Bearer <token>` header. Tokens with the wrong signature, expired tokens, revoked tokens, or sessions whose user has been deleted all return `401 {"error":"Authentication required"}`.

### POST /v1/auth/logout

Revoke the current session. Idempotent: calling logout with no token, an invalid token, or an already-revoked token still returns `200 {"ok":true}`.

- **Auth**: optional (the route does not 401 if the token is missing — it just no-ops)
- **Body**: none

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/auth/logout \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

#### Errors

No expected error responses. Even unauthenticated calls succeed.

### POST /v1/auth/refresh

Rotate the current session without a password (sliding expiry). Unlike every other authenticated route, this route does **not** enforce the token's JWT `exp` claim — it accepts a token whose HMAC signature is still valid as long as the D1 session row is unrevoked and within 30 days of its DB expiry (`SESSION_REFRESH_GRACE_MS`). On success the presented session is revoked and a brand-new 7-day session is issued, so a rotated token can never be replayed. The frontend uses this to keep active accounts signed in across the 7-day token TTL.

- **Auth**: the expiring/expired bearer token (via the `Authorization` header)
- **Body**: none (`{}`)

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/auth/refresh \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{}'
```

#### Example success response (200 OK)

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9....",
  "expiresAt": 1754856000000,
  "user": { "id": "u_123", "username": "jane", "displayName": "Jane", "role": "student", "email": "jane@example.com" }
}
```

#### Errors

| Status | Body `error` |
| --- | --- |
| `401` | `Session is no longer valid — please sign in again` (revoked, expired beyond grace, bad signature, or unknown user) |
| `429` | `Too many attempts` (rate limit) |

---

### GET /v1/auth/me

Get the current user's profile and linked auth providers.

- **Auth**: required
- **Body**: none

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/auth/me \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "user": {
    "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    "username": "medstudent2025",
    "displayName": "Alice (MS2)",
    "role": "student",
    "email": "alice@medschool.edu",
    "hasPassword": true
  },
  "providers": ["google"]
}
```

`hasPassword` is `false` for accounts created via Google Sign-In that have never had a password set. The frontend uses this to decide whether to show the "Set password" or "Change password" UI.

`providers` is the list of linked identity providers, currently always `["google"]` (or `[]` if the user is email/password-only).

#### Example error responses

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### PATCH /v1/account

Update the current user's display name and/or email.

- **Auth**: required
- **Body**: JSON

#### Request body schema

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `displayName` | string | no | Trimmed and truncated to 80 chars; must be non-empty if present |
| `email` | string \| null | no | Must pass email regex if non-null; pass `null` or `""` to clear the email; stored lowercased |

Both fields are optional. Omitting a field leaves it unchanged.

#### Example request

```bash
curl -s -X PATCH https://osler-cloud.example.workers.dev/v1/account \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{
    "displayName": "Alice Smith (MS3)",
    "email": "alice.smith@medschool.edu"
  }'
```

#### Example success response (200 OK)

```json
{
  "user": {
    "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    "username": "medstudent2025",
    "displayName": "Alice Smith (MS3)",
    "role": "student",
    "email": "alice.smith@medschool.edu",
    "hasPassword": true
  },
  "providers": ["google"]
}
```

#### Example error responses

Invalid input — `400`:

```json
{ "error": "Invalid account details" }
```

Email already in use by another account — `409`:

```json
{ "error": "That email is already in use" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/account/password

Set or change the current user's password.

- **Auth**: required
- **Body**: JSON

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `password` | string | yes | New password; must pass standard policy (10–200 chars, 2+ character classes) |
| `currentPassword` | string | conditional | Required if and only if the user's `has_password` flag is `true`. Verified against the stored PBKDF2 hash. |

For Google-only accounts (`hasPassword: false`), `currentPassword` is not required and is ignored if provided — this endpoint is used to set an initial password.

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/account/password \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{
    "currentPassword": "Cardiology#2025",
    "password": "Cardiology#2026"
  }'
```

#### Example success response (200 OK)

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9.aeyJzdWIiOi...",
  "expiresAt": 1735606400000,
  "user": {
    "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    "username": "medstudent2025",
    "displayName": "Alice (MS2)",
    "role": "student",
    "email": "alice@medschool.edu"
  }
}
```

A **fresh session token** is returned and the old one is preserved (not revoked). All OTHER sessions for the user are revoked — the user stays logged in only on the device that changed the password (and any sessions issued before this call on other devices are killed).

#### Example error responses

Weak new password — `400`:

```json
{ "error": "Password must be at least 10 characters with 2 character classes" }
```

Wrong current password (or `has_password=true` and `currentPassword` missing) — `401`:

```json
{ "error": "Current password is incorrect" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/account/export

Export the user's full account profile and all synced progress as a single JSON document. Used by the "Download my data" UI in account settings (GDPR-friendly data portability).

- **Auth**: required
- **Body**: none

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/account/export \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -o account-export.json
```

#### Example success response (200 OK)

```json
{
  "account": {
    "user": {
      "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      "username": "medstudent2025",
      "displayName": "Alice (MS2)",
      "role": "student",
      "email": "alice@medschool.edu",
      "hasPassword": true
    },
    "providers": ["google"]
  },
  "progress": {
    "qbank": {
      "records": {
        "cardio-mi-001": {
          "timestamp": 1735000000000,
          "correct": 7,
          "total": 10,
          "lastAnswered": 1734999999000
        },
        "resp-asthma-004": {
          "timestamp": 1735000100000,
          "correct": 9,
          "total": 10
        }
      },
      "updatedAt": 1735000100000
    },
    "flashcards": {
      "records": {
        "pharm-beta-blockers": {
          "lastReviewed": 1735000050000,
          "interval": 86400000,
          "ease": 2.5,
          "due": 1735086450000
        }
      },
      "updatedAt": 1735000050000
    }
  },
  "exportedAt": 1735000200000
}
```

The structure of `records` inside `qbank` and `flashcards` is opaque to the server — the server only merges by timestamp. See [PUT /v1/sync](#put-v1sync) for the merge rules.

#### Example error responses

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### DELETE /v1/account

Permanently delete the current user's account and **all** associated data. This is irreversible.

- **Auth**: required
- **Body**: JSON (with confirmation)

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `confirm` | string | yes | Must be exactly `"DELETE"` (case-sensitive) |
| `password` | string | conditional | Required if `has_password=true`; verified against stored PBKDF2 hash |

#### Cascade behavior

Unlike admin-driven deletes (which reassign content objects to the acting admin), self-service account delete **cascade-deletes** the user's content objects. This is intentional: if a user is deleting their own account, they presumably want all their stuff gone.

The cascade deletes:

- `progress_documents` (their sync data)
- `sessions` (their active and revoked sessions)
- `password_reset_tokens` (any outstanding reset tokens)
- `auth_identities` (Google links)
- `auth_handoffs` (outstanding handoff tickets)
- `content_objects` rows they own (R2 artifacts are not auto-deleted — admins should clean those up)
- The `users` row itself

#### Example request

```bash
curl -s -X DELETE https://osler-cloud.example.workers.dev/v1/account \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{
    "confirm": "DELETE",
    "password": "Cardiology#2025"
  }'
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

#### Example error responses

Missing or wrong `confirm` value — `400`:

```json
{ "error": "Type DELETE to confirm account deletion" }
```

Wrong password (when `has_password=true`) — `401`:

```json
{ "error": "Current password is incorrect" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

## 5. Sync endpoints

Sync is the mechanism by which Osler keeps a user's QBank and flashcard progress consistent across devices. Local IndexedDB remains the primary store; sync is best-effort background replication.

Each user has exactly two sync documents: `qbank` and `flashcards`. Each document is a JSON object whose keys are arbitrary record IDs (chosen by the client — typically question IDs or flashcard IDs) and whose values are record objects. The server does not understand the internal shape of a record; it only merges by timestamp.

### GET /v1/sync

Fetch both sync documents for the current user.

- **Auth**: required
- **Body**: none

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/sync \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "qbank": {
    "records": {
      "cardio-mi-001": {
        "timestamp": 1735000000000,
        "correct": 7,
        "total": 10
      },
      "resp-asthma-004": {
        "timestamp": 1735000100000,
        "correct": 9,
        "total": 10
      }
    },
    "updatedAt": 1735000100000
  },
  "flashcards": {
    "records": {
      "pharm-beta-blockers": {
        "lastReviewed": 1735000050000,
        "interval": 86400000,
        "ease": 2.5
      }
    },
    "updatedAt": 1735000050000
  }
}
```

If the user has never synced, both documents return `{records:{}, updatedAt:0}`.

#### Example error responses

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### PUT /v1/sync

Upload local changes and have them merged with the server-side documents. Returns the merged result so the client can update its local cache.

- **Auth**: required
- **Body**: JSON

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `qbank` | object | no | `{records: {...}}` — see below |
| `flashcards` | object | no | `{records: {...}}` — see below |

Both fields are optional. Omitting one leaves that document unchanged on the server. The body must be valid JSON; passing `{}` is a valid no-op.

The `records` field inside each document must be a plain object (not an array, not a primitive). Keys are record IDs; values are record objects (shape is opaque to the server).

#### Merge rules

**QBank**: for each record ID in the local payload, replace the server-side record only if `local.timestamp >= server.timestamp`. The server's record is preserved otherwise.

**Flashcards**: same as QBank, but the comparison key is `lastReviewed` instead of `timestamp`.

Both comparisons use `Number(value) >= Number(other)` with `0` as the default if a timestamp is missing. Ties go to the local (incoming) value, which means re-submitting the same record is idempotent.

#### Size limits

Each document (`qbank.records` and `flashcards.records` independently) is capped at **900,000 UTF-8 bytes** when serialized to JSON. This is enforced via `new TextEncoder().encode(JSON.stringify(records)).length`, so multi-byte characters (e.g. CJK content) count correctly toward the limit.

The 900 KB cap leaves headroom below D1's 1 MB per-row limit, accounting for JSON-stringify overhead and column metadata.

#### Example request

```bash
curl -s -X PUT https://osler-cloud.example.workers.dev/v1/sync \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{
    "qbank": {
      "records": {
        "cardio-mi-001": {
          "timestamp": 1735000200000,
          "correct": 8,
          "total": 10
        }
      }
    },
    "flashcards": {
      "records": {
        "pharm-ace-inhibitors": {
          "lastReviewed": 1735000250000,
          "interval": 172800000,
          "ease": 2.6
        }
      }
    }
  }'
```

#### Example success response (200 OK)

Returns the merged documents — the client should replace its local cache with these.

```json
{
  "qbank": {
    "records": {
      "cardio-mi-001": {
        "timestamp": 1735000200000,
        "correct": 8,
        "total": 10
      },
      "resp-asthma-004": {
        "timestamp": 1735000100000,
        "correct": 9,
        "total": 10
      }
    },
    "updatedAt": 1735000300000
  },
  "flashcards": {
    "records": {
      "pharm-ace-inhibitors": {
        "lastReviewed": 1735000250000,
        "interval": 172800000,
        "ease": 2.6
      },
      "pharm-beta-blockers": {
        "lastReviewed": 1735000050000,
        "interval": 86400000,
        "ease": 2.5
      }
    },
    "updatedAt": 1735000300000
  }
}
```

Note: only the documents that were actually present in the request body appear in the response. If you only sent `qbank`, the response will only contain `qbank`.

#### Example error responses

Invalid document shape (e.g. `records` is an array or missing) — `400`:

```json
{ "error": "Invalid progress document" }
```

Document too large (>900 KB UTF-8) — `400`:

```json
{ "error": "Progress document is too large" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

## 6. Admin endpoints

All `/v1/admin/*` routes require:

1. A valid bearer session token (otherwise `401`).
2. The session's user role to be `admin` or `content_admin` (otherwise `403 {"error":"Forbidden"}`).
3. Some routes additionally require role `admin` only (also `403` for `content_admin`).

### Roles & capabilities

There are three roles in the system:

| Role | Description |
| --- | --- |
| `student` | Default. Cannot access `/v1/admin/*` at all. |
| `content_admin` | Can create, edit, submit, and view their own content + all published content. Cannot approve/reject/publish/unpublish, cannot manage users, cannot view audit log or stats. |
| `admin` | Full access: all of the above plus user management, content review, direct publish, audit log, stats, session revocation. |

The capabilities bitmask returned by `GET /v1/admin/me` is computed from the role:

| Capability | `admin` | `content_admin` |
| --- | --- | --- |
| `manageUsers` | ✓ |  |
| `manageContent` | ✓ | ✓ |
| `approveContent` | ✓ |  |
| `publishDirect` | ✓ |  |
| `viewStats` | ✓ |  |
| `viewAudit` | ✓ |  |
| `manageSessions` | ✓ |  |

Admin role is **not** granted at registration time. To promote a user, run:

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE users SET role = 'admin' WHERE username = '<your-username>';"
```

Every administrative action is recorded in the `admin_audit` table with the actor ID, action name, target ID, optional detail JSON, and timestamp. The audit log is retained for 1 year (365 days) and pruned by the hourly cron trigger.

### GET /v1/admin/me

Get the current admin's profile and computed capabilities bitmask.

- **Auth**: `admin` or `content_admin`
- **Body**: none

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/admin/me \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

For an `admin`:

```json
{
  "user": {
    "id": "8d5c2b1a-...",
    "username": "admin",
    "displayName": "Site Administrator",
    "role": "admin",
    "email": "admin@medschool.edu",
    "createdAt": 1734000000000
  },
  "capabilities": {
    "manageUsers": true,
    "manageContent": true,
    "approveContent": true,
    "publishDirect": true,
    "viewStats": true,
    "viewAudit": true,
    "manageSessions": true
  }
}
```

For a `content_admin`, only `manageContent` is `true`.

#### Example error responses

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

Authenticated but not an admin — `403`:

```json
{ "error": "Forbidden" }
```

---

### GET /v1/admin/stats

Aggregate platform counts. Used by the admin dashboard.

- **Auth**: `admin` only (`content_admin` gets `403`)
- **Body**: none

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/admin/stats \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "userCount": 348,
  "sessionCount": 72,
  "contentCount": 1245,
  "pendingCount": 8,
  "publishedCount": 1187,
  "draftCount": 32
}
```

| Field | Meaning |
| --- | --- |
| `userCount` | Total registered users |
| `sessionCount` | Active (non-revoked, non-expired) sessions |
| `contentCount` | Total content objects (all statuses) |
| `pendingCount` | Content objects in `pending` review state |
| `publishedCount` | Content objects in `published` state |
| `draftCount` | Content objects in `draft` state (does not include `rejected`) |

#### Example error responses

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/audit

Paginated audit log of all admin actions.

- **Auth**: `admin` only
- **Body**: none

#### Query parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | no | 1-indexed; defaults to 1; values <1 are clamped to 1 |
| `action` | string | no | Filter to a specific action type (e.g. `change_role`, `delete_user`); empty string means "all" |

#### Action types

The following actions are written to the audit log:

| Action | Written by |
| --- | --- |
| `change_role` | `PATCH /v1/admin/users/:id` (when role changes) |
| `delete_user` | `DELETE /v1/admin/users/:id` |
| `reset_password` | `POST /v1/admin/users/:id/reset-password` |
| `revoke_sessions` | `DELETE /v1/admin/users/:id/sessions` |
| `create_content` | `POST /v1/admin/content` |
| `submit_content` | `POST /v1/admin/content/:id/submit` |
| `approve` | `POST /v1/admin/content/:id/approve` |
| `reject` | `POST /v1/admin/content/:id/reject` |
| `publish_direct` | `POST /v1/admin/content/:id/publish` |
| `unpublish` | `POST /v1/admin/content/:id/unpublish` |
| `delete_content` | `DELETE /v1/admin/content/:id` |

#### Example request

```bash
curl -s "https://osler-cloud.example.workers.dev/v1/admin/audit?page=2&action=change_role" \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "items": [
    {
      "id": "audit-uuid-1",
      "actorId": "8d5c2b1a-...",
      "actorUsername": "admin",
      "actorDisplayName": "Site Administrator",
      "action": "change_role",
      "targetId": "9c7e2f1a-...",
      "detail": {
        "from": "student",
        "to": "content_admin",
        "displayName": "Bob (Content Editor)"
      },
      "createdAt": 1735000100000
    },
    {
      "id": "audit-uuid-2",
      "actorId": "8d5c2b1a-...",
      "actorUsername": "admin",
      "actorDisplayName": "Site Administrator",
      "action": "change_role",
      "targetId": "b2c1d0e9-...",
      "detail": {
        "from": "content_admin",
        "to": "admin",
        "displayName": "Carol (Now Admin)"
      },
      "createdAt": 1734999000000
    }
  ],
  "total": 47,
  "page": 2,
  "limit": 50
}
```

#### Example error responses

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/users

List users with optional search.

- **Auth**: `admin` only
- **Body**: none

#### Query parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | no | 1-indexed; defaults to 1 |
| `q` | string | no | Search term; matched against `username`, `display_name`, and `email` using LIKE with `%q%` wildcards. LIKE wildcards (`%` and `_`) in the search term are escaped literally. |

Page size is fixed at **25**.

#### Example request

```bash
curl -s "https://osler-cloud.example.workers.dev/v1/admin/users?page=1&q=alice" \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "users": [
    {
      "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      "username": "medstudent2025",
      "displayName": "Alice (MS2)",
      "role": "student",
      "email": "alice@medschool.edu",
      "createdAt": 1734000000000
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 25
}
```

Results are ordered by `created_at DESC` (newest users first).

#### Example error responses

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/users/:id

Get a single user's profile, active session count, and recent content.

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The user's `users.id` |

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/admin/users/9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  "username": "medstudent2025",
  "displayName": "Alice (MS2)",
  "role": "student",
  "email": "alice@medschool.edu",
  "createdAt": 1734000000000,
  "activeSessionCount": 2,
  "content": [
    {
      "id": "content-uuid-1",
      "title": "Cardiology: MI Quick Review",
      "status": "published",
      "contentType": "library",
      "updatedAt": 1734500000000
    },
    {
      "id": "content-uuid-2",
      "title": "Pharm: Beta-blockers Quiz",
      "status": "draft",
      "contentType": "quiz",
      "updatedAt": 1734600000000
    }
  ]
}
```

`activeSessionCount` counts sessions where `revoked_at IS NULL AND expires_at > now()`. `content` is up to 25 most-recently-updated content objects owned by the user (regardless of status).

#### Example error responses

User not found — `404`:

```json
{ "error": "User not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### PATCH /v1/admin/users/:id

Update a user's role or display name.

- **Auth**: `admin` only
- **Body**: JSON

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The target user's `users.id` |

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `role` | string | no | One of `student`, `content_admin`, `admin`. Invalid values are silently ignored (the existing role is kept). |
| `displayName` | string | no | Trimmed and truncated to 80 chars; empty string after trimming falls back to the existing value |

**Cannot demote self**: if the acting admin tries to set their own role to anything other than `admin`, the response is `400`. This prevents accidental self-lockout — ask another admin to demote you.

#### Example request

```bash
curl -s -X PATCH https://osler-cloud.example.workers.dev/v1/admin/users/9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{
    "role": "content_admin",
    "displayName": "Alice (Content Editor)"
  }'
```

#### Example success response (200 OK)

```json
{
  "id": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  "username": "medstudent2025",
  "displayName": "Alice (Content Editor)",
  "role": "content_admin",
  "email": "alice@medschool.edu",
  "createdAt": 1734000000000
}
```

An audit log entry of action `change_role` is written with the old and new role, and the new display name.

> **Note on existing sessions**: the user's currently-issued session tokens still carry their old role in the JWT payload. Role changes take effect on the next `requireUser` call because the role is looked up from the `users` table at validation time, not from the token. So role changes are effective immediately for authorization, but the `role` field in `/v1/auth/me` responses reflects the current DB state.

#### Example error responses

Self-demotion attempt — `400`:

```json
{ "error": "You cannot demote yourself. Ask another admin to demote you." }
```

User not found — `404`:

```json
{ "error": "User not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### DELETE /v1/admin/users/:id

Delete a user account. **Cannot delete self** — the acting admin must use `DELETE /v1/account` for that.

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The target user's `users.id` |

#### Cascade behavior (different from self-service delete)

Unlike `DELETE /v1/account` which cascade-deletes the user's content, the admin delete route **reassigns** the user's content objects to the acting admin. This keeps published content live and lets the admin decide whether to delete the reassigned drafts/pending items individually.

The cascade:

1. `UPDATE content_objects SET created_by = <acting admin> WHERE created_by = <target>`
2. `DELETE FROM progress_documents WHERE user_id = <target>`
3. `DELETE FROM sessions WHERE user_id = <target>`
4. `DELETE FROM password_reset_tokens WHERE user_id = <target>`
5. `DELETE FROM auth_identities WHERE user_id = <target>`
6. `DELETE FROM auth_handoffs WHERE user_id = <target>`
7. `DELETE FROM users WHERE id = <target>`

#### Example request

```bash
curl -s -X DELETE https://osler-cloud.example.workers.dev/v1/admin/users/9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

An audit log entry of action `delete_user` is written with the deleted user's username and the acting admin's ID (as `contentReassignedTo`).

#### Example error responses

Cannot delete self — `400`:

```json
{ "error": "Cannot delete your own account" }
```

User not found — `404`:

```json
{ "error": "User not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/admin/users/:id/reset-password

Admin-initiated password reset. Sets a new password on the user's account (the admin communicates it to the user out-of-band) and revokes all the user's sessions.

- **Auth**: `admin` only
- **Body**: JSON

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The target user's `users.id` |

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `password` | string | yes | New password; must pass standard policy (10–200 chars, 2+ character classes) |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/admin/users/9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b/reset-password \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{"password":"TemporaryAccess#2025"}'
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

Side effects:

1. User's `password_hash`, `password_salt`, and `has_password` (set to `1`) are updated.
2. **All** the user's sessions are revoked — they must log in again with the new password.

An audit log entry of action `reset_password` is written with the target's username.

#### Example error responses

Weak password — `400`:

```json
{ "error": "Password must be at least 10 characters with 2 character classes" }
```

User not found — `404`:

```json
{ "error": "User not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/users/:id/sessions

List up to 100 of the user's most recent sessions, **including revoked and expired ones** for audit purposes.

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The target user's `users.id` |

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/admin/users/9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b/sessions \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "sessions": [
    {
      "id": "session-uuid-1",
      "expires_at": 1735606400000,
      "created_at": 1735000200000,
      "revoked_at": null
    },
    {
      "id": "session-uuid-2",
      "expires_at": 1735590000000,
      "created_at": 1734990000000,
      "revoked_at": 1734995000000
    }
  ]
}
```

Sessions are ordered by `created_at DESC` (newest first). Note that token hashes are **not** returned — only metadata. The cap of 100 is a hard limit.

#### Example error responses

User not found — `404`:

```json
{ "error": "User not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### DELETE /v1/admin/users/:id/sessions

Revoke all active sessions for a user. The user is immediately signed out on all their devices.

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The target user's `users.id` |

#### Example request

```bash
curl -s -X DELETE https://osler-cloud.example.workers.dev/v1/admin/users/9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b/sessions \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

Side effects: every session for the user with `revoked_at IS NULL` gets `revoked_at = now()`. Already-revoked or expired sessions are not touched.

An audit log entry of action `revoke_sessions` is written with the target's username.

#### Example error responses

User not found — `404`:

```json
{ "error": "User not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/content

List content objects with optional status filter and title search.

- **Auth**: `admin` or `content_admin`
- **Body**: none

#### Query parameters

| Name | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `status` | string | no | `published` | One of `draft`, `pending`, `published`, `rejected`, `all`. Invalid values fall back to `published`. |
| `q` | string | no | (none) | Title substring search; LIKE wildcards (`%`, `_`) are escaped |

#### Visibility rules

| Caller role | What they see |
| --- | --- |
| `admin` | All content matching the status filter (or all statuses if `status=all`) |
| `content_admin` with `status=published` | All published content |
| `content_admin` with any other status | Only their own content matching that status |

The result set is capped at **100 items** (a safety cap to avoid unbounded scans). Results are ordered by `updated_at DESC`.

#### Example request

```bash
curl -s "https://osler-cloud.example.workers.dev/v1/admin/content?status=pending&q=cardiology" \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "items": [
    {
      "id": "content-uuid-1",
      "r2_key_base": "content/library/content-uuid-1",
      "content_type": "library",
      "title": "Cardiology: MI Quick Review",
      "language": "en",
      "status": "pending",
      "created_by": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      "created_at": 1734000000000,
      "updated_at": 1734500000000,
      "submitted_at": 1734490000000,
      "reviewed_by": null,
      "reviewed_at": null,
      "rejection_reason": null,
      "creator_username": "medstudent2025"
    }
  ],
  "total": 1
}
```

Note: the response does not include pagination metadata — the cap of 100 is meant to fit on a single admin page. If you have more than 100 items in a status, narrow with `q`.

#### Example error responses

Not an admin/content_admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/content/pending

Convenience endpoint: list all content objects in `pending` status, ordered by submission time ascending (oldest first, so the longest-waiting items surface to the top).

- **Auth**: `admin` only (`content_admin` gets `403`)
- **Body**: none

#### Query parameters

None.

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/admin/content/pending \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "items": [
    {
      "id": "content-uuid-1",
      "r2_key_base": "content/library/content-uuid-1",
      "content_type": "library",
      "title": "Cardiology: MI Quick Review",
      "language": "en",
      "status": "pending",
      "created_by": "9c7e2f1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      "created_at": 1734000000000,
      "updated_at": 1734500000000,
      "submitted_at": 1734490000000,
      "reviewed_by": null,
      "reviewed_at": null,
      "rejection_reason": null,
      "creator_username": "medstudent2025",
      "creator_display_name": "Alice (MS2)"
    }
  ]
}
```

Unlike `GET /v1/admin/content`, this endpoint includes both `creator_username` and `creator_display_name` (because the join is already there).

#### Example error responses

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/admin/content

Create a new content object. The object starts in `draft` status with an initial body written to R2.

- **Auth**: `admin` or `content_admin`
- **Body**: JSON

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `contentType` | string | yes | One of `quiz`, `bank`, `flashcard`, `written`, `osce`, `library`, `video` |
| `title` | string | no | Trimmed and truncated to 200 chars; stored as the initial DB title |
| `language` | string | no | Defaults to `"en"` if omitted |
| `content` | string | no | Initial draft body written to R2. If omitted, defaults to `JSON.stringify({title: <title or "Untitled">}, null, 2)`. |

The R2 key base is `content/<contentType>/<uuid>`, and the initial draft is written to `content/<contentType>/<uuid>/draft.json`.

#### Content types

| Type | Use case |
| --- | --- |
| `quiz` | Self-assessment quiz with multiple-choice questions |
| `bank` | QBank-style question bank (exam-style MCQs) |
| `flashcard` | Flashcard deck |
| `written` | Written-answer practice questions |
| `osce` | OSCE scenario/case |
| `library` | Library article / reference material |
| `video` | Video tutorial (metadata + transcript) |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/admin/content \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{
    "contentType": "library",
    "title": "Cardiology: MI Quick Review",
    "language": "en",
    "content": "{\"title\":\"Cardiology: MI Quick Review\",\"body\":\"Myocardial infarction...\"}"
  }'
```

#### Example success response (201 Created)

```json
{
  "id": "f4e5d6c7-...",
  "r2KeyBase": "content/library/f4e5d6c7-...",
  "status": "draft"
}
```

An audit log entry of action `create_content` is written with the title and content type.

#### Example error responses

R2 not configured — `503`:

```json
{ "error": "Content storage not configured" }
```

Invalid content type — `400`:

```json
{ "error": "Invalid content type" }
```

Not an admin/content_admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/content/:id

Get a single content object's metadata and body.

- **Auth**: `admin` or `content_admin`
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Visibility rules

- `admin` can read any content object regardless of status.
- `content_admin` can read: (a) any `published` content, or (b) their own content in any status. Otherwise `403`.

The `body` field is the raw text from R2: for `published` objects it comes from `content/<type>/<id>/published.json`; for all other statuses it comes from `content/<type>/<id>/draft.json`. Returns `null` if the R2 object is missing (e.g. draft was never saved).

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-... \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "id": "f4e5d6c7-...",
  "r2_key_base": "content/library/f4e5d6c7-...",
  "content_type": "library",
  "title": "Cardiology: MI Quick Review",
  "language": "en",
  "status": "draft",
  "created_by": "8d5c2b1a-...",
  "created_at": 1734000000000,
  "updated_at": 1734500000000,
  "submitted_at": null,
  "reviewed_by": null,
  "reviewed_at": null,
  "rejection_reason": null,
  "body": "{\"title\":\"Cardiology: MI Quick Review\",\"body\":\"Myocardial infarction...\"}"
}
```

Note: `body` is a **string** (raw R2 contents), not a parsed JSON object. The client is responsible for parsing.

#### Example error responses

Content not found — `404`:

```json
{ "error": "Content not found" }
```

`content_admin` reading another user's non-published content — `403`:

```json
{ "error": "Forbidden" }
```

Not an admin/content_admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### PUT /v1/admin/content/:id/draft

Save the draft body to R2. **This endpoint accepts a raw text body, not JSON.**

- **Auth**: `admin` or `content_admin`
- **Body**: raw text (Content-Type typically `text/plain` or `application/json` — but the server reads `request.text()` and does not parse)
- **Size limit**: 1,000,000 bytes

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Visibility rules

- `admin` can write to any content object's draft.
- `content_admin` can only write to their own content objects (any status). `403` otherwise.

#### Title auto-extraction

If the body parses as JSON and contains a `title` field that is a string, the content object's `title` column is updated to that value (trimmed, max 200 chars). Otherwise the title is left unchanged. This lets the editor update the title by editing the JSON body's `title` field, without a separate API call.

#### Example request

```bash
curl -s -X PUT https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-.../draft \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: text/plain" \
  --data-binary '{
    "title": "Cardiology: MI Quick Review (rev 2)",
    "body": "Myocardial infarction is defined as..."
  }'
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

Side effects:

1. The raw text is written to `content/<type>/<id>/draft.json` in R2.
2. The content object's `updated_at` is set to `now()`.
3. If the body parses as JSON with a string `title`, the `title` column is updated.

No audit log entry is written for draft saves (it would be too noisy — drafts are saved continuously as the user types).

#### Example error responses

Empty body or body >1MB — `400`:

```json
{ "error": "Invalid body" }
```

R2 not configured — `503`:

```json
{ "error": "Content storage not configured" }
```

Content not found — `404`:

```json
{ "error": "Content not found" }
```

`content_admin` writing to another user's content — `403`:

```json
{ "error": "Forbidden" }
```

Not an admin/content_admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/admin/content/:id/submit

Snapshot the current draft to the pending slot and set status to `pending`. Clears any prior review metadata (reviewer, review time, rejection reason) so the object starts a fresh review cycle.

- **Auth**: `admin` or `content_admin`
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Visibility rules

- `admin` can submit any content object.
- `content_admin` can only submit their own. `403` otherwise.

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-.../submit \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true, "status": "pending" }
```

Side effects:

1. The current draft body is copied to `content/<type>/<id>/pending.json` in R2 (a snapshot).
2. The content object's `status` is set to `pending`, `submitted_at` to `now()`, and `reviewed_by`/`reviewed_at`/`rejection_reason` are cleared.

An audit log entry of action `submit_content` is written with the title.

#### Example error responses

Draft is empty (no draft body in R2) — `400`:

```json
{ "error": "Draft is empty" }
```

R2 not configured — `503`:

```json
{ "error": "Content storage not configured" }
```

Content not found — `404`:

```json
{ "error": "Content not found" }
```

`content_admin` submitting another user's content — `403`:

```json
{ "error": "Forbidden" }
```

Not an admin/content_admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/admin/content/:id/approve

Promote a pending content object to published. Copies the pending snapshot to the published slot.

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-.../approve \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true, "status": "published" }
```

Side effects:

1. The pending snapshot is copied to `content/<type>/<id>/published.json` in R2.
2. The content object's `status` is set to `published`, `reviewed_by` to the acting admin, `reviewed_at` to `now()`, and `rejection_reason` is cleared.

An audit log entry of action `approve` is written with the title.

#### Example error responses

No pending snapshot in R2 (i.e. the content was never submitted) — `400`:

```json
{ "error": "No pending snapshot found" }
```

R2 not configured — `503`:

```json
{ "error": "Content storage not configured" }
```

Content not found — `404`:

```json
{ "error": "Content not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/admin/content/:id/reject

Reject a pending content object with a reason. Sets status to `rejected`.

- **Auth**: `admin` only
- **Body**: JSON

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Request body schema

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string | no | Free-text rejection reason; trimmed and truncated to 1000 chars; stored as `rejection_reason` |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-.../reject \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...." \
  -H "content-type: application/json" \
  -d '{"reason":"Section 3 (ECG interpretation) has factual errors. Please review leads II/III pattern for inferior MI."}'
```

#### Example success response (200 OK)

```json
{ "ok": true, "status": "rejected" }
```

Side effects:

1. The content object's `status` is set to `rejected`, `reviewed_by` to the acting admin, `reviewed_at` to `now()`, and `rejection_reason` to the supplied reason (or `null` if empty).

Note: the pending R2 object is **not** deleted — the author can revise the draft, re-submit, and the new pending snapshot will overwrite the old one.

An audit log entry of action `reject` is written with the title and reason.

#### Example error responses

Content not found — `404`:

```json
{ "error": "Content not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/admin/content/:id/publish

Direct publish: copy the current draft to the published slot, bypassing the review queue entirely. Useful for trusted admins making small fixes to already-published content or pushing urgent corrections.

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-.../publish \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true, "status": "published" }
```

Side effects:

1. The **draft** body (not pending) is copied to `content/<type>/<id>/published.json` in R2.
2. The content object's `status` is set to `published`, `reviewed_by` to the acting admin, `reviewed_at` to `now()`, and `rejection_reason` is cleared.

An audit log entry of action `publish_direct` is written with the title (note the different action name vs. `approve` so audit consumers can distinguish them).

#### Example error responses

Draft is empty — `400`:

```json
{ "error": "Draft is empty" }
```

R2 not configured — `503`:

```json
{ "error": "Content storage not configured" }
```

Content not found — `404`:

```json
{ "error": "Content not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### POST /v1/admin/content/:id/unpublish

Revert a published content object back to draft status. The published R2 copy is **retained** so the action is reversible (re-publishing will work without needing to re-approve).

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Example request

```bash
curl -s -X POST https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-.../unpublish \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true, "status": "draft" }
```

Side effects:

1. The content object's `status` is set to `draft` and `updated_at` to `now()`.
2. Review metadata is **not** cleared (so you can see who originally approved it).
3. The R2 `published.json` object is left in place.

An audit log entry of action `unpublish` is written with the title.

#### Example error responses

Content not found — `404`:

```json
{ "error": "Content not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### GET /v1/admin/content/:id/diff

Get the pending and published snapshots side-by-side for review. Returns raw R2 strings (or `null` if the snapshot doesn't exist).

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Example request

```bash
curl -s https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-.../diff \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{
  "pending": "{\"title\":\"Cardiology: MI Quick Review (rev 2)\",\"body\":\"...\"}",
  "published": "{\"title\":\"Cardiology: MI Quick Review\",\"body\":\"...\"}"
}
```

If there is no pending snapshot (content was never submitted, or was already approved/rejected), `pending` is `null`. If there is no published snapshot (content was never published), `published` is `null`. The client can render a JSON diff between the two.

#### Example error responses

Content not found — `404`:

```json
{ "error": "Content not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

### DELETE /v1/admin/content/:id

Permanently delete a content object and all of its R2 artifacts.

- **Auth**: `admin` only
- **Body**: none

#### Path parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | yes | The content object's `id` |

#### Example request

```bash
curl -s -X DELETE https://osler-cloud.example.workers.dev/v1/admin/content/f4e5d6c7-... \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9...."
```

#### Example success response (200 OK)

```json
{ "ok": true }
```

Side effects:

1. R2 objects `content/<type>/<id>/draft.json`, `pending.json`, and `published.json` are all deleted (best-effort — missing objects are silently skipped).
2. The `content_objects` row is deleted.

This is irreversible — once deleted, the content cannot be recovered.

An audit log entry of action `delete_content` is written with the title.

#### Example error responses

Content not found — `404`:

```json
{ "error": "Content not found" }
```

Not an admin — `403`:

```json
{ "error": "Forbidden" }
```

Missing or invalid token — `401`:

```json
{ "error": "Authentication required" }
```

---

## 7. Common error patterns & how to handle them

### Authentication errors (`401`)

Any `401` from an authenticated route means the bearer token is missing, malformed, expired, revoked, or belongs to a deleted user. The correct client behavior is:

1. Clear the locally-stored session token.
2. Redirect to the login screen (or show a "session expired" modal).
3. Do **not** automatically retry the request with the same token.

```javascript
if (response.status === 401) {
  sessionStorage.removeItem("osler.session");
  location.href = "/?session=expired";
  return;
}
```

The single `401` message is `{"error":"Authentication required"}` for authenticated routes, and `{"error":"Invalid username or password"}` for `POST /v1/auth/login`. Do not try to differentiate "missing token" from "expired token" — the server does not expose this.

### Authorization errors (`403`)

A `403` means you are authenticated but not allowed to do the thing. Common causes:

| Cause | Example | Client behavior |
| --- | --- | --- |
| Wrong role | `student` calling `/v1/admin/*` | Hide the admin UI; show "you do not have access" |
| `content_admin` accessing another user's draft | `GET /v1/admin/content/<someone-else's-id>` when status≠`published` | Hide the link; show ownership error |
| Wrong Origin | Cross-origin request from a non-`ALLOWED_ORIGIN` site | This is a deployment misconfiguration; fix `ALLOWED_ORIGIN` in `wrangler.toml` |
| Token role is `student` but route requires `admin` | Promote the user via D1 | Show "insufficient privileges" |

### Validation errors (`400`)

Validation errors are returned as a single human-readable message in `error`. The server does not return structured field-level errors — the client should display the message verbatim or parse the common patterns:

| Message fragment | Meaning |
| --- | --- |
| `"Invalid"` | Generic input validation failure |
| `"Password must be at least 10 characters with 2 character classes"` | Weak password |
| `"Type DELETE to confirm account deletion"` | Missing/wrong `confirm` field |
| `"Cannot delete your own account"` / `"You cannot demote yourself..."` | Self-protection guard |
| `"Draft is empty"` | Tried to submit/publish a content object with no draft body |
| `"No pending snapshot found"` | Tried to approve without a pending snapshot |
| `"Invalid content type"` | Unknown `contentType` on `POST /v1/admin/content` |
| `"Invalid body"` | Empty or >1MB draft body |
| `"Invalid progress document"` | Malformed sync payload |
| `"Progress document is too large"` | Sync document >900 KB UTF-8 |
| `"Invalid reset request"` / `"This reset link is invalid or expired"` | Reset token invalid/used/expired |
| `"This sign-in link is invalid or expired"` | Google handoff ticket invalid/used/expired |

### Conflict errors (`409`)

`409` is returned when a uniqueness constraint is violated:

- `POST /v1/auth/register` with a duplicate `username` or `email` → `{"error":"That username or email is already in use"}`
- `PATCH /v1/account` with an `email` already used by another account → `{"error":"That email is already in use"}`

The client should treat these as user-facing errors and prompt for a different value.

### Rate-limit errors (`429`)

When you receive `429`:

1. Stop sending requests immediately.
2. Wait at least 60 seconds (the bucket window).
3. Retry once. If still `429`, exponential backoff.

The server uses an in-memory LRU per Worker isolate, so the effective rate limit may be slightly higher than the table suggests when traffic is spread across multiple isolates. Do not try to "find" the limit — design the client to back off on the first `429`.

For harder guarantees, front the Worker with Cloudflare Rate Limiting Rules configured in the dashboard.

### Service-unavailable errors (`503`)

`503` indicates a configuration problem, not a transient outage:

| Message | Cause |
| --- | --- |
| `"Worker is not configured"` | `DB` or `JWT_SECRET` env var is missing on the Worker |
| `"Google sign-in is not configured"` | Missing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `WORKER_URL` |
| `"Content storage not configured"` | R2 bucket `CONTENT` is not bound in `wrangler.toml` |

These are deployment issues — the client should show a "service unavailable" message and not retry automatically. Operators should check `wrangler.toml` and redeploy.

### Internal server errors (`500`)

`500` means an unexpected exception was thrown. The error is logged via `console.error` and visible in `wrangler tail` or the Cloudflare dashboard logs. The response body is the generic `{"error":"Internal server error"}` — no internal details are leaked.

If you encounter repeated `500`s:

1. Check `wrangler tail` for the exception stack.
2. Verify D1 schema is up to date (`npm run db:list`).
3. Verify R2 bucket is bound (`env.CONTENT`).
4. Open an issue with the log timestamp.

### Network errors & retries

The Worker does not implement request idempotency. For mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`), a network timeout does **not** mean the request failed — it may have succeeded on the server but the response was lost. The client should:

- For idempotent operations (`GET`, `PUT /v1/sync` with merged timestamps): retry with exponential backoff.
- For non-idempotent operations (`POST /v1/auth/register`, `DELETE /v1/account`): do **not** auto-retry. Show an error and let the user decide.
- For `POST /v1/admin/content/:id/approve` and similar state transitions: re-fetch the object with `GET /v1/admin/content/:id` to see the current status before retrying.

### Empty / null handling

Several endpoints return `null` for missing optional fields:

- `GET /v1/admin/content/:id` returns `body: null` if R2 has no draft/published object.
- `GET /v1/admin/content/:id/diff` returns `pending: null` and/or `published: null` if those snapshots don't exist.
- `GET /v1/auth/me` returns `providers: []` (empty array, not null) for password-only accounts.
- User objects return `email: null` (not omitted) if no email is set.

Clients should explicitly handle `null` rather than relying on field presence.

### Pagination

Only two endpoints paginate:

| Endpoint | Page size |
| --- | --- |
| `GET /v1/admin/audit` | 50 |
| `GET /v1/admin/users` | 25 |

Both use 1-indexed `page` query param. The response includes `total`, `page`, and `limit` so the client can render "Page X of Y". `GET /v1/admin/content` does **not** paginate — it has a hard cap of 100 items, narrowed by the `q` query param if the result set is too large.

### CORS preflight

Browsers send an `OPTIONS` preflight before any non-simple cross-origin request. The Worker handles `OPTIONS` with `204 No Content` and the full CORS header set — no application logic runs. Preflight responses are cacheable for 86,400 seconds (`Access-Control-Max-Age: 86400`).

If your client sees CORS errors:

1. Confirm the request `Origin` matches `ALLOWED_ORIGIN` exactly (including scheme and port).
2. Check that the request includes `Origin` header (browsers do; curl does not unless you add `-H "Origin: ..."`).
3. Verify the Worker is deployed and `/v1/health` returns 200.

### Timezone & timestamp handling

All timestamps are integer Unix epoch milliseconds (UTC). The server never interprets or stores local time. Clients should format timestamps in the user's locale for display but always transmit and store as integers.

| Field | Example value | Meaning |
| --- | --- | --- |
| `expiresAt` | `1735606400000` | Session expiry (ms since epoch) |
| `createdAt` | `1734000000000` | User/account creation time |
| `updatedAt` | `1735000100000` | Last sync document update |
| `submittedAt` | `1734490000000` | Content submission time |
| `reviewedAt` | `1734500000000` | Content review time (approve/reject) |
| `exp` (in JWT payload) | `1735606400` | Unix epoch **seconds** (not ms!) |

The `exp` field inside the JWT payload is in seconds — this is the OAuth/JWT standard. The server multiplies by 1000 before comparing to `Date.now()`. Clients should not need to read this field directly.

### Conflict resolution in sync

Sync conflicts are resolved entirely by timestamp. There is no server-side conflict detection, no versioning, no diff API for sync — the merge rules are:

- **QBank**: newer `timestamp` wins (ties go to local).
- **Flashcards**: newer `lastReviewed` wins (ties go to local).

This means if two devices edit the same QBank question offline and then sync, the one with the newer timestamp overwrites the older one — no merge, no three-way diff. For Osler's use case (per-question answer history) this is correct because each question's record is an atomic snapshot, not a partial update.

If a user reports "my progress was lost", the most common cause is that they had an older device with stale data sync after a newer device had already synced. There is no recovery — the older device's data was correctly discarded by the merge rule. The fix is to ensure devices sync regularly so timestamps stay current.

---

## 8. Revision history

| Date | Change |
| --- | --- |
| Initial | API reference extracted from `cloudflare/worker/src/index.ts`. Covers all 39 public, authenticated, sync, and admin endpoints. |
| 2026-07-31 | Added the public R2 content endpoints (`GET /v1/content/<category>/<path>` and `GET /v1/content-manifests/<category>/manifest.json`), their `CORP: cross-origin` override, and the httpOnly route-gating cookie note. Covers 41 endpoints. |

For the changelog of the Worker itself, see [`../CHANGELOG.md`](../CHANGELOG.md). For deployment-related changes (env vars, migrations, R2 binding), see [`cloudflare-backend.md`](./cloudflare-backend.md).
