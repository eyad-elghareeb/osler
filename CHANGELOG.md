# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Segmented quiz sync, permanent telemetry aggregates, per-database panel** — the `qbank` kind is packed into sequential segment rows (`qbank:1`, `qbank:2`, …) by a new sync orchestrator, starting a new segment at 85% occupancy, so quiz progress outgrows D1's 2MB per-row limit (up to the 15MB per-user budget) with zero client changes and exactly one realtime poke per push. Telemetry gains a permanent `analytics_daily` rollup (recomputed by the cron before the 30-day raw-event prune) that keeps all-time aggregate statistics alive — shown as a new "All-Time Events" tile — while question-choice aggregates were already permanent. The quota panel's D1 card gains a measured per-database table (core / sync pool / telemetry with usage bars) when the analytics token carries D1 Read.
- **Optional D1 sharding (core / sync pool / telemetry)** — `npm run db:shard` splits `progress_documents` across a pool of up to six sync databases, partitioned USER-BY-USER: every kind of a user's sync data lives in exactly one shard, recorded on the user row (`users.sync_shard`, added by core migration 0003 and assigned by hash of the id at signup), so per-user sync stays a single-database operation while the pool yields ~2.5 GB of free-tier sync storage. Telemetry (`analytics_events` + choice stats + daily counters) keeps its own database; row read/write quotas stay account-wide. Queries route per shard with graceful single-database fallback, shard schemas self-bootstrap (idempotent `CREATE IF NOT EXISTS` once per isolate — an empty shard heals instead of 500ing), and `GET /v1/admin/analytics/cloudflare-limits` now returns `d1Shards`, `d1MeasuredBytes` (real summed file size), and a per-table `shard` label rendered in the quota panel.
- **Audit log viewer** — new `/admin/audit` page (admin only) with paginated audit log (50 entries/page), action-type filter, and actor display. Backed by new `GET /v1/admin/audit?page=&action=` endpoint.
- **Session management** — admins can now view active sessions per user (`GET /v1/admin/users/:id/sessions`) and revoke all sessions for a user (`DELETE /v1/admin/users/:id/sessions`). User detail endpoint now returns `activeSessionCount` and recent content (up to 25 items).
- **Content title search** — `GET /v1/admin/content?status=&q=` now supports an optional title search parameter. LIKE wildcards (`%`, `_`) are escaped in user-supplied search terms.
- **Unpublish endpoint** — `POST /v1/admin/content/:id/unpublish` reverts published content back to draft, retaining the R2 published copy for re-publishing. Audited as `unpublish`.
- **Stats breakdown** — `GET /v1/admin/stats` now returns `publishedCount` and `draftCount` in addition to existing counts.
- **In-memory rate limiting** — auth endpoints (login, register, reset, google/consume, username-available) are now rate-limited per IP. Returns HTTP 429 when exceeded. Global per-IP cap of 240 requests/min across all rate-limited routes.
- **Per-user session cap** — 12 concurrent sessions per user. The oldest is automatically revoked when a 13th is issued.
- **Security headers** — every JSON response now includes `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, and `Cache-Control: no-store` (for authenticated responses).
- **Hourly cron trigger** — `[triggers] crons = ["0 * * * *"]` in `wrangler.toml` runs the `scheduled` handler hourly to prune expired sessions, OAuth states, handoffs, reset tokens, and audit-log entries older than 1 year.
- **Audit log retention** — entries are pruned after 1 year (365 days) by the cron handler.
- **D1 migration `0004_security_indexes.sql`** — adds indexes for session enumeration, audit-log reads by actor, and per-user content listing.
- **Comprehensive docs** — new files in `docs/`: `hosting.md`, `forking.md`, `security.md`, `admin-guide.md`, `api-reference.md`, `troubleshooting.md`, `environment.md`, `deployment.md`, `contributing.md`, `tauri-admin.md`. Updated `cloudflare-backend.md` to reference the new docs.
- **Root-level `SECURITY.md`** — responsible disclosure policy.
- **Root-level `CHANGELOG.md`** — this file.
- **i18n strings** — English and Arabic translations added for the audit log page (nav, table headers, action filter labels).

### Changed

- **D1 storage limit corrected to 500 MB/database** — the quota panel and docs claimed a 5 GB ceiling; the D1 free tier allows 500 MB per database and, unlike the read/write row quotas, the storage ceiling does not pool across databases. With `D1 Read` added to the analytics token, the storage gauge shows real measured file size (REST `file_size` sum); otherwise it keeps the per-table estimates.
- **Analytics daily write cap tightened to 10k rows/day** (was 25k) — sized for ~200 DAU with hours of headroom, reserving most of the account-wide 100k/day write budget for auth, sync, and content. Retention stays at 30 days (the admin overview derives "this month" metrics from `analytics_events`), and the safety-throttles panel rows render cap figures from the constants instead of hardcoded strings.
- **Password policy** — now requires at least 2 character classes (lowercase / uppercase / digit / symbol) in addition to the existing minimum 10 characters. Enforced on registration, password change, password reset, and admin-initiated reset.
- **Admin user deletion reassigns content** — `DELETE /v1/admin/users/:id` no longer cascade-deletes the user's `content_objects`. Instead, ownership is reassigned to the acting admin so published content stays live. Self-service `DELETE /v1/account` still cascades.
- **Admin self-demotion blocked** — `PATCH /v1/admin/users/:id` now returns 400 if you attempt to demote yourself. Ask another admin to demote you.
- **Sync document size check** — uses `new TextEncoder().encode(...).length` (UTF-8 byte count) instead of string character count to correctly enforce the 900 KB cap on non-ASCII content.
- **Audit log error handling** — `auditLog()` now logs failures via `console.error` instead of silently swallowing them.
- **`PUT /v1/admin/content/:id/draft`** — now extracts and updates the title from the draft body's `title` field (if the body is JSON), keeping the `content_objects.title` column in sync.
- **`POST /v1/admin/content/:id/submit`** — clears prior review metadata (`reviewed_by`, `reviewed_at`, `rejection_reason`) so resubmissions start fresh.
- **`POST /v1/account/password`** — preserves the current session when changing password (only revokes OTHER sessions for the user).
- **`b64url`** — no longer uses `String.fromCharCode(...spread)` which could stack-overflow on large inputs; uses chunked `String.fromCharCode.apply` instead.
- **Worker no longer runs `cleanupStale` on every request** — moved exclusively to the hourly cron trigger for performance.
- **`adminPublicUser` in user detail endpoint** — returns `activeSessionCount` and recent `content` array in addition to base user fields.
- **`AdminCapabilities` bitmask** — extended with `viewAudit` and `manageSessions` flags.
- **`AdminStats` shape** — extended with `publishedCount` and `draftCount` fields.
- **`AdminApi` client** — extended with `auditLog`, `getUser`, `userSessions`, `revokeUserSessions`, `unpublish` methods. `listContent` now accepts an optional `q` parameter.
- **`CloudUser.role`** — type updated from `"student" | "admin"` to `"student" | "admin" | "content_admin"`.
- **`wrangler.toml`** — added `[triggers] crons = ["0 * * * *"]` for hourly cleanup.
- **Worker `package.json`** — added `db:list` and `tail` and `secret:list` scripts.

### Fixed

- **LIKE wildcard injection** — admin user search (`?q=`) and content title search now escape `%` and `_` characters with `ESCAPE '\\'` so user input is matched literally.
- **Self-service account delete cascade** — content objects created by the user are now correctly cascade-deleted (was already correct in the previous version, but now documented explicitly).
- **Sync document byte-size check** — UTF-8 multi-byte content (Arabic, emoji) is now correctly measured against the 900 KB cap using `TextEncoder().encode().length` instead of string `.length`.
- **`b64url` stack overflow** — for large byte arrays, the spread-based `String.fromCharCode` could throw `Maximum call stack size exceeded`. Now uses chunked encoding.
- **Audit log silent failures** — `auditLog()` previously swallowed all errors; failures are now logged to Worker logs via `console.error`.
- **Admin content list missing `total`** — `GET /v1/admin/content` now returns `{items, total}` instead of just `{items}`.

### Deprecated

- `AdminApi.users(page, q)` — still works, but new `AdminApi.getUser(id)` is preferred for fetching a single user with full detail (sessions + content).

### Security

- See "Added" section above for the full list of security hardening in this release: rate limiting, security headers, session cap, audit log retention, content reassignment, self-demotion protection, LIKE wildcard escaping.

## [1.0.0] — Initial public release

- Email/password & Google OAuth authentication
- PBKDF2-SHA-256 password hashing (310k iterations, 16-byte salt)
- HMAC-SHA-256 signed session tokens with server-side revocation
- Roles: `student`, `content_admin`, `admin`
- Account management: profile update, password change, data export, account deletion
- Password reset via Resend transactional email
- Two-document (QBank + flashcards) progress sync with timestamp-based merge
- R2-backed content management with draft/pending/published/rejected workflow
- Admin panel: dashboard, users, content browser, review queue
- Cloudflare Access integration via `cf-access-authenticated-user-email` header
- Optional Turnstile anti-bot on auth endpoints
- PWA install with offline content cache
- 7 engine plugins: quiz, bank, written, flashcard, osce, library, video
- Custom themes with full oklch color token overrides
- Full Arabic (RTL) UI with per-content language filter
- Gemini-powered AI assistant
- PDF export engine with embedded fonts (Poppins, Lora, Cairo)
- Native app feel: View Transitions API, WebAuthn biometric unlock, Vibration haptics, Screen Wake Lock, Network Information API
- Tauri admin desktop app: setup wizard, instance generator, config editor, content editor, build/start runner, git ops, multi-host deployment

[Unreleased]: https://github.com/eyad-elghareeb/osler/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/eyad-elghareeb/osler/releases/tag/v1.0.0
