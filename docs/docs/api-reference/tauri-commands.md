# Tauri Commands API Reference

The Tauri admin dashboard exposes Rust functions to the frontend via
`window.__TAURI__.invoke('command_name', args)`. This page lists every
command, its arguments, and its return type.

For the Rust implementations, see `tauri-admin/src/commands.rs` and the
per-module files (`auth.rs`, `git.rs`, `deploy.rs`, etc.).

## Auth commands

### `auth_sign_in`

Initiates GitHub Device Flow sign-in.

```javascript
await window.__TAURI__.invoke('auth_sign_in');
// Returns: { deviceCode, userCode, verificationUri, expiresIn, interval }
```

The frontend displays the `userCode` and opens `verificationUri` in the
browser. Polls `auth_check_status` every `interval` seconds.

### `auth_check_status`

Polls for Device Flow completion.

```javascript
const status = await window.__TAURI__.invoke('auth_check_status', { deviceCode });
// Returns: { state: 'pending' | 'success' | 'expired' | 'error', token? }
```

### `auth_sign_out`

Signs out and clears the keychain entry.

```javascript
await window.__TAURI__.invoke('auth_sign_out');
// Returns: { success: true }
```

### `auth_get_user`

Returns the current signed-in user.

```javascript
const user = await window.__TAURI__.invoke('auth_get_user');
// Returns: { login, name, avatarUrl, scopes } | null
```

## Git commands

### `git_list_repos`

Lists the user's GitHub repos.

```javascript
const repos = await window.__TAURI__.invoke('git_list_repos');
// Returns: [{ name, fullName, private, defaultBranch, hasOslerContent }]
```

