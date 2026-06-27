# Security Model

Osler V2 handles four categories of sensitive data:

1. **GitHub authentication tokens** — used by the Tauri admin for CMS
   operations and bundle pushes.
2. **Deploy provider credentials** — Netlify, Vercel, Cloudflare API tokens.
3. **Firebase credentials** — used by the PWA for auth, sync, and analytics;
   used by the admin dashboard for service-account operations.
4. **Update integrity** — bundles pushed to deployed instances must be
   verified before they are applied.

This page documents where each category lives, how it is protected, and what
the threat model assumes. For the V1 baseline, see `SECURITY.md` in the
repository root — this page extends it with V2 additions.

## Token storage

### GitHub OAuth tokens

GitHub tokens are used by the Tauri admin dashboard for two purposes: CMS
operations (read/write to the content repo) and bundle pushes (write to
deployed instance repos). Both flows use the same token, scoped to `repo`
and `user`.

- Stored in the **OS keychain** via the `keyring` crate (macOS Keychain,
  Windows Credential Manager, Linux Secret Service).
- **Never** stored in `localStorage`, `tauri-plugin-store` (which writes
  plain JSON to the app data dir), or logs.
- Token is scoped to `repo` and `user` (read/write to instance repos, read
  user profile).
- Cleared on explicit sign-out; never persisted after token revocation.

### Deploy provider credentials

Each deploy provider (GitHub Pages, Netlify, Vercel, Cloudflare Pages) gets
its own credentials stored in the OS keychain under a service-specific entry
(`com.osler.admin.netlify`, `com.osler.admin.vercel`, etc.). Credentials are
never logged, never written to `tauri-plugin-store`, and never sent to any
endpoint other than the provider's own API.

### Firebase credentials (web app)

The PWA reads Firebase config from `import.meta.env.VITE_FIREBASE_*` at build
time. These are public values — the Firebase API key is safe to publish in
client-side code because Firebase security rules enforce authorization, not
the API key. The values are:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
```

See `.env.example` in the repository root for the template.

### Firebase service account (admin dashboard)

The admin dashboard connects to Firebase via a service account JSON for
service-account-only operations (e.g., analytics aggregation, user lookup for
support). The service account path is configured in the Settings page and
stored in the OS keychain. The JSON file itself lives on the admin's machine —
never in version control, never in the bundle.

### `localStorage` allow-list

The only `localStorage` keys allowed in the web app:

| Key | Purpose |
|-----|---------|
| `osler_device_id` | Anonymous device metadata (not user data) |
| `osler_migrated_v1` | Migration flag |
| `osler_migration_errors_v1` | Migration error log |
| `osler_auto_update_check` | Admin app update toggle (Settings page) |
| Theme, sidebar state, editor prefs | Ephemeral UI state |

All tracker/streak/sync data goes through IndexedDB (`src/lib/storage.js`).
This rule is enforced in code review — any new `localStorage` usage must be
added to this table and justified.

## Authentication

### Web app (Firebase Auth)

- Guest mode is the default resting state. A user can study all admin-managed
  content without signing in.
- Google and GitHub OAuth are available via Firebase Authentication.
- OAuth upgrades the guest account (preserves data via Firebase `link()` API).
- Sign-out returns to guest mode — never to a logged-out state.

### Admin dashboard (GitHub OAuth)

- Uses GitHub Device Flow (recommended for desktop apps).
- No redirect URI needed — works in headless/air-gapped environments.
- Token is exchanged once, stored in OS keychain, and reused across sessions.

### Self-hoster Firebase (V2)

When a self-hoster configures their own Firebase project, the generator wizard
writes their Firebase config into the generated site's `config.json`. The
config is public (see above) — the security boundary is Firestore rules, not
the config values.

## Update system security

### Tier 1 — Admin dashboard self-update

The admin dashboard checks `api.github.com/repos/osler-app/osler/releases/latest`
for new versions. It downloads the binary, verifies the SHA-256 hash before
swap, and falls back gracefully on network failure (no auto-update, user
notified). The admin can disable auto-check in Settings.

### Tier 2 — Engine updates to deployed instances

Engine updates push to deployed instance repos that the admin has write access
to. The GitHub token is verified before any push operation. The bundle hash is
computed over all files and verified on receipt by the deployed instance's
service worker. A rollback tag (`update-v1.2.3-previous`) is pushed before
each update. All GitHub API calls use exponential backoff on rate-limit
errors.

### Bundle signing

Update bundles are signed with a release key. The public key is configured in
`tauri.conf.json` at `plugins.updater.pubkey`. To generate a signing key pair:

```bash
# Install tauri CLI (if not already)
cargo install tauri-cli

