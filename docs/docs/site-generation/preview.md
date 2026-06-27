# Local Preview

The site generator wizard's **Preview locally** button lets you test a
generated bundle in your browser before deploying. This page documents the
preview workflow, what works in preview, and what doesn't.

## Starting a preview

After generating a bundle (see [Wizard](wizard.md)):

1. Click **Preview locally** in the post-generate dialog.
2. The admin:
   - Extracts the zip to a temp directory (e.g. `/tmp/osler-preview-{timestamp}/`
     on Linux, `%TEMP%\osler-preview-{timestamp}\` on Windows).
   - Starts a tiny_http server on `localhost:5500` (or the next free port if
     5500 is taken).
   - Opens the default browser to `http://localhost:5500/`.
3. The browser loads the PWA exactly as a deployed instance would.

The preview runs until you:

- Click **Stop preview** in the admin's preview window.
- Close the admin (the server is killed on app exit).
- The temp directory is cleaned up on next admin launch.

## What works in preview

Almost everything works in preview mode:

- ✅ All engines (quiz, bank, flashcard, written, osce) fully functional
- ✅ Hub navigation, search, content filtering
- ✅ Theme + i18n (EN/AR + RTL)
- ✅ Service worker (offline caching, update detection) — but only after
  the first reload (SW needs one cycle to install)
- ✅ IndexedDB storage (your study progress saves locally)
- ✅ AI tutor (Phase 12) — if Gemini API key is configured
- ✅ Content pack export/import
- ✅ First-run tour

## What doesn't work in preview

A few things require production-only setup:

- ❌ **Firebase auth (Google / GitHub OAuth)** — Firebase OAuth requires the
  origin to be in the authorized domains list. `localhost` is authorized by
  default in most Firebase projects, but `127.0.0.1` is not. The preview
  uses `127.0.0.1:5500` — add it to the authorized domains in the Firebase
  console (Auth → Settings → Authorized domains) if you want OAuth to work.
- ❌ **Firebase Analytics** — analytics events fire but may not reach the
  Firebase console from `localhost` (depends on your browser's tracking
  protection). Check the browser's network tab to verify.
- ❌ **Bundle updates (Tier 2)** — the preview is a local directory, not a
  GitHub repo. Tier 2 push requires a deployed instance with
  `update-manifest.json` accessible via GitHub. Use a real deploy to test
  Tier 2.
- ❌ **PWA install prompt** — browsers suppress the install prompt on
  `localhost`. Test install UX on a deployed instance.
- ❌ **Custom domain** — preview is always `localhost`. Custom domain
  behavior (CORS, CSP) must be tested on a real deploy.

## Inspecting the bundle

While the preview is running, you can inspect the extracted bundle files in
the temp directory. This is useful for:

- Verifying `config.json` has the correct theme + auth + deploy settings
- Verifying the `engines/` directory contains the chosen engines
- Verifying the `content/` directory contains the chosen content packs
- Verifying `update-manifest.json` has the correct hash + file list
- Verifying provider config files (`netlify.toml`, `vercel.json`, etc.) are
  well-formed

To find the temp directory:

- **Linux:** `/tmp/osler-preview-{timestamp}/`
- **macOS:** `$TMPDIR/osler-preview-{timestamp}/` (usually
  `/var/folders/.../T/osler-preview-{timestamp}/`)
- **Windows:** `%TEMP%\osler-preview-{timestamp}\` (usually
  `C:\Users\{user}\AppData\Local\Temp\osler-preview-{timestamp}\`)

The admin also shows the temp directory path in the preview window.

## DevTools

Use the browser's DevTools (F12) to inspect:

- **Console** — JS errors, warnings, `[module] ...` log lines
- **Network** — verify content + engine files load successfully; check for
  404s
- **Application → IndexedDB** — inspect the `osler` database; verify
  tracker stores have data after studying
- **Application → Cache Storage** — verify the service worker cached the
  bundle
- **Application → Service Workers** — verify the SW registered and is active
- **Lighthouse** — run a Lighthouse audit (Performance, Accessibility, Best
  Practices, SEO, PWA). See [Operations → Monitoring](../operations/monitoring.md)
  for target scores.

## Testing offline mode

To verify the service worker's offline behavior:

1. Load the preview once (SW installs and caches the bundle).
2. Reload (SW serves from cache).
3. In DevTools → Network → check "Offline".
4. Reload. The PWA should load fully offline.

If the PWA fails to load offline, check:

- The SW registered (Application → Service Workers).
- The bundle is in Cache Storage (Application → Cache → `osler-v1`).
- The `sw.js` file is at the site root.

## Testing Firebase sync

To verify Firebase sync works (Firebase mode only):

1. Make sure `127.0.0.1` is in the Firebase project's authorized domains.
2. Sign in (Google or GitHub).
3. Study a few items (records to IndexedDB).
4. Open the same Firebase project in another browser profile or device.
5. Sign in as the same user.
6. Verify the study progress syncs.

If sync fails, check:

- The Firebase config in `config.json` matches your project.
- The Firestore rules allow the user to read/write their own data (see
  [Firebase → Firestore Rules](../firebase/firestore-rules.md)).
- The browser's network tab — sync calls should be hitting
  `firestore.googleapis.com`.

## Testing i18n / RTL

To verify Arabic layout:

1. In the PWA, switch the language to Arabic (topbar flag icon or Settings).
2. The UI should flip to RTL.
3. Verify no hardcoded `margin-left` / `padding-right` broke the layout
   (use logical properties — see [i18n → RTL Guide](../i18n/rtl-guide.md)).
4. Load an Arabic content item and verify it renders correctly.
5. Switch back to English — UI should flip back to LTR.

## Stopping the preview

Click **Stop preview** in the admin's preview window. The admin:

1. Stops the tiny_http server.
2. Closes the browser tab (if the user permits).
3. Optionally cleans up the temp directory (toggle in Settings → General →
   "Clean up preview temp dirs on stop").

If you don't clean up, the temp directory persists — useful for re-inspecting
the bundle after stopping the server. The admin cleans up old preview dirs
on next launch (older than 7 days).

## Common preview issues

### "Port 5500 already in use"

The admin tries `5500` first, then `5501`, `5502`, etc. If all are taken
(>10 ports tried), it shows an error. Close whatever is using the ports
(often another instance of the admin, or another dev server).

### "Firebase: unauthorized domain"

Add `127.0.0.1` (not just `localhost`) to the Firebase project's authorized
domains. See "What doesn't work in preview" above.

### "Service worker failed to register"

Check the browser console for the specific error. Common causes:

- `sw.js` is not at the site root (verify in temp directory).
- The SW has a syntax error (open `sw.js` in an editor and check).
- The browser doesn't support service workers (very old browser).
- HTTPS is required — but `localhost` / `127.0.0.1` are exempt in all modern
  browsers.

### "Content pack failed to load"

Check the browser's network tab — the content JSON file should return 200.
If 404, the file is missing from the bundle (re-generate). If 200 but
content doesn't render, open the file in an editor and verify it's valid
JSON matching the schema.

## What's next

- [Wizard](wizard.md) — generate a bundle to preview.
- [Deployment → GitHub Pages](../deployment/github-pages.md) — when you're
  ready to deploy for real.
- [Troubleshooting → Debugging](../troubleshooting/debugging.md) — browser
  DevTools deep dive.
