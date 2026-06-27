# Settings

The admin dashboard's **Settings** tab is the single configuration surface.
This page documents every setting, where it's stored, and what it controls.

## Settings layout

Settings is divided into 6 sections:

1. **General** — theme, language, auto-update toggle
2. **GitHub** — sign-in state, content repo, instance repos
3. **Firebase** — service account, project config
4. **AI Generation** — Gemini API key, cost caps
5. **Deploy Providers** (V2) — per-provider credentials
6. **Updates** — signing key, update channel, history

## General

### Theme

- **Type:** select
- **Options:** light / dark / system
- **Default:** system
- **Storage:** `localStorage` key `osler_theme` (this is in the allow-list)
- **Effect:** Toggles the admin UI theme. Does not affect generated sites
  (each site has its own theme picker in the generator wizard).

### Language

- **Type:** select
- **Options:** en / ar
- **Default:** en
- **Storage:** `localStorage` key `osler_lang`
- **Effect:** V2 i18n. Switches the admin UI language. The admin's frontend
  loads the corresponding bundle from `tauri-admin/frontend/i18n/`.

### Check for updates automatically

- **Type:** checkbox
- **Default:** on
- **Storage:** `localStorage` key `osler_auto_update_check` (in the allow-list)
- **Effect:** When on, the admin checks `api.github.com/repos/osler-app/osler/releases/latest`
  on launch and every 6 hours. When off, you must check manually.

## GitHub

### Signed in as

- **Type:** read-only display
- **Shows:** GitHub username, avatar, scopes
- **Action:** **Sign out** button — clears the token from the OS keychain
  and returns to the sign-in screen.

### Content repo

- **Type:** select (populated from your GitHub repos)
- **Default:** the first repo named `osler-content*` if it exists
- **Storage:** `tauri-plugin-store` key `content_repo`
- **Effect:** Which repo the CMS workflow commits to. Changing this is
  disruptive — the new repo must have a valid `manifest.json` or the admin
  will offer to initialize one.

### Instance repos

- **Type:** multi-select
- **Default:** empty
- **Storage:** `tauri-plugin-store` key `instance_repos` (array of repo full
  names)
- **Effect:** Which repos appear in the **Updates** tab's instance picker.
  Add repos here after deploying a new site to make them updateable.

### GitHub token scopes

The admin requests these scopes during Device Flow:

- `repo` — read/write to your repositories (for CMS + instance pushes)
- `user` — read your profile (for the avatar + username display)

The admin does NOT request `delete_repo`, `admin:org`, or any other
high-privilege scope. If you need to delete a repo, do it from the GitHub
web UI.

## Firebase

### Service account JSON

- **Type:** file picker
- **Default:** none
- **Storage:** OS keychain — stores the file PATH (not the JSON contents)
- **Effect:** Used by `analytics.rs` to call Firebase Analytics REST API
  with service-account credentials. Required for the admin's **Analytics**
  tab to show aggregated data.

To get a service account JSON:

1. Go to the Firebase console → Project Settings → Service Accounts.
2. Click **Generate new private key**.
3. Save the JSON file somewhere permanent (e.g. `~/.osler/firebase-service-account.json`).
4. Pick the file in the admin's Settings.

### Firebase project config

- **Type:** read-only display (pasted into generated sites by the wizard)
- **Default:** from `.env` (`VITE_FIREBASE_*`)
- **Storage:** `.env` file (not in keychain — these are public values)
- **Effect:** When the generator wizard builds a site, it writes these
  values into the generated site's `config.json`. The site uses them to
  initialize Firebase.

See [Firebase → Bring Your Own](../firebase/bring-your-own.md) for the full
Firebase setup walkthrough.

## AI Generation

### Gemini API key

- **Type:** password input
- **Default:** none
- **Storage:** OS keychain — service name `com.osler.admin.gemini`
- **Effect:** Used by `src/lib/gemini.js` for the 3-stage content generation
  pipeline AND the PWA's AI tutor (Phase 12). The same key is reused.