# Generate signing key pair
cd tauri-admin
cargo tauri signer generate -w ~/.osler/osler-updater.key

# Add the private key path to CI secrets
# Paste the public key into tauri.conf.json > plugins.updater.pubkey
```

Without a configured pubkey, `tauri-plugin-updater` rejects updates at
runtime. The CI pipeline sets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as secrets.

## Content Security Policy (CSP)

The admin dashboard uses a strict CSP:

```
default-src 'self' osler-admin: 'unsafe-inline' 'unsafe-eval';
connect-src *;
img-src 'self' http://127.0.0.1:* data: blob: https:;
font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com;
frame-src http://127.0.0.1:* 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:*
```

The `'unsafe-inline'` and `'unsafe-eval'` are required for the embedded
content editor (JSON editor with syntax highlighting) and will be tightened
when a proper editor component replaces the inline approach. Generated PWAs
ship with a tighter CSP (no `unsafe-eval`) because they don't include the
content editor.

## Firestore security rules (V2)

V2 extends V1's Firestore rules to cover the new `userContent/{uid}/items/{itemId}`
collection. The rules are owner-only — a user can read and write their own
custom content, but no one else's. The full rules are in
[Firebase → Firestore Rules](../firebase/firestore-rules.md).

Summary:

- `users/{uid}/trackers/*` — owner-only read/write (V1, preserved).
- `users/{uid}/streaks/*` — owner-only read/write (V1, preserved).
- `userContent/{uid}/items/{itemId}` — owner-only read/write (V2 new).
- `events/{eventId}` — authenticated create only; no read (V1, preserved).

## Content pack import safety

When a user imports a content pack file (`.json`), the import flow runs the
full `validate()` pipeline against the pack contents before inserting anything
into IndexedDB. This prevents:

- **XSS via `question` field** — schema validation rejects strings containing
  `<script>` tags or other disallowed HTML.
- **Schema version mismatches** — `meta.schemaVersion` must match a known
  version in `_meta.json`.
- **UID collisions** — if the imported pack contains a UID that already
  exists locally, the user is prompted to overwrite, skip, or rename.

See [Content Authoring → Validation](../content-authoring/validation.md) for
the full validation contract.

## Threat model

The V2 threat model assumes:

- **The Firebase project is run by a trusted operator** (either the Osler team
  for the official deployment, or a self-hoster for their own deployment).
  Firebase rules enforce per-user isolation; the operator cannot read user
  content (though they can see document metadata in the Firebase console).
- **The deploy provider is trusted** to serve the bundle intact. Bundle
  signing catches any in-flight tampering.
- **The user's device is trusted** up to the browser sandbox. Osler does not
  defend against a compromised browser or a malicious extension.
- **Content packs from untrusted sources** are untrusted until validated. The
  import flow rejects invalid packs, but a valid pack could still contain
  misleading medical content — the user is responsible for vetting packs
  from sources they don't trust.

Out of scope:

- Defending against a malicious Firebase operator (use a self-hosted project
  if you don't trust the official one).
- Defending against a compromised deploy provider (use bundle signing).
- DRM on content packs (explicitly an anti-goal — packs are JSON, freely
  copyable).

## Security checklist

- [x] GitHub tokens stored in OS keychain only (`keyring` crate)
- [x] No secrets in `localStorage` beyond the allow-list
- [x] `tauri.conf.json` enables `safeStorage` for secret persistence
- [x] All IndexedDB user data is local-only (not shared across devices
      without explicit sync)
- [x] Firebase API calls use authenticated endpoints
- [x] Sync merge strategies prevent data loss (field-level merge, SM-2
      later-review-wins)
- [x] `catch {}` is banned — all catches log to console with context
- [x] CSP restricts script sources
- [x] Deploy provider credentials stored in OS keychain (V2)
- [x] Content pack import validates against schemas before write (V2)
- [x] Firestore rules cover `userContent` collection (V2)
- [ ] Public key configured for updater (requires `tauri signer generate` —
      see Bundle signing above)
- [ ] CI signs update artifacts (requires signing key in CI secrets)
- [ ] Rate limiting implemented for GitHub API calls (exponential backoff)

Items marked `[ ]` require human setup (key generation, CI configuration) and
cannot be automated.

## What's next

- [Firebase → Bring Your Own](../firebase/bring-your-own.md) — set up your own
  Firebase project.
- [Firebase → Firestore Rules](../firebase/firestore-rules.md) — the rules in
  full.
- [Admin Dashboard → Settings](../admin-dashboard/settings.md) — credential
  management in the Tauri app.
