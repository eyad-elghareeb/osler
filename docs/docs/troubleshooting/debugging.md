# Debugging

This page is a deep-dive into debugging Osler V2 — both the PWA and the
Tauri admin. It covers DevTools, logging conventions, and common debugging
patterns.

## Browser DevTools (PWA)

Open with `F12` or `Ctrl+Shift+I` (Cmd+Option+I on macOS). The most-used
tabs:

### Console

Osler logs extensively to the console. Every log has a `[module]` prefix:

```javascript
console.warn('[content-loader] failed to load', url, e);
console.log('[sync] pushing 3 changed fields');
console.error('[auth] Firebase token refresh failed', e);
```

Filter by module:

- Type `[sync]` in the Console filter to see only sync logs.
- Type `[auth]` to see only auth logs.

Common log levels:

- `console.log` — informational (sync, lifecycle).
- `console.warn` — recoverable errors (failed fetch, validation failure).
- `console.error` — non-recoverable errors (init failed, uncaught
  exceptions).

Osler bans `.catch(function(){})` (silent catches). Every catch logs at
least a `console.warn`. If you see no logs for a failing feature, the
catch may be in a third-party library — check the network tab.

### Network

The Network tab shows all HTTP requests. Filter by:

- `Fetch/XHR` — API calls (Firebase, Gemini, content fetches).
- `JS` — engine and lib bundles.
- `CSS` — stylesheets.
- `Img` — content images.
- `Other` — service worker requests.

For Firebase issues, look for:

- `firestore.googleapis.com` — Firestore reads/writes.
- `securetoken.googleapis.com` — Firebase Auth token refresh.
- `identitytoolkit.googleapis.com` — Firebase Auth sign-in.

Status codes:

- 200 — OK.
- 401 — auth token invalid / expired. Sign out and sign in again.
- 403 — Firestore rules blocked the request. Check the rules.
- 429 — rate limited. Wait.
- 5xx — Firebase is having issues. Check
  [status.firebase.google.com](https://status.firebase.google.com/).

For Gemini issues, look for:

- `generativelanguage.googleapis.com` — Gemini API calls.

### Application

The Application tab has sub-tabs for:

- **Service Workers** — registered SWs, their status, update flow.
- **Cache Storage** — the `osler-v1` cache with all bundled files.
- **IndexedDB** — the `osler` database with all tracker stores.
- **Local Storage** — the allow-listed keys (theme, lang, device ID, etc.).
- **Session Storage** — ephemeral session data (rarely used).

For storage issues:

- Verify IndexedDB has the expected stores (quizTracker, bankTracker,
  flashcardTracker, writtenTracker, osceTracker, userContent, etc.).
- Verify the `osler-v1` cache has the bundled files.
- Verify LocalStorage only has allow-listed keys.

To clear all storage:

1. Application → Storage → "Clear site data".
2. Reload.

### Performance

For performance issues (slow load, janky scrolling):

1. Open Performance tab.
2. Click "Record".
3. Reproduce the issue (e.g. navigate to a quiz).
4. Click "Stop".
5. Analyze the flame chart.

Look for:

- Long tasks (> 50ms) — these block the main thread.
- Layout thrashing (forced reflow).
- Excessive event listeners.

### Lighthouse

For overall performance / a11y / SEO:

1. Open Lighthouse tab.
2. Pick categories (Performance, Accessibility, Best Practices, SEO, PWA).
3. Pick device (Mobile / Desktop).
4. Click "Generate report".

V2 targets: Performance 95+, Accessibility 90+, Best Practices 95+, SEO
90+, PWA pass.

## Tauri admin DevTools

The Tauri admin dashboard also has DevTools (enabled in dev mode, disabled
in release builds unless you pass `--debug`).

To enable in release:

```bash
cargo run --release -- --debug
# or build with debug features:
cargo build --release --features debug
```

Then right-click in the admin window → "Inspect Element".

The admin's DevTools are the same as a browser's (it's a webview). The
Rust-side logs go to the terminal (stdout) where you ran `cargo run`.

## Rust-side logging

The Tauri admin uses the `log` crate:

```rust
use log::{info, warn, error};

info!("CMS commit: {} to {}", uid, repo);
warn!("GitHub API rate limited, retrying in {}s", backoff);
error!("Bundle push failed: {}", e);
```

By default, logs go to stdout with `RUST_LOG=info` level. To see debug
logs:

```bash
RUST_LOG=debug cargo run
```

For more granular control:

```bash
RUST_LOG=osler_admin_lib=debug,info cargo run
```

This sets `debug` for the `osler_admin_lib` crate and `info` for
everything else.

## Service worker debugging

The service worker (`sw.js`) has its own DevTools:

1. Open DevTools → Application → Service Workers.
2. Click "logs" next to the SW entry — opens a separate console for the SW.

Common SW issues:

- **SW not registering** — check `sw.js` is at the site root and is valid
  JS.
- **SW not activating** — check the install handler (it may be failing on
  a `cache.add()` call).
- **SW not updating** — check the `update` event handler. The SW may be
  stuck in `waiting` state. Click "skipWaiting" in DevTools to force it.
- **Cache not matching** — verify the cached URLs match the requested
  URLs (case-sensitive, including query strings).

## IndexedDB inspection

DevTools → Application → IndexedDB → `osler`:

- `quizTracker` — per-quiz-item study state.
- `bankTracker` — per-bank-item view state.
- `flashcardTracker` — per-card SM-2 state.
- `writtenTracker` — per-prompt response state.
- `osceTracker` — per-OSCE session state.
- `userContent` — user-authored content items.
- `tutorHistory` — AI tutor conversation history (Phase 12).
- `meta` — sync metadata (last sync timestamp, device ID).
- `aiSpend` — daily/monthly AI spend tracking.

To inspect a record:

1. Click the store name.
2. Click any record in the list.
3. The right panel shows the full JSON.

To edit a record (for debugging):

1. Double-click the value.
2. Edit the JSON.
3. Press Enter.

To delete a record:

1. Right-click → Delete.

To clear a store:

1. Right-click the store name → Clear.

## Logging conventions

When adding logs to Osler code, follow these conventions:

```javascript
// INFO — lifecycle, sync, init
console.log('[sync] pushing 3 changed fields to Firestore');

// WARN — recoverable errors, fallbacks
console.warn('[content-loader] failed to load', url, e, '— using cached');

// ERROR — non-recoverable, user-visible
console.error('[auth] Firebase token refresh failed', e);

// DEBUG — verbose, off by default
if (window.OSLER_DEBUG) {
  console.debug('[sm2] scheduling card', cardId, 'with rating', rating);
}
```

Set `window.OSLER_DEBUG = true` in the console to enable debug logs.

Always include:

- `[module]` prefix.
- Context (what was being attempted).
- The error object (for `warn` / `error`).

Never log:

- Full secrets (API keys, tokens).
- PII (user email, Firebase UID — log a hash instead).
- Large objects (log a summary, not the full object).

## Remote debugging

For debugging a user's issue you can't reproduce locally:

### Option 1: User sends console logs

1. Ask the user to open DevTools → Console.
2. Right-click any log → "Save as..." → save the file.
3. Send you the file.

This captures the console output, but not network requests or stack
traces for uncaught errors.

### Option 2: User shares screen

Walk the user through reproducing the issue over a screen share (Zoom,
Google Meet, etc.). You can't see DevTools directly, but the user can
describe what they see.

### Option 3: Bug report with reproduction

1. Ask the user to file a GitHub Issue with:
   - Osler version (Settings → About).
   - Browser + OS.
   - Steps to reproduce.
   - Expected vs. actual.
   - Console logs (copy-pasted).
2. Try to reproduce locally.
3. If you can't reproduce, ask the user to test in an incognito window
   (rules out extension interference).

## Debug mode

The PWA supports a debug mode via URL parameter:

```
https://your-site.netlify.app/?debug=true
```

In debug mode:

- Verbose logging is enabled (equivalent to `window.OSLER_DEBUG = true`).
- Firebase Analytics events are logged to console (not just sent).
- The service worker skips caching (always fetches fresh).
- Toast durations are extended (so you can read them).
- A "Debug" panel appears in the bottom-left corner with:
  - Current Firebase user
  - Sync status
  - Cache status
  - Storage usage

Use debug mode for support calls — it surfaces a lot of internal state.

## Common debugging patterns

### "The user's data is gone"

1. Ask the user to open DevTools → Application → IndexedDB → `osler`.
2. Check the relevant store — are there records?
3. If yes, the data is there but the UI isn't showing it. Check the
   engine's filter / sort logic.
4. If no, the data was deleted (by the user, by a sync conflict, or by
   clearing site data).
5. If sync was on, check Firestore (admin's Analytics tab or Firebase
   console → Firestore → Data) for the user's records.

### "Sync isn't working"

1. Verify the user is signed in (not guest mode).
2. Verify Firebase mode is on (check `config.json`).
3. Open DevTools → Network → look for `firestore.googleapis.com` requests.
4. Check the request/response — is Firestore returning errors?
5. Open DevTools → Application → IndexedDB → `meta` store — when was the
   last sync?
6. Force a sync: in the console, `window.OslerSync.forceSync()`.

### "The site is slow"

1. Open DevTools → Performance → Record → reproduce → Stop.
2. Look for long tasks.
3. Open DevTools → Network → reload → check the waterall.
4. Common culprits:
   - Large content packs (split them).
   - Unminified JS (run `npm run build`).
   - No service worker caching (verify SW is registered).
   - Slow Firebase queries (add indexes — see Firestore console → Indexes).

## What's next

- [Common Issues](common-issues.md) — quick fixes for known problems.
- [Operations → Monitoring](../operations/monitoring.md) — production
  monitoring.
- [Development → Testing](../development/testing.md) — catching bugs before
  they reach production.
