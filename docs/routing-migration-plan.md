# Routing Migration Plan — Proper Routes, Cookie Auth, Solid State & URL Handling

> Status: **planned** — awaiting execution.
> Stack: Next 16 App Router, React 19, Serwist PWA, IndexedDB-backed `storage` singleton.
> No new dependencies.

## Decisions (confirmed)

- **Full path-based routes** — real segments (`/qbank/[uid]`, `/library/[article]`, `/settings/[section]`) replace query-param view state.
- **Legacy `?view=` deep links are dropped** — no redirect shim; old URLs stop resolving.
- **Cookie-based session + middleware auth** — httpOnly cookie, guarded by `src/middleware.ts`.

---

## Current state (the problem)

- Single route `/` — `src/app/page.tsx` (`Home`, a client component) owns *all* app state: `view`, `activeItem`/`activeContent`, `activeArticleId`, `activeVideoId`, `settingsSection`, session.
- URL sync is hand-rolled — query params (`?view=&pack=&article=&video=&section=`) synced via `pushState`/`replaceState` + `popstate`/`pageshow` listeners (`page.tsx:140-268`). Fragile, non-modern.
- `AppShell` is a component receiving `view` as a prop (`app-shell.tsx:137`); every studio is conditionally rendered in one giant tree.
- Auth is client-only — `sessionStorage` (`osler-cloud-session-v1`, `osler-session`); per-tab, no middleware, no server awareness.
- **Already solid (do not touch):** IndexedDB storage singleton, in-memory cache, write-flush on unload, `sessions.saveActive()`/`getActive()` mid-quiz resume (`storage.ts:678-695`).

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

All app routes live under the route group `src/app/(app)/` (adds no URL segment — same pattern as `src/app/admin/`). Hubs render the existing studios with no active item; dynamic segments load the pack and render the studio in session mode.

---

## 1. Cookie-based auth + middleware

### New: `src/app/api/auth/session/route.ts`
- `POST` — receives `{ session }` after login; sets **httpOnly** cookie `osler-session` (`SameSite=Lax`, `Path=/`, `Secure` in production, `Max-Age` derived from `session.expiresAt`).
- `GET` — reads the cookie, returns the parsed session JSON (client bootstrap for new tabs).
- `DELETE` — clears the cookie (logout).

### Modified: `src/lib/osler/cloud.ts`
- `saveCloudSession()` / `clearCloudSession()` additionally fire `POST` / `DELETE` to `/api/auth/session` (fire-and-forget, `.catch`-guarded).
- All existing `readCloudSession()` callers stay untouched.

### New: `src/middleware.ts`
- **Public allowlist:** `/login`, `/api/*`, `/_next/*`, `/osler-content/*`, `/assets/*`, `/sw.js`, `/manifest.webmanifest`, `/icon.svg`, `/favicon.png`.
- App routes without a valid `osler-session` cookie → `redirect("/login?next=" + pathname)`.
- `/login` with a valid cookie → `redirect("/")`.
- `/admin/*` → `NextResponse.next()` (separate auth concern, untouched).

### New: `src/app/login/page.tsx`
- Renders the existing `LoginScreen`.
- `onLogin(name)` → session context updates → `router.push(searchParams.next ?? "/")`.
- Reads `?cloudAuthError=` and shows the Google error message there.

### Modified: `src/app/layout.tsx`
- Mount `OslerSessionProvider` (root layout stays a server component; client provider imports like `OslerThemeProvider`).

### New: `src/lib/osler/session-context.tsx` — `OslerSessionProvider` / `useOslerSession`
- Holds `{ username, cloudSession, login, logout, loading }`.
- Absorbs the session-restore/expiry/`cloudAuth`-ticket effects from `page.tsx:71-123`.
- **Bootstrap order:** sessionStorage (sync, fast) → IDB `settings` fallback → `GET /api/auth/session` (new-tab online restore).
- Result: login persists **across tabs** (today sessionStorage loses it in new tabs) — the concrete "solid state saving" win.

---

## 2. Shared navigation layer

### New: `src/lib/osler/navigation.ts`
- `useCurrentView()` — derive `OslerView` from `usePathname()`.
- `routeFor(view, params)` — path builder.
- `navigate(view, params)` — `withViewTransition(() => router.push(path), directionFor(from, to))` + `haptic("selection")`, preserving the existing `VIEW_ORDER` slide heuristic (`app-shell.tsx:93-125`).

### Modified: `src/components/osler/app-shell.tsx`
- Drop `view` / `onViewChange` props.
- Derive `view` via `useCurrentView()`.
- Nav buttons, `MobileTabBar`, and search selection call `navigate()`.
- Keep everything else (search, sync badge, user menu, View-Transitions branch).

---

## 3. Content loading per route

