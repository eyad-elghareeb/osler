# Security model & hardening guide

This document describes Osler's security model end-to-end: the threat model, the controls in place, the responsibilities of operators vs. the upstream maintainers, and recommended hardening steps for production deployments.

> **Reporting a vulnerability:** see [`../SECURITY.md`](../SECURITY.md) for the responsible disclosure process. **Do not open a public GitHub issue for security vulnerabilities.**
>
> **Related guides:** [`hosting.md`](./hosting.md) · [`cloudflare-backend.md`](./cloudflare-backend.md) · [`environment.md`](./environment.md)

---

## Table of Contents

1. [Threat model](#1-threat-model)
2. [Authentication & sessions](#2-authentication--sessions)
3. [Password security](#3-password-security)
4. [Role-based access control](#4-role-based-access-control)
5. [Admin panel security](#5-admin-panel-security)
6. [Cross-origin & transport security](#6-cross-origin--transport-security)
7. [Rate limiting & abuse prevention](#7-rate-limiting--abuse-prevention)
8. [Data protection & privacy](#8-data-protection--privacy)
9. [Audit logging](#9-audit-logging)
10. [Dependency & supply chain security](#10-dependency--supply-chain-security)
11. [Operator hardening checklist](#11-operator-hardening-checklist)
12. [Known limitations](#12-known-limitations)

---

## 1. Threat model

Osler is a medical education platform. The assets we protect:

| Asset | Sensitivity | Stored where |
| --- | --- | --- |
| Student progress (QBank answers, flashcard schedules) | Low–medium | IndexedDB (local) + D1 (cloud sync, optional) |
| Account credentials (password hash, OAuth tokens) | High | D1 (never plaintext) |
| Session tokens | High | D1 (hash) + sessionStorage (browser) + httpOnly cookie (signature only) |
| Content (quizzes, articles) | Low | Public folder (static) + R2 (admin-managed) |
| Admin audit log | Medium | D1 (`admin_audit` table) |
| Email addresses | Medium | D1 (`users.email`) |

### Threats we defend against

- **Credential theft** via phishing, MITM, or DB leak → mitigated by PBKDF2 hashing, HSTS, server-side session revocation
- **Brute-force login** → mitigated by rate limiting + optional Turnstile + PBKDF2 310k iterations
- **Privilege escalation** (student → admin) → mitigated by role checks on every admin endpoint
- **CSRF** on state-changing endpoints → mitigated by bearer-token auth in sessionStorage (not cookies) + strict CORS. The only cookie Osler sets (`osler-session`) is httpOnly + `SameSite=Lax` and carries no bearer token — it exists solely so the Next.js middleware can gate route access.
- **XSS in admin content** → mitigated by JSON-only content storage (no HTML rendering on admin side); app-side rendering uses React's default escaping
- **Username enumeration** → mitigated by uniform error messages on login/reset, but `/v1/auth/username-available` is intentionally public (live validation UX tradeoff)
- **Email enumeration** via password reset → mitigated by uniform `{ok:true}` response regardless of whether the email exists
- **OAuth state fixation** → mitigated by PKCE nonce stored server-side in `oauth_states`, deleted on use
- **Session fixation** → mitigated by server-side session ID lookup, HMAC signature verification, automatic revocation on password change/reset

### Threats we don't fully defend against

- **Physical device compromise** — if an attacker has the user's unlocked device, they have the session token. Mitigation: biometric unlock (WebAuthn) is supported but optional.
- **Server-side compromise** — if an attacker gains Worker secret access (e.g., `JWT_SECRET`), all sessions are forgeable. Mitigation: rotate `JWT_SECRET` immediately on suspicion; this revokes all sessions.
- **D1 leak** — password hashes are safe (PBKDF2 310k iterations would take decades to crack one hash), but email addresses and progress data would be exposed. Mitigation: encrypt sensitive D1 columns at the application layer if your jurisdiction requires it (not built-in).
- **Malicious content_admin** — a `content_admin` can submit arbitrary JSON to R2. If the frontend renders it as HTML (it doesn't — only React-rendered Markdown), XSS could result. Mitigation: all content rendering uses React's default escaping; `dangerouslySetInnerHTML` is never used.

---

## 2. Authentication & sessions

### Session token format

A session token is `<base64url(payload)>.<base64url(hmac-sha256(payload, JWT_SECRET))>` where payload is:

```json
{
  "sub": "<user uuid>",
  "sid": "<session uuid>",
  "role": "student" | "content_admin" | "admin",
  "exp": <unix seconds>
}
```

- **HMAC-SHA-256** with `JWT_SECRET` ensures tokens cannot be forged without the secret.
- The `role` in the JWT is informational; the actual role check reads from D1 on every request, so role changes take effect immediately.
- The `exp` claim sets a 7-day TTL. Expired tokens are rejected.
- The session is also looked up in D1 by `sid` + `token_hash`, so revoking the session server-side immediately invalidates the token even before `exp`.

### Session storage (client)

Sessions are stored in `sessionStorage` (not `localStorage` or cookies). This means:

- ✅ Cleared when the browser tab closes (limits exposure window).
- ✅ Not sent automatically with every request (no CSRF risk from cookies).
- ✅ Isolated per-tab (multiple admin logins don't conflict).
- ❌ Lost on tab close (users must re-login). Trade-off for security.

### Route-gating cookie (Next.js middleware)

In addition to the bearer token, the Next.js app sets a single **httpOnly `osler-session` cookie** used by `src/middleware.ts` to decide whether a request can reach protected app routes. This cookie is distinct from the Worker token:

- It carries **no bearer token** — only a signed payload (`{ kind, user|username, expiresAt }`).
- The value is `<base64url(payload)>.<base64url(hmac-sha256(payload, OSLER_SESSION_SECRET))>` — the middleware verifies the HMAC on every request, so a forged cookie is rejected.
- It is `httpOnly`, `SameSite=Lax`, and `Secure` in production, so it is never readable by client-side JS and is not a CSRF vector (it gates navigation only — the Worker API still authenticates via the `Authorization` header).
- `POST /api/auth/session` issues the cookie **only** after verifying the CloudSession bearer token against the Worker (`GET /v1/auth/me`), and refuses local-mode `{ username }` payloads when cloud is enabled. `GET /api/auth/session` returns a redacted view — the bearer `token` is never exposed over HTTP.

The middleware secret resolves from `OSLER_SESSION_SECRET`, then `JWT_SECRET`, then an insecure dev fallback (with a warning logged in production). Set `OSLER_SESSION_SECRET` explicitly — see [`environment.md`](./environment.md#13-osler_session_secret).

### Session revocation

Sessions can be revoked in three ways:

1. **User-initiated**: `POST /v1/auth/logout` revokes the current session.
2. **Password change/reset**: All other sessions for the user are revoked (the current session is preserved on password change, revoked on reset).
3. **Admin-initiated**: `DELETE /v1/admin/users/:id/sessions` revokes all sessions for a user.

Revoked sessions are deleted by the hourly cron trigger.

### Per-user session cap

A user may have at most **12 concurrent active sessions**. When the 13th is issued, the oldest is automatically revoked. This prevents session accumulation from many device logins.

---

## 3. Password security

### Hashing

Passwords are hashed using **PBKDF2-SHA-256** with:

- 16-byte cryptographically random salt (per-user)
- 310,000 iterations (OWASP-recommended as of 2023)
- 256-bit output

The hash and salt are stored in separate columns (`password_hash`, `password_salt`) in the `users` table. The plaintext password is never logged or stored.

### Password verification

Verification uses a constant-time comparison to prevent timing attacks:

```js
let mismatch = 0;
for (let i = 0; i < actual.length; i += 1) {
  mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
}
return mismatch === 0;
```

### Password policy

- Minimum 10 characters
- Maximum 200 characters (prevents DoS via huge inputs)
- Must contain at least 2 of: lowercase, uppercase, digit, symbol
- Enforced on registration, password change, password reset, and admin-initiated reset

### Password reset

1. User requests reset via `POST /v1/auth/reset/request` with their email.
2. If the email exists and Resend is configured, an email is sent with a single-use token (valid for 30 minutes).
3. The endpoint always returns `{ok: true}` regardless of whether the email exists, to prevent email enumeration.
4. User visits the reset link and submits a new password via `POST /v1/auth/reset/confirm`.
5. The token is marked used, the password is updated, and all existing sessions for the user are revoked.

Tokens are stored in D1 as `sha256(token)` (not plaintext), so a D1 leak doesn't reveal valid reset links.

---

## 4. Role-based access control

### Roles

| Role | Capabilities |
| --- | --- |
| `student` (default) | All user-facing features. Cannot access `/admin` or any `/v1/admin/*` endpoint. |
| `content_admin` | Can create and edit their own content objects (drafts, submit for review). Cannot approve/reject/publish other users' content. Cannot manage users. Sees only their own drafts/pending/rejected + all published content in the admin panel. |
| `admin` | Full access: manage users (list/view/update/delete/reset password/revoke sessions), manage all content (including others' drafts), approve/reject/publish, view audit log, view stats. |

### Enforcement points

Every `/v1/admin/*` endpoint enforces role checks at the Worker level:

1. **Authentication**: `requireUser` verifies the bearer token and looks up the session.
2. **Role gate**: `isAdminOrContent(session)` or `isAdmin(session)` returns 403 if the role doesn't match.
3. **Object ownership**: For `content_admin` accessing content, the Worker checks `obj.created_by === session.user.id` for non-published items.
4. **Self-action protection**: `DELETE /v1/admin/users/:id` returns 400 if `targetId === session.user.id`. `PATCH /v1/admin/users/:id` returns 400 if demoting self.

### Frontend guards

The admin shell uses `AdminRouteGuard` with `requireSuperAdmin` for dashboard/users/review/audit pages. **This is defence in depth** — the real enforcement is at the Worker. A user who bypasses the frontend guard (e.g., by editing React state in DevTools) still cannot make API calls because the Worker rejects them.

### Promoting the first admin

There is no way to register as `admin` via the API. The first admin must be promoted via D1 SQL:

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE users SET role = 'admin' WHERE username = '<your-username>';"
```

This is intentional — it requires server-side access to grant admin, preventing trivial privilege escalation via the API.

---

## 5. Admin panel security

### Cloudflare Access integration

The admin shell reads the `cf-access-authenticated-user-email` header set by Cloudflare Zero Trust Access. In production, if this header is missing, the shell refuses to render and shows a "Protected by Cloudflare Access" message.

**This is an additional layer of defence**, not the primary auth. The Worker still requires a valid admin session token regardless.

To enable Cloudflare Access:

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add Application → Self-hosted
2. Application domain: `your-domain.com` (or path `/admin*`)
3. Configure an identity provider (Email OTP, Google Workspace, Okta, etc.)
4. Save. Subsequent visits to `/admin` will require Cloudflare Access auth.

### Audit log

Every administrative action is recorded in the `admin_audit` table:

| Action | Logged when |
| --- | --- |
| `change_role` | Admin changes a user's role |
| `delete_user` | Admin deletes a user |
| `reset_password` | Admin resets a user's password |
| `revoke_sessions` | Admin revokes all sessions for a user |
| `create_content` | Any user creates a content object |
| `submit_content` | content_admin submits for review |
| `approve` | Admin approves pending content |
| `reject` | Admin rejects pending content |
| `publish_direct` | Admin publishes directly (skipping review) |
| `unpublish` | Admin reverts published → draft |
| `delete_content` | Admin deletes a content object |

The audit log is viewable at `/admin/audit` (admin only), with optional action filter and pagination (50 entries/page). Retention is 1 year (365 days), pruned by the hourly cron trigger.

### Audit log integrity

The audit log is append-only by application convention (no `UPDATE` or `DELETE` queries on `admin_audit` except the cron-driven retention prune). There is no cryptographic integrity guarantee — a malicious database admin could edit rows. If you need tamper-evident logging, consider streaming audit events to an external append-only store (e.g., AWS CloudTrail, GCP Audit Logs, or a separate D1 database with restricted access).

---

## 6. Cross-origin & transport security

### CORS

The Worker's CORS is locked to a single `ALLOWED_ORIGIN` configured in `wrangler.toml`. Requests with an `Origin` header that doesn't match are rejected with HTTP 403. Empty Origin (server-to-server / curl) is treated as the allowed origin so the worker can be tested locally.

Multiple origins are not supported. If you need multiple frontends (e.g., staging + production), deploy separate Workers per environment.

### Security headers

Every JSON response includes:

| Header | Value | Purpose |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Force HTTPS for 1 year, opt into HSTS preload list |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking via iframe |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolate browsing context |
| `Cross-Origin-Resource-Policy` | `same-origin` | Prevent cross-origin reads |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Disable unused browser APIs |
| `Cache-Control` | `no-store` (auth endpoints) | Prevent caching of sensitive responses |

**Exception — public content endpoints:** `GET /v1/content/<category>/<path>` and `GET /v1/content-manifests/<category>/manifest.json` override `Cross-Origin-Resource-Policy` to `cross-origin` so the Pages site (a different origin) can read R2-backed content cross-origin. They also set `Cache-Control: public` (`max-age=86400, immutable` for non-JSON/Markdown assets, `max-age=60` for JSON/Markdown) and are rate-limited like auth routes. See [`api-reference.md`](./api-reference.md) for details.

### TLS

Cloudflare and Vercel both terminate TLS at their edge with modern cipher suites and HTTP/3 support. Self-hosted deployments should use Caddy (which auto-provisions Let's Encrypt) or nginx with a strong config (Mozilla SSL Configuration Generator, "Intermediate" preset).

---

## 7. Rate limiting & abuse prevention

### In-Worker rate limiting

Auth endpoints are rate-limited per IP using an in-memory LRU bucket:

| Route pattern | Bucket | Limit | Window |
| --- | --- | --- | --- |
| `POST /v1/auth/login` | `auth:login` | 12 requests | 60s |
| `POST /v1/auth/register` | `auth:register` | 6 requests | 60s |
| `POST /v1/auth/reset/request` | `auth:reset` | 6 requests | 60s |
| `POST /v1/auth/reset/confirm` | `auth:reset` | 6 requests | 60s |
| `POST /v1/auth/google/consume` | `auth:google:consume` | 12 requests | 60s |
| `GET /v1/auth/username-available` | `auth:register` | 6 requests | 60s |
| (all of the above combined) | `ip:global` | 240 requests | 60s |

Returns HTTP 429 with `{error: "Too many attempts. Please try again in a minute."}` when exceeded.

> **Caveat**: Cloudflare Workers recycle isolates, so in-memory rate limits are best-effort. For hard guarantees, front the Worker with Cloudflare Rate Limiting Rules in the dashboard (set up via `Rules → WAF → Rate limiting rules`).

### Turnstile (anti-bot)

Cloudflare Turnstile is optional but recommended for public deployments. Enable by:

1. Create a Turnstile widget at <https://dash.cloudflare.com/?to=/:account/turnstile>
2. Set `TURNSTILE_ENABLED="true"` in `wrangler.toml`
3. `npx wrangler secret put TURNSTILE_SECRET_KEY`
4. Set `turnstileSiteKey` in `public/osler.config.json`

When enabled, the registration / login / reset forms show the Turnstile widget and the Worker verifies the token before proceeding.

### PBKDF2 cost

The 310,000-iteration PBKDF2 takes ~50–100ms per hash on a Worker. This is intentional — it makes brute-force password cracking expensive. A single Worker request budget is 30s, so even a sustained attack would be limited to ~300 attempts per request before timing out, plus the rate limit caps it at 12/min/IP.

---

## 8. Data protection & privacy

### What's stored where

| Data | Local (IndexedDB) | Cloud (D1) | Cloud (R2) |
| --- | --- | --- | --- |
| QBank answers & sessions | ✅ | ✅ (sync) | — |
| Flashcard review records | ✅ | ✅ (sync) | — |
| Article highlights & notes | ✅ | — | — |
| User profile (username, email, display name) | — | ✅ | — |
| Password hash + salt | — | ✅ | — |
| OAuth identity links | — | ✅ | — |
| Session tokens | sessionStorage (+ httpOnly signed cookie for route gating) | ✅ (hash only) | — |
| Content objects (quiz/article/flashcard JSON) | ✅ (cached) | — | ✅ (admin-managed) |
| Admin audit log | — | ✅ | — |

### Data export

Users can export their data via `GET /v1/account/export`. Returns:

```json
{
  "account": { "user": {...}, "providers": [...] },
  "progress": { "qbank": {...}, "flashcards": {...} },
  "exportedAt": 1234567890
}
```

This is the GDPR "right to data portability" — users can take their data with them.

### Data deletion

Users can self-delete via `DELETE /v1/account` (requires `confirm: "DELETE"` and password verification). Admins can delete via `DELETE /v1/admin/users/:id`. Both delete all user data including sessions, progress, OAuth links, password reset tokens, and (for self-delete) content objects. Admin-driven deletes **reassign** content objects to the acting admin so published content stays live.

### Data retention

- Sessions: deleted after expiry (7 days) or revocation, pruned by hourly cron.
- Password reset tokens: 30 minutes.
- OAuth states & handoffs: 10 minutes.
- Admin audit log: 1 year.
- D1 database: retained until you delete it.
- R2 objects: retained until you delete them via the admin panel or `wrangler r2 object delete`.

### Backup & disaster recovery

- **D1**: `npx wrangler d1 export osler-cloud --remote --output=backup.sql`
- **R2**: Use `r2 object get` per object or write a script that walks the prefix tree
- **Self-hosted**: back up the entire app directory plus any local SQLite

Restore by importing the SQL dump into a fresh D1 database and re-pointing `wrangler.toml`.

---

## 9. Audit logging

See [§5 Admin panel security → Audit log](#5-admin-panel-security). The audit log is the primary forensic record for admin actions. Recommended review cadence:

- **Weekly**: scan the audit log for unexpected role changes or bulk user deletions.
- **Monthly**: confirm audit log entries match your change management records.
- **On suspicion**: filter by `actor_id` to see what a specific admin did.

The audit log is **not** a substitute for Cloudflare's own logs (Workers → Logs), which capture every request including rejected ones.

---

## 10. Dependency & supply chain security

### Frontend dependencies

Osler uses ~150 npm packages. All are pinned in `package-lock.json`. To audit for known vulnerabilities:

```bash
npm audit
npm audit --audit-level=high
```

To automatically merge Dependabot PRs, enable Dependabot security updates in your fork's GitHub settings.

### Worker dependencies

The Worker has **zero runtime dependencies** — it uses only the Web Crypto API and the standard `fetch`. There are no supply-chain risks at runtime. The only dev dependency is `wrangler` (for deployment), which runs on your machine, not in the Worker.

### Subresource integrity

All scripts loaded from external CDNs (none currently, by design) would need SRI hashes. Osler bundles everything via Next.js's built-in webpack/turbopack, so there are no external script tags to worry about.

### Content Security Policy

The frontend doesn't currently ship a CSP header. For additional hardening, add one via:

- **Cloudflare Pages**: Dashboard → Pages → your project → Settings → Headers → `_headers` file:
  ```
  /*
    Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://osler-cloud.example.workers.dev https://generativelanguage.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  ```
- **Vercel**: `vercel.json` → `headers` array
- **Self-hosted (Caddy)**: `header / Content-Security-Policy "..."` directive

Adjust `connect-src` to include your Worker URL and any third-party APIs you use (Gemini, YouTube, etc.).

---

## 11. Operator hardening checklist

For production deployments, run through this checklist:

### Authentication & access

- [ ] `JWT_SECRET` is a 48+ byte random string (not a memorable password)
- [ ] `OSLER_SESSION_SECRET` is set on the frontend (Next.js) — otherwise the middleware falls back to `JWT_SECRET` or an insecure dev constant. Generate with `openssl rand -base64 32`. Different from `JWT_SECRET` is fine; the two are unrelated secrets.
- [ ] `TURNSTILE_ENABLED=true` and `TURNSTILE_SECRET_KEY` configured
- [ ] First admin user promoted via D1 SQL (not via the API)
- [ ] Admin panel protected by Cloudflare Access (Zero Trust)
- [ ] At least 2 admin users (so you're not locked out if one leaves)
- [ ] Admin role changes are reviewed monthly via the audit log

### Network & transport

- [ ] `ALLOWED_ORIGIN` is the exact production origin (no wildcards)
- [ ] HTTPS enforced everywhere (Cloudflare/Vercel/Caddy handles this)
- [ ] HSTS preload list submitted at <https://hstspreload.org> (after confirming you won't drop HTTPS)
- [ ] Worker URL only reachable over HTTPS (Cloudflare enforces this by default)

### Data protection

- [ ] D1 backups scheduled (at least weekly) — `npx wrangler d1 export`
- [ ] R2 backups scheduled if using admin content management
- [ ] Data retention policy documented (audit log: 1 year; sessions: 7 days; etc.)
- [ ] GDPR / FERPA / local data protection compliance reviewed by legal

### Monitoring

- [ ] `npm run tail` configured to ship Worker logs to a log aggregator (Logflare, Datadog, etc.)
- [ ] Alerts on HTTP 5xx rate spikes
- [ ] Alerts on rate-limit (429) spikes — may indicate brute-force attack
- [ ] Alerts on audit-log `delete_user` or `change_role` actions

### Incident response

- [ ] Documented runbook for "suspected JWT_SECRET leak" → rotate secret, all sessions invalidated
- [ ] Documented runbook for "suspected admin compromise" → audit log review, demote suspect admin, reset passwords of recently-changed users
- [ ] Documented runbook for "D1 leak" → mandatory password reset for all users, rotate `JWT_SECRET`
- [ ] Contact email for security reports published in [`SECURITY.md`](../SECURITY.md)

---

## 12. Known limitations

These are conscious trade-offs or items on the roadmap:

- **No IP-based geo-blocking**: Workers don't expose geo data without a paid plan. Use Cloudflare's IP Access Rules in the dashboard if you need to block specific regions.
- **No 2FA / TOTP**: The admin role relies on a single password. To add a second factor, put the admin panel behind Cloudflare Access (which supports TOTP, WebAuthn, etc.).
- **No email verification on signup**: Email is optional and not verified. To require verification, you'd need to add an email-verification flow using Resend (not currently implemented).
- **No per-content ACLs**: All `content_admin` users see all published content. For per-content ACLs, you'd need to extend the schema with a `content_acl` table.
- **In-memory rate limiting**: Best-effort, not durable across isolate restarts. Front with Cloudflare Rate Limiting Rules for hard guarantees.
- **No field-level encryption**: D1 columns are stored in plaintext (except password hashes). For sensitive data (e.g., student PII beyond email), encrypt at the application layer.
- **No nonce-based CSP**: The frontend doesn't ship a CSP. Adding one requires configuring Next.js's nonce generation per request.
- **Audit log is not tamper-evident**: A malicious DB admin could edit rows. Stream to an external append-only store if you need tamper evidence.

If any of these limitations are deal-breakers for your deployment, open an issue to discuss — most are within reach of a focused PR.
