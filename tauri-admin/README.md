# Osler Suite — Instance Manager & Content Studio (v0.3)

A standalone Tauri 2 desktop suite that manages Osler instances from end-to-end:
- **Osler Instance & Cloud Manager**: Automated step-by-step instance generator with Cloudflare full-stack deployment (Worker, D1 SQL database, R2 content storage, Pages frontend), system prerequisites diagnostics and auto-installer, and instance code patch/updater.
- **Osler Content Studio**: Dedicated authoring CMS for medical educators to edit questions, flashcards, OSCE stations, written cases, and markdown articles with WYSIWYG, Mermaid diagrams, validation, and git sync.

## What's new in v0.3

- **Two Distinct Applications / Dedicated Modes**:
  - Topbar App Switcher pill (`[ 🚀 Instance Manager ]` ⇄ `[ ✍️ Content Studio ]`).
  - Standalone entrypoints: `instance-manager.html` and `studio.html` for direct dedicated window launches.
- **Advanced Automated Instance Generator with Cloudflare Full-Stack Deployment**:
  - 5-step guided wizard (Prerequisites -> Site Identity & Engines -> Cloudflare Stack -> Automated Deploy -> Actions).
  - Cloud-enabled instances host content directly on **Cloudflare R2** with automated sync.
  - Direct 1-click deployment buttons: `npm run deploy:pages` and `npm run deploy:worker`.
- **System Prerequisites Diagnostics & Installer**:
  - Checks Node.js (>= 18), Git CLI, Wrangler CLI, and Cloudflare Authentication status.
  - 1-click installation triggers for missing tools and browser login.
- **Instance Code Patch & Update Engine**:
  - Compares target instances with main Osler source to identify updates in `src/`, `scripts/`, `cloudflare/worker/src/`, and database migrations.
  - Pre-update safety snapshot backup created in `.osler-backup/`.
  - Intelligently merges dependencies in `package.json` and settings in `public/osler.config.json` while **strictly preserving** all user content in `public/osler-content/`, environment secrets, and `.git/`.
  - 1-click rollback and manifest re-generation.

## Layout

```
tauri-admin/
├── Cargo.toml              — Tauri 2 deps + reqwest/tokio/base64/sha1/sha2/hex
├── tauri.conf.json         — App config (frontendDist: "frontend", CSP updated)
├── build.rs                — Tauri build script
├── capabilities/
│   └── default.json        — Tauri 2 permissions (dialog, fs, shell, process)
├── src/
│   ├── main.rs             — Tauri boot + command registration (incl. deploy)
│   ├── lib.rs              — Module root
│   ├── commands.rs         — All #[tauri::command] handlers (file CRUD,
│   │                         manifest, validate, build/start, git)
│   ├── deploy.rs           — Provider deploy pipelines (Vercel / GitHub Pages
│   │                         / Cloudflare Pages / Netlify) + PAT storage
│   ├── manifest.rs         — Manifest generator (Rust port of
│   │                         scripts/generate-content-manifests.js)
│   ├── validate.rs         — Content JSON schema validation
│   └── runner.rs           — Build/start runner (state in commands.rs)
    └── frontend/
        ├── index.html          — App shell + pre-hydration script + EasyMDE CSS
        ├── styles.css          — Design tokens + components + RTL + EasyMDE overrides
        ├── i18n.js             — English + Arabic dictionary (incl. deploy strings)
        ├── main.js             — Tauri bridge + router + toasts + preview-mode mock
        └── views/
            ├── dashboard.js    — Project overview + quick actions + deploy card
            ├── content.js      — File tree + JSON/markdown editor (uses EasyMDE)
            ├── markdown-editor.js — EasyMDE wrapper (loads from CDN on demand)
            ├── content-editor.js  — Structured form editors for known JSON types
            ├── manifest.js     — View + regenerate manifest.json per category
            ├── build.js        — Run build/start, stream logs
            ├── git.js          — Status, stage, commit, push, pull
            ├── github.js       — GitHub repo sync (connect, push, pull)
            ├── deploy.js       — Connect Provider & Deploy page (4 providers)
            ├── start.js        — Server runner (npm run start with live logs)
            ├── run-publish.js  — Combined build, start, git & deploy hub
            ├── configure.js    — Config editor & instance generator hub
            ├── wizard.js       — 6-step first-time setup wizard
            ├── instance.js     — Scaffold new Osler instances
            ├── config.js       — Structured config editor (5 tabs)
            ├── settings.js     — UI language, theme, project root
            └── mermaid-editor.js — Mermaid diagram editor & explorer
```

## Commands (Rust → frontend)

### Project / file CRUD (unchanged from v0.1)

