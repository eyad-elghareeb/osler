# Routing Migration Plan — Proper Routes, Cookie Auth, Solid State & URL Handling

> Status: **implemented** — this document describes the corrected, secure
> implementation that ships in this repo.
> Stack: Next 16 App Router, React 19, Serwist PWA, IndexedDB-backed
> `storage` singleton, Cloudflare Worker (D1 + R2) on the free tier.
> No new dependencies.

## Decisions (confirmed)

- **Full path-based routes** — real segments (`/qbank/[uid]`, `/library/[article]`, `/settings/[section]`) replace query-param view state.
- **Legacy `?view=` deep links are dropped** — no redirect shim; old URLs stop resolving.
- **Cookie-based session + middleware auth** — httpOnly cookie, guarded by `src/middleware.ts`. The cookie is **HMAC-signed** so it cannot be forged.

---

## Critical security fixes (vs. the original draft)

The original draft of this plan had several security holes that have been
closed in the shipped implementation:

1. **Cookie forging via `POST /api/auth/session`** — the old endpoint
   accepted `{ username: "admin" }` from anyone and issued a valid
   httpOnly cookie. The middleware then only checked `!!cookie.value`, so
   any string (even `garbage`) bypassed auth.
   **Fix:** `POST /api/auth/session` now (a) accepts a `CloudSession`
   payload only, (b) verifies the bearer token against the Worker via
   `GET /v1/auth/me` before issuing the cookie, and (c) refuses local-mode
   `{ username }` payloads when cloud is enabled. The cookie value is
   `<base64url(payload)>.<hmac>` so the middleware can verify authenticity
   on every request. See `src/lib/osler/server-session.ts`.