### New: `src/app/(app)/qbank/[uid]/page.tsx` (client, thin)
- `const { uid } = await params` (Next 16 async params).
- `loadContentByUid(uid, "qbank")` → `<QBankStudio activeItem activeContent onExit={() => navigate("qbank")} … />`.
- Loading / empty states per the design system.
- **Type mismatch** (e.g. a flashcard uid pasted into `/qbank/…`) → `redirect("/flashcards/" + uid)`.
- Unknown uid → `redirect("/qbank")`.

Same pattern for:
- `flashcards/[uid]` → `FlashcardStudio`
- `osce/[uid]` → `OsceStudio`
- `library/[article]` → `Library`
- `videos/[video]` → `VideosStudio`
- `settings/[section]` → `Settings` (invalid section → `redirect("/settings")`)

### Modified: `src/lib/osler/content.ts`
- Add optional `engineHint` to `loadContentByUid` so `/qbank/[uid]` fetches only the qbank manifest instead of scanning every enabled folder (`content.ts:292-319`).
- Add a session-scoped module-level `Map<uid, AnyContent>` memo so back/forward reopens don't re-download + re-parse packs (replaces the old `openPackWithData` preloaded-content handoff).

### Callers converted to `navigate()` (mechanical; studios unchanged internally)
- `dashboard.tsx`, `qbank-studio.tsx`, `flashcard-studio.tsx`, `osce-studio.tsx`, `library.tsx`, `videos-studio.tsx`, `profile.tsx` — swap `onViewChange` / `onOpenPack` / `onNavigateBack` / `openSettingsSection` for path navigation.

---

## 4. Deletions

- `src/app/page.tsx` — the entire `Home` orchestration, the hand-rolled `pushState`/`popstate`/`pageshow` URL sync (`page.tsx:140-268`), and the `?cloudAuth` consumption (moves into the session provider). Next.js owns history / back / forward / bfcache now.
- Legacy `?view=` / `?pack=` URLs are dropped (per decision) — no redirect shim.
- Add `src/app/not-found.tsx` for 404s.

---

## 5. State saving after the migration

| Concern | Before | After |
|---|---|---|
| Session / auth | `page.tsx` state + sessionStorage (per-tab) | Layout-level context + httpOnly cookie; survives routes, refresh, new tabs; enables middleware guarding |
| Pack / article / video / section selection | React state + manual URL sync | URL path state; survives refresh + back/forward natively |
| Mid-quiz state | `sessions.saveActive()` / `getActive()` → IDB | Unchanged — refreshing `/qbank/[uid]` rehydrates; dashboard "continue" cards keep working |
| Progress / highlights / notes / SRS | IndexedDB singleton | Unchanged (already solid) |

---

## 6. Execution phases (each ends buildable + lint-clean)

1. **Auth foundation** — `api/auth/session` route, `cloud.ts` cookie mirror, `session-context.tsx`, mount in root layout. Zero UI change.
2. **Route shell** (atomic for `/`) — `src/middleware.ts`, `/login`, `(app)/layout.tsx`, `(app)/page.tsx` (Dashboard) + learn/profile/settings pages, reworked `AppShell`, delete `page.tsx`. Studios still receive props from their pages.
3. **Dynamic segments + data** — `[uid]` / `[article]` / `[video]` / `[section]` pages, `engineHint` + content memo, convert all callers to `navigate()`.
4. **Polish + verify** — login `next` redirect, `cloudAuth` handling in provider, `not-found.tsx`; run `npm run build` and `npm run lint`; manual checks.

---

## 7. Verification checklist

- `npm run build` and `npm run lint` pass at the end of every phase.
- `npm run generate-manifests` unaffected (no content changes).
- Manual checks:
  - Deep links: `/qbank/<uid>`, `/library/<article>`, `/settings/ai` resolve after hard reload.
  - Browser back / forward and bfcache wake-up restore the right view.
  - Offline app-open (PWA) still renders from the SW-cached shell.
  - Cross-tab login persistence (login in one tab, new tab is already logged in).
  - Logout clears the cookie, redirects to `/login`.
  - RTL (Arabic UI) routes render correctly.

---

## 8. Guardrails / notes

- Pages stay `"use client"` (AGENTS.md rule 1) — content is client-fetched from `/osler-content`, so no server prerender of hubs (optional later work).
- `middleware.ts` coexists with Serwist's navigation caching: offline app-open renders from the SW-cached shell; the cookie isn't consulted offline, so behavior matches today (sessionStorage per-tab; the IDB fallback from phase 1 improves it).
- `next-intl` / `next-auth` are in deps but unused — the hand-rolled cookie handler avoids pulling them in (rule 15).
- Studios, storage, content-loading internals, and the design system are untouched — this migrates only the shell / URL / auth layer.