To get a key: [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
Free tier covers ~50 generations/day.

### Daily cost cap

- **Type:** number (USD)
- **Default:** 20
- **Storage:** `tauri-plugin-store` key `gemini_daily_cap`
- **Effect:** Hard limit on Gemini spend per UTC day. When the admin's
  running total for the day would exceed this, generation is blocked.
  See [AI Tutor → Cost Caps](../ai-tutor/cost-caps.md) for the tracking
  mechanism.

### Monthly cost cap

- **Type:** number (USD)
- **Default:** 200
- **Storage:** `tauri-plugin-store` key `gemini_monthly_cap`
- **Effect:** Hard limit on Gemini spend per UTC month.

### Spend history

- **Type:** read-only table
- **Shows:** date, daily total, monthly total, generation count
- **Effect:** Transparency — see where the money is going.

## Deploy Providers (V2)

Each provider has its own card with: credential input, test button, status.

### GitHub Pages

- **Credential:** reuses the GitHub token (no separate credential)
- **Status:** shows whether Pages is enabled on the content repo
- **Test:** verifies the token has `repo` scope and Pages is enabled

### Netlify

- **Credential:** Netlify personal access token
- **Storage:** OS keychain — service name `com.osler.admin.netlify`
- **Test:** calls `https://api.netlify.com/api/v1/users` with the token
- **Get a token:** [app.netlify.com/user/applications](https://app.netlify.com/user/applications)
  → Personal access tokens → New access token

### Vercel

- **Credential:** Vercel access token
- **Storage:** OS keychain — service name `com.osler.admin.vercel`
- **Test:** calls `https://api.vercel.com/v2/user` with the token
- **Get a token:** [vercel.com/account/tokens](https://vercel.com/account/tokens)

### Cloudflare Pages

- **Credential:** Cloudflare API token + Account ID
- **Storage:** OS keychain — service name `com.osler.admin.cloudflare` (both
  values stored as a JSON blob)
- **Test:** calls `https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects`
- **Get a token:** [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
  → Create Token → Use template "Cloudflare Pages"

See [Deployment](../deployment/github-pages.md) for per-provider deploy
walkthroughs.

## Updates

### Signing key

- **Type:** file picker + password input
- **Default:** none
- **Storage:** OS keychain — service name `com.osler.admin.signer` (stores
  the file path; the key file itself is on disk)
- **Effect:** Used by `push_update.rs` to sign Tier 2 bundle updates.

See [Bundle Updates](bundle-update.md#configuring-the-signing-key) for
generating a signing key pair.

### Public key (read-only)

- **Type:** read-only text
- **Source:** `tauri.conf.json` → `plugins.updater.pubkey`
- **Effect:** This is the pubkey deployed instances use to verify updates.
  It must match the signing key above. If empty, signing is disabled and
  deployed instances refuse Tier 2 updates.

### Update channel

- **Type:** select
- **Options:** stable / beta
- **Default:** stable
- **Storage:** `tauri-plugin-store` key `update_channel`
- **Effect:** Which GitHub releases the admin's self-updater considers.
  `stable` = tagged releases only. `beta` = pre-releases too.

### Update history

- **Type:** read-only table
- **Shows:** date, version, status (success/failed/rolled back)
- **Effect:** Audit trail of Tier 1 self-updates. Click any row to see the
  release notes.

## Storage summary

For quick reference, here's where each setting lives:

| Setting | Storage |
|---------|---------|
| Theme | `localStorage` (`osler_theme`) |
| Language | `localStorage` (`osler_lang`) |
| Auto-update check | `localStorage` (`osler_auto_update_check`) |
| GitHub token | OS keychain (`com.osler.admin.github`) |
| Content repo | `tauri-plugin-store` (`content_repo`) |
| Instance repos | `tauri-plugin-store` (`instance_repos`) |
| Firebase service account path | OS keychain (`com.osler.admin.firebase`) |
| Firebase project config | `.env` (`VITE_FIREBASE_*`) |
| Gemini API key | OS keychain (`com.osler.admin.gemini`) |
| Daily/monthly caps | `tauri-plugin-store` (`gemini_*_cap`) |
| Netlify token | OS keychain (`com.osler.admin.netlify`) |
| Vercel token | OS keychain (`com.osler.admin.vercel`) |
| Cloudflare token + account | OS keychain (`com.osler.admin.cloudflare`) |
| Signing key path | OS keychain (`com.osler.admin.signer`) |
| Public key | `tauri.conf.json` (`plugins.updater.pubkey`) |
| Update channel | `tauri-plugin-store` (`update_channel`) |

The `localStorage` allow-list is documented in
[Security Model](../architecture/security-model.md#localstorage-allow-list).
Any new `localStorage` usage must be added to that table.

## Resetting settings

To reset all settings to defaults:

1. Go to **Settings** → **Advanced** → **Reset**.
2. Confirm. The admin clears:
   - All `localStorage` keys in the allow-list
   - All `tauri-plugin-store` keys
   - All OS keychain entries for `com.osler.admin.*`
3. The admin restarts.

This does NOT delete:

- The content repo (lives on GitHub)
- Generated site bundles (lives on disk where you saved them)
- Deployed instances (lives on the hosting provider)

Use reset when handing the admin to a new user or troubleshooting weird
state. For routine changes, edit individual settings.

## What's next

- [Installation](installation.md) — first-run setup.
- [Bundle Updates](bundle-update.md) — Tier 2 update mechanism.
- [Architecture → Security Model](../architecture/security-model.md) — where
  secrets live and why.
