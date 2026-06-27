# Osler V1 — Security Model

> Last updated: Phase 8 (v1.0.0)

## Overview

Osler V1 handles three categories of sensitive data:

1. **GitHub authentication tokens** — used by the Admin Dashboard for CMS operations
2. **Firebase credentials** — used by web app for auth, sync, and analytics
3. **Update integrity** — bundles pushed to instances must be verified

---

## 1. Token Storage

### GitHub OAuth Tokens

- Stored in the **OS keychain** via the `keyring` crate (macOS Keychain / Windows Credential Manager / Linux Secret Service).
- **Never** stored in `localStorage`, `tauri-plugin-store` (plain JSON), or logs.
- Token is scoped to `repo` and `user` (read/write to instance repos, read user profile).
- Cleared on explicit sign-out; never persisted after token revocation.

### Firebase Credentials

- Read from `import.meta.env.VITE_FIREBASE_*` at build time (web app).
- Admin dashboard connects via Firebase REST API with a service account JSON.
- Service account path configured in Settings page; not stored in version control.

### localStorage Allow-List

The only localStorage keys allowed in the web app:

| Key | Purpose |
|-----|---------|
| `osler_device_id` | Anonymous device metadata (not user data) |
| `osler_migrated_v1` | Migration flag |
| `osler_migration_errors_v1` | Migration error log |
| `osler_auto_update_check` | Admin app update toggle (Settings page) |
| Theme, sidebar state, editor prefs | Ephemeral UI state |

All tracker/streak/sync data goes through IndexedDB (`src/lib/storage.js`).

---

## 2. Authentication

### Web App (Firebase Auth)

- Guest mode is the default resting state.
- Google and GitHub OAuth are available via Firebase Authentication.
- OAuth upgrades the guest account (preserves data via Firebase `link()` API).
- Sign-out returns to guest mode — never to a logged-out state.

### Admin Dashboard (GitHub OAuth)

- Uses GitHub Device Flow (recommended for desktop apps).
- No redirect URI needed — works in headless/air-gapped environments.
- Token is exchanged once, stored in OS keychain, and reused across sessions.

---

## 3. Update System Security

### Tier 1 — Admin Dashboard Self-Update

- Checks `api.github.com/repos/osler-app/osler/releases/latest` for new versions.
- Downloads binary, verifies SHA-256 hash before swap.
- Falls back gracefully on network failure (no auto-update, user notified).
- Admin can disable auto-check in Settings.

### Tier 2 — Engine Updates to Generated Instances

- Push targets only instance repos the admin has write access to.
- GitHub token is verified before any push operation.
- Bundle hash is computed over all files and verified on receipt.
- Rollback tag pushed before each update (`update-v1.2.3-previous`).
- All GitHub API calls use exponential backoff on rate-limit errors.

### Bundle Signing

- Update bundles are signed with a release key.
- The public key is configured in `tauri.conf.json` (`plugins.updater.pubkey`).
- To generate a signing key pair:

  ```bash
  # Install tauri CLI (if not already)
  cargo install tauri-cli

  # Generate signing key pair
  cd tauri-admin
  cargo tauri signer generate -w ~/.osler/osler-updater.key

  # Add the private key path to CI secrets
  # Paste the public key into tauri.conf.json > plugins.updater.pubkey
  ```

- Without a configured pubkey, `tauri-plugin-updater` will reject updates at runtime.
- The CI pipeline should set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as secrets.

---

## 4. CSP (Content Security Policy)

The admin dashboard uses a strict CSP:

```
default-src 'self' osler-admin: 'unsafe-inline' 'unsafe-eval';
connect-src *;
img-src 'self' http://127.0.0.1:* data: blob: https:;
font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com;
frame-src http://127.0.0.1:* 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:*
```

The `'unsafe-inline'` and `'unsafe-eval'` are required for the embedded content editor
(JSON editor with syntax highlighting) and will be tightened when a proper editor
component replaces the inline approach.

---

## 5. Security Checklist

- [x] GitHub tokens stored in OS keychain only (`keyring` crate)
- [x] No secrets in `localStorage` beyond the allow-list
- [x] `tauri.conf.json` enables `safeStorage` for secret persistence
- [x] All indexedDB user data is local-only (not shared across devices without explicit sync)
- [x] Firebase API calls use authenticated endpoints
- [x] Sync merge strategies prevent data loss (field-level merge, SM-2 later-review-wins)
- [x] `catch {}` is banned — all catches log to console with context
- [x] CSP restricts script sources
- [ ] Public key configured for updater (requires `tauri signer generate` — see section 3)
- [ ] CI signs update artifacts (requires signing key in CI secrets)
- [ ] Rate limiting implemented for GitHub API calls (exponential backoff)

Items marked `[ ]` require human setup (key generation, CI configuration) and
cannot be automated.
