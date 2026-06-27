# Common Issues

This page is a quick reference for the most common issues Osler V2 users
and admins encounter. For deeper debugging, see
[Debugging](debugging.md).

## Build issues

### `npm run build` fails with "Cannot find module 'esbuild'"

**Cause:** `node_modules/` is missing or out of sync with `package-lock.json`.

**Fix:**

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

If you used `npm install` instead of `npm ci` previously, the lockfile may
have drifted. Always use `npm ci` for reproducible installs.

### `npm run build` fails with "esbuild: Linux x64 not supported"

**Cause:** esbuild's platform-specific binary didn't install correctly.

**Fix:**

```bash
npm rebuild esbuild
```

If that fails, delete `node_modules/esbuild` and run `npm install` again.

### Tauri build fails with "webkit2gtk-4.1 not found"

**Cause:** Linux system deps missing.

**Fix:**

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf
```

macOS: install Xcode Command Line Tools (`xcode-select --install`).
Windows: install WebView2 runtime.

### Tauri build fails with "cargo: command not found"

**Cause:** Rust not installed or not in PATH.

**Fix:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustc --version    # verify
```

## Test issues

### `npm test` fails with "fake-indexeddb not found"

**Cause:** devDependencies not installed.

**Fix:** `npm ci` (the test setup requires `fake-indexeddb`,
`happy-dom`, etc. from devDependencies).

### `npm run validate` fails with "schema version mismatch"

**Cause:** a content file's `meta.schemaVersion` doesn't match any version
in `src/schemas/_meta.json`.

**Fix:**

1. Open the failing content file.
2. Find `meta.schemaVersion`.
3. Check `src/schemas/_meta.json` — what versions are listed for that
   content type?
4. Either:
   - Update the content file's `schemaVersion` to a known version.
   - Add the new version to `_meta.json` (after creating the schema file).

See [Content Authoring → Validation](../content-authoring/validation.md).

### E2E tests fail with "browser not found"

**Cause:** Playwright browsers not installed.

**Fix:**

```bash
npx playwright install chromium
# for cross-browser testing:
npx playwright install firefox webkit
```

### E2E tests fail with "webServer failed to start"

**Cause:** port 5500 already in use, or `dist/` doesn't exist.

**Fix:**

```bash
# kill whatever is on port 5500
lsof -ti:5500 | xargs kill -9     # macOS/Linux
netstat -ano | findstr :5500      # Windows

# ensure dist/ exists
npm run build

# retry
npm run test:e2e
```

## Admin dashboard issues

### "Sign in with GitHub" hangs

**Cause:** Device Flow code expired, or network issue.

**Fix:**

1. Cancel the sign-in.
2. Restart the admin dashboard.
3. Try again.
4. If it still fails, check your network (GitHub Device Flow requires
   outbound HTTPS to `github.com/login/device/code`).

### Admin won't launch after update

**Cause:** the update may have failed mid-swap, leaving a partial binary.

**Fix:**

1. Find the previous binary (the admin keeps the last version as
   `{osler-admin}.previous` in the install dir).
2. Rename it back to `osler-admin` (or `Osler Admin.exe` on Windows).
3. Launch.
4. Disable auto-update in Settings until the bug is fixed.
5. Report the issue.

### Content editor shows "validation failed" but the form looks correct

**Cause:** the JSON view may have a typo not visible in the form view, or
a hidden field is invalid.

**Fix:**

1. Switch to the JSON view (right panel of the editor).
2. Look for red underlines.
3. Hover over them to see the error.
4. Fix and re-validate.

If you can't find the error, copy the JSON and validate it externally:

```bash
npx ajv validate -s src/schemas/{type}-v1.json -d your-file.json
```

## PWA issues

### "Firebase: unauthorized domain"

**Cause:** the PWA's URL is not in the Firebase project's authorized
domains list.

**Fix:**

1. Go to Firebase console → Authentication → Settings → Authorized
   domains.
2. Add the URL (without `https://` and without trailing slash):
   - `localhost` (for local preview)
   - `127.0.0.1` (for local preview with IP)
   - `your-site.netlify.app` (for deployed site)
3. Wait 1-2 minutes for propagation.
4. Reload the PWA.

### Service worker not registering

**Cause:** multiple possible. Check the browser console for the specific
error.

**Common fixes:**

- `sw.js` not at the site root → check that the file exists at `/sw.js`.
- HTTPS required → use `localhost` or `127.0.0.1` for local testing (they
  are HTTPS-exempt).
