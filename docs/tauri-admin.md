# Osler Suite — Tauri Desktop Guide (v0.3)

The Osler suite is a standalone **Tauri 2 desktop application** (Rust backend + plain HTML/JS frontend) that lives at [`tauri-admin/`](../tauri-admin/). It is a single focused application:
1. **Osler Instance & Cloud Manager** (`instance-manager.html`): Automated step-by-step instance generator and full A-to-Z setup - Cloudflare stack deployment (Worker, D1 SQL, R2 content storage, Pages frontend), prerequisites diagnostics and auto-installer, Google Sign-In configuration, first-admin promotion, health verification, and the instance code patch/updater.

This guide is the **operator manual** for the admin app. For the architectural overview, see [`tauri-admin/README.md`](../tauri-admin/README.md). For the web app's admin panel (the in-browser one at `/admin`), see [`admin-guide.md`](./admin-guide.md).

> **Source repository:** <https://github.com/eyad-elghareeb/osler>
> **License:** MIT — see [LICENSE](../LICENSE).
> **Related guides:** [`hosting.md`](./hosting.md) · [`deployment.md`](./deployment.md) · [`forking.md`](./forking.md) · [`contributing.md`](./contributing.md) · [`admin-guide.md`](./admin-guide.md)

---

## Table of Contents

