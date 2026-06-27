# Project Structure

Osler V2 is a monorepo with three independently buildable components: the PWA
(web app), the Tauri admin dashboard, and the docs site. This page describes
what lives where.

## Top-level layout

```
osler/
├── src/                  # PWA source (vanilla JS + esbuild)
│   ├── lib/              # Shared modules (21 files — see below)
│   ├── css/              # Extracted engine stylesheets
│   ├── schemas/          # JSON Schema for all 6 content types + _meta.json
│   ├── i18n/             # EN/AR string bundles (V2)
│   └── build.js          # esbuild bundler script
├── engines/              # 9 quiz engines (entry points, one per engine)
├── content/              # Admin-managed content (JSON)
├── tauri-admin/          # Tauri v2 desktop admin app (Rust)
│   ├── src/              # 15 Rust modules — see below
│   ├── frontend/         # Admin UI (HTML + vanilla JS, served by Tauri)
│   ├── capabilities/     # Tauri v2 capability files
│   ├── icons/            # App icons
│   ├── gen/              # Tauri-generated scaffolding (don't edit)
│   ├── tests/            # Rust integration tests
│   ├── Cargo.toml        # Rust dependencies
│   ├── Cargo.lock        # Pinned Rust dependency versions
│   └── tauri.conf.json   # Tauri config (CSP, updater, bundle)
├── scripts/              # Build utilities, validators, PDF generators
├── tests/                # JS test suites (unit, integration, e2e)
├── docs/                 # This documentation set (mkdocs-material)
├── dist/                 # Build output (gitignored)
├── .github/workflows/    # CI pipelines (ci.yml)
├── .agents/              # LLM agent context (skills, scratch)
├── v1-osler-plan-enhanced.md     # V1 plan (Phases 0-8, shipped)
├── v2-osler-plan-enhanced.md     # V2 plan (Phases 9-16, in progress)
├── v2-llm-execution-guide.md     # Per-session execution steps for LLM agents
├── llm-execution-guide.md        # V1 LLM execution guide
├── AGENTS.md             # V1 agent reference (read before touching files)
├── SECURITY.md           # V1 security model (extended by V2)
├── README.md             # Project overview
├── PATCH_NOTES.md        # Patch history
├── package.json          # Node dependencies + scripts
├── package-lock.json     # Pinned Node dependency versions
├── vitest.config.js      # Vitest configuration
├── playwright.config.js  # Playwright configuration
├── manifest.webmanifest  # PWA manifest
├── sw.js                 # Service worker (caching, update flow)
├── tracker-map.json      # Tracker store name map
├── update-manifest.json  # Current bundle hash + engine list
└── .env.example          # Firebase env var template
```

## `src/lib/` — shared modules

The `src/lib/` directory contains 21 modules imported by every engine via the
`engines/engine-shared.js` bridge. Each module has a single responsibility:

| Module | Responsibility |
|--------|---------------|
| `analytics.js` | V20 analytics taxonomy — `track(event, props)` validates and sends to Firebase Analytics |
| `anki.js` | Anki CSV import/export (deck conversion to/from Osler format) |
| `auth.js` | Firebase auth — guest → Google → GitHub, account linking, sign-out |
| `content-gen.js` | 3-stage Gemini AI content generation pipeline (Flash-Lite outline → Flash-Lite extract → Pro convert) |
| `content-loader.js` | Fetches and caches content JSON files; handles offline fallback |
| `dom.js` | DOM helpers — `$`, `$$`, `create`, event delegation |
| `firebase.js` | Firebase app initialization — Auth + Firestore + Storage + Analytics |
| `gemini.js` | Gemini API client — handles cost caps, retries, error mapping |
| `icons.js` | SVG icon library (inline icons, no external icon font) |
| `install-prompt.js` | PWA install prompt handler (beforeinstallprompt event) |
| `keyboard.js` | Keyboard shortcut registration + a11y helpers |
| `migration.js` | V0 → V1 storage migration (one-time, idempotent) |
| `quota.js` | IndexedDB quota management — estimates usage, warns near limit |
| `sm2.js` | SM-2 spaced repetition algorithm — schedule, review, interval calculation |
| `storage.js` | IndexedDB wrapper — `STORES` config array, `STORE_NAMES` frozen map, per-type tracker tables |
| `sync-utils.js` | Single source of truth for `getDeviceId()` — do not duplicate |
| `sync.js` | Firestore sync — 5 merge strategies, conflict resolution, retry logic |
| `theme.js` | Light/dark/system theme toggle, persists to localStorage |
| `toast.js` | Toast notifications (a11y: aria-live, role=status) |
| `tracker.js` | Per-type tracker (quiz/bank/flashcard/written/osce) — record outcome, query history |
| `ui.js` | Shared UI primitives — buttons, modals, dropdowns, progress bars |
| `validate.js` | JSON Schema validation against `src/schemas/` — V19 policy: `meta.schemaVersion` must be known |

Engines should access these via the bridge (`window.OslerTracker`,
`window.OslerAnalytics`, etc.) rather than importing the lib directly. This
keeps the engine bundles small and ensures a single source of truth.

## `engines/` — the 9 engines

Each engine is a self-contained JS entry point that gets bundled by esbuild
into `dist/{name}.js`. The 9 engines:

| Engine | Purpose |
|--------|---------|
| `quiz-engine.js` | Timed multiple-choice quiz with instant feedback |
| `bank-engine.js` | Untimed question bank for review (no scoring) |
| `flashcard-engine.js` | SM-2 spaced repetition flashcards (Anki-style) |
| `written-engine.js` | Free-text written assessment with self-rating |
| `osce-engine.js` | OSCE clinical simulation (case + checklist) |
| `index-engine.js` | Hub — landing page listing all available content |
| `search-engine.js` | Cross-content search (full-text over all engines) |
| `ai-assistant-engine.js` | V1 AI assistant modal (precursor to V2 tutor) |
| `uworld-engine.js` | UWorld-style exam simulator (timed blocks) |

V2 generator wizard lets the admin pick any subset of these 5 study engines
(quiz, bank, flashcard, written, osce). The hub, search, and AI assistant are
always bundled; uworld is opt-in.

## `tauri-admin/src/` — Rust modules

The Tauri admin dashboard is a Rust binary with 15 modules:

| Module | Responsibility |
|--------|---------------|
| `main.rs` | Binary entry point |
| `lib.rs` | Tauri app builder, command registration |
| `commands.rs` | Tauri command handlers (exposed to frontend via `invoke`) |
| `auth.rs` | GitHub OAuth Device Flow |
| `git.rs` | GitHub API client (CMS operations, bundle pushes) |
| `deploy.rs` | Provider deploy orchestration (calls provider modules) |
| `bundle_engines.rs` | Engine bundler — assembles a site bundle from chosen engines + content |
| `push_update.rs` | Tier 2 update push — computes hash, signs, pushes to instance repos |
| `updater.rs` | Tier 1 self-update — checks GitHub releases, downloads, verifies, swaps |
| `validation.rs` | JSON Schema validation (mirrors `src/lib/validate.js` in Rust) |
| `parser.rs` | Content pack parser (import flow) |
| `pdf.rs` | PDF export (uses `scripts/pdf_generator.py` via subprocess) |
| `server.rs` | Local preview HTTP server (tiny_http on localhost:5500) |
| `templates.rs` | Provider config file templates (netlify.toml, vercel.json, etc.) |
| `mcp_server.rs` | MCP server (optional, for AI-assisted admin operations) |
| `analytics.rs` | Firebase Analytics REST client (service account) |

V2 will add `providers/` subdirectory with one file per provider
(`github_pages.rs`, `netlify.rs`, `vercel.rs`, `cloudflare.rs`).

## `tests/` — JS test suites

```
tests/
├── setup.js                  # Vitest setup (fake-indexeddb, happy-dom)
├── unit/
│   ├── lib/                  # one .test.js per src/lib/ module
│   │   ├── anki.test.js
│   │   ├── auth.test.js
│   │   ├── content-gen.test.js
│   │   ├── quota.test.js
│   │   ├── sm2.test.js
│   │   ├── storage.test.js
│   │   ├── theme.test.js
│   │   ├── tracker.test.js
│   │   ├── ui.test.js
│   │   └── validate.test.js
│   └── sync/                 # sync-specific tests
│       ├── field-merge.test.js
│       ├── migration.test.js
│       └── sm2-merge.test.js
├── integration/
│   ├── storage.test.js       # IndexedDB end-to-end
│   └── sync-adapter.test.js  # Firestore sync with mock backend
├── e2e/                      # Playwright specs
│   ├── anki-csv.spec.js
│   ├── bank-session.spec.js
│   ├── content-gen.spec.js
│   ├── firebase-auth.spec.js
│   ├── flashcard-study.spec.js
│   ├── github-cms.spec.js
│   ├── osce-simulation.spec.js
│   ├── player.spec.js
│   ├── quiz-session.spec.js
│   ├── update-bundle.spec.js
│   ├── update-push.spec.js
│   └── written-assessment.spec.js
└── fixtures/
    └── sample-quiz.json      # shared test fixture
```

## `scripts/` — build utilities

| Script | Purpose |
|--------|---------|
| `validate-content.js` | Runs `ajv` against every file in `content/` using `src/schemas/` |
| `validate-schemas.js` | Validates that the schema files themselves are well-formed JSON Schema |
| `export-schemas.js` | Exports schemas to `dist/schemas/` for runtime use |
| `add-type-button.js` | Adds a "type" button to the admin dashboard (utility) |
| `apply-css-tokens.js` | Applies CSS design tokens (colors, spacing) to all engine stylesheets |
| `standardize_quiz_files.js` | Migrates legacy quiz JSON to current schema (one-time) |
| `sync_quiz_assets.js` | Syncs quiz assets (images, audio references) to the content repo |
| `pdf_generator.py` | Python PDF generator (uses ReportLab) — invoked by Tauri admin's `pdf.rs` |
| `pdf_generator_pyodide.py` | Pyodide-in-browser version of the PDF generator (for PWA) |
| `ensure_pdf_deps.py` | Ensures ReportLab + font deps are installed |
| `download_pdf_fonts.py` | Downloads Noto Sans/Serif SC fonts for PDF generation |

## What's next

- [Coding Conventions](coding-conventions.md) — the rules every PR must follow.
- [API Reference → Lib Modules](../api-reference/lib-modules.md) — per-module
  API documentation.
- [Admin Dashboard → Installation](../admin-dashboard/installation.md) —
  building the Tauri admin from source.
