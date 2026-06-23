# Osler V1 — Implementation Plan

> **Rename note:** This file was renamed from `v6-plan.md` to `v1-osler-plan.md` on 2026-06-23.

> Companion file. I check this before every session. Each phase has file manifests, implementation order, and one-line verification commands.

---

## Progress

```
Phase 0 — Foundation       [✓]  2 weeks   10 files    3 verification commands  (2026-06-23)
Phase 1 — Content Format   [  ]  1 week     9 files    3 verification commands
Phase 2 — IndexedDB        [  ]  2 weeks    7 files    4 verification commands
Phase 3 — Firebase & Sync  [  ]  2 weeks    6 files    4 verification commands
Phase 4 — UI & Anki        [  ]  1.5 weeks  4 files    2 verification commands
Phase 5 — GitHub CMS       [  ]  4 weeks   16 files    3 verification commands
Phase 6 — AI Pipeline      [  ]  1 week     5 files    3 verification commands
Phase 7 — Test & Ship      [  ]  1.5 weeks 14 files    3 verification commands
Phase 8 — Update System    [  ]  2 weeks   10 files    3 verification commands
                        ─────────
                        17 weeks total
```

---

## Automation

| Script | What It Does |
|--------|-------------|
| `npm run build` | esbuild all engines, copy CSS |
| `npm run test` | Vitest unit + integration + contract tests |
| `npm run test:e2e` | Playwright 20 journeys |
| `npm run validate` | Validate all JSON in content/ against schemas |
| `npm run check` | build + test + validate in sequence |
| `npm run export-schemas` | Copy schemas → .agents/context/ |
| `npm run check-updates` | Generate update manifest, verify bundle integrity |
| `npm run update-bundle` | Build update bundle ZIP with latest engines |

**CI:** `npm run check` on every PR, `npm run test:e2e` on main merge, auto-deploy to Pages.

---

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 7 ──▶ Phase 8
                │                                          ▲
                └──▶ Phase 5 ──▶ Phase 6 ──────────────────┘