- Browser doesn't support service workers → use a modern browser.
- `sw.js` has a syntax error → open it in an editor and check.

### "Sync failed" toast appears repeatedly

**Cause:** usually a Firestore rules issue, network issue, or quota issue.

**Fix:**

1. Open DevTools → Network → look for failed Firestore requests.
2. If 403: Firestore rules are blocking. Verify the rules (see
   [Firebase → Firestore Rules](../firebase/firestore-rules.md)).
3. If 429: rate limited. Wait a few minutes.
4. If 5xx: Firebase is having issues. Check
   [status.firebase.google.com](https://status.firebase.google.com/).
5. If offline: the toast should disappear when you reconnect. If not,
   reload the page.

### PWA doesn't work offline

**Cause:** service worker didn't cache the bundle.

**Fix:**

1. Open the PWA once online (SW installs and caches).
2. Reload (SW activates and serves from cache).
3. DevTools → Application → Cache Storage → verify `osler-v1` cache has
   files.
4. DevTools → Network → check "Offline" → reload.

If the cache is empty after step 3, the SW's install handler may have
failed. Check the SW's console logs (DevTools → Application → Service
Workers → "logs" link).

### AI tutor button is hidden

**Cause:** Firebase mode is off OR no Gemini API key is configured.

**Fix:**

1. Verify the site was generated in Firebase mode (check `config.json` in
   the deployed site).
2. Configure the Gemini API key in the admin's Settings → AI Generation.
3. Regenerate and redeploy the site (the API key is bundled into
   `config.json`).

### Content pack import fails

**Cause:** the pack is malformed, uses an unknown schema version, or has
UID collisions.

**Fix:**

1. Open the pack file in a text editor (it's plain JSON).
2. Verify `packFormat === "osler-content-pack"` and `packVersion === "1.0"`.
3. For each item, verify `meta.schemaVersion` matches a known version in
   `src/schemas/_meta.json`.
4. If UIDs collide with local content, use the "Rename" option on import.

For detailed validation errors, open DevTools → Console — the PWA logs
the full validation error.

## Deploy issues

### GitHub Pages: "404 — There isn't a GitHub Pages site here"

**Cause:** Pages not enabled, or wrong branch selected.

**Fix:**

1. Go to repo settings → Pages.
2. Source: `gh-pages` branch.
3. Wait up to 5 minutes for first deploy.

### Netlify: "Site loads but CSS / JS 404"

**Cause:** `netlify.toml` not deployed, or wrong publish directory.

**Fix:**

1. Verify `netlify.toml` is at the bundle root.
2. In Netlify UI → Site settings → Build settings → Publish directory:
   set to `.` (current directory).

### Vercel: "Routing is broken (404 on /quiz/123)"

**Cause:** SPA rewrites not applied.

**Fix:**

1. Verify `vercel.json` is at the bundle root.
2. Verify it has the `rewrites` section (see
   [Deployment → Vercel](../deployment/vercel.md)).
3. Redeploy.

### Cloudflare Pages: "Deployment failed: file count exceeds 20000"

**Cause:** too many files in the bundle.

**Fix:**

1. Reduce the number of content packs.
2. Combine small items into larger packs.
3. Switch to a provider without the 20,000 file limit (Netlify, Vercel).

## Sync issues

### Sync works on one device but not another

**Cause:** different Firebase projects, different auth states, or different
Firestore rules versions.

**Fix:**

1. Verify both devices are signed in as the same Firebase user.
2. Verify both devices are using the same site URL (and thus the same
   `config.json` with the same Firebase config).
3. Check Firestore rules are the latest version.
4. Check the second device's network / browser console for errors.

### Sync conflict causes data loss

**Cause:** the merge strategy didn't preserve both sides' changes.

**Fix:**

1. Check which store was affected (trackers, streaks, userContent).
2. Look up the merge strategy for that store (see
   [Firebase → Sync Strategies](../firebase/sync-strategies.md)).
3. If the strategy is correct but data was still lost, file a bug with:
   - The two devices' states before sync.
   - The merged state.
   - The expected merged state.

Some data loss is by design (e.g. `fieldMergeByUpdatedAt` takes the later
`updatedAt` per field — if both devices wrote the same field, one wins).
Other data loss may be a bug in the merge implementation.

## What's next

- [Debugging](debugging.md) — DevTools deep dive.
- [Operations → Incident Response](../operations/incident-response.md) —
  for SEV-1/2 issues.
- [Troubleshooting → Common Issues on GitHub](https://github.com/osler-app/osler/issues?q=label%3Atroubleshooting)
  — community-reported issues.