| Command             | Args                                              | Returns                                        |
| ------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `ping`              | —                                                 | `"osler-admin"`                                |
| `set_project_root`  | `{ root }`                                        | `{ root, hasPackageJson, hasContentDir }`     |
| `project_state`     | —                                                 | `{ root, hasPackageJson, hasContentDir, gitRemote, gitBranch }` |
| `list_files`        | —                                                 | `{ items: [...] }` (recursive tree)            |
| `load_file`         | `{ path }`                                        | `{ path, content }`                            |
| `save_file`         | `{ path, content }`                               | `{ saved, path }`                              |
| `create_file`       | `{ path, content? }`                              | `{ created, path }` (auto-scaffolds empty JSON)|
| `create_folder`     | `{ path }`                                        | `{ created, path }`                            |
| `delete_path`       | `{ path }`                                        | `{ deleted, path }`                            |
| `move_path`         | `{ from, to_folder }`                             | `{ moved, from, to }`                          |
| `rename_path`       | `{ path, new_name }`                              | `{ renamed, from, to }`                        |
| `generate_manifest` | —                                                 | `{ generated: [...] }`                         |
| `read_manifest`     | `{ category }`                                    | `manifest.json` parsed object                  |
| `write_manifest`    | `{ category, json }`                              | `{ written, category }`                        |
| `validate_content`  | `{ contentType, contentJson }`                    | `{ valid, errors: [] }`                        |
| `run_build`         | —                                                 | `{ started, kind: "build" }`                   |
| `run_start`         | —                                                 | `{ started, kind: "start" }`                   |
| `stop_runner`       | —                                                 | `{ stopped }`                                  |
| `runner_status`     | —                                                 | `{ kind, running, exitCode, ...logs }`         |
| `git_status`        | —                                                 | `{ entries: [...] }`                           |
| `git_add`           | `{ paths: [] }`                                   | `{ added }`                                    |
| `git_commit`        | `{ message }`                                     | `{ committed, message }`                       |
| `git_push`          | —                                                 | `{ pushed, output }`                           |
| `git_pull`          | —                                                 | `{ pulled, output }`                           |
| `git_remote`        | —                                                 | `{ remote, branch }`                           |
| `open_external`     | `{ url }`                                         | `()`                                           |

### Deploy commands (new in v0.2)

| Command                    | Args                                       | Returns                                                                  |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `get_deploy_config`        | —                                          | Redacted config object (tokens shown as `••••••••`)                      |
| `set_deploy_config`        | `{ config }`                               | Redacted config after merge (empty tokens preserve existing values)      |
| `clear_deploy_provider`    | `{ provider }`                             | Redacted config after removing the given provider                        |
| `test_deploy_connection`   | `{ provider }`                             | `{ ok: bool, details?: {...}, error?: string }`                          |
| `deploy`                   | `{ provider, skipBuild? }`                 | `{ started: true, provider }` — logs stream via `deploy_status`          |
| `deploy_status`            | —                                          | `{ provider, running, success, startedAt, endedAt, logs, resultUrl, error }` |
| `clear_deploy_logs`        | —                                          | `{ cleared: true }`                                                      |

## Provider deploy pipelines

Each provider is implemented as a separate async function in `src/deploy.rs`.
All network requests are issued from Rust via `reqwest` + `rustls-tls`, so the
webview CSP does not need to allow provider endpoints — only the CDN for the
markdown editor.

| Provider           | Endpoint                                                              | What it does                                                                                                          |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Vercel**         | `POST https://api.vercel.com/v13/deployments`                         | Triggers a production redeploy from the Git branch linked to your Vercel project (the provider rebuilds from Git).    |
| **GitHub Pages**   | `POST https://api.github.com/repos/{owner}/{repo}/git/blobs` → trees  | Builds the project locally (`bun run build` or `npm run build`), then uploads the `out/` directory to the configured   |
|                    | → commits → `PATCH .../git/refs/heads/{branch}`                       | branch via the Git Data API (blobs → tree → commit → ref update). The branch is created if missing.                   |
| **Cloudflare Pages** | `POST https://api.cloudflare.com/.../pages/projects/{p}/deployments` | Triggers a production deployment from the connected Git branch (the provider rebuilds from Git).                      |
| **Netlify**        | `POST https://api.netlify.com/api/v1/sites/{site_id}/deploys`         | Triggers a manual build of the connected site (the provider rebuilds from Git).                                       |

For Vercel, Cloudflare Pages, and Netlify, the deploy pipeline first runs
`git push` so the provider's build infra picks up the latest source. For
GitHub Pages, the pipeline runs `bun run build` locally and uploads the
resulting `out/` directory directly (or `public/` as a fallback when no
static export is present).

## PAT storage & security

Personal Access Tokens are stored under:

