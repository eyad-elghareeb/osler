# Troubleshooting guide

This guide walks through the most common issues operators and users hit when running Osler, grouped by category. For each issue you'll find the **symptom** (what the user sees), the **likely cause**, **diagnostic steps** (commands to run, logs to check), and a **fix or workaround**.

> **Related guides:** [`hosting.md`](./hosting.md) · [`cloudflare-backend.md`](./cloudflare-backend.md) · [`security.md`](./security.md) · [`environment.md`](./environment.md)
>
> Before opening a GitHub issue, please run through the relevant section here. Most "the app is broken" reports are configuration problems that this guide can resolve in a few minutes.

---

## Table of Contents

1. [Build & install issues](#1-build--install-issues)
2. [Cloudflare Worker issues](#2-cloudflare-worker-issues)
3. [Database migration issues](#3-database-migration-issues)
4. [Authentication issues](#4-authentication-issues)
5. [Admin panel issues](#5-admin-panel-issues)
6. [Sync issues](#6-sync-issues)
7. [PWA / mobile issues](#7-pwa--mobile-issues)
8. [Content issues](#8-content-issues)
9. [Performance issues](#9-performance-issues)
10. [Deployment issues](#10-deployment-issues)
11. [Gathering a useful bug report](#11-gathering-a-useful-bug-report)

---

## 1. Build & install issues

### 1.1 `npm install` fails with engine mismatch or peer-dep errors

**Symptom.** Running `npm install` aborts with `EBADENGINE` (`Unsupported engine`) or a long `ERESOLVE` tree.

**Likely cause.** Wrong Node version. Osler requires **Node.js 22** (see `.nvmrc`); npm 9/10 from older Node majors will refuse to install the lockfile as written.

**Diagnose.**

```bash
node --version    # must print v22.x
npm --version
cat .nvmrc
```

**Fix.** Use `nvm` (or `fnm`/`volta`) to install Node 22 and re-run install:

```bash
nvm install 22 && nvm use 22 && nvm alias default 22
rm -rf node_modules package-lock.json
npm install
```

If you must stay on an older Node, you can force npm to ignore the engine check with `npm install --engine-strict=false`, but this is unsupported — Next.js 16 internals rely on Node 22 APIs.

### 1.2 `npm run dev` crashes with "Cannot find module 'next'"

**Symptom.** `Error: Cannot find module 'next'` from `next dev`.

**Likely cause.** `node_modules/` is missing, partial, or was copied across operating systems (e.g. zipped on macOS, unzipped on Linux). Native binaries such as `@next/swc-*` are platform-specific.

**Diagnose.**

```bash
ls node_modules/@next
# Should contain: swc-linux-x64-gnu, swc-darwin-arm64, etc. — match your platform
```

**Fix.** Delete `node_modules` and the lockfile, then reinstall:

```bash
rm -rf node_modules .next
npm install
```

### 1.3 Build fails with "Module not found: Can't resolve 'lucide-react'"

**Symptom.** `npm run build` exits with `Module not found: Can't resolve 'lucide-react'` (or another icon/UI dependency).

**Likely cause.** A previous `npm install` was interrupted, leaving `package-lock.json` updated but `node_modules/` partial.

**Fix.**

```bash
rm -rf node_modules package-lock.json
npm install
```

### 1.4 Build fails with `Error: Cannot find module './fonts/cairo-*.ttf'`

**Symptom.** Production build dies inside `src/lib/osler/pdf-fonts.ts` with `Cannot find module './fonts/cairo-arabic.ttf'` (or similar Poppins/Lora/Cairo file references).

**Likely cause.** The bundled font binaries live under `src/lib/osler/fonts/`. They are tracked by Git LFS on some forks; a shallow clone or a clone without LFS will pull pointer files instead of real fonts.

**Diagnose.**

```bash
file src/lib/osler/fonts/cairo-arabic.ttf
# Real TTF:  "TrueType Font data, ..."
# LFS pointer: ASCII text starting with "version https://git-lfs..."
```

**Fix.**

```bash
git lfs install
git lfs pull
# or, if you don't use LFS upstream, re-clone without --depth
```

### 1.5 Icons render as blank squares or missing glyphs

**Symptom.** The UI shows empty squares / tofu where icons (clipboard, book, video) should appear.

**Likely cause.** `lucide-react` is missing from the bundle, or a custom theme has overridden the `--icon-color` token to a transparent value.

**Diagnose.** Open DevTools → Network → filter `lucide`. Verify the chunk loads. Inspect an icon SVG element to confirm `stroke="currentColor"` is non-zero.

**Fix.** Reinstall deps (see [1.3](#13-build-fails-with-module-not-found-cant-resolve-lucide-react)). If the icon name itself is wrong (e.g. you configured `engines.quiz.icon = "clipboardx"` in `osler.config.json`), the icon silently renders nothing — fix the icon name to a valid `lucide-react` export.

### 1.6 `next build` crashes with "Type error" on a content JSON import

**Symptom.** Build fails inside `next.config.ts` or `scripts/generate-content-manifests.js` with a TypeScript-style type error referencing a content JSON file.

**Likely cause.** A content pack you added has a schema mismatch (e.g. missing `questions`, `prompts`, or `passages` key).

**Diagnose.** Run the manifest generator directly to get a clearer error:

```bash
npm run generate-manifests
```

**Fix.** Open the offending JSON file under `public/osler-content/<category>/<pack>.json` and fix the schema. See the README's "Content System" section for the expected shape per engine type. The Tauri admin's `validate.rs` can also lint packs.

### 1.7 Build hangs at "Compiled" then never finishes

**Symptom.** `npm run build` reaches "Compiled successfully" but stays at "Collecting page data" indefinitely.

**Likely cause.** A page imports a Node-only module at the top level (e.g. `fs`, `child_process`) outside a `server`-only path, or a content pack is several MB and the static-generation step is choking.

**Diagnose.** Run with verbose logging:

```bash
NEXT_TELEMETRY_DEBUG=1 npm run build 2>&1 | tee build.log
```

**Fix.** Move Node-only imports inside `if (typeof window === 'undefined')` blocks or `import 'server-only'`. For huge content packs, split them — Osler loads content from disk per request, so smaller packs improve both build and runtime.

### 1.8 Tailwind classes don't apply after editing `globals.css`

**Symptom.** Edits to `src/app/globals.css` are visible in the file but don't appear in the rendered page.

**Likely cause.** Tailwind 4 caches the compiled stylesheet in `.next/cache/`. A stale entry can persist across config changes.

**Fix.**

```bash
rm -rf .next/cache
npm run dev
```

---

## 2. Cloudflare Worker issues

### 2.1 `wrangler deploy` fails with `Authentication error [code: 10000]`

**Symptom.** Deploying the Worker aborts with `ERROR 10000: Authentication error`.

**Likely cause.** `CLOUDFLARE_API_TOKEN` is missing, expired, or lacks the `Workers Scripts:Edit` permission.

**Diagnose.**

```bash
npx wrangler whoami
# Should print your account email + account id
```

**Fix.** Re-create an API token at <https://dash.cloudflare.com/profile/api-tokens> using the **Edit Cloudflare Workers** template, then:

```bash
npx wrangler login
# or
export CLOUDFLARE_API_TOKEN=cf_xxx
```

Confirm the token has access to the account that owns your D1 database and R2 bucket.

### 2.2 Worker returns `500` from every route, logs show `Cannot read properties of undefined (reading 'prepare')`

**Symptom.** Every API call returns 500; `npm run tail` shows `Cannot read properties of undefined (reading 'prepare')` or `env.DB is undefined`.

**Likely cause.** The D1 binding is misconfigured in `wrangler.toml` — either `database_id` is still the placeholder, or the `[[d1_databases]]` block was deleted.

**Diagnose.**

```bash
cat cloudflare/worker/wrangler.toml | grep -A4 d1_databases
npx wrangler d1 list
```

Compare the `database_id` printed by `wrangler d1 list` with the value in `wrangler.toml`.

**Fix.** Replace `REPLACE_WITH_D1_DATABASE_ID` with the real ID and redeploy:

```bash
npm run deploy
```

### 2.3 R2 routes return `500` with `env.CONTENT is undefined`

**Symptom.** Login and sync work, but every `/v1/admin/content*` route returns 500. Logs show `env.CONTENT is undefined`.

**Likely cause.** The `[[r2_buckets]]` block has been removed from `wrangler.toml`, or the bucket name doesn't exist on your account.

**Diagnose.**

```bash
npx wrangler r2 bucket list
```

The bucket listed must match `bucket_name = "osler-content"` (or whatever you set). If `osler-content` is missing, create it:

```bash
npx wrangler r2 bucket create osler-content
```

Then redeploy. If you intentionally don't use the admin content workflow, comment out the `[[r2_buckets]]` block — but then the content routes will refuse to create objects (by design).

### 2.4 Frontend gets CORS error: `Access to fetch at '...' from origin '...' has been blocked by CORS policy`

**Symptom.** Browser console shows `blocked by CORS policy: No 'Access-Control-Allow-Origin' header` for every API call.

**Likely cause.** `ALLOWED_ORIGIN` in `wrangler.toml` doesn't exactly match the browser origin (scheme + host + port). Common pitfalls: `http://` vs `https://`, trailing slash, `www.` prefix mismatch, or using the Pages preview URL while `ALLOWED_ORIGIN` is set to the production URL.

**Diagnose.** Open the Network tab and read the `Origin` request header on a failing call. Compare it byte-for-byte with:

```bash
grep ALLOWED_ORIGIN cloudflare/worker/wrangler.toml
```

**Fix.** Set the exact origin and redeploy:

```toml
[vars]
ALLOWED_ORIGIN = "https://your-app.pages.dev"
```

```bash
cd cloudflare/worker && npm run deploy
```

The Worker supports **one** origin only. If you need staging + production, deploy a second Worker for each environment with its own `ALLOWED_ORIGIN`.

### 2.5 Worker returns `500` from `/v1/auth/*` with `JWT_SECRET is not defined`

**Symptom.** Every auth endpoint returns 500. Logs include `env.JWT_SECRET is undefined` or `HMAC key is null`.

**Likely cause.** `JWT_SECRET` was never set as a Worker secret.

**Diagnose.**

```bash
cd cloudflare/worker
npx wrangler secret list
# Must include JWT_SECRET
```

**Fix.**

```bash
npx wrangler secret put JWT_SECRET
# paste: openssl rand -base64 48
```

No redeploy is needed — secrets take effect immediately for the next request.

### 2.6 `wrangler dev` returns 401 on every route even with `.dev.vars`

**Symptom.** Local dev Worker responds with 401 on all routes after `wrangler dev`.

**Likely cause.** `.dev.vars` is missing or has the wrong filename. Wrangler only auto-loads secrets from `.dev.vars` (not `.env`).

**Diagnose.**

```bash
ls -la cloudflare/worker/.dev.vars
# Should exist and contain JWT_SECRET=...
```

**Fix.**

```bash
cp cloudflare/worker/.dev.vars.example cloudflare/worker/.dev.vars
# Edit .dev.vars and fill in JWT_SECRET (any long random string works locally)
```

Restart `wrangler dev`.

### 2.7 OAuth handoff returns `400 invalid_state` on Google Sign-In

**Symptom.** User clicks "Continue with Google", lands on Google, comes back, and the app shows `invalid_state` or `state_mismatch`.

**Likely cause.** OAuth state token expired (10-minute TTL — `OAUTH_TTL_MS`) or the user has cookies/localStorage blocked so the PKCE nonce can't round-trip.

**Diagnose.** Check the Worker logs for the `/v1/auth/google/callback` request — look for the `state` and `nonce` lookup. If the row is missing in `oauth_states`, it either expired or was already consumed.

**Fix.** Have the user retry the Google Sign-In flow within 10 minutes. If it persists:

- Confirm `WORKER_URL` in `wrangler.toml` matches the deployed Worker URL (Google rejects redirects to mismatched hosts).
- Confirm Google Cloud Console's Authorized Redirect URI is exactly `https://<worker-domain>/v1/auth/google/callback` (no trailing slash).

### 2.8 `wrangler deploy` fails with `Worker exceeded resource limits`

**Symptom.** Deploy succeeds but the first request returns `Worker exceeded resource limits` (CPU time).

**Likely cause.** A request triggered an unbounded loop or a massive D1 read. Most commonly: a user with thousands of sessions has logged in, and the session-enumeration query is scanning the whole `sessions` table without an index.

**Diagnose.** Tail logs while reproducing:

```bash
cd cloudflare/worker && npm run tail
```

**Fix.** Confirm migration `0004_security_indexes.sql` was applied (see [3.3](#33-migration-applied-locally-but-not-on-production)). If you've added a new query, ensure it has a covering index.

### 2.9 Worker returns `429 Too Many Requests` for legit traffic

**Symptom.** Real users get `429 Too Many requests` intermittently on login/register/reset.

**Likely cause.** Per-IP rate limit exceeded. Defaults: 12 logins/min, 6 registrations/min, 6 resets/min, 600 total/min across all rate-limited routes per IP (per isolate — Cloudflare may recycle isolates so this is best-effort).

**Diagnose.** Check whether the user is behind a NAT/VPN with many others. Universities and corporate Wi-Fi often share one public IP.

**Fix.** If the limit is genuinely too low for your audience, edit `RATE_LIMIT_MAX` in `cloudflare/worker/src/index.ts` and redeploy. For harder guarantees, add a Cloudflare Rate Limiting Rule in the dashboard (it runs before the Worker).

### 2.10 `scheduled` handler never runs

**Symptom.** Expired sessions / OAuth states / reset tokens pile up; the `admin_audit` table grows unbounded.

**Likely cause.** The cron trigger in `wrangler.toml` is misconfigured, or you exceeded the 5-cron free-tier limit.

**Diagnose.** Cloudflare Dashboard → Workers → your Worker → Triggers → Cron Triggers. You should see `0 * * * *` (hourly) listed with recent invocation times.

**Fix.** Ensure `wrangler.toml` includes:

```toml
[triggers]
crons = ["0 * * * *"]
```

Redeploy. If you have other Workers consuming your 5-cron quota, consolidate or upgrade.

---

## 3. Database migration issues

### 3.1 `npm run db:migrate` errors with `D1_ERROR: near "REPLACE": syntax error`

**Symptom.** Migration fails with a SQL syntax error referencing a statement that looks valid.

**Likely cause.** Local wrangler version is older than the one used to author the migration. The bundled migrations use modern SQLite syntax (e.g. `RETURNING`, `IF NOT EXISTS` on indexes).

**Fix.**

```bash
cd cloudflare/worker
npm install wrangler@latest
npm run db:migrate
```

### 3.2 Migration applies but tables are missing

**Symptom.** `db:migrate` reports success, but `wrangler d1 execute ... "SELECT name FROM sqlite_master WHERE type='table'"` shows fewer tables than expected.

**Likely cause.** Migrations are tracked in the `d1_migrations` table. If a migration row was inserted by a partial run, subsequent runs skip it even though the SQL didn't fully apply.

**Diagnose.**

```bash
npx wrangler d1 execute osler-cloud --remote --command "SELECT * FROM d1_migrations;"
```

**Fix.** Roll back manually by dropping the partial tables and the migration row, then re-run:

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "DELETE FROM d1_migrations WHERE id = '0003_admin.sql';"
npx wrangler d1 execute osler-cloud --remote --command "DROP TABLE IF EXISTS content_objects; DROP TABLE IF EXISTS admin_audit;"
npm run db:migrate
```

> Always back up first: `npx wrangler d1 export osler-cloud --remote --output=backup.sql`.

### 3.3 Migration applied locally but not on production

**Symptom.** `npm run db:migrate:local` works; `npm run db:migrate` against `--remote` says "no migrations to apply" but the production schema is missing tables.

**Likely cause.** The `d1_migrations` table on remote is out of sync with the local one — usually because someone ran `wrangler d1 execute` directly against remote with a `--command` that inserted a row manually.

**Diagnose.**

```bash
npx wrangler d1 execute osler-cloud --local --command "SELECT * FROM d1_migrations;"
npx wrangler d1 execute osler-cloud --remote --command "SELECT * FROM d1_migrations;"
```

**Fix.** Compare the two lists. For each migration present locally but missing remotely, run:

```bash
npx wrangler d1 execute osler-cloud --remote --file=migrations/000X_name.sql
npx wrangler d1 execute osler-cloud --remote --command \
  "INSERT INTO d1_migrations (id, applied_at) VALUES ('000X_name.sql', strftime('%s','now')*1000);"
```

### 3.4 Schema drift after a fork rebase

**Symptom.** After pulling upstream, the app errors with `no such column: users.has_password` (or another missing-column error).

**Likely cause.** Upstream added a column in a migration that you didn't apply, or you renamed a column in your fork and the upstream code now references the old name.

**Fix.** Identify the migration that introduced the column:

```bash
grep -rn "has_password" cloudflare/worker/migrations/
```

Apply any pending migrations. If you've forked a migration, keep the file name (`0001_initial.sql`) but add an `ALTER TABLE` at the end so existing deployments get the new column idempotently (`ALTER TABLE ... ADD COLUMN ... ` — note SQLite doesn't support `IF NOT EXISTS` on `ADD COLUMN`, so wrap in a try/catch by checking `pragma_table_info`).

### 3.5 `wrangler d1 execute` reports `SQLITE_BUSY`

**Symptom.** `wrangler d1 execute` fails with `SQLITE_BUSY` or `database is locked`.

**Likely cause.** Multiple wrangler processes are writing concurrently, or a long-running transaction in the Worker is holding a write lock.

**Fix.** Wait 30 seconds and retry. If it persists, check whether another operator is running a migration. D1 serializes writes per database; this is expected behavior.

---

## 4. Authentication issues

### 4.1 User can't register: "Invalid registration details"

**Symptom.** User fills out the registration form and sees `Invalid registration details`.

**Likely cause.** One of the validation rules failed silently:
- Username: `/^[a-zA-Z0-9_.-]{3,32}$/`
- Email: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, ≤254 chars
- Password: ≥10 chars, ≤200 chars, ≥2 of 4 character classes (lowercase / uppercase / digit / symbol)

**Diagnose.** Have the user try a different username/password. Check Worker logs for the `/v1/auth/register` request body.

**Fix.** Tell the user the actual rules (they're intentionally not surfaced verbatim in the UI to make brute-force harder). Suggest a password manager.

### 4.2 User can't register: "That username or email is already in use"

**Symptom.** Registration returns 409 `That username or email is already in use`.

**Likely cause.** Username match is case-insensitive (`COLLATE NOCASE`), so `John` collides with `john`. Same for email.

**Fix.** Pick a different username. If the user is sure they never registered, an admin can look up the existing account:

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT id, username, email, created_at FROM users WHERE username = '<name>' COLLATE NOCASE OR email = '<email>' COLLATE NOCASE;"
```

### 4.3 User can't log in: "Invalid username or password"

**Symptom.** User is certain the password is correct but login fails.

**Likely cause.** Account was created via Google Sign-In and has no password (`has_password = 0`). Email/password login is impossible for these accounts.

**Diagnose.**

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT id, username, email, has_password FROM users WHERE email = '<email>' COLLATE NOCASE;"
```

If `has_password = 0`, the user signed in via Google. Tell them to use "Continue with Google", or an admin can reset their password (which sets `has_password = 1`).

### 4.4 Password reset email never arrives

**Symptom.** User submits the reset form, sees "If the email exists, a reset link has been sent", but no email lands.

**Likely cause.** One of:
- `RESEND_API_KEY` is not set on the Worker
- `EMAIL_FROM` is not a verified Resend sender (on the Resend free tier, you must verify the domain)
- `APP_ORIGIN` is wrong, so the reset link points to a non-existent host
- The user's mail provider is dropping the email

**Diagnose.** Tail Worker logs while the user submits the form:

```bash
cd cloudflare/worker && npm run tail
```

Look for a `RESEND_API_KEY` error or a Resend API 4xx response.

**Fix.** Set the secrets:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
# EMAIL_FROM is actually a [vars] entry — set in wrangler.toml
```

Verify the sending domain at <https://resend.com/domains>. If you only have the onboarding email address (`onboarding@resend.dev`), you can only send to your own account email.

### 4.5 Password reset link says "expired or invalid"

**Symptom.** User clicks the link in the email and sees `expired or invalid`.

**Likely cause.** Reset tokens have a 30-minute TTL (`RESET_TTL_MS`) and are single-use. If the user clicks the link twice, the second click fails. If they wait more than 30 minutes, it also fails.

**Fix.** Have the user request a fresh reset link and click it only once, within 30 minutes.

### 4.6 Google Sign-In redirect loop

**Symptom.** User clicks "Continue with Google" and bounces between `accounts.google.com` and the Worker `/v1/auth/google/callback` indefinitely.

**Likely cause.** `WORKER_URL` in `wrangler.toml` doesn't match the actual Worker URL, so Google's redirect URI validation fails and sends them back to the start. Or the Google OAuth Client is configured with a redirect URI that doesn't match.

**Diagnose.** Open the network tab during the loop. The Google `/oauth2/auth` request will have a `redirect_uri` query param — confirm it equals `https://<your-worker>/v1/auth/google/callback`.

**Fix.** Set both to match:

```toml
[vars]
WORKER_URL = "https://osler-cloud.<your-subdomain>.workers.dev"
```

In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client → Authorized redirect URIs, add `https://<your-worker>/v1/auth/google/callback` exactly. Redeploy the Worker.

### 4.7 Session expires immediately after login

**Symptom.** User logs in, lands on the dashboard, and is immediately bounced back to the login screen.

**Likely cause.** Browser is blocking `sessionStorage` (e.g. Safari ITP with cross-site tracking prevention, or a privacy extension). The session token is written to `sessionStorage` on login and re-read on the next page load; if storage is cleared between the two, the user is logged out.

**Diagnose.** In DevTools → Application → Session Storage → confirm `osler-session` exists after login. If it disappears on navigation, storage is being cleared.

**Fix.** Ask the user to:
- Disable tracking-prevention extensions for the Osler domain.
- In Safari: Preferences → Privacy → uncheck "Prevent cross-site tracking" or add an exception for the Osler domain.
- Confirm they're not browsing in private/incognito mode (Safari private mode nukes sessionStorage between page loads).

### 4.8 Login works on desktop but not on iOS Safari

**Symptom.** Same credentials, desktop logs in fine, iOS Safari returns "Invalid username or password".

**Likely cause.** iOS autocorrect / smart punctuation is mangling the password (curly quotes instead of straight, capitalised first letter).

**Fix.** Tap into the password field, disable autocorrect / smart punctuation (Settings → General → Keyboard → Smart Punctuation off), and retype. Or use a password manager.

### 4.9 User signed in on too many devices and got logged out

**Symptom.** User reports being randomly logged out.

**Likely cause.** Osler caps at 12 concurrent sessions per user (`MAX_SESSIONS_PER_USER`). When the 13th signs in, the oldest is revoked. If a user is in the habit of signing in from many devices/browsers, they'll see random logouts as their oldest sessions get pruned.

**Fix.** Have the user sign out from devices they no longer use (Settings → Account → Sessions), or an admin can revoke all their sessions and have them re-authenticate on the devices they actually use:

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE sessions SET revoked_at = strftime('%s','now')*1000 WHERE user_id = '<user-id>' AND revoked_at IS NULL;"
```

---

## 5. Admin panel issues

### 5.1 Visiting `/admin` returns 403

**Symptom.** Signed-in admin user visits `/admin` and gets a 403 page.

**Likely cause.** The admin shell refuses to render in production unless the `cf-access-authenticated-user-email` header is present (set by Cloudflare Zero Trust Access). If you haven't put `/admin` behind Cloudflare Access, the header is missing and the page 403s.

**Fix.** Either:
1. Set up Cloudflare Access on the `/admin*` path (recommended — see [`hosting.md` §3 Step 4](./hosting.md#step-4-recommended-put-the-admin-panel-behind-cloudflare-access)).
2. Set `NODE_ENV=development` on the frontend (not recommended for production).

### 5.2 Admin user can't see the /admin link in the menu

**Symptom.** User is a confirmed admin but the admin link doesn't appear in the user menu.

**Likely cause.** The role check happens client-side after `/v1/auth/me` resolves. If the role isn't `admin` or `content_admin`, the link is hidden. Possible reasons: the role change wasn't applied, or the user is signed in with a different account than the one promoted.

**Diagnose.**

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT id, username, email, role FROM users WHERE username = '<username>' COLLATE NOCASE;"
```

If `role` is still `student`, the promotion didn't take.

**Fix.**

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE users SET role = 'admin' WHERE username = '<username>' COLLATE NOCASE;"
```

Have the user sign out and back in (the role is cached for the session lifetime).

### 5.3 Lost admin access — no admins left

**Symptom.** The only admin was demoted or deleted, and now no one can access `/admin`.

**Fix.** Promote any user via D1 directly:

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE users SET role = 'admin' WHERE email = '<your-email>' COLLATE NOCASE;"
```

Sign in as that user. (You need Cloudflare account access to run wrangler against `--remote` D1 — keep your Cloudflare account secure!)

### 5.4 `content_admin` user can't see their own drafts

**Symptom.** `content_admin` user signs in, opens the admin content view, and sees an empty list even though they created drafts earlier.

**Likely cause.** `content_admin` role is intentionally limited: they see only (a) their own non-published content and (b) all published content. If they're looking at a default filter that hides drafts, or another admin reassigned their content, the list looks empty.

**Diagnose.**

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT id, title, status, created_by FROM content_objects WHERE created_by = '<user-id>';"
```

**Fix.** Confirm the filter in the admin UI is set to "All" or "Draft". If the content was reassigned to a different admin (e.g. after the original creator was deleted), it now belongs to that admin — by design (see [`cloudflare-backend.md` §Admin — User Management](./cloudflare-backend.md)).

### 5.5 Audit log is empty

**Symptom.** `/admin/audit` shows "No entries" even after admin actions have been performed.

**Likely cause.** Either no admin actions have actually been logged (user listings, content reads, etc. are NOT audited — only mutations), or the hourly cron has pruned everything because of a clock skew.

**Diagnose.**

```bash
npx wrangler d1 execute osler-cloud --remote --command "SELECT COUNT(*) FROM admin_audit;"
npx wrangler d1 execute osler-cloud --remote --command "SELECT action, COUNT(*) FROM admin_audit GROUP BY action;"
npx wrangler d1 execute osler-cloud --remote --command "SELECT MIN(created_at), MAX(created_at) FROM admin_audit;"
```

**Fix.** If `COUNT(*) = 0` and you're sure admins have done mutations, check the `auditLog()` calls in `src/index.ts` — a custom fork may have removed them. If rows exist but the UI shows none, the filter parameter may be wrong (`/admin/audit?action=...`).

### 5.6 Admin can't demote or delete themselves

**Symptom.** Admin tries to demote their own role or delete their own account and gets a 400.

**Likely cause.** By design — the Worker rejects self-demotion and self-deletion with HTTP 400 to prevent locking yourself out.

**Fix.** Have a different admin perform the action. If you're the only admin and need to demote yourself, first promote another user.

### 5.7 Admin action silently fails — no audit entry

**Symptom.** Admin clicks an action button, nothing happens, no audit row is created.

**Likely cause.** The request hit the Worker but failed validation before `auditLog()` was called. Most commonly: trying to delete a content object that's in `published` state from a `content_admin` account (only `admin` can delete).

**Diagnose.** Watch the network tab for the failing request — the 4xx response body will say why.

### 5.8 Cloudflare Access blocks admin even though they're signed in

**Symptom.** User signed in to Osler successfully, but visiting `/admin` shows a Cloudflare Access login screen instead of the admin shell.

**Likely cause.** They haven't authenticated through your Cloudflare Access identity provider for this session. Cloudflare Access is independent of the Osler app session.

**Fix.** Have them complete the Cloudflare Access login (email OTP, Google Workspace, etc.) once. After that, the `cf-access-authenticated-user-email` header is set on every request and the admin shell will render.

---

## 6. Sync issues

### 6.1 Progress not syncing to the cloud

**Symptom.** User answers QBank questions on one device, signs in on another device, and the progress isn't there.

**Likely cause.** Cloud sync isn't enabled. Either:
- `cloud.enabled = false` in `public/osler.config.json`
- `cloud.apiUrl` is empty or wrong
- The user is on a guest/local session (never signed in)

**Diagnose.** Open Settings → Sync on the source device. The status should read "Synced" with a recent timestamp. If it says "Disabled" or "Offline", cloud sync isn't running. Check the browser console for failed `PUT /v1/sync` requests.

**Fix.** Set in `public/osler.config.json`:

```jsonc
"cloud": {
  "enabled": true,
  "apiUrl": "https://osler-cloud.<your-subdomain>.workers.dev",
  "syncQbank": true,
  "syncFlashcards": true
}
```

Redeploy the frontend. Have the user sign in on both devices.

### 6.2 Sync stuck on "Syncing…" forever

**Symptom.** Settings → Sync shows a perpetual spinner.

**Likely cause.** A previous sync request is hung. Most commonly: the sync payload is hitting the 900 KB cap (`MAX_DOCUMENT_BYTES`) and the Worker is rejecting it, but the client UI doesn't surface the error.

**Diagnose.** DevTools → Network → look for `PUT /v1/sync`. If it returned 400 with `Progress document is too large`, that's the issue.

**Fix.** The user's progress document has grown too large. Common cause: tens of thousands of flashcard reviews with full review history. Have the user:
1. Export their data via Settings → Account → Export (creates a JSON backup).
2. Sign out, then sign back in (clears the local IndexedDB sync queue).
3. Re-import the backup.

If it persists, inspect the document size client-side:

```js
// In the browser console
const data = await indexedDB.databases()
// find the osler db, open it, and check the sync queue store size
```

### 6.3 Conflicts between devices — older data overwrites newer

**Symptom.** User does work on Device A, syncs, opens Device B (which had older progress), and Device B's older state overwrites Device A.

**Likely cause.** Sync uses last-write-wins on per-record timestamps. If Device B's clock is wrong (set to a future date), its records appear "newer" and win.

**Diagnose.** On Device B, run in the console:

```js
new Date().toISOString()
```

Compare to actual current time.

**Fix.** Fix the clock on the offending device. Re-sync from a device with the correct state.

### 6.4 IndexedDB quota exceeded

**Symptom.** Browser console shows `QuotaExceededError` on writes; new progress isn't saved.

**Likely cause.** IndexedDB has a per-origin quota (typically a percentage of free disk space, but enforced strictly on iOS Safari — often 1 GB). Osler stores progress, flashcard reviews, and downloaded content packs there.

**Diagnose.** DevTools → Application → Storage → "Storage usage". In Chrome, you'll see a per-database breakdown.

**Fix.**
1. Settings → Downloads → remove downloaded content packs you no longer need.
2. Clear old completed QBank sessions (Profile → Stats → "Clear old sessions").
3. In Safari: Settings → Safari → Advanced → Website Data → remove Osler, then re-sign-in. (This wipes local data; make sure cloud sync is on first!)

### 6.5 P2P (network) sync doesn't connect

**Symptom.** Two devices on the same Wi-Fi, both on the same room name, never see each other.

**Likely cause.** PeerJS uses a public broker by default. If the broker is unreachable, or your network blocks WebRTC (corporate Wi-Fi often does), the handshake fails.

**Diagnose.** Open Settings → Sync → Network panel. The connection status should say "Connected". If it says "Looking for peers…" forever, the broker is unreachable.

**Fix.**
- Try a different network (mobile hotspot to rule out corporate firewall).
- If you operate the Osler instance, host your own PeerJS broker and update the sync config.
- Use QR sync or File sync as a fallback — they work fully offline.

### 6.6 QR sync fails with "payload too large"

**Symptom.** User scans a QR code and gets "payload too large".

**Likely cause.** QR sync uses multi-part encoding with LZ-string compression and CRC32. Each part has a max payload size; very large progress documents exceed the part count limit.

**Fix.** Use File sync instead (Settings → Sync → File → Export, then Import on the other device). QR is best for incremental transfers (e.g. one quiz session).

### 6.7 Cloud sync overwrites local-only data on first sign-in

**Symptom.** User had local progress as a guest, then signs in for the first time, and their local progress disappears.

**Likely cause.** On first sign-in, the app pulls the cloud document (which is empty for a new account) and merges it. Local records with newer timestamps win, but old local records that pre-date the cloud document's timestamps may be overwritten.

**Fix.** Before signing in for the first time, instruct users to:
1. Settings → Sync → File → Export (creates a backup).
2. Sign in (which will sync local → cloud).
3. If anything is missing, import the backup — File sync merges with newer-wins, so the local records will re-establish themselves.

---

## 7. PWA / mobile issues

### 7.1 "Install" prompt doesn't appear

**Symptom.** User visits the app, expects the Add to Home Screen prompt, but nothing happens.

**Likely cause.** PWA install requires:
- A valid `manifest.webmanifest` served with `application/manifest+json` content type.
- A service worker that's registered and active.
- HTTPS (localhost is exempt for development).
- A user gesture (the browser won't auto-prompt on load).

**Diagnose.** Lighthouse audit → PWA section. It will list missing criteria.

**Fix.** Confirm `https://your-domain/manifest.webmanifest` returns valid JSON. Check the service worker is registered:

```js
navigator.serviceWorker.getRegistration()
```

If the registration is `undefined`, the SW failed to install — check the Console for the failure reason.

### 7.2 Installed PWA shows old version after a deploy

**Symptom.** User installed the PWA last week; after a deploy, they still see the old UI.

**Likely cause.** The service worker caches the app shell and only checks for updates on next launch. If the user keeps the PWA open across days, they'll keep the old version until they fully close and reopen it.

**Fix.** The app shows an "Update available — reload" banner when a new SW version is detected. Tell the user to tap it. If they don't see the banner, fully close the PWA (swipe away in app switcher) and reopen — the SW will activate the new version on next launch.

### 7.3 Offline mode doesn't work — page shows "No internet"

**Symptom.** User goes offline, opens the PWA, sees Chrome's "No internet" dinosaur instead of the app.

**Likely cause.** The service worker's precache list is empty or the SW isn't active. Most common after a failed build where `next-pwa` (or equivalent) didn't generate the SW.

**Diagnose.**

```bash
curl -sI https://your-domain/sw.js | head -5
# Should return 200 with content-type application/javascript
```

In DevTools → Application → Service Workers, confirm a SW is registered and active.

**Fix.** Rebuild and redeploy. Confirm `public/sw.js` exists in the built output.

### 7.4 iOS Safari quirks — biometric unlock doesn't work

**Symptom.** "Unlock with biometric" button is missing on iOS Safari, even after enabling biometrics on Android.

**Likely cause.** WebAuthn on iOS Safari requires the page to be installed as a PWA (Add to Home Screen). Face ID is not exposed to in-browser Safari for WebAuthn.

**Fix.** Have the user install the PWA to their home screen first, then enroll biometrics from inside the installed PWA.

### 7.5 iOS Safari — viewport extends under the notch

**Symptom.** On iPhone X+ devices, content overlaps the notch or home indicator.

**Likely cause.** iOS Safari ignores `viewport-fit: cover` unless the meta tag explicitly includes it.

**Fix.** The layout already includes `<meta name="viewport" content="..., viewport-fit=cover">` and `env(safe-area-inset-*)` utilities. If a custom fork removed it, restore the meta tag in `src/app/layout.tsx`.

### 7.6 Push notifications not arriving

**Symptom.** User enabled notifications but never receives any.

**Likely cause.** Osler doesn't currently send push notifications (no Web Push integration). The browser-level "notifications" toggle in iOS Settings controls in-app notifications only.

**Fix.** Not a bug — there's no push channel implemented. If you need push, integrate Web Push + a push service (e.g. OneSignal) and a Worker endpoint that triggers sends.

### 7.7 Android Chrome — PWA install prompt suppressed

**Symptom.** Android Chrome doesn't show the install banner.

**Likely cause.** Chrome suppresses the prompt if the user previously dismissed it for this origin (cooldown is ~30 days), or if the `beforeinstallprompt` event was prevented.

**Fix.** User can always install via the three-dot menu → "Install app" / "Add to Home screen". The menu option is available regardless of the prompt cooldown.

### 7.8 PWA crashes immediately on launch (Android)

**Symptom.** Installed PWA opens to a white screen and crashes back to home screen.

**Likely cause.** The SW precache list references a chunk that no longer exists (stale cache from a previous version).

**Fix.** Clear the app's storage: Settings → Apps → Osler → Storage → Clear. Then re-open; the SW will re-fetch fresh assets.

---

## 8. Content issues

### 8.1 Content manifests out of date — new pack doesn't show up

**Symptom.** User added a new JSON file under `public/osler-content/qbank/` but it doesn't appear in the UI after deploy.

**Likely cause.** Content is discovered via `manifest.json` files generated by `scripts/generate-content-manifests.js`. These must be regenerated whenever you add or modify content.

**Fix.**

```bash
npm run generate-manifests
# Then rebuild + redeploy
```

If you deployed via Cloudflare Pages with auto-deploy on push, make sure your build command includes the manifest step (it's in `npm run build` already — but if you customised the build command, double-check).

### 8.2 Missing content packs after upgrade

**Symptom.** After pulling upstream, some content packs that used to be visible are gone.

**Likely cause.** Upstream may have renamed or moved content files, or your fork disabled an engine in `osler.config.json`.

**Diagnose.**

```bash
ls public/osler-content/
# Should list: qbank/ flashcard/ osce/ library/ videos/
```

Check `osler.config.json`:

```jsonc
"engines": {
  "quiz": { "enabled": true },
  ...
}
```

A disabled engine hides ALL its content from the UI (the files stay on disk).

**Fix.** Re-enable the engine in config, or restore the content files from git:

```bash
git checkout upstream/main -- public/osler-content/
npm run generate-manifests
npm run build
```

### 8.3 Arabic RTL rendering broken — text shows LTR

**Symptom.** Arabic content displays left-to-right; punctuation ends up on the wrong side.

**Likely cause.** Either the UI language isn't set to Arabic (`defaults.language.ui = "ar"`), or the content pack is missing the language marker that triggers RTL.

**Diagnose.** Inspect the rendered element — `dir="rtl"` should be set on the container. The `i18n-provider.tsx` toggles `dir` based on `document.documentElement.lang`.

**Fix.**
- For UI: Settings → Language → Arabic.
- For content: ensure the content pack JSON includes `"language": "ar"` on each item.
- For PDF: Arabic in PDFs requires the bundled Cairo font and `bidi-js` shaping — if you forked `pdf-fonts.ts`, ensure the Arabic font table is intact.

### 8.4 Images in articles don't load — broken image icon

**Symptom.** Markdown article renders but inline images show broken-image placeholders.

**Likely cause.** Article images live at `public/osler-content/library/<article-slug>/images/<file>.png`. The Markdown references them with a relative path that doesn't resolve under the app's routing.

**Diagnose.** Right-click the broken image → Copy image address → open in a new tab. If it 404s, the path is wrong.

**Fix.** In the Markdown, use absolute paths from the public root: `![](/osler-content/library/<slug>/images/diagram.png)`. Regenerate manifests if you've added new images.

### 8.5 Mermaid diagrams render as raw text

**Symptom.** A ` ```mermaid ` code block in a Markdown article shows as raw Mermaid syntax instead of a diagram.

**Likely cause.** Mermaid is loaded lazily; on slow connections or if the Mermaid CDN is blocked, the diagram never renders.

**Diagnose.** Open DevTools → Network → filter "mermaid". The CDN script should load.

**Fix.** If your network blocks the CDN, self-host Mermaid: download the UMD bundle to `public/vendor/mermaid.min.js` and update the loader in `library.tsx`. Otherwise, just wait — Mermaid renders client-side after the page hydrates.

### 8.6 Article TOC tree shows duplicate entries

**Symptom.** The library sidebar shows the same article twice.

**Likely cause.** The manifest generator picks up the article from two places — e.g. you have both `library/article.md` and `library/article/index.md`.

**Fix.** Keep one canonical file per article. Re-run `npm run generate-manifests`.

### 8.7 Content pack JSON fails to parse

**Symptom.** Loading a content pack in the UI shows "Failed to load content"; browser console has a JSON parse error.

**Likely cause.** Trailing comma, single quotes, or unescaped control characters in the JSON. Standard JSON is strict.

**Fix.** Run the JSON through a linter:

```bash
npx jsonlint public/osler-content/<category>/<pack>.json
```

The Tauri admin's `validate.rs` also lints Osler-specific schema requirements.

---

## 9. Performance issues

### 9.1 Slow page loads (>5s to interactive)

**Symptom.** Initial page load takes several seconds even on a fast connection.

**Likely cause.** Most often: large content packs being loaded eagerly on the dashboard, or a missing CDN in front of the origin (especially for self-hosted VPS deployments).

**Diagnose.** Lighthouse → Performance. Look at the "Avoid enormous network payloads" audit and the largest content requests.

**Fix.**
- Self-hosted: put Caddy (or Cloudflare) in front of Node so static assets are served without hitting the app server. The Caddyfile in [`hosting.md` §5](./hosting.md#5-option-c-self-hosted-vps-with-caddy) already does this.
- Cloudflare Pages: enable "Brotli compression" and "HTTP/3" in the project settings.
- Trim large content packs — split any pack over 500 KB into multiple smaller packs.

### 9.2 Slow sync — `PUT /v1/sync` takes >10s

**Symptom.** Sync requests are slow even with small payloads.

**Likely cause.** D1 reads the entire `progress_documents` row on every GET, and writes serialize the whole document on every PUT. For users with large documents (close to the 900 KB cap), each sync round-trip is I/O-bound on D1.

**Diagnose.** Check the Worker logs for the request duration. Compare to the payload size:

```bash
cd cloudflare/worker && npm run tail
```

**Fix.** Reduce the document size. Strategies:
- Disable flashcard sync for users who only use QBank (`cloud.syncFlashcards = false` per-user via the admin UI, if you fork it; otherwise globally in `osler.config.json`).
- Periodically prune old completed sessions in the client (Profile → Stats → "Clear sessions older than 90 days").

### 9.3 D1 query timeouts on admin endpoints

**Symptom.** `/v1/admin/users?q=...` returns 504 after ~30 seconds.

**Likely cause.** The `LIKE` search across `username / display_name / email` is doing a full table scan. Without the security indexes from migration 0004, this is O(N) and grows with user count.

**Diagnose.** Check the index list:

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='users';"
```

**Fix.** Ensure migration 0004 was applied (see [3.3](#33-migration-applied-locally-but-not-on-production)). If it was and you still see slowness at >50k users, consider adding an FTS5 virtual table on `username` and `email` — but you'll need to fork the Worker.

### 9.4 Dashboard "Continue Learning" tile takes seconds to populate

**Symptom.** After sign-in, the dashboard loads but the "Continue Learning" section is empty for several seconds.

**Likely cause.** The dashboard reads from IndexedDB, which on a cold start has to hydrate from disk. On devices with slow flash (low-end Android), this can take 2–5 seconds.

**Fix.** Not a bug — expected cold-start behavior. The UI shows a skeleton placeholder. If you want to mask it further, add a `cache-first` IndexedDB read with a `stale-while-revalidate` background fetch in `storage.ts`.

### 9.5 PDF export takes >30 seconds

**Symptom.** User exports a quiz to PDF; the spinner spins for 30+ seconds.

**Likely cause.** Large quiz (100+ questions) with embedded Arabic content requires BiDi shaping per character — this is CPU-bound on the main thread.

**Fix.** Suggest smaller export batches (50 questions or fewer). If you've forked `pdf.ts`, move BiDi shaping into a Web Worker to unblock the main thread.

### 9.6 Video playback stutters / buffers constantly

**Symptom.** Videos buffer frequently even on a fast connection.

**Likely cause.** YouTube's CDN may be slow or blocked in your region. The "pipe via alternative host" button (using Invidious) is the workaround.

**Fix.** Configure `NEXT_PUBLIC_INVIDIOUS_HOST` in `.env.local` to point at a fast Invidious instance near you. Public instances are listed at <https://api.invidious.io/>.

### 9.7 Flashcard review queue is slow to load

**Symptom.** Opening a flashcard deck takes >2s.

**Likely cause.** The deck has 1000+ cards and the spaced-repetition algorithm recalculates due-dates on every open.

**Fix.** Split the deck into sub-decks (the deck tree supports nested folders). Each sub-deck loads independently.

---

## 10. Deployment issues

### 10.1 Cloudflare Pages build fails with "Next.js runtime not found"

**Symptom.** Cloudflare Pages build aborts with `Error: Cannot find module 'next'` or `Next.js runtime not found`.

**Likely cause.** The build command doesn't install dependencies before building, or you're using the wrong framework preset.

**Fix.** In Cloudflare Pages → Project → Settings → Build & Development:
- Framework preset: **Next.js** (static export)
- Build command: `npm run build`
- Build output directory: `out`
- Root directory: `/` (or wherever the repo is)

If using `@cloudflare/next-on-pages`, ensure the build command is `npx @cloudflare/next-on-pages@latest`.

### 10.2 Vercel deployment fails with "Function budget exceeded"

**Symptom.** Vercel build fails with `Function budget exceeded` or `Function size limit exceeded`.

**Likely cause.** Next.js serverless functions are capped at 50 MB (Hobby) / 250 MB (Pro). Bundled font binaries (Cairo, Poppins, Lora — ~12 MB total) push you over the limit if your function bundles them.

**Fix.** Mark the fonts as external to the function bundle by moving them to `public/fonts/` and loading via `fetch()` at runtime. Or upgrade to Vercel Pro. Or self-host (see [`hosting.md` §5](./hosting.md#5-option-c-self-hosted-vps-with-caddy)).

### 10.3 Custom domain not working — DNS resolves but page won't load

**Symptom.** DNS lookup returns the correct IP/CNAME, but visiting the domain times out or shows a default page.

**Likely cause.** The hosting provider hasn't been told about the custom domain. Each provider requires explicit registration:
- **Cloudflare Pages**: Project → Custom domains → Add. Wait for the cert to provision (~5 min).
- **Vercel**: Project → Settings → Domains → Add. Set DNS to Vercel's nameservers or A record.
- **Self-hosted**: Caddy auto-provisions TLS only if the domain's A record points directly at your server.

**Fix.** Add the domain in the provider dashboard and wait. Confirm the cert:

```bash
curl -vI https://your-domain.com 2>&1 | grep -E "subject:|issuer:"
```

### 10.4 HSTS Preload submission rejected

**Symptom.** Submitting your domain to <https://hstspreload.org/> returns errors like "redirects HTTP to HTTPS but doesn't include the preload directive".

**Likely cause.** HSTS preload requires:
- HTTPS redirect on the apex domain.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (note `max-age` must be at least 2 years).
- The header on the apex domain itself (not just `www`).

**Diagnose.**

```bash
curl -sI https://your-domain.com | grep -i strict-transport
```

**Fix.** The Worker's default HSTS header is `max-age=31536000` (1 year) — that's deliberate, since preload is opt-in. To opt in, set the header to 2 years on your edge:

- Cloudflare Pages: Rules → Transform Rules → Modify Response Header → set `Strict-Transport-Security` to `max-age=63072000; includeSubDomains; preload`.
- Caddy: `header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"`.

Re-submit after the new header is live. Don't submit until you're sure you won't want to drop HTTPS — preload is essentially permanent.

### 10.5 Cloudflare Worker deploy succeeds but routes return 404

**Symptom.** `npm run deploy` succeeds, but `curl https://<worker>/v1/health` returns 404.

**Likely cause.** The Worker is deployed but the route isn't wired up. For `*.workers.dev` Workers, the URL is `https://<worker-name>.<your-subdomain>.workers.dev`. If you've set a custom route on a zone, the route pattern might be wrong.

**Diagnose.**

```bash
curl https://osler-cloud.<your-subdomain>.workers.dev/v1/health
```

Should return `{"ok":true,...}`. If it 404s, the Worker name doesn't match `name = "osler-cloud"` in `wrangler.toml`.

**Fix.** Verify the deployed Worker name:

```bash
npx wrangler deployments list
```

If you want a custom domain, use `routes` in `wrangler.toml`:

```toml
routes = [
  { pattern = "api.your-domain.com/*", zone_name = "your-domain.com" }
]
```

### 10.6 Vercel preview deployments can't reach the Worker (CORS)

**Symptom.** Vercel preview URL (`your-app-git-feature.vercel.app`) can't call the API; browser shows CORS error.

**Likely cause.** The Worker's `ALLOWED_ORIGIN` is a single origin (your production URL). Vercel preview URLs are different origins.

**Fix.** This is a known limitation. Options:
1. Don't use Vercel previews for backend-dependent features.
2. Deploy a second Worker for the preview environment with `ALLOWED_ORIGIN` set to the Vercel preview URL.
3. Use a custom domain per branch (Vercel Pro feature) and update `ALLOWED_ORIGIN` per environment.

### 10.7 Self-hosted: Caddy fails to provision TLS ("TLS-ALPN-01 challenge failed")

**Symptom.** Caddy logs `tls.alpn challenge failed` and never serves HTTPS.

**Likely cause.** Port 443 is firewalled or already in use by another service. Let's Encrypt uses TLS-ALPN-01 on port 443 to verify domain ownership.

**Fix.**
- Open ports 80 and 443 inbound on your cloud provider's firewall.
- Stop anything else listening on 443: `sudo ss -tlnp | grep ':443'`.
- Restart Caddy: `sudo systemctl restart caddy`.

### 10.8 Docker container exits immediately with `EADDRINUSE`

**Symptom.** `docker run` exits with `Error: listen EADDRINUSE: address already in use :::3000`.

**Likely cause.** Another process on the host is using port 3000, or you've started two Osler containers.

**Fix.**

```bash
# Map to a different host port
docker run -d -p 3001:3000 osler:latest
# Or find and stop the conflicting process
sudo lsof -i :3000
```

### 10.9 GitHub Pages deploy shows blank page (404 on assets)

**Symptom.** GitHub Pages serves the index.html but all `_next/static/*` assets 404.

**Likely cause.** GitHub Pages serves from a subpath (`https://<user>.github.io/<repo>/`), but the build expects the root path.

**Fix.** In `next.config.ts`, set `basePath` and `assetPrefix`:

```ts
const isGH = process.env.GH_PAGES === 'true';
export default {
  basePath: isGH ? '/<repo>' : '',
  assetPrefix: isGH ? '/<repo>/' : '',
};
```

The Tauri admin's GitHub Pages deploy provider sets this up automatically.

### 10.10 Worker deploy succeeds but Turnstile still rejects all logins

**Symptom.** After enabling Turnstile, every login returns "Invalid captcha".

**Likely cause.** The site key in `osler.config.json` (`cloud.turnstileSiteKey`) doesn't match the secret key set on the Worker (`TURNSTILE_SECRET_KEY`). Or `TURNSTILE_ENABLED` is set but the secret key wasn't set.

**Diagnose.**

```bash
npx wrangler secret list | grep TURNSTILE
grep TURNSTILE_ENABLED cloudflare/worker/wrangler.toml
```

**Fix.**
1. In Cloudflare Dashboard → Turnstile → your widget → copy both the **Site Key** and **Secret Key**.
2. `npx wrangler secret put TURNSTILE_SECRET_KEY` → paste the secret key.
3. Set the site key in `public/osler.config.json`:

```jsonc
"cloud": {
  "turnstileSiteKey": "0x4AAAAAAA...",
  ...
}
```

4. Set `TURNSTILE_ENABLED = "true"` in `wrangler.toml`, redeploy the Worker, redeploy the frontend.

---

## 11. Gathering a useful bug report

If none of the above resolves your issue, please gather the following before opening a GitHub issue:

1. **Osler version** — the commit SHA from `git rev-parse HEAD`, or the version from the deployed app's footer.
2. **Hosting setup** — which option from [`hosting.md`](./hosting.md) you're using (Cloudflare Pages + Worker, Vercel, VPS, Docker, static).
3. **Browser and OS** — e.g. "Chrome 128 on Android 14" or "Safari 17.2 on iOS 17.4".
4. **Console output** — open DevTools → Console, reproduce the issue, and copy the full output (redact any token-looking strings).
5. **Network trace** — DevTools → Network → right-click → Save all as HAR. Attach to the issue.
6. **Worker logs** — if the issue is backend-related, run `cd cloudflare/worker && npm run tail` while reproducing, and paste the relevant lines.
7. **D1 schema version** — `npx wrangler d1 execute osler-cloud --remote --command "SELECT * FROM d1_migrations;"`.
8. **Config** — paste the contents of `public/osler.config.json` (with `apiUrl` redacted if you prefer), and the `[vars]` section of `wrangler.toml`.

With these in hand, maintainers can usually pinpoint the issue on the first reply. Without them, the first reply is almost always "please provide …" — save everyone a round-trip.

---

> **Still stuck?** Open a discussion at <https://github.com/eyad-elghareeb/osler/discussions> for operator-to-operator help, or a bug report at <https://github.com/eyad-elghareeb/osler/issues> for confirmed defects. For security issues, see [`../SECURITY.md`](../SECURITY.md) — do not open a public issue for security.
