# Osler V2 — Security Model

> Last updated: Phase 16 (v2.0.0)
>
> Extends V1 SECURITY.md with V2 additions. V1 sections (token storage,
> authentication, update system) are preserved unchanged.

## Overview

Osler V2 handles four categories of sensitive data:

1. **GitHub authentication tokens** — used by the Tauri admin for CMS
   operations and bundle pushes (V1, preserved).
2. **Deploy provider credentials** — Netlify, Vercel, Cloudflare API tokens
   (V2 new).
3. **Firebase credentials** — used by the PWA for auth, sync, and analytics;
   used by the admin dashboard for service-account operations (V1 extended).
4. **Update integrity** — bundles pushed to deployed instances must be
   verified before they are applied (V1, preserved).

## V2 additions

### Deploy provider credentials (Phase 15)

V2 adds per-provider credential storage in the OS keychain:

| Provider | Keychain service | Credential shape |
|----------|------------------|------------------|
| GitHub Pages | (reuses `com.osler.admin.github`) | existing GitHub token |
| Netlify | `com.osler.admin.netlify` | `{ access_token }` |
| Vercel | `com.osler.admin.vercel` | `{ access_token }` |
| Cloudflare Pages | `com.osler.admin.cloudflare` | `{ api_token, account_id }` |

Credentials are:

- Stored in the OS keychain via the `keyring` crate (macOS Keychain,
  Windows Credential Manager, Linux Secret Service).
- **Never** written to `tauri-plugin-store` (plain JSON) or `localStorage`.
- **Never** logged. Provider modules redact credentials in error messages.
- **Never** sent to any endpoint other than the provider's own API.

### Cloud Storage (Phase 9)

V2 adds optional Firebase Cloud Storage for cloud-based content pack sharing.
The Storage rules enforce:

- `userContent/{uid}/{fileName}` — owner-only write with size + content-type
  limits (50 MB max, `application/json` only).
- Optional public read for files marked `sharePublic = 'true'` via custom
  metadata.

See `storage.rules` in the project root.

### User custom content (Phase 10)

V2 adds the `userContent/{uid}/items/{itemId}` Firestore collection for
user-authored content. Rules enforce owner-only read/write. Schema validation
is client-side (defense-in-depth via optional server-side rules is documented
in `docs/firebase/firestore-rules.md`).

### Content pack import safety (Phase 10)

Content pack import (`src/lib/content-pack.js`) validates every item against
its JSON Schema before writing to IndexedDB. This prevents:

- **XSS via `question` field** — schema validation rejects strings containing
  `<script>` tags or other disallowed HTML.
- **Schema version mismatches** — `meta.schemaVersion` must match a known
  version in `_meta.json` (V19 policy).
- **UID collisions** — the user is prompted to overwrite, skip, or rename.

See `docs/content-authoring/validation.md` for the validation contract.

## V1 sections (preserved)

The V1 security model sections remain in effect:

- Token storage (GitHub tokens in OS keychain via `keyring` crate)
- Authentication (Firebase Auth for web, GitHub Device Flow for admin)
- Update system (Tier 1 self-update + Tier 2 bundle push, with SHA-256
  verification + signing)
- Bundle signing (release key, configured in `tauri.conf.json`)
- CSP (admin dashboard — strict; PWA — tighter, no `unsafe-eval`)

See `SECURITY.md` (V1) in the repository root for the full V1 details.

## Threat model (V2)

The V2 threat model extends V1:

- **Firebase project is run by a trusted operator** (either the Osler team
  for the official deployment, or a self-hoster for their own deployment).
  Firebase rules enforce per-user isolation; the operator cannot read user
  content (though they can see document metadata in the Firebase console).
- **Deploy providers are trusted** to serve the bundle intact. Bundle signing
  catches in-flight tampering.
- **The user's device is trusted** up to the browser sandbox. Osler does not
  defend against a compromised browser or a malicious extension.
- **Content packs from untrusted sources** are untrusted until validated.
  The import flow rejects invalid packs (schema validation, size limits,
  content-type checks), but a valid pack could still contain misleading
  medical content — the user is responsible for vetting packs from sources
  they don't trust.

Out of scope:

- Defending against a malicious Firebase operator (use a self-hosted project
  if you don't trust the official one).
- Defending against a compromised deploy provider (use bundle signing).
- DRM on content packs (explicitly an anti-goal — packs are JSON, freely
  copyable).
- Real-time content scanning (no Cloud Functions — V2 anti-goal).

## Security checklist (V2)

- [x] GitHub tokens stored in OS keychain only (`keyring` crate) — V1, preserved
- [x] No secrets in `localStorage` beyond the allow-list — V1, preserved
- [x] `tauri.conf.json` enables `safeStorage` for secret persistence — V1, preserved
- [x] All IndexedDB user data is local-only (not shared across devices
      without explicit sync) — V1, preserved
- [x] Firebase API calls use authenticated endpoints — V1, preserved
- [x] Sync merge strategies prevent data loss (field-level merge, SM-2
      later-review-wins) — V1, preserved
- [x] `catch {}` is banned — all catches log to console with context — V1, preserved
- [x] CSP restricts script sources — V1, preserved
- [x] Deploy provider credentials stored in OS keychain (V2)
- [x] Content pack import validates against schemas before write (V2)
- [x] Firestore rules cover `userContent` collection — owner-only (V2)
- [x] Storage rules enforce size + content-type limits on uploads (V2)
- [x] Bundle spec validates Firebase config before deploy (V2)
- [ ] Public key configured for updater (requires `tauri signer generate` —
      V1, still pending human setup)
- [ ] CI signs update artifacts (requires signing key in CI secrets —
      V1, still pending human setup)
- [ ] Rate limiting implemented for GitHub API calls (exponential backoff —
      V1, still pending)
- [ ] Server-side schema validation in Firestore rules (P9.2 security
      review — defense-in-depth, optional)

## Incident response

See `docs/operations/incident-response.md` for SEV-1/2 playbooks including:

- Deployed site is broken (rollback)
- Firestore rules leak user data (rules update + audit)
- Firebase project deleted / disabled (recovery)
- AI tutor down (Gemini API errors)
- Sync broken for many users (rules + quota + code review)

## Responsible disclosure

For security-sensitive bugs, do NOT open a public GitHub Issue. Email
security@osler.app with:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We acknowledge within 48 hours and aim to ship a fix within 30 days
(severity-dependent). Reporters are credited in the release notes unless
they prefer to remain anonymous.