1. [What is the Tauri admin suite?](#1-what-is-the-tauri-admin-suite)
2. [Prerequisites](#2-prerequisites)
3. [Building the admin](#3-building-the-admin)
4. [First-run experience](#4-first-run-experience)
5. [Main UI sections](#5-main-ui-sections)
6. [Setup Wizard](#6-setup-wizard)
7. [Config Editor](#7-config-editor)
8. [Instance Generator](#8-instance-generator)
9. [Post-deploy assisted setup (Google Sign-In, first admin, health)](#9-post-deploy-assisted-setup-google-sign-in-first-admin-health)
10. [Build & start runner](#10-build--start-runner)
11. [Git operations](#11-git-operations)
12. [Deployment providers](#12-deployment-providers)
13. [GitHub OAuth setup](#13-github-oauth-setup)
14. [Build-time GitHub OAuth secret injection](#14-build-time-github-oauth-secret-injection)
15. [Cross-platform builds](#15-cross-platform-builds)
16. [Updating the admin](#16-updating-the-admin)
17. [Troubleshooting](#17-troubleshooting)
18. [Frontend-only preview](#18-frontend-only-preview)
19. [Capabilities and permissions](#19-capabilities-and-permissions)

---

## 1. What is the Tauri admin suite?

The Tauri admin suite is a desktop application that manages **Osler instances end to end**.

### Architecture at a glance

```
┌──────────────────────────────────────────────────────────┐
│                 Osler Instance Manager (Tauri 2)                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Frontend (Instance Manager)  │  │
│  │  ├── index.html / instance-manager.html │
│  │  ├── main.js (Tauri bridge + router)     │  │
│  │  ├── i18n.js (en + ar translations)                │  │
│  │  ├── styles.css (design tokens + RTL)    │  │
│  │  └── views/ (instance, updater, deploy, prereq…)  │  │
│  └─────────────────┬──────────────────────────────────┘  │
│                    │ invoke("command", args)              │
│  ┌─────────────────▼──────────────────────────────────┐  │
│  │  Rust backend                                      │  │
│  │  ├── commands.rs (file CRUD, build/start)│  │
│  │  ├── config.rs (osler.config.json + instance gen)  │  │
│  │  ├── deploy.rs (Cloudflare full-stack + CLI deploy)│  │
│  │  ├── instance_updater.rs (code diffs + backups)    │  │
│  │  ├── prereq.rs (Node, Git, Wrangler, CF auth check)│  │
│  │  ├── github.rs (OAuth + repo sync)                 │  │
│  │  ├── setup.rs (secrets, first admin, health check)              │  │
│  │  └── runner.rs (build/start process state)         │  │
│  └─────────────────┬──────────────────────────────────┘  │
│                    │ std::process / std::fs / ureq        │
└────────────────────┼─────────────────────────────────────┘
                     │
                     ▼
        Your Osler project folder on disk
        ├── src/                    ← core framework & engines
        ├── public/osler-content/   ← local content packs
        ├── public/osler.config.json
        ├── cloudflare/worker/      ← backend & D1 migrations
        └── .osler-backup/          ← timestamped safety snapshots
```

---

## 2. Prerequisites

The admin runs on macOS, Windows, and Linux. Each platform has slightly different prerequisites.

### Rust toolchain (all platforms)

Install via [rustup](https://rustup.rs/):

```bash
# macOS / Linux:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Windows: download rustup-init.exe from https://rustup.rs/
```

Verify:

```bash
rustc --version    # must be 1.77+
cargo --version
```

The `Cargo.toml` declares `rust-version = "1.77"`. Newer Rust works; older Rust will fail to compile.

### Tauri CLI

Install via cargo:

```bash
cargo install tauri-cli --version "^2"
# Or via npm:
npm install -g @tauri-apps/cli@^2
```

Verify:

```bash
cargo tauri --version
# → tauri-cli 2.x.x
```

### System dependencies by platform

#### macOS

| Dependency | How to install | Notes |
|---|---|---|
| Xcode Command Line Tools | `xcode-select --install` | Required for the C compiler + system headers |

That's it — Tauri on macOS uses the system WebKit (WKWebView), so no extra webview runtime is needed.

#### Linux

| Dependency | How to install (Debian/Ubuntu) | Notes |
|---|---|---|
| `webkit2gtk-4.1` | `sudo apt install libwebkit2gtk-4.1-dev` | The webview engine |
| `libgtk-3-dev` | `sudo apt install libgtk-3-dev` | GTK window chrome |
| `libayatana-appindicator3-dev` | `sudo apt install libayatana-appindicator3-dev` | System tray (optional) |
| `librsvg2-dev` | `sudo apt install librsvg2-dev` | SVG rendering for icons |
| `build-essential` | `sudo apt install build-essential curl wget file` | C compiler + make |
| `libssl-dev` | `sudo apt install libssl-dev` | TLS for `ureq` HTTP client |

Fedora / Arch / SUSE: see <https://tauri.app/start/prerequisites/> for the equivalent package list.

#### Windows

| Dependency | How to install | Notes |
|---|---|---|
| WebView2 runtime | Preinstalled on Windows 11 | On Windows 10, install from <https://developer.microsoft.com/microsoft-edge/webview2/> |
| Visual Studio C++ Build Tools | <https://visualstudio.microsoft.com/visual-cpp-build-tools/> | Pick "Desktop development with C++" workload |

### Optional: Bun (faster builds)

The admin will use `bun` instead of `npm` for build/start if it's on your PATH:

```bash
# Install bun:
curl -fsSL https://bun.sh/install | bash
```

Bun is significantly faster for `bun run build` (~3× on a cold build), but npm works fine if you don't want to install it.

### Optional: Node.js 22

If your Osler project will use `npm run build` / `npm run start`, you need Node.js 22 (see `.nvmrc` in the project root). The admin shells out to whatever `npm` / `bun` is on your PATH.

---

## 3. Building the admin

### Development mode

```bash
cd tauri-admin
cargo tauri dev
```

The first run compiles all dependencies — expect **3–5 minutes** on a recent laptop. Subsequent runs are <30 seconds thanks to incremental compilation. The app window opens at 1440×900 (or your last-used size), showing the project folder picker overlay.

Hot reload: editing `frontend/*.{html,js,css}` reflects instantly in the webview (just save the file). Editing Rust source (`src/*.rs`) triggers a recompile + window restart.

### Production build

```bash
cd tauri-admin
cargo tauri build
```

Output goes to `tauri-admin/target/release/bundle/`:

| Platform | Bundle formats | Output path |
|---|---|---|
| macOS | `.app` + `.dmg` | `bundle/macos/` and `bundle/dmg/` |
| Windows | `.msi` + `.exe` (NSIS) | `bundle/msi/` and `bundle/nsis/` |
| Linux | `.deb` + `.AppImage` + `.rpm` | `bundle/deb/`, `bundle/appimage/`, `bundle/rpm/` |

The build also produces a stripped binary at `tauri-admin/target/release/osler-admin` (Linux) / `osler-admin.exe` (Windows) / `Osler Admin.app/Contents/MacOS/osler-admin` (macOS) that you can run directly without an installer.

### Platform-specific build commands

| Platform | Command | Notes |
|---|---|---|
| macOS (Intel) | `cargo tauri build --target x86_64-apple-darwin` | |
| macOS (Apple Silicon) | `cargo tauri build --target aarch64-apple-darwin` | Default on M1/M2/M3 |
| macOS (Universal binary) | `cargo tauri build --target universal-apple-darwin` | Requires both toolchains via `rustup target add` |
| Windows | `cargo tauri build` | Run from a Windows machine or VM |
| Linux | `cargo tauri build` | Run from a Linux machine or Docker container with the system deps |
| Cross-compile from Linux to Windows | `cargo tauri build --target x86_64-pc-windows-gnu` | Experimental; cross-compiling Tauri is fragile |

> **Tip:** For distributing signed macOS builds, set the `APPLE_SIGNING_IDENTITY` env var and use `cargo tauri build --target universal-apple-darwin` — Tauri will sign + notarize the bundle automatically. See the [Tauri signing guide](https://tauri.app/distribute/sign-macos/).

### Build-time environment variables

These env vars (or `.env` file in `tauri-admin/`) are read by `build.rs` at compile time:

| Variable | Purpose | Required? |
|---|---|---|
| `GH_OAUTH_CLIENT_ID` | GitHub OAuth app client ID — baked into the binary for zero-config GitHub sign-in | Optional (users can enter their own at runtime) |
| `GH_OAUTH_CLIENT_SECRET` | GitHub OAuth app client secret — only for confidential OAuth apps | Optional (omit for public clients) |

See [§15](#15-build-time-github-oauth-secret-injection) for the full mechanism.

---

## 4. First-run experience

When you launch the admin for the first time (or after clearing your `localStorage`):

1. **Project folder picker overlay** appears, blocking the rest of the UI:

   ```
   ┌────────────────────────────────────────────────────┐
   │  Welcome to Osler Admin                            │
   │                                                    │
   │  Pick the Osler project folder you want to manage. │
   │                                                    │
   │  [  Choose folder…  ]                              │
   │                                                    │
   │  The folder should contain:                        │
   │   • package.json                                   │
   │   • public/osler-content/                          │
   │   • public/osler.config.json (optional)            │
   └────────────────────────────────────────────────────┘
   ```

2. **Click "Choose folder…"** — a native OS folder picker opens. Navigate to your Osler project root and confirm.

3. The admin runs `set_project_root` and `project_state` to verify the folder:
   - ✅ `hasPackageJson: true` and `hasContentDir: true` → bind succeeds
   - ❌ Missing `package.json` → error toast: "This folder doesn't look like an Osler project"
   - ❌ Missing `public/osler-content/` → warning toast: "Content folder not found — some features will be disabled"

4. The bound project root is saved to `localStorage` and re-used on next launch. You can change it later from **Settings → Project root**.

5. **Setup Wizard auto-launches** if (and only if) `public/osler.config.json` does **not** exist in the project root. See [§6](#6-setup-wizard). If the config exists, the wizard is skipped and you land on the Dashboard.

### Rebinding to a different project

From the sidebar footer or **Settings → Project root → Change**, you can re-trigger the folder picker at any time. The current project state is discarded (no in-memory state survives a rebind), but files on disk are untouched.

### Multi-project support

The admin manages **one** project at a time. To manage multiple Osler instances, run multiple admin windows (on macOS, duplicate the app; on Linux/Windows, launch the binary twice) and bind each to a different project folder.

---

## 5. Main UI sections

The admin shell has four top-level sections, each accessible from the sidebar:

### Navigation structure

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▌ Osler Admin                                              [EN ▾] [⚙] │ ← topbar
├────────────┬─────────────────────────────────────────────────────────┤
│            │                                                         │
│  Dashboard │  <active view content>                                  │
│  Content   │                                                         │
│  Configure │                                                         │
│  Run & Pub │                                                         │
│            │                                                         │
│ ────────   │                                                         │
│ Settings   │                                                         │
│            │                                                         │
│ ────────   │                                                         │
│ osler on   │                                                         │ ← sidebar
│ main       │                                                         │   footer
│ ↑ origin   │                                                         │   (git info)
│            │                                                         │
└────────────┴─────────────────────────────────────────────────────────┘
```

### Section reference

| Section | Route | Component | Purpose |
|---|---|---|---|
| **Dashboard** | `#dashboard` | `views/dashboard.js` | Project overview: quick stats (file count, last build, git status), recent activity log, quick-action buttons, GitHub link card |
| **Configure** | `#configure` | `views/configure.js` (hub) → `views/wizard.js` / `views/instance.js` / `views/config.js` | Hub for the three config-related views: Setup Wizard, Instance Generator, Config Editor |
| **Run & Publish** | `#run-publish` | `views/run-publish.js` (hub) → `views/build.js` / `views/start.js` / `views/git.js` / `views/github.js` / `views/deploy.js` | Hub for build, start, git, and deploy — all the "do something to the project" actions |
| **Settings** | `#settings` | `views/settings.js` | UI language (EN/AR), theme (light/dark), project root rebinding |

### Sidebar footer

The sidebar footer always shows:

- **Project name** (derived from the bound folder name, or `osler.config.json → site.shortName` if available)
- **Git branch** (e.g. `on main`)
- **Git remote** (e.g. `↑ origin` — click to open in browser)

If the project has no git remote configured, the footer shows a "Connect GitHub" CTA that opens the GitHub sync view.

### Topbar

The topbar shows:

- **App title** ("Osler Admin") with a small icon
- **UI language toggle** (EN ↔ AR) — flips the entire admin UI including direction
- **Settings gear** — shortcut to the Settings view

The window has `decorations: false` (no native title bar) and uses `titleBarStyle: "Overlay"` on macOS for the traffic-light buttons. The topbar is draggable to move the window (Tauri's `core:window:allow-start-dragging` permission is enabled).

---

## 6. Setup Wizard

The Setup Wizard is a multi-step first-time configuration flow for `osler.config.json`. It auto-launches when no config exists on first bind, and can be re-run any time from **Configure → Setup Wizard**.

### The 6 steps

| # | Step | What you configure |
|---|---|---|
| 1 | **Site identity** | `site.name`, `site.shortName`, `site.tagline`, `site.organisation`, `site.supportEmail` |
| 2 | **GitHub repo** | `site.githubRepo` — the URL of your fork (always required; surfaced in the admin sidebar footer + in-app About section) |
| 3 | **Engine plugins** | Toggle each of the 7 engines on/off: quiz, bank, written, flashcard, osce, library, video |
| 4 | **Theme** | Pick from built-in + preset themes (Dark, Light, Navy Clinic, Forest Rounds, Cream Journal, Crimson ED) |
| 5 | **Language** | Default UI language (`en` or `ar`) + content language filter (`all` / `en` / `ar`) |
| 6 | **Review** | Read-only summary of all choices; click "Save" to write `osler.config.json` via the `write_config` Rust command |

> **GitHub sign-in (OAuth)**: between steps 2 and 3, the wizard optionally prompts for a GitHub OAuth client ID. If you skip this, the GitHub sync view will require a PAT instead. See [§14](#14-github-oauth-setup).

### What the wizard writes

After step 6, the wizard calls `write_config` with a JSON object shaped like:

```jsonc
{
  "schemaVersion": 1,
  "site": {
    "name": "My Medical School",
    "shortName": "MMS",
    "tagline": "Personalised study platform",
    "githubRepo": "https://github.com/your-org/your-osler",
    "organisation": "Your Organisation",
    "supportEmail": "admin@yourschool.edu"
  },
  "engines": {
    "quiz":      { "enabled": true  },
    "bank":      { "enabled": true  },
    "written":   { "enabled": false },
    "flashcard": { "enabled": true  },
    "osce":      { "enabled": true  },
    "library":   { "enabled": true  },
    "video":     { "enabled": false }
  },
  "themes": { "default": "dark", "custom": [] },
  "defaults": {
    "view": "dashboard",
    "language": { "ui": "en", "content": "all" },
    "quiz":     { "questionCount": 20, "secondsPerQuestion": 90, "tutorMode": false, "shuffle": true },
    "ai":       { "model": "gemini-3.5-flash-lite", "enabled": true, "temperature": 0.4 },
    "sync":     { "method": "network", "defaultRoom": "mms-2026" }
  },
  "cloud": { "enabled": false, "apiUrl": "", "syncQbank": true, "syncFlashcards": true },
  "wizard": { "completed": true, "completedAt": "2025-01-15T10:30:00.000Z", "version": 1 }
}
```

The file is pretty-printed to `public/osler.config.json`.

### Re-running the wizard

Re-running the wizard does **not** wipe your existing config — it pre-fills every field with the current value so you can amend individual fields without losing the rest. This is the easiest way to:

- Toggle engines on/off without learning the config schema
- Change your default theme
- Update `site.githubRepo` after moving your fork

### When the wizard doesn't auto-launch

The wizard only auto-launches when **both** conditions are true:

1. A project root has been bound
2. `osler.config.json` does **not** exist at `<project_root>/public/osler.config.json`

If you delete the config file (or rename it temporarily) and rebind, the wizard will auto-launch again.

---

## 7. Config Editor

The Config Editor (`views/config.js`) is a structured form editor for `osler.config.json`. Use it for ongoing config tweaks after the initial wizard run.

### The 5 tabs

| Tab | What you edit |
|---|---|
| **Site** | `site.{name, shortName, tagline, githubRepo, organisation, supportEmail}` — text inputs with live preview of how the values appear in the PWA manifest |
| **Engines** | Per-engine toggle (`enabled`) + optional overrides (`label`, `singular`, `color`, `icon`). Click "Reset to default" on any override to clear it. |
| **Themes** | Pick `themes.default` from a dropdown of built-in + custom themes. Add/edit/remove custom themes with a palette editor that shows live swatches for every oklch token. |
| **Defaults** | `defaults.view` (dropdown), `defaults.language.{ui, content}` (dropdowns), `defaults.quiz.{questionCount, secondsPerQuestion, tutorMode, shuffle}`, `defaults.ai.{model, enabled, temperature}`, `defaults.sync.{method, defaultRoom}` |
| **Raw JSON** | A textarea with the raw `osler.config.json` content. Power-user escape hatch — useful for pasting in a theme from a colleague or making a quick edit the form doesn't surface. |

### Save behavior

- The **Save** button (bottom-right of every tab) calls `write_config` with the in-memory `cfg` object.
- The form tracks `dirty` state — the Save button is disabled when there are no unsaved changes.
- Switching tabs does **not** discard unsaved changes (the in-memory `cfg` is shared across tabs). The Raw JSON tab parses on focus-out; if your JSON is invalid, it shows an inline error and refuses to switch back to a form tab until fixed.

### Engine overrides

The Engines tab supports per-engine overrides for `label`, `singular`, `color`, and `icon`. These take precedence over the built-in `ENGINE_META` in `src/lib/osler/content.ts` and are surfaced to the web app via `getEngineMeta(type)`.

```jsonc
"engines": {
  "quiz": {
    "enabled": true,
    "label": "Weekly Quiz",         // overrides "Quiz"
    "singular": "Quiz",
    "color": "oklch(0.55 0.20 16)", // overrides default oklch
    "icon": "clipboard-list"        // overrides default lucide icon name
  }
}
```

The Config Editor's Engines tab has a color picker (rendered as a row of preset oklch swatches + a free-text input) and an icon picker (a searchable dropdown of lucide-react icon names).

### Theme palette editor

The Themes tab's palette editor supports all 25 design tokens:

- **Core (10):** `primary`, `primaryForeground`, `background`, `foreground`, `accent`, `muted`, `mutedForeground`, `destructive`, `border`, `input`, `ring`
- **Surfaces (6):** `card`, `cardForeground`, `popover`, `popoverForeground`, `secondary`, `secondaryForeground`
- **Sidebar (9):** `sidebar`, `sidebarForeground`, `sidebarPrimary`, `sidebarPrimaryForeground`, `sidebarAccent`, `sidebarAccentForeground`, `sidebarBorder`, `sidebarRing`, (plus `sidebarForeground` already counted)

Each token has a color input (oklch hex picker) and a "reset" button. The live preview panel on the right shows a mock QBank card using your custom palette so you can see the result before saving.

---

## 8. Instance Generator

The Instance Generator (`views/instance.js`) scaffolds a **brand-new Osler project** into a target directory. It's the fastest way to start a new fork without copying files manually.

### What it scaffolds

| Path | Source | Notes |
|---|---|---|
| `<target>/package.json` | Copied from `tauri-admin/default-osler-config.json` template | Adjusted with the new project name |
| `<target>/public/osler.config.json` | Generated from wizard-style inputs | Site identity + engines + theme + language |
| `<target>/public/osler-content/qbank/` | Empty folder + `.gitkeep` | |
| `<target>/public/osler-content/flashcard/` | Empty folder + `.gitkeep` | |
| `<target>/public/osler-content/osce/` | Empty folder + `.gitkeep` | |
| `<target>/public/osler-content/library/` | Empty folder + `.gitkeep` | |
| `<target>/public/osler-content/videos/` | Empty folder + `.gitkeep` | |
| `<target>/public/osler-content/manifest.json` | Empty `{"categories": []}` skeleton | Will be regenerated after first content addition |
| `<target>/README.md` | Generated template | Includes the project name, deploy instructions, link to upstream |
| `<target>/.gitignore` | Standard Node.js + Next.js template | Includes `.next/`, `node_modules/`, `.env*` |
| `<target>/.nvmrc` | `22` | |
| `<target>/.osler-admin/` | Empty folder | Will hold `deploy.json` after first deploy config |

> The Instance Generator does **not** copy `src/`, `cloudflare/worker/`, or `tauri-admin/` — those come from your existing Osler checkout. The generator creates a **config + content skeleton** that you'd typically commit on top of a fresh fork.

### Inputs

The Instance Generator view collects:

1. **Target directory** (folder picker)
2. **Project name** (used for `package.json` `name` field + folder name if target is a parent folder)
3. **Site identity** (name, shortName, tagline, organisation, supportEmail) — same fields as the wizard
4. **Engine selection** (checkboxes for all 7 engines)
5. **Default theme** (dropdown)
6. **Default language** (EN / AR dropdown)
7. **Include sample content?** (checkbox) — if checked, copies a small demo pack (one quiz, one flashcard deck, one article) so the new project boots with something to look at

### What it does NOT do

- Does **not** run `npm install` (you do that after)
- Does **not** run `git init` (you do that after, or fork first then run the generator into the fork)
- Does **not** deploy anything
- Does **not** create the Cloudflare Worker project (you copy `cloudflare/worker/` from upstream separately)

### Typical workflow

1. Fork `osler` on GitHub → clone your fork locally
2. Open the admin → bind to your cloned fork
3. **Configure → Instance Generator** → pick a sibling folder as the target
4. Fill in site identity + engines → generate
5. Open the new project folder — it now has `public/osler.config.json` + content stubs
6. Copy `src/`, `cloudflare/`, `tauri-admin/` from the upstream into the new project (or just commit your config + content on top of the existing fork)
7. Run `npm install` → `npm run generate-manifests` → `npm run dev`

---

## 9. Post-deploy assisted setup (Google Sign-In, first admin, health)

Step 5 of the Instance Generator ("Ready") includes a **Finish setup** card that covers everything only possible once the Worker is live. These run through four dedicated Tauri commands in `src/setup.rs`:

| Command | What it does |
| --- | --- |
| `setup_generate_secret` | Returns a cryptographically random secret (Node crypto, no new Rust deps) |
| `setup_write_secrets` | Writes Worker secrets via `npx wrangler secret put` with stdin piping; values are never logged or written to disk |
| `setup_promote_admin` | Runs the `UPDATE users SET role = 'admin'` SQL against the instance's D1 database (admin is never granted at registration) |
| `setup_check_health` | `GET /v1/health` from the Rust side, since the webview CSP blocks cross-origin fetches |

The flow:

1. **Health check** - one click verifies `GET /v1/health` against the deployed Worker.
2. **Google Sign-In** - step 3 collects the OAuth Client ID + Secret (optional); after deploy they are written as Worker secrets automatically. If skipped, the Ready card shows the exact **Authorized redirect URI** (`https://<worker>/v1/auth/google/callback`) to register in Google Cloud Console, plus inputs to save the credentials later. The Google button goes live on the login screen immediately, with no redeploy needed.
3. **First admin** - register an account in the new instance, enter the username in the Ready card, click **Promote to admin**, reload.


## 10. Build & start runner

The **Run & Publish → Build** sub-view lets you run `npm run build` and `npm run start` (or `bun` equivalents) with live-streamed stdout/stderr logs.

### Build runner

Click **Build** to run `npm run build` (or `bun run build` if bun is on your PATH). The build runs as a child process via the Rust `runner.rs` module, which:

1. Spawns the process with the project root as `cwd`
2. Pipes stdout and stderr to a log buffer in memory
3. Emits log lines to the frontend via Tauri events (`runner_status` event)
4. Tracks exit code + duration

The log panel shows:

```
[10:30:01] $ npm run build
[10:30:02] 
[10:30:02] > osler@1.0.0 build
[10:30:02] > next build
[10:30:03] 
[10:30:05]   ▲ Next.js 16.0.0
[10:30:05]   - Turbopack
[10:30:05] 
[10:30:10]  Creating an optimized production build ...
[10:30:25]  ✓ Compiled successfully
[10:30:26]  ✓ Linting
[10:30:30]  ✓ Collecting page data
[10:30:35]  ✓ Generating static pages
[10:30:36]  ✓ Finalizing page optimization
[10:30:36] 
[10:30:36]  Route (app)                                 Size  First Load JS
[10:30:36]  ┌ ○ /                                      3.2 kB         152 kB
[10:30:36]  └ ○ /_not-found                            0.5 kB         142 kB
[10:30:36]  + First Load JS shared by all              142 kB
[10:30:36] 
[10:30:36]  ○  (Static)  prerendered as static content
[10:30:36] 
[10:30:37] ✓ Build completed in 35s
[10:30:37] ✓ Exit code: 0
```

### Start runner

Click **Start** to run `npm run start` (or `bun run start`). This launches the Next.js standalone server on port 3000. The log panel shows the server output. A **Stop** button appears next to the running process; clicking it sends `SIGTERM` (or `taskkill /T` on Windows).

### Runner state

The Rust backend tracks a single runner at a time (you can't run build + start simultaneously). The `runner_status` command returns:

```jsonc
{
  "kind": "build" | "start" | null,
  "running": true | false,
  "exitCode": 0 | null,
  "startedAt": "2025-01-15T10:30:01Z",
  "endedAt": "2025-01-15T10:30:37Z" | null,
  "logs": ["...", "..."]
}
```

### Log management

- Logs are kept in memory only — they're lost when the admin closes.
- The log panel supports **copy-to-clipboard** (button in the top-right of the panel) and **clear** (trash icon).
- For long-running builds, the panel auto-scrolls to the bottom unless you scroll up (then a "Jump to latest" button appears).

### Why shell out instead of using Next.js programmatically?

The admin deliberately uses `npm run build` / `npm run start` as subprocesses rather than importing Next.js programmatically. This:

- Keeps the admin's binary size small (no Next.js bundled in)
- Matches what CI does (so build failures in CI are reproducible locally)
- Lets the admin work with any future version of Next.js without code changes
- Surfaces the full build output to the user (instead of catching errors in JS)

---

## 11. Git operations

The **Run & Publish → Git** sub-view (`views/git.js`) gives you point-and-click access to the most common git operations. All git commands run as subprocesses at the project root.

### Status display

The Git view shows:

- **Current branch** (e.g. `main`)
- **Remote URL** (e.g. `https://github.com/your-username/osler.git` — click to open in browser)
- **Ahead/behind upstream** counts (e.g. `↑ 2 ↓ 0`)
- **Changed files** list with status indicators:

| Indicator | Meaning |
|---|---|
| `M` | Modified |
| `A` | Added (staged) |
| `D` | Deleted |
| `R` | Renamed |
| `?` | Untracked |
| `U` | Unmerged (conflict) |

### Operations

| Action | Button | What it does |
|---|---|---|
| **Stage** | Click the file's checkbox (or "Stage all") | `git add <paths>` |
| **Unstage** | Click the file's checkbox again (or "Unstage all") | `git reset HEAD <paths>` |
| **Commit** | Type a message in the textarea + click "Commit" | `git commit -m "<message>"` |
| **Push** | "Push" button | `git push` |
| **Pull** | "Pull" button | `git pull` |
| **Discard changes** | Per-file "Discard" link | `git checkout -- <path>` (asks for confirmation) |
| **View diff** | Click a file | Opens a side-by-side diff in a modal |

### Commit message helper

The commit textarea includes a dropdown of Conventional Commits prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `i18n:`, `content:`, `security:`) so you can build a well-formed message with one click.

### GitHub sync (alternative to PAT)

If you've connected your GitHub account via OAuth (see [§14](#14-github-oauth-setup)), the Git view shows an additional **"Sync with GitHub"** button that runs `git push` + `git pull` in sequence, surfacing any conflicts inline.

### What the Git view does **not** do

- ❌ Branch creation / deletion / switching — use the terminal or your IDE for that
- ❌ Merge conflict resolution — the admin surfaces the conflict but defers to your merge tool
- ❌ Rebase / cherry-pick / reset — terminal only
- ❌ Submodule management — terminal only

The Git view is a **convenience layer** for the 80% case (stage → commit → push). Power users should keep using the terminal.

### Git commands (Rust → frontend)

| Command | Args | Returns |
|---|---|---|
| `git_status` | — | `{ entries: [{ path, status, staged }] }` |
| `git_add` | `{ paths: [] }` | `{ added }` |
| `git_commit` | `{ message }` | `{ committed, message }` |
| `git_push` | — | `{ pushed, output }` |
| `git_pull` | — | `{ pulled, output }` |
| `git_remote` | — | `{ remote, branch }` |

---

## 12. Deployment providers

The **Run & Publish → Deploy** sub-view (`views/deploy.js`) lets you trigger production deploys to four providers, each via REST API + Personal Access Tokens stored on disk.

### Provider reference

| Provider | Endpoint | What it does | Required credentials |
|---|---|---|---|
| **Vercel** | `POST https://api.vercel.com/v13/deployments` | Triggers a production redeploy from the Git branch linked to your Vercel project | `token` (Vercel PAT), `project_name`, `branch` (optional `org` + `repo` + `repo_id` for explicit git source) |
| **GitHub Pages** | `POST https://api.github.com/repos/{owner}/{repo}/git/blobs` → trees → commits → `PATCH .../git/refs/heads/{branch}` | Builds locally (`bun run build` or `npm run build`) and uploads the `out/` directory to the configured branch via the Git Data API | `token` (GitHub PAT), `owner`, `repo`, `branch`, `source_dir` (optional) |
| **Cloudflare (Pages + Worker)** | `POST https://api.cloudflare.com/.../pages/projects/{p}/deployments` + Wrangler deploy for Worker | Triggers a production deployment from the connected Git branch (the provider rebuilds from Git). Deploys the Worker from `cloudflare/worker/` via Wrangler as part of the same flow. | `api_token` (Cloudflare API token), `account_id`, `project_name`, `branch`, `worker_name` |
| **Netlify** | `POST https://api.netlify.com/api/v1/sites/{site_id}/deploys` | Triggers a manual build of the connected site (the provider rebuilds from Git) | `token` (Netlify PAT), `site_id`, `deploy_title` (optional) |

### How deploys work

For **Vercel**, **Cloudflare Pages**, and **Netlify**, the deploy pipeline first runs `git push` (via the Git view's push command) so the provider's build infra picks up the latest source, then calls the provider's REST API to trigger a redeploy. The provider rebuilds on their own infrastructure; you don't need a local build.

For **GitHub Pages**, the pipeline runs `bun run build` (or `npm run build`) **locally** and uploads the resulting `out/` directory directly via the Git Data API (blobs → tree → commit → ref update). The branch is created if it doesn't exist. As a fallback when no static export is present, it uploads `public/` instead.

For **Cloudflare**, the pipeline does **both**: triggers a Pages deploy via the REST API **and** runs `npx wrangler deploy` from `cloudflare/worker/` to deploy the Worker. This is the only provider that deploys the full stack (frontend + backend) in one click.

### PAT storage & security

Personal Access Tokens are stored under:

```
<project_root>/.osler-admin/deploy.json
```

| Property | Behavior |
|---|---|
| File mode | `0600` on Unix (read/write owner only). On Windows, ACLs are inherited from the project folder. |
| `.gitignore` | `.osler-admin/` is automatically appended to `.gitignore` if not already present, so PATs never get committed by accident |
| Redaction in UI | `get_deploy_config` always redacts token-shaped fields (`token`, `pat`, `password`, `api_key`) to `••••••••` before returning to the frontend |
| Empty token preservation | `set_deploy_config` preserves the previously saved value when an empty string is submitted for a token field — lets you update non-secret fields without re-entering your PAT |
| Per-provider clear | `clear_deploy_provider({ provider })` removes all stored fields for a single provider, so you can rotate credentials without touching the others |

### Deploy flow

1. **Connect a provider**: fill in the fields on the Deploy view → click "Test connection" → the admin calls the provider's REST API with a minimal request (e.g. list projects) to verify the token works → green check on success, red error message on failure.
2. **Trigger a deploy**: click "Deploy" → the admin runs the provider-specific pipeline → live log lines stream back via the `deploy_status` event → the final deployment URL is surfaced in a quick-deploy panel.
3. **Monitor**: the deploy runs asynchronously — you can switch views while it runs. The Deploy view shows a banner with current status: `running` / `success` / `failed` + timestamps.

### Deploy commands (Rust → frontend)

| Command | Args | Returns |
|---|---|---|
| `get_deploy_config` | — | Redacted config object (tokens shown as `••••••••`) |
| `set_deploy_config` | `{ config }` | Redacted config after merge (empty tokens preserve existing) |
| `clear_deploy_provider` | `{ provider }` | Redacted config after removing the given provider |
| `test_deploy_connection` | `{ provider }` | `{ ok: bool, details?: {...}, error?: string }` |
| `deploy` | `{ provider, skipBuild? }` | `{ started: true, provider }` — logs stream via `deploy_status` event |
| `deploy_status` | — | `{ provider, running, success, startedAt, endedAt, logs, resultUrl, error }` |
| `clear_deploy_logs` | — | `{ cleared: true }` |

### Choosing a provider

See [`deployment.md`](./deployment.md) §1 for the full decision matrix. The short version:

- **Cloudflare (Pages + Worker)** — recommended default; one click deploys the full stack
- **Vercel + Cloudflare Worker** — best Next.js DX; use Vercel button here + Worker deploy separately
- **GitHub Pages** — static-only; no accounts / sync / admin
- **Netlify** — alternative to Vercel; per-PR preview deploys

---

## 13. GitHub OAuth setup

The admin's GitHub integration (`views/github.js` + `src/github.rs`) lets you bind a GitHub repository and push/pull without entering a PAT every time. It uses GitHub's OAuth App flow.

### Step 1: Create a GitHub OAuth App

1. Visit <https://github.com/settings/developers> → **New OAuth App**
2. Fill in:
   - **Application name:** `Osler Admin (your school / org)`
   - **Homepage URL:** `https://github.com/your-username/osler` (or your fork URL)
   - **Authorization callback URL:** `http://localhost:7878/callback`
3. Click **Register application**
4. On the next page, note the **Client ID** (public, safe to share)
5. Click **Generate a new client secret** → note the **Client Secret** (only shown once; store immediately)

### Step 2: Choose how to provide the credentials

You have two options:

**Option A — Build-time injection (recommended for organizations):**

Bake the OAuth credentials into the admin binary at build time via `.env`. See [§15](#15-build-time-github-oauth-secret-injection).

**Option B — Runtime entry (recommended for public releases):**

Distribute the admin without any OAuth credentials baked in. Each user enters their own client ID (and secret, if applicable) in the admin's **Settings → GitHub** panel or via the setup wizard's OAuth step.

### Step 3: Configure the admin

If using Option A: rebuild the admin after editing `.env`. On next launch, the GitHub sync view will use the baked-in credentials automatically — no UI interaction needed.

If using Option B: open the admin → Settings → GitHub → paste your Client ID (and Client Secret if confidential) → Save. The credentials are stored in `<project_root>/.osler-admin/deploy.json` alongside the deploy PATs, with the same `0600` permissions and `.gitignore` protection.

### Step 4: Authorize

Click **"Connect GitHub"** in the sidebar footer (or in the GitHub sync view). A browser window opens to GitHub's OAuth consent screen. After you authorize, GitHub redirects to `http://localhost:7878/callback` — a tiny HTTP server spun up by the admin receives the authorization code, exchanges it for an access token via `src/github.rs`, and stores the token in memory for the session.

> **Public vs. confidential OAuth apps:** If you registered the OAuth App as **Public** (the new GitHub default for desktop apps), no client secret is required — the access token exchange uses PKCE. If you registered as **Confidential** (the old default), you must provide the client secret. New apps should always use Public + PKCE.

### What the GitHub sync enables

Once connected:

- **Push / pull** in the Git view works without entering credentials
- The sidebar footer shows your GitHub username + avatar
- The Dashboard's "GitHub" card shows the repo's open PR / issue counts (fetched via the GitHub API)
- The Instance Generator can auto-create a new GitHub repo for the scaffolded project (with your permission)

### Token revocation

To revoke the admin's access at any time:

1. Visit <https://github.com/settings/applications>
2. Find your OAuth App → click **...** → **Revoke access**
3. The admin's next push/pull attempt will fail with a 401 — re-authorize via the consent screen

To rotate the OAuth App itself (e.g. if the client secret leaks):

1. GitHub → your OAuth App → **Generate a new client secret** (the old one stops working immediately)
2. Update the admin's stored credentials (Settings → GitHub) or rebuild with the new `.env`

---

## 14. Build-time GitHub OAuth secret injection

For organizations distributing a pre-built admin binary to their staff, you can bake the GitHub OAuth credentials into the binary at build time so end users don't need to enter anything.

### The mechanism

`tauri-admin/build.rs` runs at compile time. It reads `tauri-admin/.env` (if present) and emits `cargo:rustc-env` directives that make the values available to `src/github.rs` via `option_env!("OSLER_GH_CLIENT_ID")` and `option_env!("OSLER_GH_CLIENT_SECRET")`.

```rust
// build.rs (simplified — see the actual file for the full version)
fn main() {
    println!("cargo:rerun-if-changed=.env");

    if let Ok(contents) = std::fs::read_to_string(".env") {
        for line in contents.lines() {
            // Parse KEY=VALUE pairs
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                let val = v.trim().trim_matches('"');
                match key {
                    "GH_OAUTH_CLIENT_ID" if !val.is_empty() =>
                        println!("cargo:rustc-env=OSLER_GH_CLIENT_ID={}", val),
                    "GH_OAUTH_CLIENT_SECRET" if !val.is_empty() =>
                        println!("cargo:rustc-env=OSLER_GH_CLIENT_SECRET={}", val),
                    _ => {}
                }
            }
        }
    }

    tauri_build::build()
}
```

### Setting up `.env`

Create `tauri-admin/.env` (do **not** commit this file — it's already in `.gitignore`):

```bash
# tauri-admin/.env
GH_OAUTH_CLIENT_ID=Iv1.abcdef1234567890
GH_OAUTH_CLIENT_SECRET=your-secret-here-only-for-confidential-apps
```

> **Client ID is PUBLIC.** It's safe to commit, safe to ship in the binary. The Osler project ships a default client ID for the upstream OAuth App.
>
> **Client Secret is CONFIDENTIAL.** Only needed if your OAuth App is registered as Confidential. For public releases, register the app as a Public client (PKCE flow) so no secret is required.

### Rebuilding after `.env` changes

The `cargo:rerun-if-changed=.env` directive ensures that any change to `.env` triggers a recompile on the next `cargo tauri dev` or `cargo tauri build`. You don't need to `cargo clean`.

### Verifying the injection worked

After building, check that the credentials are present in the binary:

```bash
# Linux / macOS:
strings target/release/osler-admin | grep "Iv1\." | head -1
# Should print your client ID prefix

# Or, run the admin and check the GitHub sync view — it should show
# "Connected (built-in credentials)" without prompting for a client ID.
```

### Security considerations

- The client secret, if baked in, **can be extracted** from the binary by anyone with the binary. This is acceptable for organization-internal distribution where every user has the same access level. It is **not** acceptable for public releases — for those, register the OAuth App as Public + PKCE and ship without a secret.
- Tauri apps run on the user's own machine, so baking in the builder's own app credentials for a privately-distributed build is acceptable per GitHub's OAuth App best practices.
- For maximum security, use **Option B** from [§14](#14-github-oauth-setup) (runtime entry) — each user enters their own credentials, nothing is baked in.

---

## 15. Cross-platform builds

The admin builds and runs on macOS, Windows, and Linux. Each platform has quirks.

### macOS

| Aspect | Notes |
|---|---|
| Architecture | Apple Silicon (M1/M2/M3) is the default target on those machines. Intel Macs build for `x86_64`. For a Universal binary, run `rustup target add x86_64-apple-darwin aarch64-apple-darwin` then `cargo tauri build --target universal-apple-darwin`. |
| Webview | WKWebView (system WebKit) — no separate runtime to install |
| Window decorations | `titleBarStyle: "Overlay"` makes the traffic lights overlap the topbar (macOS-native look). The topbar has a drag region so the window is movable. |
| Code signing | For distribution outside your org, set `APPLE_SIGNING_IDENTITY` env var and Tauri will sign + notarize the `.app`. See <https://tauri.app/distribute/sign-macos/>. |
| DMG | `cargo tauri build` produces both `.app` and `.dmg` in `bundle/dmg/`. |
| Notarization | Required for Gatekeeper to allow the app to run on other Macs. Set `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` env vars before building. |

### Windows

| Aspect | Notes |
|---|---|
| Webview | WebView2 (Edge runtime). Preinstalled on Windows 11; on Windows 10, install from <https://developer.microsoft.com/microsoft-edge/webview2/>. |
| Architecture | `x86_64-pc-windows-msvc` is the default (requires Visual Studio C++ Build Tools). For `gnu` toolchain, use `x86_64-pc-windows-gnu`. |
| Window decorations | `decorations: false` removes the native title bar. The topbar has a drag region; the close/minimize/maximize buttons are custom-rendered in the top-right. |
| Installers | `cargo tauri build` produces both `.msi` (WiX) and `.exe` (NSIS) in `bundle/msi/` and `bundle/nsis/`. |
| Code signing | For distribution, set `TAURI_SIGNING_PRIVATE_KEY` env var to sign the installer. Users get a green "Verified publisher" instead of SmartScreen warning. |
| Path length | Windows has a 260-char path limit by default. If your project root is deep (`C:\Users\<you>\Documents\Projects\osler\...`), you may hit it during `cargo tauri build`. Enable long paths in Windows Registry or move the project closer to `C:\`. |

### Linux

| Aspect | Notes |
|---|---|
| Distros | Tested on Ubuntu 22.04+, Fedora 38+, Arch (rolling). Other distros likely work if you can install the webkit2gtk-4.1 deps. |
| Webview | WebKitGTK (via `libwebkit2gtk-4.1`). |
| Window decorations | `decorations: false` removes the native title bar. CSD (client-side decorations) are drawn by the admin. On GNOME, the topbar may overlap the system top bar in fullscreen — test on your target DE. |
| Bundles | `cargo tauri build` produces `.deb` (Debian/Ubuntu), `.rpm` (Fedora/RHEL/SUSE), and `.AppImage` (universal). The AppImage is the most portable — it runs on any distro with FUSE. |
| System tray | Optional — requires `libayatana-appindicator3-dev` at build time. The admin doesn't currently use a tray icon, but the capability is enabled in `capabilities/default.json`. |
| Wayland | Works on Wayland with `WEBKIT_DISABLE_DMABUF_RENDERER=1` env var (set automatically by Tauri 2.x). If you see rendering glitches, try `GDK_BACKEND=x11`. |

### Cross-compiling

Cross-compiling Tauri apps between platforms is fragile because of the native webview dependency. The recommended approach is to build on the target platform:

| Target | Build on |
|---|---|
| macOS (Universal) | A macOS machine (Intel or Apple Silicon) |
| Windows x86_64 | A Windows machine or VM |
| Linux x86_64 | A Linux machine or Docker container |
| Linux ARM64 (e.g. Raspberry Pi) | The target device itself, or an ARM64 Docker container |

For CI, use GitHub Actions matrix builds with `runs-on: macos-latest`, `windows-latest`, `ubuntu-latest` — see the [Tauri GitHub Action](https://github.com/tauri-apps/tauri-action).

---

## 16. Updating the admin

To update the admin to the latest version:

### Step 1: Pull the latest code

```bash
cd <your-osler-project>/tauri-admin
git pull upstream main
# or, if you forked the admin separately:
git pull origin main
```

### Step 2: Update Rust dependencies

```bash
cargo update
# This updates Cargo.lock to the latest semver-compatible versions of all deps.
```

If you want to upgrade Tauri itself (e.g. from 2.0 to 2.1), edit `Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2.1", features = [] }
```

Then run `cargo update -p tauri`.

### Step 3: Rebuild

```bash
cargo tauri dev    # quick smoke test in dev mode
cargo tauri build  # produce a new installer
```

If the rebuild fails, check [§18 Troubleshooting](#18-troubleshooting).

### Step 4: Replace the installed binary

- **macOS:** Replace `Osler Admin.app` in `/Applications/` (or wherever you installed it) with the new `.app` from `target/release/bundle/macos/`.
- **Windows:** Run the new `.msi` or `.exe` installer — it will replace the previous version.
- **Linux:** Install the new `.deb` / `.rpm` via `dpkg -i` / `rpm -i`, or replace the AppImage file.

### Step 5: Verify

Launch the admin → check **Settings → About** for the version number. Bind to your Osler project → run through a quick smoke test:

- Dashboard loads with project stats
- Content view shows the file tree
- Config editor opens with current `osler.config.json`
- Build runner can start a build

### Step 6: (Optional) Migrate stored PATs

If the deploy config schema changed between versions (rare), the admin will prompt you to re-enter your PATs on first deploy. The old PATs are preserved in `.osler-admin/deploy.json.bak` for safety.

### Updating `Cargo.lock` in CI

If you have a CI pipeline that builds the admin, add a step to commit the updated `Cargo.lock`:

```yaml
- name: Update Cargo.lock
  run: cargo update
- name: Commit Cargo.lock
  run: |
    git config user.name "CI"
    git config user.email "ci@example.com"
    git add Cargo.lock
    git commit -m "chore(admin): update Cargo.lock" || true
    git push
```

---

## 17. Troubleshooting

### Common issues

#### `error: failed to run custom build command for 'tauri-build'

**Cause:** Missing system dependencies (Linux) or missing Xcode CLT (macOS).

**Fix (Linux):**

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev build-essential
```

**Fix (macOS):**

```bash
xcode-select --install
```

#### `error: package 'tauri' v2.x.y cannot be built because it requires rustc 1.77 or newer`

**Cause:** Your Rust toolchain is older than 1.77.

**Fix:**

```bash
rustup update stable
rustup default stable
rustc --version   # should print 1.77+
```

#### Tauri CLI version mismatch

**Symptom:** `cargo tauri dev` fails with "Tauri CLI version X does not match Tauri runtime version Y".

**Cause:** The `tauri-cli` cargo install is out of sync with the `tauri` crate version in `Cargo.toml`.

**Fix:**

```bash
# Reinstall the CLI to match the Cargo.toml version
cargo install tauri-cli --version "^2"
# Verify
cargo tauri --version
```

#### `cargo build` fails with linker errors on Windows

**Cause:** Missing Visual Studio C++ Build Tools.

**Fix:** Install "Visual Studio Build Tools 2022" from <https://visualstudio.microsoft.com/visual-cpp-build-tools/>, pick the "Desktop development with C++" workload, restart your terminal, and try again.

#### Frontend assets missing (`frontend not found`)

**Symptom:** `cargo tauri build` fails with `Error: The frontendDist directory 'frontend' does not exist`.

**Cause:** You're running the build from the wrong directory.

**Fix:** Make sure you're in `tauri-admin/`, not the project root:

```bash
cd tauri-admin
cargo tauri build
```

#### Webview is blank / shows white screen

**Cause (Linux):** Wayland + WebKitGTK rendering bug.

**Fix:**

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 cargo tauri dev
# Or, if running the installed binary:
WEBKIT_DISABLE_DMABUF_RENDERER=1 /path/to/osler-admin
```

**Cause (Windows):** WebView2 runtime missing.

**Fix:** Install WebView2 Runtime from <https://developer.microsoft.com/microsoft-edge/webview2/>.

#### Deploy fails with `401 Unauthorized`

**Cause:** PAT is invalid, expired, or lacks the required scopes.

**Fix:**

1. Verify the PAT is correct in **Run & Publish → Deploy → Connect provider**
2. For Vercel: token must have "Full Account" scope at <https://vercel.com/account/tokens>
3. For GitHub: token must have `repo` scope (and `workflow` scope if deploying to a branch that triggers GitHub Actions)
4. For Cloudflare: token must have "Cloudflare Pages — Edit" permission at <https://dash.cloudflare.com/profile/api-tokens>
5. For Netlify: token must be a personal access token at <https://app.netlify.com/user/applications>

#### Deploy fails with `404 Not Found` on `project_name` / `site_id`

**Cause:** The `project_name` (Vercel/Cloudflare) or `site_id` (Netlify) doesn't match any project on your account.

**Fix:** Double-check the value. For Netlify, the `site_id` is the UUID in the site's dashboard URL (`https://app.netlify.com/sites/<site_id>`). For Cloudflare, the `project_name` is the Pages project name (lowercase, hyphenated). For Vercel, the `project_name` is in the project's dashboard URL.

#### Git push fails with `authentication required`

**Cause:** The remote requires authentication and the admin doesn't have credentials stored.

**Fix:** Either:

1. Use the GitHub OAuth flow (see [§14](#14-github-oauth-setup)) to authorize the admin
2. Use a git credential helper (`git config --global credential.helper store`) and push once from the terminal to cache your credentials
3. Switch the remote to HTTPS with an embedded PAT: `git remote set-url origin https://<username>:<pat>@github.com/<username>/osler.git` (less secure — PAT visible in `.git/config`)

#### Manifest regeneration shows "Failed to parse: <path>"

**Cause:** One of the JSON files in that category has a syntax error.

**Fix:** Same as above — open the file and fix the syntax. The admin will skip the broken file and regenerate the rest of the manifest; you'll see the broken file missing from the tree once you re-open the Content view.

#### Build runner hangs indefinitely

**Cause:** `npm install` is hanging (usually a network issue), or the build is waiting for input.

**Fix:**

1. Click **Stop** to terminate the process
2. Open a terminal at the project root and run `npm install` manually to see the error
3. Once `npm install` succeeds manually, retry the build from the admin

#### The admin window is off-screen / can't be moved

**Cause:** The window was last closed on a monitor that's no longer attached.

**Fix:**

1. Right-click the admin's taskbar / dock icon
2. Click "Move" (Windows) or use the Window menu (macOS)
3. Use arrow keys to bring it back on-screen

Or reset the window state:

```bash
# macOS:
defaults delete com.osler.admin
# Windows: delete %APPDATA%\com.osler.admin\window-state.json
# Linux: delete ~/.config/osler-admin/window-state.json
```

### Getting more help

If none of the above fixes your issue:

1. Search the existing issues: <https://github.com/eyad-elghareeb/osler/issues>
2. Open a new issue with:
   - Your OS + version
   - Rust version (`rustc --version`)
   - Tauri CLI version (`cargo tauri --version`)
   - The exact error message (copy from the admin's log panel)
   - Steps to reproduce

---

## 18. Frontend-only preview

The admin's frontend is plain HTML/CSS/JS with no build step. You can open it directly in a browser to preview the UI without compiling Tauri — useful for quick design iterations or for contributors who don't have the Rust toolchain installed.

### How to preview

```bash
cd tauri-admin/frontend

# Option 1: Python's built-in HTTP server (no install needed)
python3 -m http.server 1420
# Open http://localhost:1420 in your browser

# Option 2: Node http-server
npx http-server -p 1420

# Option 3: VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

### Preview mode

Add `?preview=1` to the URL, or set `localStorage["osler-admin-preview"] = "1"`:

```
http://localhost:1420/?preview=1
```

In preview mode:

- The mock pretends a project root is bound (returns fake data)
- All `invoke()` calls fall back to no-op mocks that return empty data
- Deploy commands return success-shaped responses so the deploy flow can be exercised end-to-end
- You can navigate every view (Dashboard, Content + Markdown editor, Manifest, Build, Git, Deploy, Settings) without a real Tauri backend

### What works in preview mode

| Feature | Works? |
|---|---|
| UI navigation (sidebar, topbar, language toggle) | ✅ |
| Form rendering (Config editor, deploy fields) | ✅ |
| Mock data display (Dashboard cards, file tree) | ✅ (with fake data) |
| RTL / Arabic UI | ✅ |
| Theme tokens (light/dark) | ✅ |
| Toast notifications | ✅ |
| File CRUD (save, create, delete) | ❌ (mocked, no-op) |
| Git operations | ❌ (mocked) |
| Build / start runner | ❌ (mocked) |
| Deploy to a real provider | ❌ (mocked) |
| OAuth flow | ❌ (mocked) |

### When to use preview mode

- **Design iteration:** quickly try a new color, layout, or component without rebuilding the binary
- **i18n work:** add Arabic strings and verify the RTL layout
- **CSS tweaks:** edit `styles.css` and reload to see changes
- **Onboarding new contributors:** let them explore the admin UI before installing Rust
- **Screenshotting for docs:** the screenshots in this guide were taken in preview mode

### What you can't test in preview mode

Anything that requires the Rust backend — file I/O, subprocess execution, network requests via `ureq`, Tauri-specific APIs (dialog, fs, shell). For those, you need the real Tauri build.

### Removing preview mode

To exit preview mode:

```js
// In the browser console:
localStorage.removeItem("osler-admin-preview");
// Then reload without ?preview=1
```

---

## 19. Capabilities and permissions

Tauri 2 uses a capabilities system to gate which native APIs the webview can call. The admin's capabilities live at [`tauri-admin/capabilities/default.json`](../tauri-admin/capabilities/default.json) and define exactly what the admin is allowed to do.

### The capabilities file

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2/capability",
  "identifier": "default",
  "description": "Default capabilities for the Osler admin dashboard: shell out to git/npm/bun, read/write the project root, open dialogs.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-unmaximize",
    "core:window:allow-maximize",
    "core:window:allow-close",
    "core:window:allow-is-maximized",
    "dialog:default",
    "dialog:allow-open",
    "opener:default",
    "fs:default",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "shell:default",
    "shell:allow-execute",
    "process:default"
  ]
}
```

### What each permission grants

| Permission | What it allows | What the admin uses it for |
|---|---|---|
| `core:default` | Default Tauri core APIs (event system, app info) | Internal plumbing |
| `core:window:default` | Default window operations | Window lifecycle |
| `core:window:allow-start-dragging` | `window.startDragging()` | Drag the frameless window by the topbar |
| `core:window:allow-minimize` | `window.minimize()` | Topbar minimize button |
| `core:window:allow-toggle-maximize` | `window.toggleMaximize()` | Topbar maximize button |
| `core:window:allow-unmaximize` | `window.unmaximize()` | Restore from maximized |
| `core:window:allow-maximize` | `window.maximize()` | Maximize via keyboard / menu |
| `core:window:allow-close` | `window.close()` | Topbar close button |
| `core:window:allow-is-maximized` | `window.isMaximized()` | Update topbar button state |
| `dialog:default` | Default dialog APIs | Error / info dialogs |
| `dialog:allow-open` | `dialog.open()` (folder picker) | Project root folder picker |
| `opener:default` | Default opener APIs | Open URLs in the system browser (sidebar footer GitHub link) |
| `fs:default` | Default fs APIs (scoped to project root) | Read/write content files, config, manifests |
| `fs:allow-read-text-file` | Read text files | Load JSON / Markdown content |
| `fs:allow-write-text-file` | Write text files | Save JSON / Markdown / config |
| `shell:default` | Default shell APIs | Spawn git, npm, bun, wrangler subprocesses |
| `shell:allow-execute` | `shell.execute()` | Run `git push`, `npm run build`, etc. |
| `process:default` | Default process APIs | Manage child processes (build / start runner) |

### What the admin does NOT request

| Permission | Why it's not requested |
|---|---|
| `fs:allow-read-file` (binary) | The admin only reads/writes text files (JSON, Markdown, config). No need for binary file access. |
| `fs:allow-exists` | Not used — the Rust backend handles existence checks via `std::fs` directly, not through the Tauri fs plugin. |
| `http:default` | Not used — all HTTP requests go through `ureq` in Rust (which bypasses the Tauri HTTP plugin). The webview's `fetch()` is restricted by the CSP. |
| `notification:default` | Not used — toasts are rendered in the webview, not as OS notifications. |
| `clipboard:default` | Not used — copy-to-clipboard uses the browser's `navigator.clipboard` API, scoped to the webview. |
| `global-shortcut:default` | Not used — no global keyboard shortcuts. |
| `macos-private-api:default` | Not used — the admin doesn't need any private macOS APIs. |
| `tray:default` | Not used — no system tray icon. |

### Content Security Policy (CSP)

The admin's CSP is defined in `tauri.conf.json`:

```
default-src 'self';
img-src 'self' data: https:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net;
font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net;
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
connect-src 'self' ipc: http://ipc.localhost https://api.github.com https://cdn.jsdelivr.net
```

| Directive | Why |
|---|---|
| `default-src 'self'` | Default deny — only same-origin resources allowed unless explicitly listed |
| `img-src 'self' data: https:` | Allow images from anywhere (article images, GitHub avatars, etc.) |
| `style-src` includes `fonts.googleapis.com` | Cairo font CSS loads from Google Fonts |
| `connect-src` includes `api.github.com` | GitHub API calls (repo info, OAuth) |
| `connect-src` includes `ipc: http://ipc.localhost` | Tauri IPC (webview ↔ Rust backend) |
| `'unsafe-inline'` for script-src | Required for the pre-hydration script in `index.html` that sets the language before paint (avoids RTL flash) |

> **Note:** `'unsafe-inline'` for `script-src` is a known compromise. The pre-hydration script must run before the page renders to avoid a flash of LTR content for Arabic users. Moving it to an external file would defeat the purpose. The script is short, audited, and shipped with the binary — it's not user-controllable.

### Auditing the capabilities

If you're distributing the admin within an organization with strict IT policies, you may need to audit exactly what the binary can do. The full list of Tauri 2 permissions is at <https://tauri.app/security/permissions/>. The admin requests only the minimum set required for its features — no microphone, camera, location, file system access outside the project root, or arbitrary HTTP.

To verify after a build:

```bash
# Check the bundled capabilities in the binary:
strings target/release/osler-admin | grep -E "^[a-z-]+:[a-z-]+" | sort -u | head -50
# Should match the permissions listed in capabilities/default.json
```

### Restricting capabilities further

If you want to lock down the admin further (e.g. disable the deploy feature for read-only operators), you can edit `capabilities/default.json` to remove specific permissions. For example, removing `shell:allow-execute` would prevent the admin from running any subprocess (build, start, git, deploy) — useful for a "viewer" mode where the admin only edits content files.

After editing the capabilities, rebuild:

```bash
cargo tauri build
```

The new binary will refuse to invoke any command whose permission was removed.

---

That's the full Tauri admin guide. For the web app's in-browser admin panel (the one at `/admin` for managing users + R2 content), see [`admin-guide.md`](./admin-guide.md). For deploying the Osler project that the admin manages, see [`deployment.md`](./deployment.md).