2. **Token leakage via `GET /api/auth/session`** — the old endpoint
   returned the full `CloudSession` (including the Worker bearer token) to
   any same-origin JS. An XSS would have harvested live tokens.
   **Fix:** `GET /api/auth/session` now returns a **redacted** view —
   `{ kind, user, expiresAt }` for cloud sessions, `{ kind, username,
   expiresAt }` for local sessions. The bearer `token` is NEVER returned
   by the endpoint. Cross-tab restore shows the user as logged in (so
   middleware doesn't bounce them) but the client must re-authenticate to
   obtain a token for Worker API calls. This is the trade-off for not
   exposing the token via HTTP.

3. **Open redirect via `?next=` on `/login`** — the old `login/page.tsx`
   did `router.push(searchParams.get("next") || "/")` with no validation.
   An attacker could craft `/login?next=https://evil.com` and the user
   would be redirected off-site after login.
   **Fix:** both the middleware and the login page validate `next` with
   `isSafeLocalPath()` — must start with `/`, must not start with `//` or
   `/\`, must not contain a scheme prefix, capped at 1024 chars.

4. **`router.replace()` during render in `settings/[section]`** — the old
   page called `router.replace("/settings")` synchronously during render
   for invalid sections, triggering a React warning and unreliable
   redirects.
   **Fix:** the redirect now happens in a `useEffect`, with a loading
   state shown until the redirect fires.

5. **Unauthenticated R2 proxy** — `/api/r2-fetch` served any
   `content-files/*` / `content-manifests/*` key to anyone, with no auth
   check. While the underlying Worker endpoint is public, the proxy was
   pointless overhead and a potential abuse vector (bandwidth, log spam).
   **Fix:** `/api/r2-fetch` now requires a valid (HMAC-verified) session
   cookie. Also adds path-traversal (`..`, `\\`) and length checks.

6. **Cross-origin content blocked by CORP** — the Worker's
   `SECURITY_HEADERS` set `Cross-Origin-Resource-Policy: same-origin`,
   which blocked the Pages site from reading `/v1/content/*` responses
   cross-origin.
   **Fix:** the public content endpoints (`/v1/content/`,
   `/v1/content-manifests/`) now override CORP to `cross-origin` so the
   Pages site can read the R2-backed content.

7. **Cloud reachability probe race** — the old `isCloudReachable()`
   optimistically returned `true` on first call but never documented the
   failure path. The `content.ts` fallback already handled it, but the
   behavior is now documented and the probe kicks off eagerly.

---

## Route map

| Current (query param) | New (path) | Page |
|---|---|---|
| `/?view=dashboard` (default) | `/` | `(app)/page.tsx` |
| — (login gate) | `/login` | `login/page.tsx` |
| `/?view=learn` | `/learn` | `(app)/learn/page.tsx` |
| `/?view=library` | `/library` | `(app)/library/page.tsx` |
| `/?view=library&article=x` | `/library/[article]` | `(app)/library/[article]/page.tsx` |
| `/?view=qbank` | `/qbank` | `(app)/qbank/page.tsx` |
| `/?view=qbank&pack=uid` | `/qbank/[uid]` | `(app)/qbank/[uid]/page.tsx` |
| `/?view=flashcards` | `/flashcards` | `(app)/flashcards/page.tsx` |
| `/?view=flashcards&pack=uid` | `/flashcards/[uid]` | `(app)/flashcards/[uid]/page.tsx` |
| `/?view=osce` | `/osce` | `(app)/osce/page.tsx` |
| `/?view=osce&pack=uid` | `/osce/[uid]` | `(app)/osce/[uid]/page.tsx` |
| `/?view=videos` | `/videos` | `(app)/videos/page.tsx` |
| `/?view=videos&video=id` | `/videos/[video]` | `(app)/videos/[video]/page.tsx` |
| `/?view=profile` | `/profile` | `(app)/profile/page.tsx` |
| `/?view=settings` | `/settings` | `(app)/settings/page.tsx` |
| `/?view=settings&section=x` | `/settings/[section]` | `(app)/settings/[section]/page.tsx` |

All app routes live under the route group `src/app/(app)/` (adds no URL
segment — same pattern as `src/app/admin/`). Hubs render the existing
studios with no active item; dynamic segments load the pack and render
the studio in session mode.

---

## 1. Cookie-based auth + middleware

### `src/lib/osler/server-session.ts` (new, server-only)

HMAC-signed, tamper-evident session cookie utilities.

- `signSessionCookie(payload)` — produces `<base64url(payloadJSON)>.<hmac>`.
- `verifySessionCookie(value)` — verifies the HMAC, parses the payload,
  checks expiry, validates the payload shape. Returns `null` on any
  failure.
- `readSessionFromRequest(request)` — convenience wrapper for middleware.
- `SESSION_COOKIE_NAME = "osler-session"`, `SESSION_COOKIE_OPTIONS` —
  `httpOnly`, `secure` in prod, `sameSite=lax`, `path=/`.

The HMAC secret is resolved from `OSLER_SESSION_SECRET` (preferred), then
`JWT_SECRET` (Worker shared secret, for backwards compat), then a dev
fallback constant. A warning is logged if neither env var is set in
production.

### `src/app/api/auth/session/route.ts` (rewritten)

- `POST` — accepts either `{ session: CloudSession }` (cloud) or
  `{ username }` (local). Cloud sessions are **verified against the
  Worker** via `GET /v1/auth/me` before the cookie is issued. Local-mode
  `{ username }` is accepted **only when cloud is disabled** — this
  prevents an attacker from downgrading a cloud-enabled instance to
  local-mode auth. Body size capped at 8 KB. Username validated
  (length ≤ 80, no control chars).
- `GET` — returns a **redacted** view: `{ kind: "cloud", user, expiresAt }`
  or `{ kind: "local", username, expiresAt }` or `{ session: null }`.
  The bearer `token` is never returned. `Cache-Control: no-store`.
- `DELETE` — clears the cookie.

### `src/middleware.ts` (rewritten)

- **Public allowlist:** `/api/*`, `/_next/*`, `/osler-content/*`,
  `/assets/*`, `/admin/*` (Cloudflare Access handles admin auth),
  `/serwist/*`, `/sw.js`, `/manifest.webmanifest`, `/icon.svg`,
  `/favicon.png`, `/favicon.ico`, `/robots.txt`, `/site.webmanifest`.
- **Cookie verification:** `readSessionFromRequest(request)` verifies
  the HMAC signature AND the expiry. A cookie with a missing/invalid
  signature or expired payload is treated as no session.
- `/login` with a valid session → redirect to `next` (validated) or `/`.
- App routes without a valid session → redirect to `/login?next=<path>`.
- The `next` param is validated with `isSafeLocalPath()` to prevent open
  redirect.

### `src/app/login/page.tsx` (rewritten)

- Validates `next` with `isSafeLocalPath()` (same logic as middleware).
- Only redirects to `next` after `loading` is false AND `username` is
  set — avoids a redirect race where the cookie POST hasn't completed.
- `handleLogin` calls `login(name)` then `router.push(next)` on the next
  tick. The session-context effect also fires if the state update lands
  first, double-guarding the navigation.
- Passes `cloudAuthError` (from `?cloudAuthError=google`) to
  `LoginScreen` as a prop, so the error banner shows even if the URL
  param is consumed by the time the component mounts.

### `src/lib/osler/session-context.tsx` (rewritten)

- `OslerSessionProvider` holds `{ username, cloudSession, loading }`.
- **Bootstrap order:**
  1. Cloud session in sessionStorage (fast, per-tab, has the token).
  2. Local username in sessionStorage.
  3. `GET /api/auth/session` — returns the redacted view. For cloud
     sessions this means the user is shown as logged in but cloud sync
     does NOT start (no token). For local sessions, the username is
     restored.
  4. localStorage `osler-local-username` fallback (local mode only).
- Cloud sync starts **only** when a real `CloudSession` with a `token`
  is present (from sessionStorage or a fresh login).
- Google `?cloudAuth=<ticket>` flow uses `router.replace` (not
  `window.history.replaceState`) so Next's router state stays consistent.
- Cloud session expiration (401 from sync) clears both sessionStorage and
  the cookie, then redirects to `/login`.

### `src/lib/osler/cloud.ts` (patched)

- `saveCloudSession()` still writes to sessionStorage + POSTs to
  `/api/auth/session`. The POST may now return 401 if the Worker rejects
  the token — in that case the stale sessionStorage entry is cleared.
- All other callers unchanged.

### `src/app/layout.tsx`

- `OslerSessionProvider` mounted at the root (above `AnalyticsProvider`).
- Root layout stays a server component; `OslerSessionProvider` is a
  client component imported into it.

---

## 2. Shared navigation layer

### `src/lib/osler/navigation.ts`

- `useCurrentView()` — derive `OslerView` from `usePathname()`.
- `routeFor(view, params)` — path builder, `encodeURIComponent` on
  dynamic segments.
- `navigate(view, params)` — `withViewTransition(() => router.push(path),
  directionFor(from, to))` + `haptic("selection")`, preserving the
  `VIEW_ORDER` slide heuristic.

### `src/components/osler/app-shell.tsx`

- Derives `view` via `useCurrentView()`.
- Nav buttons, `MobileTabBar`, and search selections call `navigate()`.
- No `view` / `onViewChange` props — the shell is self-contained.

---

## 3. Content loading per route

### `src/app/(app)/qbank/[uid]/page.tsx` (client, thin)

- `const { uid } = await params` (Next 16 async params).
- `loadContentByUid(uid)` → renders `QBankStudio` with the loaded content.
- **Type mismatch** (e.g. a flashcard uid pasted into `/qbank/…`) →
  `router.replace("/flashcards/" + uid)` inside the `.then()` callback.
- Unknown uid → `EmptyState` with a "Back to QBank" link.
- Loading / empty states per the design system.

Same pattern for:
- `flashcards/[uid]` → `FlashcardStudio`
- `osce/[uid]` → `OsceStudio`
- `library/[article]` → `Library`
- `videos/[video]` → `VideosStudio`
- `settings/[section]` → `Settings` (invalid section →
  `router.replace("/settings")` in a `useEffect`, with a loading state
  shown until the redirect fires — NOT during render)

### `src/lib/osler/content.ts`

- `loadContentByUid(uid, engineHint?)` — optional `engineHint` restricts
  the search to one category folder (avoids scanning every enabled
  folder). Falls back to a full scan if the hint fails.
- Session-scoped module-level `Map<uid, AnyContent>` memo so
  back/forward reopens don't re-download + re-parse packs.
- Falls back to local `/osler-content/` URLs if the Worker is
  unreachable (via `resetCloudReachable()` on fetch failure).

### `src/lib/osler/content-url.ts`

- Resolves content URLs to the Worker's `/v1/content/` and
  `/v1/content-manifests/` endpoints when cloud is configured and
  reachable, otherwise to local `/osler-content/` paths.
- `isCloudReachable()` optimistically returns `true` on first call and
  kicks off an async probe. The probe result is cached for 60 s.
- `resetCloudReachable()` flips the cache to `false` on fetch failure
  and schedules a re-probe after 30 s.
- `forceRecheckCloud()` bypasses the cache for admin content publishes.

### Callers converted to `navigate()`

- `dashboard.tsx`, `qbank-studio.tsx`, `flashcard-studio.tsx`,
  `osce-studio.tsx`, `library.tsx`, `videos-studio.tsx`, `profile.tsx` —
  swap `onViewChange` / `onOpenPack` / `onNavigateBack` /
  `openSettingsSection` for path navigation via `useOslerRouter()`.

---

## 4. R2 content serving (Cloudflare free tier)

The Worker serves R2-backed content via two public endpoints:

- `GET /v1/content/<category>/<path>` — serves `content-files/<category>/<path>`
  from R2. Rate-limited at 240 req/min per IP.
- `GET /v1/content-manifests/<category>/manifest.json` — serves
  `content-manifests/<category>/manifest.json` from R2.

### Cross-origin setup (critical)

The Pages site and the Worker are on different origins. For the browser
to read the responses:

1. **CORS** — the Worker's `requestOrigin()` checks the request's
   `Origin` header against `ALLOWED_ORIGIN` (in `wrangler.toml`). If it
   matches, the response includes
   `Access-Control-Allow-Origin: <ALLOWED_ORIGIN>`. **`ALLOWED_ORIGIN`
   must equal the Pages origin** (e.g.
   `https://osler.pages.dev` or `https://osler.example.com`).
2. **CORP** — the Worker's default `Cross-Origin-Resource-Policy:
   same-origin` would block cross-origin reads. The public content
   endpoints override this to `cross-origin`.
3. **CSP** — the Pages site's `connect-src` must include the Worker URL.
   This is set at the deployment layer (Caddy / Cloudflare Pages
   `_headers`), not in the Next.js app. See `docs/deployment.md` and
   `docs/security.md` for examples.

### R2 key structure

- `content-files/<category>/<path>` — student-facing content (the
  `/v1/content/` endpoint serves these).
- `content-manifests/<category>/manifest.json` — auto-generated
  manifests (the `/v1/content-manifests/` endpoint serves these).
- `_osler.config.json` — the runtime config written by the admin panel.
- Draft content lives under `content-drafts/` (NOT served publicly).

### `/api/r2-fetch` (Pages-side proxy)

- Proxies R2 key fetches through the Pages backend so the admin panel
  doesn't need to know the Worker URL.
- **Requires a valid session cookie** (HMAC-verified) — prevents
  unauthenticated abuse.
- Validates the key starts with `content-files/` or
  `content-manifests/`, rejects `..` and `\\`, caps length at 1024.
- 15 s fetch timeout.

---

## 5. Cloudflare free tier constraints

The Worker runs entirely on Cloudflare's free tier. Key limits and how
the implementation stays within them:

| Resource | Free tier limit | How we stay within |
|---|---|---|
| Worker requests | 100K/day | Public content cached at edge (`cache-control: public, max-age=86400` for binary, `max-age=60` for JSON). Client-side Serwist caching for offline. |
| D1 rows written | 100K/day | Analytics capped at 50K/day global + 12 batches/min/IP. Sync writes are merged into single progress_documents rows. Cron prunes old sessions, audit logs (>1yr), analytics (>30d). |
| D1 rows read | 5M/day | Admin endpoints use pagination. Public content reads come from R2, not D1. |
| R2 storage | 10 GB | Content is the only large storage; expected to be well under 10 GB for a single course. |
| R2 Class A ops | 1M/month | Writes only happen on admin publish / config update. Reads are cached. |
| R2 Class B ops | 10M/month | Public content reads are cached at edge + in the SW. |
| Cron triggers | 5 | Single `0 * * * *` trigger runs cleanup + content scheduling. |
| Worker CPU | 10 ms (free) / 50 ms (paid) | Auth (PBKDF2) is the heaviest operation — 310K iterations is ~5ms on a Worker. No heavy compute. |
| In-memory state | Per-isolate | Rate limiting uses an in-memory LRU — effective per-isolate, not globally. Acceptable for the free tier; for higher load, migrate to Durable Objects. |

### `ALLOWED_ORIGIN` setup

In `cloudflare/worker/wrangler.toml`, set `ALLOWED_ORIGIN` to the exact
origin the browser uses to load your Pages site:

```toml
[vars]
ALLOWED_ORIGIN = "https://osler.pages.dev"
WORKER_URL = "https://osler-cloud.<your-subdomain>.workers.dev"
```

If you serve the Pages site from a custom domain, use that domain
(e.g. `https://osler.example.com`).

---

## 6. State saving after the migration

| Concern | Before | After |
|---|---|---|
| Session / auth | `page.tsx` state + sessionStorage (per-tab) | Layout-level context + HMAC-signed httpOnly cookie; survives routes, refresh, new tabs; middleware-gated |
| Pack / article / video / section selection | React state + manual URL sync | URL path state; survives refresh + back/forward natively |
| Mid-quiz state | `sessions.saveActive()` / `getActive()` → IDB | Unchanged — refreshing `/qbank/[uid]` rehydrates; dashboard "continue" cards keep working |
| Progress / highlights / notes / SRS | IndexedDB singleton | Unchanged (already solid) |

---

## 7. Verification checklist

- `npm run build` and `npm run lint` pass.
- `npm run generate-manifests` unaffected (no content changes).
- Manual checks:
  - Deep links: `/qbank/<uid>`, `/library/<article>`, `/settings/ai`
    resolve after hard reload.
  - Browser back / forward and bfcache wake-up restore the right view.
  - Offline app-open (PWA) still renders from the SW-cached shell.
  - Cross-tab login persistence (login in one tab, new tab is already
    logged in — username shows, but cloud sync requires re-auth for the
    token).
  - Logout clears the cookie, redirects to `/login`.
  - Open redirect blocked: `/login?next=https://evil.com` redirects to
    `/` after login.
  - Cookie forging blocked: `curl -X POST /api/auth/session -d
    '{"username":"admin"}'` on a cloud-enabled instance returns 403.
  - R2 content loads cross-origin (check Network tab — no CORP errors).
  - RTL (Arabic UI) routes render correctly.

---

## 8. Guardrails / notes

- Pages stay `"use client"` (AGENTS.md rule 1) — content is client-fetched
  from the Worker's R2-backed endpoints, so no server prerender of hubs.
- `middleware.ts` coexists with Serwist's navigation caching: offline
  app-open renders from the SW-cached shell; the cookie isn't consulted
  offline, so behavior matches today (sessionStorage per-tab; the IDB
  fallback from phase 1 improves it).
- `next-intl` / `next-auth` are in deps but unused — the hand-rolled
  HMAC cookie handler avoids pulling them in (rule 15).
- Studios, storage, content-loading internals, and the design system are
  untouched — this migrates only the shell / URL / auth layer.
- **`OSLER_SESSION_SECRET`** must be set in production. If unset, the
  server-session module falls back to `JWT_SECRET`, then to an insecure
  dev constant (with a warning). Never deploy to production without
  setting one of these.