```

After Phase 1, Phases 2, 4, 5, 6 can run in parallel. Phase 4 depends only on Phase 0.

---

## Phase 0 — Foundation (2 weeks)

**Verification:** `npm run build && npm test`

| File | Action |
|------|--------|
| `package.json` | Create — esbuild + vitest + playwright |
| `src/build.js` | Create — esbuild entry points → engines/ |
| `vitest.config.js` | Create |
| `src/lib/theme.js` | Create — CSS vars, toggle, flash-prevention |
| `src/lib/toast.js` | Create |
| `src/lib/keyboard.js` | Create |
| `src/lib/dom.js` | Create — createElement, render helpers |
| `src/lib/ui.js` | Create — Card(), Button(), Modal(), InstallPrompt(), CmdKPalette() |
| `src/lib/icons.js` | Create — Lucide SVGs (~50) |
| `src/lib/gemini.js` | Create — extracted from engine-shared.js |
| `src/css/shared.css` | Create — reset, CSS vars, elevation/spacing/radius tokens |
| `src/css/quiz-engine.css` | Extract from engine inline strings |
| `src/css/index-engine.css` | Extract |
| `src/css/flashcard-engine.css` | Extract |
| `src/css/written-engine.css` | Extract |
| `src/css/osce-engine.css` | Extract |
| `tests/fixtures/sample-quiz.json` | Create |
| `tests/unit/lib/theme.test.js` | Create |
| `tests/unit/lib/ui.test.js` | Create |
| All 9 engines | Build — verify bit-identical output |

```
Order: build config → test infra → CSS extraction (5 files) → lib modules (6 files)
→ ui.js + icons.js → gemini.js → build all engines → tests
```

```bash
npm run build                # All engines compile
npm test                     # 10+ tests pass
node -e "require('./engines/quiz-engine.js')"  # No runtime errors
```

---

## Phase 1 — Content Format (1 week)

**Depends on:** Phase 0
**Verification:** `npm run build && npm run validate`

| File | Action |
|------|--------|
| `src/schemas/quiz-v1.json` | Create — JSON Schema for all 6 content types |
| `src/schemas/bank-v1.json` | Create |
| `src/schemas/flashcard-v1.json` | Create |
| `src/schemas/written-v1.json` | Create |
| `src/schemas/osce-v1.json` | Create |
| `src/schemas/hub-v1.json` | Create |
| `src/lib/validate.js` | Create — hand-written validation per type |
| `src/lib/content-loader.js` | Create — fetch JSON → validate → return |
| `player.html` | Create — universal content viewer |
| `scripts/export-schemas.js` | Create — copy to .agents/context/ |
| `tests/unit/lib/validate.test.js` | Create |

```
Order: 6 schema files → validate.js → export-schemas.js → content-loader.js
→ player.html → validate tests
```

No tool rewrites. Content is created exclusively through the admin dashboard (Phase 5). Player only.

```bash
npm run build                    # Compiles
npm run validate                 # Sample content passes all schemas
node -e "new (require('./player.html'))"  # player.html renders
```

---

## Phase 2 — IndexedDB (2 weeks)

**Depends on:** Phase 1
**Verification:** `npm run build && npm test`

| File | Action |
|------|--------|
| `src/lib/storage.js` | Create — 7 per-type stores + localStorage fallback |
| `src/lib/quota.js` | Create — 3-stage eviction (85/90/95%) |
| Engine persistence (5 engines) | Update — use storage.js instead of raw localStorage |
| `src/lib/tracker.js` | Update — per-type table reads/writes |
| `tests/unit/lib/storage.test.js` | Create |
| `tests/unit/lib/quota.test.js` | Create |
| `tests/unit/sync/migration.test.js` | Create — v5 localStorage → v6 migration |

```
Order: storage.js → quota.js → migration → quiz-engine → bank/flashcard/written/osce
→ engine-tracker → storage tests
```

```bash
npm run build              # All engines compile
npm test                   # Storage CRUD tests pass
npm test -- --grep=migration  # Migration tests pass
# Manual: answer 3 questions, refresh — progress restored
```

---

## Phase 3 — Firebase & Sync (2 weeks)

**Depends on:** Phase 2
**Verification:** `npm run build && npm test`

| File | Action |
|------|--------|
| `src/lib/firebase.js` | Create — Firebase init (auth, firestore, analytics) |
| `src/lib/auth.js` | Create — guest → google → github state machine |
| `src/lib/sync.js` | Create — 3-tier conflict resolution + sync log |
| `src/lib/analytics.js` | Create — study event tracking |
| Hub `index.html` | Update — auth UI, "My Content" section |
| `tests/unit/sync/sm2-merge.test.js` | Create |
| `tests/unit/sync/field-merge.test.js` | Create |

No publish buttons in tools (admin-only). Hub shows "My Content" read from userContent store.

```
Order: firebase.js → auth.js → hub auth UI → sync.js (3 merge strategies)
→ analytics.js → "My Content" section → contract tests
```

```bash
npm run build              # Compiles
npm test                   # Unit + contract tests pass
npm test -- --grep=SM-2    # SM-2 merge contract tests pass
# Manual: sign in with Google, study on two devices, progress syncs
```

---

## Phase 4 — UI Polish + Anki CSV (1.5 weeks)

**Depends on:** Phase 0. Can run parallel with Phases 2-3.
**Verification:** `npm run build`

| File | Action |
|------|--------|
| `src/lib/anki.js` | Create — TSV import/export, cloze detection |
| Hub + all engines | Update — replace emoji with Lucide SVGs |
| `src/css/shared.css` | Update — elevation/spacing tokens applied |
| All engine render functions | Refactor — use ui.js instead of innerHTML += |
| Flashcard engine | Update — add "Export to Anki" button in results screen |
| Anki import | Lives in admin ContentEditor (Phase 5), not in web tools |

```
Order: anki.js → emoji replacement (hub + engines) → CSS tokens → ui.js refactor
```

```bash
npm run build                    # Compiles
grep -r '[📘📁🃏📝🔍🚩🖍️←☀️🌙]' src/  # Zero emoji in source
# Manual: export flashcards to CSV, import into Anki
```

---

## Phase 5 — GitHub CMS (4 weeks)

**Depends on:** Phase 1 (content format). Can run parallel with Phases 2-4.
**Verification:** `cd tauri-admin && cargo build`

This is the single content creation surface. The admin ContentEditor handles all 6 types.

| File | Action |
|------|--------|
| `tauri-admin/src/commands.rs` | Update — 8 GitHub commands + content CRUD |
| `tauri-admin/src/deploy.rs` | Update — provider-aware deploy |
| `tauri-admin/src/mcp_server.rs` | Create — 14 MCP tools |
| `tauri-admin/frontend/index.html` | Update — 7 pages |
| `tauri-admin/tauri.conf.json` | Update — safe-storage, HTTP plugins |
| `tauri/src/engines.rs` | Update — embed rebuilt engines |

### Admin Pages

| Page | What It Does |
|------|-------------|
| **Dashboard** | Repo overview, recent activity, PR status |
| **RepoBrowser** | Navigate repo tree, filter by .json content files |
| **ContentEditor** | Create/edit all 6 content types (quiz, bank, flashcard, written, osce). JSON editor + preview + validate + commit. Anki CSV import button here. |
| **PullRequests** | List, review, merge PRs |
| **Deploy** | One-click deploy to Pages/Netlify/Vercel |
| **Analytics** | Admin-wide metrics |
| **Settings** | GitHub token, deploy keys, permissions |

### ContentEditor Workflow

```
Open file (or "New Quiz") → Edit JSON with live validation → Preview (opens player.html)
→ Commit to branch → Open PR → Merge → Deploy
```

### MCP Tools

Wrapping the same Rust commands. No duplication.

```
list_files, read_file, write_file, validate, convert, export_pdf,
git_status, git_commit, git_push, create_pr, merge_pr, deploy,
search_content, generate_quiz, analytics_query
```

```
Order: GitHub OAuth → 8 Rust commands (1 per function) → 7 admin pages
→ MCP server (thin wrapper) → deploy integration → cargo build + test
```

```bash
cd tauri-admin && cargo build                    # Compiles
cd tauri-admin && cargo test                     # Rust tests pass
# Manual: sign in with GitHub, create quiz in ContentEditor, preview, commit, deploy
```

---

## Phase 6 — AI Pipeline (1 week)

**Depends on:** Phase 1 + Phase 5 (MCP). Can run parallel with Phase 7 prep.
**Verification:** `npm run build && npm test`

| File | Action |
|------|--------|
| `src/lib/content-gen.js` | Create — 3-stage Gemini pipeline |
| `.agents/context/*.json` | Generate — `npm run export-schemas` |
| `.agents/skills/create-quiz.md` | Create |
| `.agents/skills/create-flashcard.md` | Create |
| `.agents/skills/edit-content.md` | Create |
| `.agents/skills/content-review.md` | Create |
| `.agents/skills/anki-csv.md` | Create |

3 stages: NL→outline (user prompt → structured outline) → extraction (Flash-Lite, $0.015/K) → conversion (Pro, $0.50/K). Quality gate: score < 0.7 → "Needs Review" queue in admin. Cost caps: $20/day, $200/month.

```bash
npm run build                    # Compiles
npm run export-schemas           # Schemas in .agents/context/
# Manual: "Create 10 cardiology questions" → AI generates JSON in ContentEditor
```

---

## Phase 7 — Test & Ship (1.5 weeks)

**Depends on:** All phases
**Verification:** `npm run check && npm run test:e2e`

| File | Action |
|------|--------|
| `tests/e2e/player.spec.js` | Create |
| `tests/e2e/quiz-session.spec.js` | Create |
| `tests/e2e/flashcard-study.spec.js` | Create |
| `tests/e2e/bank-session.spec.js` | Create |
| `tests/e2e/written-assessment.spec.js` | Create |
| `tests/e2e/osce-simulation.spec.js` | Create |
| `tests/e2e/firebase-auth.spec.js` | Create |
| `tests/e2e/anki-csv.spec.js` | Create |
| `tests/e2e/content-gen.spec.js` | Create |
| `tests/e2e/github-cms.spec.js` | Create |
| `tests/integration/storage.test.js` | Create |
| `tests/integration/sync-adapter.test.js` | Create |
| `sw.js` | Update — cache strategies with named caches |
| `AGENTS.md` | Update — Osler V1 reference |
| `.github/workflows/ci.yml` | Create |

```bash
npm run check                   # Build + validate + unit tests pass
npm run test:e2e                # 10+ Playwright journeys pass
npx lighthouse http://localhost:5500 --view  # 90+ all categories
```

---

## Phase 8 — Update System (2 weeks)

**Depends on:** Phase 5 (admin dashboard), Phase 7 (CI/CD)
**Verification:** `npm run build && npm test && npm run check-updates`

### Architecture

The update system has two tiers:

```
Main Repo (osler) ──▶ GitHub Releases ──▶ Admin Dashboard (self-update)
                  │
                  └──▶ Engine Update Bundle ──▶ Generated Instances (push update)
```

### Tier 1 — Admin Dashboard Self-Update

The Tauri admin app checks for new releases on startup and periodically. When an update is found, it downloads the new binary and applies it.

| File | Action |
|------|--------|
| `tauri-admin/src/updater.rs` | Create — GitHub Releases API check, download, hash verify, swap |
| `tauri-admin/src/commands.rs` | Update — add `check_update`, `apply_update`, `get_update_status` commands |
| `tauri-admin/frontend/index.html` | Update — add Update page with status, progress, changelog |
| `tauri-admin/tauri.conf.json` | Update — add updater plugin config |

**Updater flow:**
```
Admin starts → Updater checks GitHub Releases API → compares semver
→ if newer: notify user with changelog → user clicks "Update & Restart"
→ download binary to temp dir → hash verify → swap executable → restart
```

**Fallbacks:**
- No network → skip check, show "Update unavailable (offline)"
- Hash mismatch → abort, log error, notify user
- Permission denied → show manual download instructions
- Admin can disable auto-check in Settings

### Tier 2 — Engine Updates to Generated Instances

The admin dashboard maintains a manifest of "component versions" from the main repo. When engines or critical code changes in the main repo, the admin can push updates to all managed instances.

| File | Action |
|------|--------|
| `src/lib/update-manifest.json` | Create — version manifest shipped with each build |
| `tauri-admin/src/bundle_engines.rs` | Create — extract engines + critical assets into update bundle |
| `tauri-admin/src/push_update.rs` | Create — push bundle to instance repos via PR |
| `tauri-admin/frontend/index.html` | Update — add "Managed Instances" page with update status |
| `sw.js` | Update — check for update manifest on service worker activation |
| `tauri-admin/src/commands.rs` | Update — add `bundle_update`, `push_update`, `check_instance_versions` |
| `tests/e2e/update-bundle.spec.js` | Create — e2e test for bundle generation |
| `tests/e2e/update-push.spec.js` | Create — e2e test for push to instance |

**Update bundle contents:**
```
update-v1.2.3.zip
├── engines/
│   ├── quiz-engine.js
│   ├── bank-engine.js
│   ├── flashcard-engine.js
│   ├── written-engine.js
│   ├── osce-engine.js
│   ├── ai-assistant-engine.js
│   ├── sync-engine.js
│   └── search-engine.js
├── assets/
│   ├── icon-48.png ... icon-512.png
│   └── favicon.svg
├── sw.js
├── manifest.webmanifest
├── tracker-map.json
└── update-manifest.json       # { version, hash, requiredVersion, changelog }
```

**Push flow:**
```
Admin selects instances → "Push Update v1.2.3"
→ For each instance: clone → checkout update-branch → apply bundle files
→ commit → push → open PR with auto-generated title "[Update] v1.2.3"
→ (optional) auto-merge if CI passes
```

**Instance-side update detection:**
```
Service worker activates → checks update-manifest.json for version
→ if mismatched with stored version → show "Update available" badge in hub
→ (future: auto-update on next load)
```

**Security:**
- Update bundles are signed with a release key (hash in `update-manifest.json`)
- Admin must authenticate via GitHub OAuth before pushing to instances
- Push targets only instance repos the admin has write access to

**Rollback:**
- Each push creates a git tag `update-v1.2.3-previous`
- Rollback = checkout tag, force-push
- Admin page shows last 5 updates per instance with rollback button

```
Order: version manifest → bundler → updater.rs → push_update.rs → SW update check
→ Admin UI pages (Update + Managed Instances) → e2e tests
```

```bash
npm run build                         # Builds engines + generates update-manifest.json
cd tauri-admin && cargo build         # Admin builds with updater
npm run test:e2e -- --grep=update     # Update bundle and push tests pass
# Manual: admin installs update → restarts → shows new version
# Manual: admin pushes engine update to instance → instance shows update badge
```

---

## Design Reference

### A — IndexedDB Schema

```
DB: osler-v1 (version 1)
├── quizTracker       key: {contentUid, itemId}    value: { wrongCount, consecutiveCorrect, flagged, highlights, notes, updatedAt }
├── flashcardTracker  key: uid                      value: { easeFactor, interval, nextReviewAt, repetitions, lapses, lastRating, lastReviewedAt, totalReviews, avgTimePerReview, updatedAt }
├── writtenTracker    key: uid                      value: { drafts[5], submissions, bestAiScore, lastAiFeedback, updatedAt }
├── osceTracker       key: uid                      value: { rubricScores, missedRedFlags, differentialAccuracy, updatedAt }
├── studyEvents       autoKey                       value: { contentType, contentUid, action, timestamp, deviceId }
├── userContent       key: uid                      value: { type, title, questions, tags, createdAt, updatedAt, syncStatus }
├── streak            key: 'global'                 value: { currentStreak, longestStreak, xp, level }
├── syncLog           autoKey                       value: { entryType, entryUid, operation, fieldChanges, timestamp, deviceId }
└── settings          key: settingName              value: any
```

### B — CSS Tokens

```css
--elevation-1: 0 1px 2px rgba(0,0,0,0.3);
--elevation-2: 0 2px 8px rgba(0,0,0,0.35);
--elevation-3: 0 8px 32px rgba(0,0,0,0.4);
--radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-xl: 24px;
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
--space-5: 24px; --space-6: 32px; --space-8: 48px; --space-10: 64px;
--transition-fast: 150ms ease; --transition-normal: 250ms ease;
```

### C — Content Format (JSON)

```json
{ "meta": { "uid": "unique_id", "title": "Title", "description": "...", "icon": "heart", "tags": [], "version": 1, "createdAt": "ISO8601", "updatedAt": "ISO8601" },
  "type": "quiz",
  "questions": [{ "id": "q-001", "question": "...", "options": [], "correct": 0, "explanation": "...", "tags": [], "difficulty": 5 }] }
```

Types: quiz, bank, flashcard, written, osce. Schema per type in `/src/schemas/`.

### D — Conflict Resolution

| Data Type | Strategy |
|-----------|----------|
| studyEvents | Append-only |
| quizTracker / writtenTracker / osceTracker | Field-level merge by `updatedAt` |
| flashcardTracker | SM-2: later review wins state, both count toward totals |
| userContent | Last-write-wins body, keep both titles on conflict |
| streak | Max of currentStreak, lastActivityDate |

### E — Key Decisions

| Decision | Rationale |
|----------|-----------|
| Vanilla JS over TypeScript | Barriers remain low |
| esbuild over Webpack/Vite | 300ms build, zero config |
| Raw IndexedDB over Dexie.js | No extra dependency |
| Admin-only content creation | Single surface, no tool maintenance, GitHub-native workflow |
| Firebase over Supabase | Simpler auth, built-in analytics |
| Per-type tracker tables | Clean indexes, bundle-splittable |
| Three-tier conflict resolution | SM-2 is order-dependent, LWW is unsafe |
| JSON-only content | Clean diffs, validatable |
| Lucide SVGs over icon fonts | Zero network dep |
| Gemini 2-stage pipeline | Cheap extraction + accurate conversion |
| Anki CSV over .apkg | Zero deps, text-only |
| Vitest + Playwright | Lightweight, no Babel config |

### F — Anti-Goals

| Feature | Reason |
|---------|--------|
| Standalone HTML tools (quiz-maker, bank-maker, etc.) | Admin dashboard is the only content creation surface. v5 tools still exist on disk but are deprecated. |
| TypeScript, React, Svelte, Lit | Vanilla JS keeps barrier low |
| Monorepo tooling | Overkill for one dev |
| i18n / RTL | No demand, massive scope |
| sql.js WASM | search-engine.js works fine |
| Firebase Functions | Client SDKs cover everything |
| Android APK | PWA covers mobile |
| Full visual redesign | Icons + spacing polish only |
| Anki .apkg | CSV is simpler, zero deps |

### G — Metrics & Budgets

| Metric | Target |
|--------|--------|
| Bundle per engine | <80 KB gzipped |
| Lighthouse Performance | 95+ |
| Lighthouse Accessibility | 90+ |
| PWA audit | All checks pass |
| Unit test coverage | 70%+ on src/lib/ |
| E2E pass rate | 100% on 20 journeys |
| Sync merge correctness | 100% on contract tests |
| Content-gen cost per 10-quiz | ≤$0.50 |
| Time-to-first-question | ≤3s on 3G |
| Install prompt gate | 5+ sessions |
