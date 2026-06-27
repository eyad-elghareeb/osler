# Getting Started

This page walks a new developer from a fresh clone to a running local build of
Osler V2 — both the PWA (web app) and the Tauri admin dashboard.

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 20.x (LTS) | Build pipeline, esbuild, Vitest, Playwright |
| npm | 10.x | Comes with Node 20 |
| Rust | 1.75+ | Tauri admin dashboard |
| Cargo | (with Rust) | Tauri build |
| Tauri CLI | 2.x | `cargo install tauri-cli` |
| Python | 3.10+ | PDF generator scripts (`scripts/pdf_generator.py`) — optional |
| Git | 2.30+ | Standard |

For Tauri's system dependencies on Linux, install:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf
```

macOS requires Xcode Command Line Tools. Windows requires the WebView2 runtime
(pre-installed on Windows 11).

## Clone the repository

```bash
git clone https://github.com/osler-app/osler.git
cd osler
```

If you are contributing, fork first and clone your fork. See
[Contributing](contributing.md) for the branch model.

## Install dependencies

```bash
npm ci
```

This installs:

- `esbuild` — JS bundler
- `vitest` — unit + integration test runner
- `@playwright/test` — E2E test runner
- `ajv` + `ajv-formats` — JSON Schema validation
- `firebase` — the only runtime dependency

For the Tauri admin:

```bash
cd tauri-admin
cargo build --release
```

The first build takes ~5-10 minutes (downloads and compiles all Rust
dependencies). Subsequent builds are incremental.

## Configure environment variables

Copy the example env file and fill in your Firebase config:

```bash
cp .env.example .env
```

Edit `.env` and set the `VITE_FIREBASE_*` values from your Firebase project
console. If you don't have a Firebase project yet, see
[Firebase → Bring Your Own](../firebase/bring-your-own.md) for setup
instructions. The PWA will run without these (guest mode works) but sync and
auth will be disabled.

Never commit `.env`. The `.gitignore` already excludes it.

## Build the PWA

```bash
npm run build
```

This runs `node src/build.js`, which:

1. Bundles each engine with esbuild into `dist/{engine-name}.js`.
2. Copies CSS from `src/css/` into `dist/css/`.
3. Copies content from `content/` into `dist/content/`.
4. Copies static assets (icons, manifest, service worker) into `dist/`.
5. Writes `dist/update-manifest.json` with the bundle hash and engine list.

Output lands in `dist/`. Open `dist/index.html` directly in a browser, or
serve it with any static server:

```bash
npx serve dist
# or
python3 -m http.server --directory dist 5500
```

## Run the tests

Osler V2 has four test layers. Run them in this order:

```bash
# 1. Build (catches syntax + import errors)
npm run build

# 2. Unit + integration tests (Vitest)
npm test

# 3. Validate content files against schemas
npm run validate

# 4. Validate that the schemas themselves are well-formed
npm run validate-schemas

# 5. E2E tests (Playwright, Chromium only by default)
npx playwright install chromium   # one-time
npm run test:e2e
```

The one-shot `npm run check` runs steps 1-4 in sequence. CI runs all five (with
E2E only on `main`).

## Run the Tauri admin dashboard

```bash
cd tauri-admin
cargo run --release
```

This launches the Osler Admin desktop window. The first run will prompt you to
sign in with GitHub (Device Flow). The token is stored in your OS keychain.

For development with hot reload of the frontend:

```bash
cd tauri-admin
cargo run --   # starts the Rust shell
# in another terminal, edit frontend/ files; the Tauri webview reloads on save
```

## Serve the docs locally

This documentation set is built with mkdocs-material. To serve it locally:

```bash
pip install mkdocs mkdocs-material mkdocs-section-index
cd osler-v2-developer-admin-docs   # or wherever you unzipped the docs
mkdocs serve
# open http://127.0.0.1:8000
```

## Common first-run issues

- **`npm run build` fails with "Cannot find module 'esbuild'"** — run `npm ci`
  again. If you used `npm install` instead of `npm ci`, the lockfile may have
  drifted. Delete `node_modules/` and `package-lock.json`, then `npm install`.
- **Tauri build fails on Linux with `webkit2gtk-4.1 not found`** — install
  the system dependencies listed above.
- **`npm run validate` fails with "schema version mismatch"** — your local
  content file has a `meta.schemaVersion` that doesn't match any version in
  `src/schemas/_meta.json`. Bump the schema version or fix the content file.
  See [Content Authoring → Validation](../content-authoring/validation.md).
- **Firebase auth doesn't work locally** — make sure your Firebase project's
  Auth settings have `localhost` in the authorized domains list.
- **E2E tests fail with "browser not found"** — run
  `npx playwright install chromium` (and `firefox`, `webkit` if you want
  cross-browser coverage).

## What's next

- [Project Structure](project-structure.md) — what lives where in the repo.
- [Coding Conventions](coding-conventions.md) — the rules every PR must follow.
- [Testing](testing.md) — the four test layers in detail.
- [Contributing](contributing.md) — branch model, PR checklist, CI gates.