`hasOslerContent` is `true` if the repo has a `manifest.json` at the root
(indicating it's an Osler content repo).

### `git_create_repo`

Creates a new GitHub repo for content.

```javascript
const repo = await window.__TAURI__.invoke('git_create_repo', {
  name: 'osler-content',
  private: false,
  description: 'Osler content repo',
});
// Returns: { name, fullName, cloneUrl }
```

### `git_read_file`

Reads a file from the content repo.

```javascript
const content = await window.__TAURI__.invoke('git_read_file', {
  repo: 'osler-content',
  path: 'content/sample-quiz.json',
  branch: 'main',
});
// Returns: string (file contents)
```

### `git_write_file`

Writes (commits) a file to the content repo.

```javascript
await window.__TAURI__.invoke('git_write_file', {
  repo: 'osler-content',
  path: 'content/sample-quiz.json',
  content: '{...}',
  message: 'feat(content): update sample-quiz-001',
  branch: 'main',
});
// Returns: { sha, commitUrl }
```

### `git_delete_file`

Deletes a file from the content repo.

```javascript
await window.__TAURI__.invoke('git_delete_file', {
  repo: 'osler-content',
  path: 'content/old-quiz.json',
  message: 'chore(content): remove old-quiz',
  branch: 'main',
});
// Returns: { sha, commitUrl }
```

### `git_list_content`

Lists all content items in the content repo (via `manifest.json`).

```javascript
const items = await window.__TAURI__.invoke('git_list_content', {
  repo: 'osler-content',
});
// Returns: [{ uid, type, title, path, updatedAt }]
```

## Deploy commands (V2)

### `deploy_github_pages`

Deploys a bundle to GitHub Pages.

```javascript
const result = await window.__TAURI__.invoke('deploy_github_pages', {
  bundlePath: '/tmp/osler-bundle.zip',
  repo: 'osler-site',
  // Uses the configured GitHub token
});
// Returns: { url, deploymentId }
```

### `deploy_netlify`

Deploys a bundle to Netlify.

```javascript
const result = await window.__TAURI__.invoke('deploy_netlify', {
  bundlePath: '/tmp/osler-bundle.zip',
  siteName: null,  // null = random subdomain
});
// Returns: { url, deploymentId }
```

### `deploy_vercel`

Deploys a bundle to Vercel.

```javascript
const result = await window.__TAURI__.invoke('deploy_vercel', {
  bundlePath: '/tmp/osler-bundle.zip',
  projectName: null,
});
// Returns: { url, deploymentId }
```

### `deploy_cloudflare`

Deploys a bundle to Cloudflare Pages.

```javascript
const result = await window.__TAURI__.invoke('deploy_cloudflare', {
  bundlePath: '/tmp/osler-bundle.zip',
  projectName: null,
});
// Returns: { url, deploymentId }
```

### `deploy_get_history`

Returns the deploy history for a provider.

```javascript
const history = await window.__TAURI__.invoke('deploy_get_history', {
  provider: 'netlify',
  siteId: 'abc123',
});
// Returns: [{ deploymentId, url, timestamp, status, version }]
```

### `deploy_rollback`

Rolls back to a previous deploy.

```javascript
await window.__TAURI__.invoke('deploy_rollback', {
  provider: 'netlify',
  siteId: 'abc123',
  deploymentId: 'def456',
});
// Returns: { success: true, url }
```

## Bundle commands

### `bundle_engines`

Assembles a site bundle from chosen engines + content.

```javascript
const bundlePath = await window.__TAURI__.invoke('bundle_engines', {
  engines: ['quiz', 'bank', 'flashcard', 'written', 'osce'],
  content: ['cardio-001', 'anatomy-thorax-001'],
  theme: { primary: '#3b82f6', accent: '#10b981', /* ... */ },
  auth: { mode: 'firebase', firebaseConfig: { /* ... */ } },
  deploy: { target: 'netlify' },
  outputPath: '/tmp/osler-bundle.zip',
});
// Returns: string (path to the zip)
```

### `bundle_validate`

Validates a generated bundle.

```javascript
const result = await window.__TAURI__.invoke('bundle_validate', {
  bundlePath: '/tmp/osler-bundle.zip',
});
// Returns: { valid: true } | { valid: false, errors: [...] }
```

### `bundle_compute_hash`

Computes the SHA-256 hash of a bundle.

```javascript
const hash = await window.__TAURI__.invoke('bundle_compute_hash', {
  bundlePath: '/tmp/osler-bundle.zip',
});
// Returns: string (hex SHA-256)
```

## Push update commands

### `push_update`

Pushes a Tier 2 bundle update to a deployed instance.

```javascript
const result = await window.__TAURI__.invoke('push_update', {
  instanceRepo: 'osler-site',
  files: ['engines/quiz.js', 'content/cardio-001.json'],
  version: '1.2.4',
  releaseNotes: 'Fix quiz scoring bug.',
});
// Returns: { success: true, hash, rollbackTag }
```

### `push_update_rollback`

Rolls back a Tier 2 update.

```javascript
await window.__TAURI__.invoke('push_update_rollback', {
  instanceRepo: 'osler-site',
  toVersion: '1.2.3',
});
// Returns: { success: true }
```

### `push_update_history`

Returns the update history for an instance.

```javascript
const history = await window.__TAURI__.invoke('push_update_history', {
  instanceRepo: 'osler-site',
});
// Returns: [{ version, timestamp, hash, releaseNotes, rolledBack }]
```

## Updater commands

### `updater_check`

Checks for admin dashboard updates.

```javascript
const result = await window.__TAURI__.invoke('updater_check');
// Returns: { hasUpdate: true, latestVersion: '5.2.0', releaseNotes: '...' } | { hasUpdate: false }
```

### `updater_download_and_install`

Downloads and applies an update.

```javascript
await window.__TAURI__.invoke('updater_download_and_install');
// Returns: { success: true, requiresRestart: true }
```

## Validation commands

### `validate_content`

Validates a content item against its schema.

```javascript
const result = await window.__TAURI__.invoke('validate_content', {
  content: { /* ... */ },
});
// Returns: { valid: true } | { valid: false, errors: [...] }
```

### `validate_pack`

Validates a content pack.

```javascript
const result = await window.__TAURI__.invoke('validate_pack', {
  pack: { /* ... */ },
});
// Returns: { valid: true, items: [...] } | { valid: false, errors: [...] }
```

## Parser commands

### `parse_content_pack`

Parses a content pack file (reads the file, validates, returns items).

```javascript
const result = await window.__TAURI__.invoke('parse_content_pack', {
  filePath: '/path/to/pack.json',
});
// Returns: { valid: true, items: [...] } | { valid: false, errors: [...] }
```

## PDF commands

### `pdf_export`

Exports a content item as PDF.

```javascript
const pdfPath = await window.__TAURI__.invoke('pdf_export', {
  content: { /* ... */ },
  format: 'A4',
  outputPath: '/tmp/export.pdf',
});
// Returns: string (path to the PDF)
```

Invokes `scripts/pdf_generator.py` via subprocess.

## Server commands

### `server_start_preview`

Starts a local preview HTTP server.

```javascript
const result = await window.__TAURI__.invoke('server_start_preview', {
  bundlePath: '/tmp/osler-bundle.zip',
  port: 5500,
});
// Returns: { url: 'http://127.0.0.1:5500/', port: 5500 }
```

### `server_stop_preview`

Stops the preview server.

```javascript
await window.__TAURI__.invoke('server_stop_preview');
// Returns: { success: true }
```

## Templates commands

### `templates_get_provider_config`

Returns the provider-specific config file content for a bundle.

```javascript
const config = await window.__TAURI__.invoke('templates_get_provider_config', {
  provider: 'netlify',
  siteName: 'osler-site',
});
// Returns: { filename: 'netlify.toml', content: '...' }
```

## Analytics commands

### `analytics_get_summary`

Returns aggregated analytics for a date range.

```javascript
const summary = await window.__TAURI__.invoke('analytics_get_summary', {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
});
// Returns: { dailyActiveUsers, totalSessions, aiSpend, topContent: [...] }
```

Requires the Firebase service account to be configured.

## Keyring commands

### `keyring_set`

Stores a secret in the OS keychain.

```javascript
await window.__TAURI__.invoke('keyring_set', {
  service: 'com.osler.admin.netlify',
  account: 'default',
  value: 'nfp_abc123...',
});
// Returns: { success: true }
```

### `keyring_get`

Retrieves a secret from the OS keychain.

```javascript
const value = await window.__TAURI__.invoke('keyring_get', {
  service: 'com.osler.admin.netlify',
  account: 'default',
});
// Returns: string | null
```

### `keyring_delete`

Deletes a secret from the OS keychain.

```javascript
await window.__TAURI__.invoke('keyring_delete', {
  service: 'com.osler.admin.netlify',
  account: 'default',
});
// Returns: { success: true }
```

## What's next

- [Lib Modules](lib-modules.md) — the JS-side API.
- [Admin Dashboard → Overview](../admin-dashboard/overview.md) — the
  admin's architecture.
- [Admin Dashboard → Settings](../admin-dashboard/settings.md) — where
  credentials are stored.