```
<project_root>/.osler-admin/deploy.json
```

- The file is created with mode `0600` on Unix (read/write owner only).
- `.osler-admin/` is automatically appended to `.gitignore` if not already
  present, so PATs never get committed by accident.
- The `get_deploy_config` command always redacts token-shaped fields
  (`token`, `pat`, `password`, `api_key`) to `••••••••` before returning
  them to the frontend — the UI never re-renders saved tokens.
- When `set_deploy_config` receives an empty string for a token field, it
  preserves the previously saved value. This lets users update non-secret
  fields (project name, branch, etc.) without re-entering their PAT each time.
- The `clear_deploy_provider` command removes all stored fields for a single
  provider, so users can fully rotate credentials without touching the others.

## Build & run

### Prerequisites

- Rust 1.77+ (`rustup`)
- Tauri 2 system dependencies — see <https://tauri.app/start/prerequisites/>
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk-4.1`, `libgtk-3`, `libayatana-appindicator3`, etc.
  - **Windows**: WebView2 runtime (preinstalled on Win 11)

### Dev mode

```bash
cd tauri-admin
cargo tauri dev
```

The first run compiles all dependencies (~3–5 min). The app window opens,
shows the picker overlay, and prompts you to pick the Osler project root.

### Production build

```bash
cd tauri-admin
cargo tauri build
```

Output: a platform-specific installer in `tauri-admin/target/release/bundle/`.

### Browser preview (no Tauri)

The frontend is plain HTML/CSS/JS with no build step. To preview the UI
without compiling Tauri:

```bash
cd tauri-admin/frontend
python3 -m http.server 1420
# open http://localhost:1420 in a browser
```

Add `?preview=1` to the URL (or `localStorage["osler-admin-preview"] = "1"`)
to make the mock pretend a project root is bound and return fake content —
this lets you navigate every view (Dashboard, Content + Markdown editor,
Manifest, Build, Git, Deploy, Settings) without a real Tauri backend.

In mock mode, all Tauri `invoke()` calls fall back to no-op mocks that return
empty data — except for the deploy commands, which return success-shaped
responses so the UI flow can be exercised end-to-end.

## How it fits into the Osler project

Place the `tauri-admin/` folder at the root of an Osler Next.js project:

```
osler-project/
├── package.json
├── public/
│   └── osler-content/
│       ├── flashcard/
│       ├── library/
│       ├── osce/
│       └── qbank/
├── src/
└── tauri-admin/           ← this folder
```

The Tauri app's "project root" picker should point at `osler-project/`. All
file CRUD commands are sandboxed under `public/osler-content/` to prevent
accidental edits to `src/` or `node_modules/`. Git, build, and deploy
commands run at the project root.

## Markdown editor

`.md` files open in **EasyMDE** (v2.18.0), loaded on demand from the jsDelivr
CDN. The CSP in `tauri.conf.json` whitelists `https://cdn.jsdelivr.net` for
both `script-src` and `style-src` so the editor can load inside Tauri's
webview. The editor wrapper in `views/markdown-editor.js` exposes:

```js
const editor = await OslerMarkdownEditor.create(hostElement, initialMarkdown, {
  onChange(md) { /* called on every keystroke */ },
});
const md = editor.getMarkdown();      // synchronous read
editor.setMarkdown(md);               // programmatic write
editor.destroy();                     // tear down
```

The CSS overrides in `styles.css` (under the "EasyMDE overrides" section) make
the editor match the design system: dark navy palette, primary-color cursor,
amber emphasis, primary-color links, OKLCH-based syntax highlighting in the
editor pane, and matching typography in the preview pane.

If the CDN is unreachable (offline use), the wrapper falls back to a plain
`<textarea>` with a warning toast so users can still edit the file's raw
markdown.

## RTL + Arabic support

The frontend ports the same i18n + RTL layer as the Osler web app:

- **Pre-hydration script** in `index.html` reads `localStorage["osler-admin-lang"]`
  and sets `<html lang dir>` + `osler-ar` class before paint, so users who
  picked Arabic don't see an LTR flash.
- **i18n dictionary** in `frontend/i18n.js` covers every UI string in
  English + Arabic, with `{name}` placeholder interpolation. The deploy
  page's strings are included.
- **RTL CSS** in `styles.css` uses logical properties (`margin-inline-start`,
  `inset-inline-end`, etc.) so the same DOM flips correctly under RTL.
- **Cairo font** (loaded from Google Fonts) covers Latin + Arabic; Geist
  stays as the Latin default.
- **Toggle button** in the top bar switches UI language instantly; the
  current view re-renders so list-valued strings refresh too.

Content packs authored in Arabic render RTL regardless of UI language —
the same decoupling as the web app.

## License

Same as the parent Osler project.
