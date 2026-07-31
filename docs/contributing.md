# Contributing to Osler

Thanks for your interest in contributing to Osler — a unified medical study platform (Quiz Banks, Flashcards, OSCE, Videos, Article Library) with full Arabic RTL support. This guide walks you through everything you need to make a successful contribution: setting up a dev environment, understanding the conventions, opening a PR, and getting it merged.

Osler is fully open-source (MIT) and built for self-hosting by medical schools, residency programs, study groups, and individual educators. Every contribution — bug reports, feature requests, docs, code, content packs, translations — is welcome.

> **Source repository:** <https://github.com/eyad-elghareeb/osler>
> **License:** MIT — see [LICENSE](../LICENSE).
> **Related guides:** [`forking.md`](./forking.md) · [`hosting.md`](./hosting.md) · [`deployment.md`](./deployment.md) · [`tauri-admin.md`](./tauri-admin.md) · [`security.md`](./security.md)

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Ways to contribute](#2-ways-to-contribute)
3. [Development setup](#3-development-setup)
4. [Project structure overview](#4-project-structure-overview)
5. [Coding conventions](#5-coding-conventions)
6. [Git workflow](#6-git-workflow)
7. [Adding new content packs](#7-adding-new-content-packs)
8. [Adding new engine plugins](#8-adding-new-engine-plugins)
9. [Adding new i18n strings](#9-adding-new-i18n-strings)
10. [Adding new admin endpoints](#10-adding-new-admin-endpoints)
11. [Testing](#11-testing)
12. [Releasing](#12-releasing)
13. [Security disclosures](#13-security-disclosures)
14. [Recognition](#14-recognition)

---

## 1. Code of Conduct

By participating in this project, you agree to abide by the [Contributor Covenant Code of Conduct v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). The short version: be kind, be constructive, assume good intent, and remember that the people on the other side of an issue or PR are volunteers.

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the maintainers at <security@osler.example> (placeholder — see the repo's `CODE_OF_CONDUCT.md` if present, or open a private issue). All reports will be reviewed and investigated promptly and fairly.

> **Our commitment:** Osler is built for medical educators and students worldwide, including those in regions where Arabic is the primary language of medical education. We explicitly welcome contributors from those communities and are committed to reviewing PRs that improve Arabic-language support.

---

## 2. Ways to contribute

You don't need to write code to contribute. Here are the main ways to help:

| Type | How | Effort | Impact |
|---|---|---|---|
| **Bug report** | Open an issue with reproduction steps, browser, OS, screenshots | Low | High — helps maintainers reproduce and fix |
| **Feature request** | Open an issue with the use case, not just the solution | Low | Medium — drives roadmap |
| **Documentation** | Edit `.md` files in `docs/` or the root; submit a PR | Low | High — outpaces every other contribution type |
| **Content pack** | Add a quiz / flashcard / OSCE / article / video pack to `public/osler-content/` | Medium | High — directly grows the platform's value |
| **Translation** | Add new strings to `src/lib/osler/i18n/en.ts` and `ar.ts` | Medium | High — Arabic coverage is a first-class goal |
| **Code fix** | Fix a bug — start with an issue, then a PR | Medium | High |
| **Code feature** | Build a new engine / view / native integration | High | High — but talk to us first (see §6) |
| **Design polish** | Migrate hand-rolled Tailwind to design-system primitives | Medium | Medium — keeps the codebase clean |
| **Triage** | Help label issues, reproduce bugs, close duplicates | Low | High — keeps the issue tracker navigable |

### Before you start

For anything beyond a typo or one-line fix, **open an issue first**. This avoids wasted work on a PR that won't be accepted because it duplicates existing work, conflicts with the roadmap, or violates a constraint documented in [`AGENTS.md`](../AGENTS.md). Maintainers will respond within a few days to confirm direction.

---

## 3. Development setup

### Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 22 (LTS) | Pinned via `.nvmrc` |
| **npm** | 10+ | Ships with Node 22 |
| **Git** | 2.30+ | For cloning, branching, committing |
| **A modern browser** | Chrome / Edge / Firefox / Safari | For dev + DevTools |
| **VS Code** (recommended) | Latest | With extensions (see below) |

Optional but useful:

- **Rust toolchain** (1.77+) — only if you'll touch the Tauri admin (`tauri-admin/`)
- **Tauri CLI** — only if you'll touch the admin (`cargo install tauri-cli`)
- **`wrangler` CLI** — only if you'll touch the Cloudflare Worker (`npm i -g wrangler`)

### Fork and clone

See [`forking.md`](./forking.md) for the detailed workflow. The short version:

```bash
# 1. Fork on GitHub via the web UI

# 2. Clone your fork and add upstream
git clone https://github.com/<your-username>/osler.git
cd osler
git remote add upstream https://github.com/eyad-elghareeb/osler.git
git remote -v
# origin    https://github.com/<your-username>/osler.git (fetch)
# upstream  https://github.com/eyad-elghareeb/osler.git (fetch)
```

### Install and run

```bash
nvm use                 # uses Node 22 from .nvmrc
npm install
npm run generate-manifests   # build content manifests from public/osler-content/
npm run dev             # → http://localhost:3000

# Optional: start the Cloudflare Worker backend too
npm run dev:full        # frontend + worker concurrently
npm run dev:worker      # worker only on http://localhost:8787
```

The first `npm install` takes ~60 seconds. The first `npm run dev` takes ~30 seconds to compile and then hot-reloads on every save.

### Verify your setup

```bash
npm run lint            # should report no errors
npx tsc --noEmit        # should pass (TypeScript strict mode)
npm run build           # should complete without errors
```

If any of these fail, your Node version is likely wrong — recheck `node -v` against `.nvmrc`.

### Recommended VS Code extensions

Install these from the VS Code marketplace (or run `code --install-extension <id>`):

| Extension | ID | Why |
|---|---|---|
| **ESLint** | `dbaeumer.vscode-eslint` | Inline lint feedback |
| **Tailwind CSS IntelliSense** | `bradlc.vscode-tailwindcss` | Autocomplete for Tailwind classes, color previews |
| **TypeScript Vue Plugin (Volar)** — not needed, this is React | — | — |
| **Path Intellisense** | `christian-kohler.path-intellisense` | Helps with `@/` path aliases |
| **Better Comments** | `aaron-bond.better-comments` | Highlights `* ! ? // TODO` in different colors |
| **Markdown All in One** | `yzhang.markdown-all-in-one` | For editing docs |
| **Prettier - Code formatter** | `esbenp.prettier-vscode` | Optional — Osler doesn't ship a `.prettierrc` but most contributors use it |
| **GitHub Pull Requests** | `GitHub.vscode-pull-request-github` | Review PRs from VS Code |
| **Error Lens** | `usernamehw.errorlens` | Shows errors inline next to the line |
| **Console Ninja** | `wallabyjs.console-ninja` | Optional — inline `console.log` output in the editor |

Recommended VS Code settings (`.vscode/settings.json` in your fork):

```jsonc
{
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "eslint.workingDirectories": [{ "mode": "auto" }],
  "typescript.tsdk": "node_modules/typescript/lib",
  "tailwindCSS.experimental.classRegex": [
    ["cn\\(([^)]*)\\)", "'([^']*)'"]
  ],
  "files.associations": { "*.css": "tailwindcss" }
}
```

### Optional: Tauri admin dev setup

If you'll touch the Tauri admin (`tauri-admin/`), additionally:

```bash
# Install Rust via rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install Tauri system deps (Linux)
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Or macOS:
xcode-select --install

# Run the admin
cd tauri-admin
cargo tauri dev    # first compile is 3–5 minutes; subsequent runs are <30s
```

See [`tauri-admin.md`](./tauri-admin.md) for the full admin guide.

---

## 4. Project structure overview

A high-level map of the repo. Linked files are the canonical entry points — read them before contributing to that area.

```
osler/
├── src/
│   ├── app/                      ← Next.js App Router (single route)
│   │   ├── layout.tsx            ← Root layout — fonts, theme provider, i18n provider
│   │   ├── page.tsx              ← View router — syncs OslerView with URL query params
│   │   ├── globals.css           ← Design tokens (@theme inline) + utility classes
│   │   └── sw.ts                 ← Service worker (Serwist) — precache + runtime cache
│   ├── components/
│   │   ├── osler/                ← App-specific components (the bulk of the codebase)
│   │   │   ├── app-shell.tsx     ← Top bar + nav + view routing
│   │   │   ├── mobile-tab-bar.tsx ← Bottom nav for <768px
│   │   │   ├── dashboard.tsx     ← Home view
│   │   │   ├── learn.tsx         ← Hub: Library / Flashcards / OSCE / Videos
│   │   │   ├── qbank-studio.tsx  ← Unified quiz engine (~6190 lines)
│   │   │   ├── flashcard-studio.tsx
│   │   │   ├── osce-studio.tsx
│   │   │   ├── videos-studio.tsx
│   │   │   ├── library.tsx
│   │   │   ├── pdf-export-dialog.tsx  ← PDF export customization modal
│   │   │   ├── ui-primitives.tsx ← PageHeader / StatTile / OslerCard / EmptyState / LoadingState
│   │   │   ├── theme-provider.tsx
│   │   │   ├── i18n-provider.tsx ← useI18n() hook + RTL context
│   │   │   └── ...               ← Many more (notes, AI assistant, calculator, lab-values, sync)
│   │   └── ui/                   ← 49 shadcn/ui primitives — do NOT add custom logic here
│   ├── hooks/                    ← Shared React hooks
│   │   ├── use-content-tree.ts   ← Content loading + tree queries
│   │   ├── use-content-cache.ts  ← Per-pack precaching for offline use
│   │   ├── use-native.ts         ← useNetworkInfo / useBiometricAvailability / useDocumentVisibility
│   │   ├── use-shortcuts.ts      ← Keyboard shortcut system
│   │   ├── use-article-highlighter.ts
│   │   ├── use-gestures.ts
│   │   └── ...
│   └── lib/
│       ├── utils.ts              ← cn() helper
│       └── osler/                ← Business logic
│           ├── types.ts          ← All content + config schemas (single source of truth)
│           ├── config.ts         ← osler.config.json schema + loader + DEFAULT_CONFIG
│           ├── content.ts        ← Manifest loader + ENGINE_META + tree utilities
│           ├── articles.ts       ← Markdown article loader (unified/remark/rehype)
│           ├── videos.ts
│           ├── storage.ts        ← IndexedDB-backed reactive store (singleton)
│           ├── i18n.ts           ← UI dictionary (en + ar) — EVERY new key in BOTH
│           ├── shortcuts.ts
│           ├── grading.ts        ← Gemini answer grading + photo OCR
│           ├── pdf.ts            ← jsPDF export engine (uses arabic.ts + pdf-fonts.ts)
│           ├── arabic.ts         ← BiDi reordering + letter shaping for PDF
│           ├── pdf-fonts.ts      ← Embedded Poppins / Lora / Cairo fonts
│           ├── cloud/            ← Cloudflare Worker client (accounts, sync, admin)
│           ├── sync/             ← P2P sync (WebRTC + MQTT + QR + file)
│           └── native/           ← PWA native wrappers (haptics, VT, biometric, network, wake-lock)
├── public/
│   ├── osler.config.json         ← Single source of truth for instance config
│   ├── osler-content/            ← Folder-based content
│   │   ├── qbank/                ← quiz / bank / written (JSON)
│   │   ├── flashcard/            ← JSON
│   │   ├── osce/                 ← JSON
│   │   ├── library/              ← Markdown + YAML frontmatter
│   │   └── videos/               ← JSON
│   ├── assets/                   ← Favicons, PWA icons, brand SVGs
│   └── manifest.webmanifest
├── cloudflare/
│   └── worker/                   ← Cloudflare Worker backend (D1 + R2)
│       ├── src/index.ts         ← Worker entry: routes, auth, admin endpoints
│       ├── migrations/           ← D1 SQL migrations (forward-only, never edit existing)
│       ├── wrangler.toml         ← Cloudflare config
│       └── package.json
├── scripts/
│   ├── generate-content-manifests.js  ← npm run generate-manifests
│   ├── generate-articles.js
│   ├── build-deliverable.sh      ← Linux zip-packaging helper
│   └── build-deliverable.ps1     ← Windows equivalent
├── tauri-admin/                  ← Tauri 2 desktop admin app (Rust + HTML/JS)
│   ├── src/                      ← Rust backend
│   ├── frontend/                 ← Plain HTML/JS frontend
│   └── capabilities/default.json ← Tauri permissions
├── docs/                         ← This file + sibling guides
├── AGENTS.md                     ← Coding conventions + design system (READ THIS)
├── SELF-HOSTING.md               ← User-facing self-hosting guide
├── README.md                     ← Project overview
├── CHANGELOG.md                  ← Release notes
├── Caddyfile                     ← Sample reverse-proxy config for self-hosted
├── .nvmrc                        ← Node version pin (22)
├── .env.example                  ← Environment variable template
└── package.json
```

### Where to start reading

| If you want to… | Read this first |
|---|---|
| Add a new view | [`AGENTS.md`](../AGENTS.md) → "Adding a new view" |
| Add a new engine | [`AGENTS.md`](../AGENTS.md) → "Adding a new engine plugin" + §8 of this file |
| Add a content pack | §7 of this file |
| Add an i18n string | §9 of this file |
| Add an admin endpoint | §10 of this file |
| Add a native-feature integration | [`AGENTS.md`](../AGENTS.md) → "Native app feel" |
| Touch the design system | [`AGENTS.md`](../AGENTS.md) → "Design System" |
| Touch the Tauri admin | [`tauri-admin.md`](./tauri-admin.md) |
| Touch the Cloudflare Worker | [`cloudflare-backend.md`](./cloudflare-backend.md) |
| Deploy a fork | [`deployment.md`](./deployment.md) |

---

## 5. Coding conventions

These conventions are extracted from [`AGENTS.md`](../AGENTS.md) — read the full document for the authoritative version. This section is a quick reference.

### TypeScript

- **Strict mode** is on, but `noImplicitAny: false` (so untyped function params are allowed, though discouraged).
- **No `any` without justification.** If you must use `any`, add a `// why:` comment explaining why a proper type won't work. `unknown` is almost always what you actually want.
- **Named exports only.** Never `export default`. Import with destructured named imports: `import { Foo } from "@/components/Foo"`.
- **Use `@/` path aliases.** Never relative imports like `../../components/`. Use `@/components/osler/...`, `@/lib/osler/...`, `@/hooks/...`.
- **All content schemas live in `@/lib/osler/types.ts`.** Never define content types elsewhere. The 7 engine types are `quiz | bank | flashcard | written | osce | library | video`.
- **Engine metadata comes from `ENGINE_META` in `@/lib/osler/content.ts`.** Never hardcode engine labels, colors, or icons. Use `getEngineMeta(type)` to pick up user overrides from `osler.config.json`.

### File header comments

Every new file in `src/` or `tauri-admin/` must start with a short header comment explaining its purpose. One to three lines is fine. Example:

```ts
/**
 * QBank results dashboard — renders score, percentile, distribution chart,
 * per-question review, and PDF export entry point.
 * Fed by the active session in `storage`; persists results to IndexedDB.
 */
"use client";

import { motion } from "framer-motion";
// ...
```

### Naming

| Type | Convention | Example |
|---|---|---|
| **Variables / functions** | camelCase | `const userName = ...`, `function loadQuiz() {}` |
| **React components** | PascalCase | `function QBankStudio() {}`, `export function StatTile() {}` |
| **TypeScript types / interfaces** | PascalCase | `type QuizQuestion = ...`, `interface ContentMeta {}` |
| **TypeScript enums / unions** | PascalCase | `type EngineType = "quiz" \| "bank" \| ...` |
| **Constants (module-level)** | SCREAMING_SNAKE_CASE | `const ENGINE_META = ...`, `const LEARN_SUBVIEWS = new Set(...)` |
| **CSS classes** | kebab-case with `.osler-` prefix | `.osler-page`, `.osler-card--default` |
| **File names — components** | kebab-case matching the component name | `qbank-studio.tsx` exports `QBankStudio` |
| **File names — non-components** | kebab-case | `use-content-tree.ts`, `pdf-export-dialog.tsx` |
| **File names — utilities / libs** | kebab-case | `arabic.ts`, `pdf-fonts.ts` |
| **File names — content packs** | kebab-case folder, `questions.json` / `passages.json` / `prompts.json` / `cards.json` | `cardiology/arrhythmias/questions.json` |
| **i18n keys** | dot-delimited, lowercase | `t("qbank.results.title")` |
| **Git branches** | `feat/` · `fix/` · `docs/` · `refactor/` · `chore/` prefix | `feat/pdf-export` |
| **Commit messages** | Conventional Commits (see §6) | `feat(qbank): add PDF export dialog` |

### Styling with Tailwind

- Use **semantic design tokens** (`bg-background`, `text-primary`, `border-border`, `text-success`, `text-warning`, `text-destructive`, `text-info`).
- **Never** use Tailwind palette colors directly (`text-emerald-500`, `bg-amber-500/15`, etc.). The cleanup backlog documents the existing drift; don't add more.
- Use `cn()` from `@/lib/utils` for className merging — never raw template literals.
- Use shadcn/ui primitives (`@/components/ui/*`) for dialogs, dropdowns, popovers, tabs — never re-implement.
- Use the Osler primitives (`@/components/osler/ui-primitives.tsx`: `PageHeader`, `SectionHeading`, `StatTile`, `EmptyState`, `LoadingState`, `OslerCard`, `InteractiveCard`) for canonical patterns.

### The i18n rule (critical)

> **Every new English string must land alongside its Arabic translation in the same commit.**

This is the single most-enforced rule in the codebase. A PR with a new `t("foo.bar")` call but no corresponding `ar` entry will be **blocked**, not "TODO"ed.

Concretely:

1. You add `t("qbank.export.title")` to a component.
2. You add the same key to **both** `en` and `ar` blocks in `src/lib/osler/i18n.ts`:

```ts
export const i18n = {
  en: {
    // …
    "qbank.export.title": "Export PDF",
    "qbank.export.description": "Customize the PDF export options",
  },
  ar: {
    // …
    "qbank.export.title": "تصدير PDF",
    "qbank.export.description": "خصّص خيارات تصدير PDF",
  },
};
```

3. Both keys ship in the same commit.

If you don't speak Arabic, machine translation (Google Translate / DeepL / ChatGPT) is acceptable as a first pass — flag it in the PR description with `Needs Arabic review` and a maintainer or community member will refine.

### Native-feel features

Every interactive surface must:

- Fire `haptic()` from `@/lib/osler/native/haptics` on the primary action (button press, form submit, tab switch). Pick the right pattern: `selection` for nav, `light` for taps, `success`/`error`/`warning` for outcomes.
- Wrap view-level navigation in `withViewTransition()` so the slide transition kicks in.
- Honor `prefers-reduced-motion` — the haptics + VT libs already do this; don't add motion that ignores the OS preference.
- Use safe-area utilities (`.safe-pt`, `.safe-pb`, `.safe-screen`) for any full-screen overlay so content never sits under the notch.

### Testing approach

There is currently **no automated test framework** configured (no Jest, Vitest, Playwright). This is intentional — the project is small enough that manual verification + Lighthouse + TypeScript strict mode catches most regressions. See §11 for the manual test checklist.

If you want to add a test framework, **open an issue first** — we'd love to discuss the strategy (Vitest for unit, Playwright for E2E) before you do the work.

---

## 6. Git workflow

### Branch naming

Always use a prefix that matches the change type:

| Prefix | Use for | Example |
|---|---|---|
| `feat/` | New feature or enhancement | `feat/pdf-export-dialog` |
| `fix/` | Bug fix | `fix/qbank-timer-pause-on-blur` |
| `docs/` | Documentation only | `docs/deployment-runbook` |
| `refactor/` | Code restructuring with no behavior change | `refactor/extract-stat-tile-primitive` |
| `chore/` | Tooling, deps, build config | `chore/upgrade-next-16-1` |
| `perf/` | Performance improvement | `perf/lazy-load-pdf-fonts` |
| `i18n/` | Translation additions / fixes | `i18n/ar-qbank-results` |
| `content/` | New content pack(s) | `content/cardiology-arrhythmias` |
| `security/` | Security fix (consider private disclosure first — see §13) | `security/fix-xss-in-notes` |

```bash
# From your fork's main (synced with upstream):
git checkout -b feat/pdf-export-dialog
```

### Commit message format — Conventional Commits

Osler follows [Conventional Commits](https://www.conventionalcommits.org/) for commit messages. This enables automatic changelog generation and semver bumps.

```
<type>(<scope>): <short imperative summary>

<body explaining what changed and why>

<footer>
```

| Field | Required | Rules |
|---|---|---|
| `type` | Yes | One of `feat`, `fix`, `docs`, `refactor`, `chore`, `perf`, `test`, `style`, `i18n`, `content`, `security` |
| `scope` | Optional | One word, lowercase — the area touched (e.g. `qbank`, `flashcards`, `osce`, `library`, `videos`, `pdf`, `i18n`, `worker`, `admin`, `config`, `docs`) |
| `summary` | Yes | Imperative mood ("add", "fix", "remove"), ≤72 chars, lowercase first letter, no trailing period |
| `body` | Recommended | Wrap at ~80 chars. Explain **why**, not just **what** — the diff already shows what. |
| `footer` | Optional | `BREAKING CHANGE: <description>` for breaking changes, or `Closes #123` / `Refs #123` for issue links |

Examples:

```
feat(pdf): add customization dialog for PDF export

Adds a modal that lets users pick page size (A4/Letter), single or
two-column layout, score summary, and detailed review toggles before
exporting a QBank test paper. Uses the existing jsPDF engine; no new
deps.

Closes #42
```

```
fix(qbank): pause timer when document loses visibility

The quiz timer kept running when a student switched tabs or locked
their phone, leading to unfair time penalties. Now useDocumentVisibility
pauses the timer on `visibilitychange` and resumes on return, matching
UWorld's behavior.
```

```
refactor(dashboard): migrate hand-rolled stat tiles to StatTile primitive

Removes ~80 lines of duplicated Tailwind across three dashboard cards.
Behavior identical; visual diff is a 1px padding adjustment on the
"correct" tile.

Part of the cleanup backlog in AGENTS.md.
```

```
chore(deps): bump framer-motion from 11.0.0 to 11.3.0

No behavior change. Release notes: https://github.com/framer/motion/releases/tag/v11.3.0
```

**Anti-rules:**

- ❌ Do NOT reference the AI agent or include "Generated with" / "Co-Authored-By: Claude" / similar lines.
- ❌ Do NOT use `git commit -m "fix"` or other one-word messages.
- ❌ Do NOT include the word "update" without context — `chore: update deps` is bad; `chore(deps): bump framer-motion to 11.3.0` is good.
- ❌ Do NOT mix unrelated changes in one commit. One logical change = one commit.

### Staging commits

- `git add <specific files>` — **never** `git add -A` or `git add .`. Be explicit so unrelated files don't sneak in.
- Build + lint must pass before committing. If `npx tsc --noEmit` or `npx eslint <files>` fails, fix it first — never commit broken code.
- After committing, run `git status` to confirm the tree is clean before moving to the next task.

### Pull request workflow

1. **Push your branch** to your fork:
   ```bash
   git push -u origin feat/pdf-export-dialog
   ```
2. **Open a PR** against `upstream/main` (i.e. `eyad-elghareeb/osler:main`). GitHub will prompt you after the push.
3. **Fill in the PR template** (see below).
4. **Wait for CI** (if any) to pass. There's no test framework, but `npm run lint` and `npm run build` may run via GitHub Actions.
5. **Respond to review feedback** with new commits (don't force-push unless asked — it makes review harder).
6. **Squash-merge** is the default — the maintainer will squash your branch into one commit on merge, so the Conventional Commit message you wrote in your first commit becomes the merged commit's message. If you have multiple commits with different types (e.g. a `feat` then a `fix` for the same PR), call out which one should be the squashed message in the PR description.

### PR template

When you open a PR, the template below will auto-fill (if your repo has `.github/PULL_REQUEST_TEMPLATE.md`). If not, paste this manually:

```markdown
## What does this PR do?

<!-- 1–3 sentences, plain language. Link the issue if applicable. -->

Closes #

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Content pack addition
- [ ] Refactor (no behavior change)
- [ ] i18n string addition (both en + ar in same commit)
- [ ] Other (please describe):

## Checklist

- [ ] My code follows the conventions in `AGENTS.md` (no `any`, named exports, `@/` aliases, `cn()` for classes)
- [ ] I added a header comment to any new file
- [ ] I added i18n keys to **both** `en` and `ar` in the same commit (or my change has no user-facing strings)
- [ ] I wired `haptic()` + `withViewTransition()` into any new interactive surface
- [ ] I used design-system primitives (`PageHeader`, `StatTile`, `OslerCard`, etc.) instead of hand-rolled Tailwind
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] I regenerated content manifests if I added/removed content (`npm run generate-manifests`)
- [ ] I updated `CHANGELOG.md` (if applicable)
- [ ] I tested the change manually in both dark and light themes
- [ ] I tested the change with the UI language set to Arabic (RTL)

## Screenshots / recordings

<!-- For UI changes, paste a screenshot or Loom recording in both LTR and RTL. -->

## Notes for the reviewer

<!-- Anything they should pay extra attention to? Any hacks or TODOs you'd like to flag? -->
```

### Review process

- **Response time:** Maintainers aim to respond within 5 business days. If you haven't heard back, ping with a polite comment.
- **Reviewers look for:** adherence to `AGENTS.md`, i18n correctness, design-system usage, no `any` types, no security issues, no breaking changes without a major version bump.
- **Approval:** One maintainer approval is required for non-breaking changes. Two approvals (or maintainer consensus) are required for breaking changes.
- **After merge:** Delete your branch (GitHub does this automatically if configured). Sync your fork with upstream for the next PR.

---

## 7. Adding new content packs

Osler's content is folder-based. Adding a new content pack is the most common way to contribute — no code required.

### Folder structure

```
public/osler-content/
├── qbank/                 ← quiz / bank / written (JSON; type auto-detected from file keys)
│   ├── cardiology/
│   │   ├── arrhythmias/
│   │   │   ├── questions.json       ← "quiz" (has `questions` key)
│   │   │   ├── passages.json        ← "bank" (has `passages` key)
│   │   │   ├── prompts.json         ← "written" (has `prompts` key)
│   │   │   └── images/              ← optional: images referenced by relative path
│   │   └── ...
│   └── ...
├── flashcard/             ← all JSON files here are auto-type "flashcard"
│   └── pharmacology/
│       ├── antibacterials/
│       │   ├── cards.json
│       │   └── images/
├── osce/                  ← all JSON files here are auto-type "osce"
├── library/               ← Markdown (.md) with YAML frontmatter
│   └── cardiology/
│       ├── aortic-stenosis.md
│       ├── images/
│       └── ...
└── videos/                ← all JSON files here are auto-type "video"
```

### Folder-name-as-title rule

The folder name is title-cased for display. `arrhythmias/` becomes "Arrhythmias"; `anti-arrhythmic-drugs/` becomes "Anti Arrhythmic Drugs" (hyphens become spaces). Use kebab-case folder names.

### JSON schema

Each content type has a schema defined in `src/lib/osler/types.ts`. The schemas are validated by `npm run validate-content` (or by the Tauri admin's "Validate" button). The short version:

#### Quiz (`questions.json`)

```jsonc
{
  "meta": { "uid": "quiz-arrhythmias", "title": "Arrhythmias", "lang": "en" },
  "type": "quiz",
  "questions": [
    {
      "id": "card-arr-001",
      "question": "A 68-year-old male presents with syncope…",
      "options": ["A. ...", "B. ...", "C. ...", "D. ...", "E. ..."],
      "correct": 2,                 // 0-indexed; here, option index 2
      "explanation": "The ECG shows…",
      "tags": ["cardiology", "arrhythmia", "ecg"],
      "images": [{ "src": "ecg-strip.png", "alt": "ECG rhythm strip" }]  // optional; resolves against pack's images/ subfolder
    }
  ]
}
```

#### Bank (`passages.json`)

```jsonc
{
  "meta": { "uid": "bank-cardiology", "title": "Cardiology Bank", "lang": "en" },
  "type": "bank",
  "passages": [
    {
      "id": "pass-001",
      "content": "A 55-year-old woman with a history of…",
      "questions": [
        {
          "id": "pass-001-q1",
          "passageId": "pass-001",
          "question": "Which of the following is the most likely diagnosis?",
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
          "correct": 0,
          "explanation": "The patient exhibits classic findings..."
        }
      ]
    }
  ]
}
```

#### Written (`prompts.json`)

```jsonc
{
  "meta": { "uid": "written-cardiology", "title": "Cardiology Written Prompts", "lang": "en" },
  "type": "written",
  "prompts": [
    {
      "id": "writ-001",
      "prompt": "Describe the management of acute decompensated heart failure.",
      "rubric": ["Identifies immediate stabilization (oxygen, IV diuretics)", "Mentions vasodilators if hypertensive"],
      "modelAnswer": "Initial stabilization involves positioning the patient upright, administering oxygen if hypoxic...",
      "wordLimit": 500
    }
  ]
}
```

#### Flashcard (`cards.json`)

```jsonc
{
  "meta": { "uid": "fc-antibacterials", "title": "Antibacterials Flashcards", "lang": "en" },
  "type": "flashcard",
  "cards": [
    {
      "id": "fc-001",
      "type": "basic",
      "front": "First-line treatment for essential hypertension in a 60-year-old?",
      "back": "Thiazide diuretic or ACE inhibitor"
    },
    {
      "id": "fc-002",
      "type": "cloze",
      "text": "The {{c1::SA node::pacemaker}} is the natural pacemaker of the heart.",
      "extra": "Located in the right atrium near the opening of the superior vena cava."
    }
  ]
}
```

#### OSCE (`stations.json`)

```jsonc
{
  "meta": { "uid": "osce-er-chestpain", "title": "Chest Pain Station", "lang": "en" },
  "type": "osce",
  "stations": [
    {
      "id": "osce-001",
      "title": "Chest pain in the ER",
      "type": "history",
      "specialty": "Emergency Medicine",
      "difficulty": "Intermediate",
      "task": "Take a focused medical history and determine immediate management.",
      "time": 600,
      "examiner": { "name": "Dr. Smith", "title": "Attending Physician" },
      "patient": { "name": "John Doe", "age": 55, "gender": "Male", "avatarSeed": "john-55", "opening": "Doctor, I have severe chest pain..." },
      "hiddenProfile": {
        "diagnosis": "Acute Coronary Syndrome",
        "keySymptoms": ["Crushing substernal chest pain", "Radiation to left arm"],
        "redFlags": ["Diaphoresis", "Radiation to left arm", "Hypotension"],
        "pastHistory": ["Hypertension", "Hyperlipidemia"],
        "vitalSigns": "BP 140/90, HR 95, RR 20, SpO2 96%"
      },
      "rubric": {
        "mustAsk": ["Onset and quality of pain", "Radiation", "Associated symptoms"],
        "bonus": ["Family history of CAD", "Recent risk factors"]
      },
      "questions": [
        { "question": "What is your primary differential diagnosis?", "answer": "Acute Coronary Syndrome (STEMI / NSTEMI)" }
      ]
    }
  ]
}
```

#### Library article (Markdown + YAML frontmatter)

```markdown
---
title: Aortic Stenosis
specialty: Cardiology
system: Cardiovascular
tags: [valvular, systolic-murmur, echocardiography]
readTime: 12
lang: en
---

# Aortic Stenosis

Aortic stenosis (AS) is the most common valvular heart disease in the developed world…

## Pathophysiology

![Diagram of normal vs stenotic aortic valve](images/valve-diagram.png)

The normal aortic valve area is 3–4 cm². AS is defined as a valve area < 1.0 cm²…
```

#### Video (`videos.json`)

```jsonc
{
  "meta": { "uid": "videos-heart-sounds", "title": "Heart Sounds Lectures", "lang": "en" },
  "type": "video",
  "videos": [
    {
      "id": "vid-001",
      "title": "Heart Sounds — Part 1",
      "source": { "type": "youtube", "id": "dQw4w9WgXcQ" },
      "specialty": "Cardiology",
      "topic": "Physical Exam",
      "duration": 642,
      "chapters": [
        { "title": "S1", "time": 0 },
        { "title": "S2", "time": 180 }
      ],
      "relatedArticles": ["cardiology/heart-sounds"]
    }
  ]
}
```

### Per-pack language

Every content pack can declare `lang: "en" | "ar"` on its manifest node and/or its `ContentMeta`. The renderer wraps the content body in the appropriate `dir`/`lang` container so an Arabic article renders RTL even inside an English UI shell.

### Regenerating manifests

After adding or removing content, regenerate the manifests:

```bash
npm run generate-manifests
```

This walks `public/osler-content/`, generates a `manifest.json` per category, and updates the top-level `manifest.json`. Commit the manifest changes alongside your content changes — they're part of the same logical change.

Or use the Tauri admin's **Manifest** view → "Regenerate" button (see [`tauri-admin.md`](./tauri-admin.md)).

### Submitting content

1. Add your content under `public/osler-content/`.
2. Run `npm run generate-manifests`.
3. Test locally — visit the relevant engine's hub in `npm run dev` and confirm your pack shows up and plays through.
4. If your pack is in Arabic, set `lang: "ar"` and test with the UI in both LTR (English) and RTL (Arabic) modes.
5. Commit with `content(<engine>): <pack-name>` — e.g. `content(qbank): add cardiology arrhythmias pack`.
6. Open a PR.

### Licensing your content

Content packs contributed to the upstream Osler repo must be MIT-licensed (matching the codebase) OR explicitly marked with a permissive license (CC-BY, CC-BY-SA, CC0). If your content is proprietary or you don't have redistribution rights, **do not** contribute it to upstream — keep it in your fork.

If your content is adapted from a textbook, question bank, or course, you must have written permission to redistribute. The maintainers may ask for attribution details before merging.

---

## 8. Adding new engine plugins

Osler's plugin system supports 7 engine types today: `quiz | bank | written | flashcard | osce | library | video`. Adding a new engine is a substantial change — open an issue first to discuss whether it belongs in core or in a fork.

The 5-step pattern (with the additional config steps from `AGENTS.md`):

### Step 1: Extend `EngineType` in `src/lib/osler/types.ts`

```ts
export type EngineType =
  | "quiz" | "bank" | "written"
  | "flashcard" | "osce"
  | "library" | "video"
  | "case-presentation";   // ← your new engine
```

### Step 2: Add to `ENGINE_META` in `src/lib/osler/content.ts`

```ts
export const ENGINE_META: Record<EngineType, EngineMeta> = {
  // … existing engines
  "case-presentation": {
    label: "Case Presentations",
    singular: "Case Presentation",
    color: "oklch(0.62 0.18 270)",   // purple — pick a color that doesn't collide
    icon: "presentation",            // lucide-react icon name
    folder: "cases",                 // ← content folder name under public/osler-content/
  },
};
```

### Step 3: Add the id to the config system

In `src/lib/osler/config.ts`:

- Add `"case-presentation"` to the `ENGINE_PLUGIN_IDS` array.
- Add `case-presentation: { enabled: true }` to `DEFAULT_CONFIG.engines`.

### Step 4: Create the content folder

```bash
mkdir -p public/osler-content/cases
echo '{ "cases": [] }' > public/osler-content/cases/.gitkeep
npm run generate-manifests
```

### Step 5: Add the studio component

Create `src/components/osler/cases-studio.tsx`:

```tsx
"use client";

/**
 * Case Presentations Studio — interactive patient case simulator with
 * structured history, exam, and assessment phases.
 */

import { motion } from "framer-motion";
import { useI18n } from "@/components/osler/i18n-provider";
import { PageHeader } from "@/components/osler/ui-primitives";
// … component body
```

### Step 6: Wire into the app

In `src/app/page.tsx`, add a conditional render branch:

```tsx
{view === "cases" && <CasesStudio onViewChange={setView} />}
```

In `src/components/osler/app-shell.tsx`:

- Add `"cases"` to the `OslerView` type.
- Add `"cases"` to the `VIEW_ORDER` array (controls slide-transition direction).
- Add a nav entry — either top-level or as a sub-view of `learn`.

### Step 7: Wire into the Learn hub

In `src/components/osler/learn.tsx`, add the new engine to `ALL_MODULES`:

```ts
const ALL_MODULES: OslerModule[] = [
  // …
  {
    type: "case-presentation",
    label: t("cases.home.title"),
    description: t("cases.home.description"),
    color: ENGINE_META["case-presentation"].color,
    icon: Presentation,
    view: "cases",
  },
];
```

The hub already filters by `isEngineEnabled(type)`, so the new engine respects the config toggle.

### Step 8: Add i18n keys

Add to both `en` and `ar` in `src/lib/osler/i18n.ts`:

```ts
"cases.home.title": "Case Presentations",
"cases.home.description": "Interactive patient case simulator",
// …
"cases.home.title": "عرض الحالات",
"cases.home.description": "محاكي تفاعلي لحالات المرضى",
```

### Step 9: Update the Tauri admin

In `tauri-admin/frontend/views/wizard.js` and `config.js`, add the new id to the `ENGINES` list. Also add it to `tauri-admin/default-osler-config.json`.

### Step 10: Document

- Update `AGENTS.md` → "Engine plugin system" section to include the new engine.
- Update `README.md` → "Features" and "Tech Stack" tables.
- Update `SELF-HOSTING.md` → "Engine plugins (admin-only)" table.
- Update `docs/tauri-admin.md` → Setup Wizard section.

That's the full pattern. Open the PR after all 10 steps; maintainers will review against the design system and the i18n rule.

---

## 9. Adding new i18n strings

The i18n system is a flat key→record dictionary in `src/lib/osler/i18n.ts`. There is no JSON resource file — strings live directly in TypeScript for type safety and tree-shaking.

### The rule (one more time, because it matters)

> **Every new key must land in BOTH `en` and `ar` in the same commit.** A missing AR translation is a blocker, not a "TODO".

### Naming keys

| Pattern | Example | Use for |
|---|---|---|
| `<view>.<section>.<element>` | `qbank.results.title` | View-specific strings |
| `<view>.home.<element>` | `flashcards.home.title` | Hub view titles + descriptions |
| `settings.<section>.<element>` | `settings.ai.modelLabel` | Settings panel |
| `common.<element>` | `common.cancel` | Reusable across views |
| `toasts.<event>` | `toasts.syncComplete` | Toast notifications |
| `errors.<area>.<error>` | `errors.network.timeout` | Error messages |
| `aria.<element>` | `aria.closeButton` | Screen-reader labels |
| `plural.<key>.one` / `.other` | `plural.question.one` / `plural.question.other` | Pluralization (rare in Osler) |

### Adding a key — full example

```ts
// src/lib/osler/i18n.ts
export const i18n = {
  en: {
    // … existing keys
    "qbank.export.title": "Export PDF",
    "qbank.export.description": "Customize the PDF export options",
    "qbank.export.pageSize": "Page size",
    "qbank.export.pageSize.a4": "A4",
    "qbank.export.pageSize.letter": "Letter",
    "qbank.export.layout": "Layout",
    "qbank.export.layout.single": "Single column",
    "qbank.export.layout.twoColumn": "Two column",
  },
  ar: {
    // … existing keys
    "qbank.export.title": "تصدير PDF",
    "qbank.export.description": "خصّص خيارات تصدير PDF",
    "qbank.export.pageSize": "حجم الصفحة",
    "qbank.export.pageSize.a4": "A4",
    "qbank.export.pageSize.letter": "Letter",
    "qbank.export.layout": "التخطيط",
    "qbank.export.layout.single": "عمود واحد",
    "qbank.export.layout.twoColumn": "عمودان",
  },
};
```

### Using the key in a component

```tsx
import { useI18n } from "@/components/osler/i18n-provider";

export function PdfExportDialog() {
  const { t } = useI18n();
  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{t("qbank.export.title")}</DialogTitle>
        <DialogDescription>{t("qbank.export.description")}</DialogDescription>
      </DialogHeader>
      {/* … */}
    </Dialog>
  );
}
```

### Placeholder interpolation

For strings like `"Welcome back, {name}"`, use the second argument to `t()`:

```ts
// i18n.ts
"dash.welcomeBack": "Welcome back, {name}",
"dash.welcomeBack": "مرحبًا بعودتك، {name}",

// component
t("dash.welcomeBack", { name: userName })
```

### Pluralization

Osler doesn't use a full ICU MessageFormat plural system — keep it simple with two keys:

```ts
"plural.question.one": "{count} question",
"plural.question.other": "{count} questions",
"plural.question.one": "سؤال واحد",
"plural.question.other": "{count} أسئلة",
```

```tsx
const key = count === 1 ? "plural.question.one" : "plural.question.other";
t(key, { count });
```

### Lists

For dropdown options or arrays of strings, use `tList()`:

```ts
"qbank.difficultyLevels": ["Easy", "Medium", "Hard"],
"qbank.difficultyLevels": ["سهل", "متوسط", "صعب"],
```

```tsx
const { tList } = useI18n();
const levels = tList("qbank.difficultyLevels");
// → string[]
```

### RTL considerations

- Use Tailwind logical properties (`ms-`, `me-`, `text-start`, `text-end`) instead of `ml-`, `mr-`, `text-left`, `text-right`. The `rtl-flip-x` utility class (in `globals.css`) handles arrow/chevron mirroring.
- Don't concatenate strings with hardcoded direction — if you need a leading icon, put it in JSX, not in the i18n value.
- Arabic numerals: most users prefer Western Arabic numerals (0–9) over Eastern Arabic numerals (٠–٩) in medical context. Don't localize numbers unless you have a specific reason.

### Arabic translation quality

If you don't speak Arabic:

1. Use Google Translate / DeepL / ChatGPT for a first pass.
2. Flag the PR with `Needs Arabic review` label or in the PR description.
3. A maintainer or community member will refine the translation before merge.
4. **Never** ship a PR with Arabic strings marked `// TODO: translate` — that's a hard blocker.

If you do speak Arabic, please consider helping review `Needs Arabic review` PRs — this is one of the highest-impact contributions you can make.

---

## 10. Adding new admin endpoints

The Osler admin panel lives at `/admin` and is served from the Cloudflare Worker (`cloudflare/worker/src/index.ts`). All admin endpoints require (a) authentication, (b) admin role check, (c) rate limiting, and (d) an audit log entry.

### Worker pattern — 4 layers

Every new admin endpoint must implement all four layers. Skipping any of them is a security bug, not a "shortcut".

#### Layer 1: Rate limit

```js
// cloudflare/worker/src/index.ts
import { rateLimit } from "./rate-limit.js";

export async function handleAdminDeleteUser(request, env, ctx, userId) {
  // 1. Rate limit — 10 admin actions per minute per admin
  const rl = await rateLimit(env, `admin:${userId}`, 10, 60);
  if (rl.exceeded) {
    return json({ error: "rate_limited" }, 429);
  }

  // … rest of handler
}
```

#### Layer 2: Auth check

```js
// 2. Auth — verify the JWT in the Authorization header
const session = await verifyAuth(request, env);
if (!session) {
  return json({ error: "unauthorized" }, 401);
}
```

#### Layer 3: Role check

```js
// 3. Role check — only admins can call admin endpoints
const user = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
  .bind(session.userId)
  .first();
if (!user || user.role !== "admin") {
  // Log the failed attempt — important for security monitoring
  await audit(env, session.userId, "admin_unauthorized", { endpoint: "delete_user" });
  return json({ error: "forbidden" }, 403);
}
```

#### Layer 4: Audit log

```js
// 4. Audit log — every admin action gets a row in admin_audit
await audit(env, session.userId, "user_delete", { targetUserId: userId });

// Then perform the actual action
await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
return json({ deleted: userId });
```

### Full example: admin endpoint that updates a content pack's R2 object

```js
// cloudflare/worker/src/index.ts

export async function handleAdminContentPublish(request, env, ctx) {
  // 1. Auth
  const session = await verifyAuth(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);

  // 2. Rate limit (15 publishes per hour per admin)
  const rl = await rateLimit(env, `admin-publish:${session.userId}`, 15, 3600);
  if (rl.exceeded) return json({ error: "rate_limited" }, 429);

  // 3. Role check
  const user = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(session.userId)
    .first();
  if (!user || user.role !== "admin") {
    await audit(env, session.userId, "admin_unauthorized", { endpoint: "content_publish" });
    return json({ error: "forbidden" }, 403);
  }

  // 4. Validate input (zod-equivalent manual check)
  const body = await request.json();
  if (!body.path || !body.content || typeof body.path !== "string") {
    return json({ error: "bad_request" }, 400);
  }

  // 5. Action
  const r2Key = `content/${body.path}`;
  await env.CONTENT.put(r2Key, JSON.stringify(body.content), {
    httpMetadata: { contentType: "application/json" },
  });

  // 6. Audit
  await audit(env, session.userId, "content_publish", { path: body.path });

  return json({ published: body.path });
}
```

### Frontend pattern

The admin frontend lives at `src/components/admin/` and calls Worker endpoints via `src/lib/osler/admin-api.ts`.

#### Step 1: Extend `admin-api.ts`

```ts
// src/lib/osler/admin-api.ts

export async function publishContent(path: string, content: unknown): Promise<{ published: string }> {
  const res = await fetch(`${apiUrl}/v1/admin/content/publish`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    throw new AdminApiError(res.status, await res.json().catch(() => ({})));
  }
  return res.json();
}
```

#### Step 2: Add a UI component

```tsx
// src/components/admin/content-publish-button.tsx
"use client";

/**
 * Publish button for the admin content editor — calls the Worker's
 * /v1/admin/content/publish endpoint and shows a toast on success.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/components/osler/i18n-provider";
import { publishContent } from "@/lib/osler/admin-api";
import { haptic } from "@/lib/osler/native/haptics";
import { useState } from "react";

export function ContentPublishButton({ path, content }: { path: string; content: unknown }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [publishing, setPublishing] = useState(false);

  async function onPublish() {
    haptic("selection");
    setPublishing(true);
    try {
      await publishContent(path, content);
      haptic("success");
      toast({ title: t("admin.content.published") });
    } catch (e) {
      haptic("error");
      toast({ title: t("admin.content.publishFailed"), variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Button onClick={onPublish} disabled={publishing}>
      {publishing ? t("admin.content.publishing") : t("admin.content.publish")}
    </Button>
  );
}
```

#### Step 3: Add i18n keys

In `src/lib/osler/i18n.ts`:

```ts
"admin.content.publish": "Publish",
"admin.content.publishing": "Publishing…",
"admin.content.published": "Content published",
"admin.content.publishFailed": "Publish failed",
// ar
"admin.content.publish": "نشر",
"admin.content.publishing": "جارٍ النشر…",
"admin.content.published": "تم نشر المحتوى",
"admin.content.publishFailed": "فشل النشر",
```

#### Step 4: Wire into the admin shell

Add a "Content" tab to `src/components/admin/admin-shell.tsx` and render the publish button in the content editor view.

### Why this matters

Admin endpoints are the highest-risk surface in any web app. A missing role check, an unlogged action, or a missing rate limit can:

- Let a regular user escalate to admin
- Let a brute-force attack hijack an admin account
- Hide a security incident from your audit trail
- Enable mass data exfiltration without leaving a trace

Always implement all four layers. If you're not sure about any of them, ask in the PR description — a maintainer will help.

---

## 11. Testing

Osler currently has **no automated test framework** configured. There are no test files, no test runner config, and no test scripts. This is intentional — the codebase is small enough that the type system + manual verification has been sufficient. However, we're open to adding tests; see "Future automated test plans" below.

### Manual test checklist

Run through this checklist before opening a PR that touches UI or behavior:

#### Cross-cutting

- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] No `console.log` debug statements in the diff
- [ ] No hardcoded `localhost` URLs in the diff

#### Themes

- [ ] Works in Dark theme (default)
- [ ] Works in Light theme
- [ ] Works in at least one custom theme from `osler.config.json` (if your change touches colors)

#### Languages

- [ ] Works with UI language = English (LTR)
- [ ] Works with UI language = Arabic (RTL) — full layout flips, no overflow, no LTR flash on reload
- [ ] No hardcoded English strings (search the diff for `> ` followed by a capitalized English word, or for `placeholder="`)

#### Engines (test the engines your change touches)

- [ ] **Quiz:** Create a test → answer → submit → results → review → export PDF
- [ ] **Bank:** Open a passage-based pack → answer → submit → results
- [ ] **Written:** Open a written pack → type answer → submit → rubric review
- [ ] **Flashcard:** Open a deck → flip 3 cards → mark one as "Again" → due count updates
- [ ] **OSCE:** Start a scenario → interact → end session → see rubric
- [ ] **Library:** Open an article → highlight → add sticky note → bookmark → close
- [ ] **Videos:** Open a video → play 10 seconds → use chapter markers → exit

#### Native feel (test the surfaces your change touches)

- [ ] Haptics fire on button taps (test on Android Chrome — iOS Safari no-ops silently)
- [ ] View transitions slide on navigation (test on Chrome)
- [ ] Wake lock engages during video playback (check DevTools → Application > Wake Lock)
- [ ] Network info badge shows correct type in Settings > Sync (test on a real device)

#### Sync (if your change touches `src/lib/osler/sync/`)

- [ ] Cloud sync: sign in on two devices → make a change → confirm it propagates
- [ ] Network sync: open two tabs → join the same room → make a change → confirm it propagates
- [ ] QR sync: export QR on device A → scan on device B → confirm data lands
- [ ] File sync: export `.osler-backup` → import on a fresh browser → confirm data lands

#### Admin (if your change touches the Worker or `/admin`)

- [ ] Admin login flow works
- [ ] Each admin tab loads (Dashboard, Users, Content, Audit)
- [ ] Every admin action writes to `admin_audit` (verify via D1 SQL)
- [ ] Non-admin users get 403 on admin endpoints
- [ ] Rate limit kicks in after N actions (try hitting an endpoint 20 times rapidly)

### Future automated test plans

We're considering adding the following test framework. If you'd like to help, open an issue:

| Framework | Scope | Priority |
|---|---|---|
| **Vitest** | Unit tests for `src/lib/osler/*` (pure functions: storage migrations, pdf layout, arabic shaping, content tree utils) | High |
| **React Testing Library** | Component tests for primitives (`PageHeader`, `StatTile`, etc.) and views | Medium |
| **Playwright** | E2E tests for the 7 engines (the manual test checklist above, automated) | High |
| **MSW (Mock Service Worker)** | Mock the Cloudflare Worker in tests so E2E doesn't need a live backend | Medium |
| **Lighthouse CI** | Performance regression tests in GitHub Actions | Low |
| **k6** | Load tests for the Worker (rate limit, auth, admin endpoints) | Low |

Until these land, the manual checklist is the source of truth.

---

## 12. Releasing

Osler uses a simple release process: semantic versioning, a `CHANGELOG.md`, git tags, and GitHub Releases. There's no automatic publish pipeline — releases are cut manually by maintainers.

### Versioning

Osler follows [Semantic Versioning](https://semver.org/):

| Bump | When | Example |
|---|---|---|
| **Major** (1.x → 2.0) | Breaking change in `osler.config.json` schema, content JSON schema, or Worker API | Schema bump to `schemaVersion: 2` |
| **Minor** (1.2 → 1.3) | New feature, new engine, new admin endpoint — backward-compatible | Add Case Presentations engine |
| **Patch** (1.2.0 → 1.2.1) | Bug fix, docs, content pack addition — no behavior change for existing users | Fix QBank timer pause bug |

Pre-release versions use the `1.3.0-alpha.1`, `1.3.0-beta.2`, `1.3.0-rc.1` suffixes.

### Release procedure

Maintainers follow these steps. Contributors don't need to do this, but it's useful to know what happens to your PR after merge.

1. **Confirm the `main` branch is green.** Run `npm run lint && npx tsc --noEmit && npm run build` locally to verify.
2. **Decide the version bump** based on the merged PRs since the last release:
   - Any `BREAKING CHANGE:` footer → major
   - Any `feat:` commit → minor
   - Only `fix:` / `docs:` / `chore:` → patch
3. **Update `CHANGELOG.md`** with a new section at the top:

   ```markdown
   ## [1.3.0] — 2025-02-15

   ### Added
   - Case Presentations engine (`feat:` #142 by @username)
   - PDF export customization dialog (#128 by @username)

   ### Changed
   - Refactored dashboard stat tiles to use `StatTile` primitive (#150 by @username)

   ### Fixed
   - Quiz timer no longer counts down when the tab is hidden (#145 by @username)

   ### Security
   - Rate-limited admin endpoints to 10 actions/minute (CVE-2025-XXXX)
   ```

4. **Bump `package.json`** version:
   ```bash
   npm version minor --no-git-tag-version
   ```
   This bumps `1.2.0` → `1.3.0` in `package.json` and `package-lock.json`.
5. **Commit the release:**
   ```bash
   git add CHANGELOG.md package.json package-lock.json
   git commit -m "chore(release): v1.3.0"
   ```
6. **Tag the release:**
   ```bash
   git tag -a v1.3.0 -m "Osler v1.3.0"
   git push origin main --tags
   ```
7. **Create a GitHub Release:**
   - Go to <https://github.com/eyad-elghareeb/osler/releases/new>
   - Select the `v1.3.0` tag
   - Title: `Osler v1.3.0`
   - Body: copy the `CHANGELOG.md` section for this release
   - Attach any deliverable artifacts (e.g. the zip from `scripts/build-deliverable.sh`)
   - Publish
8. **Announce** in your community channels (Discord, Twitter, email list, etc.).

### Backporting

Critical security fixes (e.g. an XSS in the notes editor) get backported to the previous minor release if there are users still on it. The process:

1. Cherry-pick the fix commit onto a `backport/v1.2.x` branch.
2. Bump to `1.2.2` (or whatever the next patch is).
3. Update `CHANGELOG.md` with a `[1.2.2]` section.
4. Tag and release as above.

### Pre-release channel

For testing new engines or breaking changes before a stable release, cut an `alpha` or `beta`:

```bash
npm version prerelease --preid beta --no-git-tag-version   # 1.3.0 → 1.3.0-beta.0
git add package.json package-lock.json
git commit -m "chore(release): v1.3.0-beta.0"
git tag -a v1.3.0-beta.0 -m "Osler v1.3.0-beta.0"
git push origin main --tags
```

Mark the GitHub Release as a "Pre-release" so users get a warning before installing.

---

## 13. Security disclosures

**Do not open public GitHub issues for security bugs.** Public issues tip off attackers before a fix is available.

If you discover a security vulnerability:

1. **Email the maintainers** at the security contact listed in [`SECURITY.md`](../SECURITY.md) (or, if no contact is listed, open a private security advisory on GitHub: repo → Security → Advisories → New draft advisory).
2. **Include** in your report:
   - A clear description of the vulnerability
   - Steps to reproduce (POC if possible)
   - Affected versions (try `main` + last stable release)
   - Impact assessment (who can exploit, what they gain)
   - Suggested fix (if you have one)
3. **Do not disclose publicly** until the maintainers have published a fix and given you the green light. We follow coordinated disclosure and aim to ship a fix within 90 days of receiving a verified report.
4. **You will be credited** in the `CHANGELOG.md` security section and the GitHub Security Advisory, unless you prefer to remain anonymous.

### What counts as a security bug

| Yes, report privately | No, open a public issue |
|---|---|
| Auth bypass / missing role check | General "how do I configure X" questions |
| SQL injection in the Worker | Bug in a UI component that doesn't expose data |
| XSS in user-content rendering (notes, articles) | Performance issues |
| IDOR (e.g. user A can read user B's progress) | Feature requests |
| JWT secret leak / weak default | Docs typos |
| Path traversal in admin file operations | Content pack format suggestions |
| Rate limit bypass | Translation improvements |
| CSRF on state-changing endpoints | Browser compatibility quirks |

If you're not sure which bucket your finding falls into, **default to private disclosure** — a maintainer will tell you if it's safe to make public.

### Security review for contributors

If your PR touches the Worker, the admin panel, authentication, or anything in `src/lib/osler/cloud/`, the maintainers will run a security review before merging. To make this faster:

- Implement all four layers (rate limit, auth, role check, audit log) on every admin endpoint (see §10).
- Validate all user input — use `zod` schemas or manual `typeof` / `Array.isArray` checks. Never trust `request.json()` to be the right shape.
- Use parameterized queries for all D1 SQL: `env.DB.prepare("... WHERE id = ?").bind(userId)`. Never string-interpolate.
- Don't log secrets (JWT, passwords, API keys) — even to `console.log` for debugging. The Worker logs go to Cloudflare's observability stack.
- Set `Content-Security-Policy` headers on any new HTML response from the Worker.

See [`security.md`](./security.md) for the full security model.

---

## 14. Recognition

Contributors are the lifeblood of any open-source project. We recognize contributions in several ways:

### All-contributors

Osler uses the [all-contributors](https://all-contributors.js.org/) spec to recognize every type of contribution — not just code. The contributors table lives in `README.md` (or a dedicated `CONTRIBUTORS.md` if the table gets large).

To add a contributor, maintainers run:

```bash
# Install the CLI once:
npm i -g all-contributors-cli

# Add a contributor:
all-contributors add <username> code,doc,translation,content,design,review,ideas,test,infra

# Regenerate the table:
all-contributors generate
```

The recognized contribution types (emoji → type):

| Emoji | Type | What it covers |
|---|---|---|
| 💻 | `code` | Code contributions (PRs) |
| 📖 | `doc` | Documentation |
| 🌍 | `translation` | i18n string additions |
| 📚 | `content` | Content pack additions |
| 🎨 | `design` | Design / UX work |
| 👀 | `review` | PR reviews |
| 🤔 | `ideas` | Feature ideas, planning |
| ✅ | `test` | Test additions (when we have them) |
| 🚇 | `infra` | CI/CD, hosting, tooling |
| 🔧 | `tooling` | Build scripts, dev tooling |
| 🐛 | `bug` | Bug reports (yes, just reporting counts!) |
| ⚠️ | `security` | Security disclosures |
| 💬 | `question` | Answering questions in issues / Discussions |
| 👋 | `financial` | Financial sponsorship |

### GitHub Sponsors

If you'd like to financially support Osler's development, the repo's `README.md` links to a GitHub Sponsors page (if one is set up). Sponsors are listed in the README and get a `👋 financial` entry in the all-contributors table.

### Release notes

Every PR that ships in a release is credited in `CHANGELOG.md` with the contributor's GitHub username and PR number. Example:

```markdown
### Added
- Case Presentations engine (#142 by @username)
```

### Hall of fame — security researchers

Researchers who report verified security vulnerabilities are credited in:

- The `CHANGELOG.md` security section for the release that ships the fix
- The GitHub Security Advisory (unless they prefer to remain anonymous)
- A "Security Hall of Fame" section in `SECURITY.md` (if one exists)

### For maintainers: how to thank contributors

- **Review PRs promptly** — slow reviews kill contributor motivation faster than anything else.
- **Be specific with praise** — "great PR!" is fine; "the way you handled the RTL edge case in the export dialog is exactly right" is much better.
- **Credit in the merge commit** — `Co-Authored-By: <username>` is fine for human contributors (just not for AI agents, per `AGENTS.md`).
- **Mention contributors in release announcements** — list the GitHub usernames of everyone who shipped a PR in the release.
- **Invite repeat contributors to be maintainers** — if someone ships 5+ quality PRs, ask if they'd like merge rights.

---

That's the contributing guide. Thanks again for your time — whether you're filing a bug report, fixing a typo, or building a new engine, every contribution makes Osler better for medical educators and students worldwide. We look forward to your PR.
