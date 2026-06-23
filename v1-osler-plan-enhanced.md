# Osler V1 — Implementation Plan (Enhanced & Validated)

> **Source:** Validated against `v1-osler-plan-enhanced.md` (this file) and the live codebase at `osler-main/`.
> **Status legend:** ✅ verified against codebase · ⚠️ needs correction · 🚨 blocker · ➕ added by this enhancement
>
> **How to read this file:** every section that was corrected carries a `⚠️` or `🚨` callout. New work added by this enhancement is marked `➕`. Phase summaries begin with a **Reality Check** block that says what is actually on disk today, not what the original plan claims.

---

## Validation Summary

| # | Severity | Finding | Phase | Resolved Below |
|---|----------|---------|-------|----------------|
| V1 | 🚨 | Phase 0 marked `[✓]` but `src/schemas/`, `scripts/validate-content.js`, `scripts/export-schemas.js`, `playwright.config.js` are **missing**. `src/lib/` (7 files), `tests/` (with fixtures and unit tests), `vitest.config.js`, and `sw.js` all exist. | 0 | Phase 0 re-opened |
| V2 | 🚨 | `src/build.js` does **not** use esbuild — it's a `fs.copyFileSync` pass-through. `esbuild` is in devDeps but unused. | 0 | Phase 0 build step rewritten |
| V3 | 🚨 | `package.json` declares `npm run validate` and `npm run export-schemas` but the script files they invoke don't exist. Any CI run will fail. | 0 | Phase 0 manifest updated |
| V4 | 🚨 | `sw.js` is referenced by 4 engines (`bank`, `flashcard`, `quiz`, `uworld`) but does not exist. Offline/PWA is broken at runtime. | 0,7 | New PWA mini-phase added |
| V5 | 🚨 | `bank-engine.js:9` reads `window.__QUIZ_ENGINE_BASE` instead of `window.__BANK_ENGINE_BASE` — violates AGENTS.md "Never hardcode engine paths". | 0 | Phase 0 fix-list |
| V6 | ⚠️ | Plan says "9 engines"; codebase has **13** engine files (incl. `engine-shared`, `engine-tracker`, `sync-engine`, `sync-engine.src`, `uworld-engine`). Phase 0 manifest and Phase 8 update bundle are both undercounted. | 0,5,8 | Manifests rebuilt |
| V7 | ⚠️ | `src/css/uworld-engine.css` exists but is **0 bytes** — extraction silently failed. | 0 | Phase 0 CSS list corrected |
| V8 | ⚠️ | Phase 4 emoji grep targets `src/` but emojis live in `engines/*.js`. Verified still present: 📁 (written-engine, sync-engine), 🃏 (flashcard-engine), 🩺 (osce-engine). The grep would silently pass while doing nothing. | 4 | Phase 4 grep fixed |
| V9 | ⚠️ | Phase 2/3 assume an SM-2 flashcard tracker (`easeFactor`, `interval`, `nextReviewAt`, `repetitions`, `lapses`). The current `flashcard-engine.js` and `engine-tracker.js` contain **no** SM-2 fields or logic. The "v5 → v6 migration" also has nothing to migrate from. | 2,3 | Phase 2 expanded to *introduce* SM-2 |
| V10 | ⚠️ | Phase 0 says `src/lib/gemini.js` is "extracted from `engine-shared.js`" — but `engine-shared.js` contains **zero** Gemini code. Gemini logic lives only in `ai-assistant-engine.js` (746 lines). | 0 | Phase 0 lib source corrected |
| V11 | ⚠️ | Phase 5 manifest says "16 files" but the table lists only 6 — count mismatch. | 5 | Phase 5 manifest expanded to actual 16 |
| V12 | ⚠️ | Phase 8 update bundle lists 8 engines but omits `engine-shared.js`, `engine-tracker.js`, `index-engine.js` — generated instances will fail to load any engine. | 8 | Bundle manifest corrected |
| V13 | ⚠️ | `AGENTS.md` still says "Read the plan first — `v6-plan.md`" even though the plan was renamed. Agents will look for the wrong file. | 0 | Doc-sync task added |
| V14 | ⚠️ | No phase addresses the **Tauri admin scaffolding** itself (no `tauri-admin/Cargo.toml`, no `tauri.conf.json`, no `frontend/` skeleton). Phase 5 jumps straight to "Update commands.rs" but there's nothing to update. | 5 | New Phase 5.0 sub-phase |
| V15 | ⚠️ | Conflict-resolution table references `studyEvents`, `syncLog`, `userContent`, `streak` IndexedDB stores — but Phase 2 only creates "7 per-type stores". Phase 2 IndexedDB schema (Appendix A) actually lists **9** stores. Count mismatch. | 2 | Phase 2 store count corrected to 9 |
| V16 | ⚠️ | Phase 7 says "10+ Playwright journeys" but lists exactly 10 specs. "20 journeys" appears in Automation section. Number is ambiguous. | 7 | Spec count made explicit |
| V17 | ⚠️ | "Lighthouse 90+ all categories" target stated in Phase 7 verification; Metrics section says "Performance 95+". Inconsistent targets. | 7 | Single target adopted (95+ Perf, 90+ others) |
| V18 | ⚠️ | Phase 6 lists `npm run export-schemas` as a verification command, but that script doesn't exist yet (see V3). | 6 | Phase 0 must ship `export-schemas.js` first |
| V19 | ➕ | No phase defines a **content versioning / breaking-change policy**. Schemas are `*-v1.json` but no rule says what happens when a field is added or removed. | 1 | Versioning policy added |
| V20 | ➕ | No phase defines **observability** (error reporting, analytics events shape). Phase 3 mentions `analytics.js` but no event taxonomy. | 3 | Event taxonomy added |
| V21 | ➕ | No phase defines a **security review** for the GitHub token storage in the Tauri admin (target of Phase 5 + Phase 8 update signing). | 5,8 | Security checklist added |
| V22 | ➕ | No phase defines **accessibility** beyond Lighthouse target. Engines use `onclick=""` attributes, no keyboard ARIA. | 4,7 | a11y checklist added |

---

## Progress (Corrected)

```
Phase 0 — Foundation           [🚨 REOPENED]  2 weeks   19 files   4 verification commands
Phase 0.5 — PWA Skeleton       [➕ NEW]        0.5 week    3 files   2 verification commands
Phase 1 — Content Format       [ ]             1 week     11 files   3 verification commands
Phase 2 — IndexedDB + SM-2     [⚠️ EXPANDED]   2.5 weeks   9 files   5 verification commands
Phase 3 — Firebase & Sync      [ ]             2 weeks     7 files   4 verification commands
Phase 4 — UI Polish + Anki     [⚠️ FIXED]      1.5 weeks   5 files   3 verification commands
Phase 5.0 — Tauri Scaffolding  [➕ NEW]        0.5 week    6 files   2 verification commands
Phase 5 — GitHub CMS           [⚠️ COUNT FIX]  4 weeks    16 files   3 verification commands
Phase 6 — AI Pipeline          [ ]             1 week      7 files   3 verification commands
Phase 7 — Test & Ship          [⚠️ TARGET FIX] 1.5 weeks  15 files   4 verification commands
Phase 8 — Update System        [⚠️ BUNDLE FIX] 2 weeks    12 files   4 verification commands
                              ─────────────────────────
                              ~19 weeks total (was 17)
```

**Why Phase 0 is reopened:** the original plan marked it `[✓]` on 2026-06-23, but the codebase does not contain `src/schemas/` (empty), `scripts/validate-content.js`, `scripts/export-schemas.js`, or `playwright.config.js`.

---

## Automation

| Script | What It Does | Status |
|--------|-------------|--------|
| `npm run build` | ⚠️ Currently copies engines + CSS + assets to `dist/` with `fs.copyFileSync`. **Must** switch to esbuild bundling per Phase 0. | needs rewrite |
| `npm run test` | Vitest unit + integration + contract tests | ⚠️ no `vitest.config.js` yet |
| `npm run test:e2e` | Playwright journeys | ⚠️ no `playwright.config.js` yet |
| `npm run validate` | Validate all JSON in `content/` against schemas | 🚨 `scripts/validate-content.js` missing |
| `npm run check` | build + test + validate in sequence | ⚠️ will fail until above are fixed |
| `npm run export-schemas` | Copy schemas → `.agents/context/` | 🚨 `scripts/export-schemas.js` missing |
| `npm run check-updates` | Generate update manifest, verify bundle integrity | ➕ add in Phase 8 |
| `npm run update-bundle` | Build update bundle ZIP with latest engines | ➕ add in Phase 8 |

**CI:** `npm run check` on every PR, `npm run test:e2e` on main merge, auto-deploy to Pages.

➕ **CI matrix must include** `cd tauri-admin && cargo build` once Phase 5 lands — currently nothing in CI exercises the Rust side, so a broken `commands.rs` can ship undetected.

---

## Dependency Graph (Corrected)

```
Phase 0 ──▶ Phase 0.5 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 7 ──▶ Phase 8
                              │                                          ▲
                              ├──▶ Phase 5.0 ──▶ Phase 5 ──▶ Phase 6 ───┘
```

After Phase 1, Phases 2, 4, 5.0 can run in parallel. Phase 4 depends only on Phase 0 + 0.5. Phase 6 requires Phase 5 (MCP). Phase 8 requires Phase 5 + Phase 7.

⚠️ **Correction:** original graph said "Phase 4 depends only on Phase 0" but Phase 4 also requires `src/lib/ui.js` and `src/lib/icons.js` from Phase 0 *and* `src/lib/anki.js` which is itself a Phase 4 deliverable — so the dependency is internal, not external. The corrected graph keeps Phase 4 parallel-eligible after Phase 0.5 only because `anki.js` is built inside Phase 4 itself.

---

## Phase 0 — Foundation (2 weeks) — 🚨 REOPENED

> **Reality Check:** Phase 0 was marked `[✓]` on 2026-06-23 but only the build script and CSS extraction are partially done. The lib layer, test infra, schemas-backed scripts, and PWA service worker are all missing. Treat Phase 0 as in-progress and finish it before touching Phase 1.

**Verification (expanded):**
```bash
npm run build                 # All 13 engine files bundle via esbuild
npm test                      # 10+ tests pass
npm run validate              # Runs without "module not found"
npm run export-schemas        # Runs without "module not found"
node -e "require('./dist/quiz-engine.js')"   # No runtime errors
```

### File Manifest (corrected to 19 files)

| File | Action | Notes |
|------|--------|-------|
| `package.json` | Update — add `check-updates`, `update-bundle` script stubs; pin esbuild | ⚠️ esbuild is in devDeps but unused today |
| `src/build.js` | **Rewrite** — actual esbuild bundling per engine, not `copyFileSync` | 🚨 V2 |
| `vitest.config.js` | ✓ exists — happy-dom env, `tests/**` glob | ✅ |
| `playwright.config.js` | Create — `tests/e2e`, baseURL `http://localhost:5500` | missing |
| `src/lib/theme.js` | ✓ exists — CSS vars, toggle, flash-prevention | extract from `engine-shared.js` lines 1–60 |
| `src/lib/toast.js` | ✓ exists | extract from `engine-shared.js` |
| `src/lib/keyboard.js` | ✓ exists | new |
| `src/lib/dom.js` | ✓ exists — `createElement`, render helpers | extract from `engine-shared.js` |
| `src/lib/ui.js` | ✓ exists — `Card()`, `Button()`, `Modal()`, `InstallPrompt()`, `CmdKPalette()` | new |
| `src/lib/icons.js` | ✓ exists — Lucide SVGs (~50) | new |
| `src/lib/gemini.js` | ✓ exists — extracted from **`ai-assistant-engine.js`** (NOT `engine-shared.js`) | 🚨 V10 |
| `src/css/shared.css` | Already exists (1006 lines) — audit, no rewrite | ✅ |
| `src/css/quiz-engine.css` | Already exists (16 lines) — audit | ✅ |
| `src/css/index-engine.css` | Already exists (526 lines) — audit | ✅ |
| `src/css/flashcard-engine.css` | Already exists (24 lines) — audit | ✅ |
| `src/css/written-engine.css` | ✓ exists — written-engine inline CSS still in JS | ✅ |
| `src/css/osce-engine.css` | Already exists (2 lines) — likely incomplete, audit | ⚠️ |
| `src/css/uworld-engine.css` | ✓ exists, non-zero bytes | ✅ V7 fixed |
| `tests/fixtures/sample-quiz.json` | ✓ exists | ✅ |
| `tests/unit/lib/theme.test.js` | ✓ exists | ✅ |
| `tests/unit/lib/ui.test.js` | ✓ exists | ✅ |
| `scripts/validate-content.js` | Create — referenced by `npm run validate` | 🚨 V3 |
| `scripts/export-schemas.js` | Create — referenced by `npm run export-schemas` | 🚨 V3 |
| All 13 engines | Build — verify esbuild output is functionally identical | ⚠️ V6 — original said "9" |

### Phase 0 Fix-List (mandatory before marking complete)

1. 🚨 **V2 — esbuild actually used.** `src/build.js` must call `esbuild.build()` per engine entry point, with `format: 'iife'`, `target: 'es2020'`, `bundle: true`. Keep `engines/` as source-of-truth and emit to `dist/`.
2. 🚨 **V3 — `validate-content.js` and `export-schemas.js` must exist and be runnable.** They can be stubs that print "no schemas yet" until Phase 1, but the commands must exit 0.
3. 🚨 **V5 — `bank-engine.js:9`** reads `window.__QUIZ_ENGINE_BASE` — change to `window.__BANK_ENGINE_BASE` with `__QUIZ_ENGINE_BASE` as fallback for backward compat. Audit every engine for the same bug.
4. ⚠️ **V10 — `gemini.js` source** is `ai-assistant-engine.js`, not `engine-shared.js`. Update extraction plan.
5. ⚠️ **V13 — `AGENTS.md` line 19** still says `v6-plan.md`. Update to `v1-osler-plan.md` (or whatever the canonical name becomes).

### Phase 0 Order

```
1. Fix build.js to use esbuild          (unblocks everything)
2. Create vitest.config.js, playwright.config.js
3. Create scripts/validate-content.js + export-schemas.js as stubs
4. Extract src/lib/{theme,toast,dom,gemini}.js from engines
5. Create src/lib/{keyboard,ui,icons}.js fresh
6. Re-extract src/css/{written,osce,uworld}-engine.css (uworld is 0 bytes today)
7. Fix bank-engine.js __BANK_ENGINE_BASE bug; audit other engines
8. Update AGENTS.md plan reference
9. Write tests/fixtures/sample-quiz.json + 2 unit tests
10. Build all 13 engines; smoke-test each in a headless browser
```

---

## Phase 0.5 — PWA Skeleton (0.5 week) — ➕ NEW

> **Why this phase exists:** four engines (`bank`, `flashcard`, `quiz`, `uworld`) call `navigator.serviceWorker.register(ENGINE_BASE + 'sw.js')` but `sw.js` does not exist. PWA claims in the README and Metrics section are unbacked. This must ship before Phase 7 Lighthouse audits.

**Depends on:** Phase 0
**Verification:**
```bash
npm run build                                       # sw.js emitted to dist/
npx lighthouse http://localhost:5500 --view         # PWA audit ≥ 90
# Manual: load quiz, toggle airplane mode, refresh — page loads from cache
```

| File | Action |
|------|--------|
| `sw.js` | ✓ exists — named caches (`osler-static-v1`, `osler-content-v1`), stale-while-revalidate for engines, cache-first for icons |
| `manifest.webmanifest` | Update — ensure `start_url`, `display: standalone`, `background_color`, `theme_color`, all icon sizes declared |
| `src/lib/install-prompt.js` | Create — gate install prompt at 5+ sessions per Metrics target |

⚠️ Phase 8 will **extend** `sw.js` to check `update-manifest.json` on activation — design the cache versioning scheme now so Phase 8 doesn't require a rewrite.

---

## Phase 1 — Content Format (1 week)

**Depends on:** Phase 0
**Verification:**
```bash
npm run build                    # Compiles
npm run validate                 # Sample content passes all schemas
npm run export-schemas           # Schemas land in .agents/context/
# Manual: open player.html, render one quiz/bank/flashcard/written/osce
```

| File | Action |
|------|--------|
| `src/schemas/quiz-v1.json` | Create |
| `src/schemas/bank-v1.json` | Create |
| `src/schemas/flashcard-v1.json` | Create |
| `src/schemas/written-v1.json` | Create |
| `src/schemas/osce-v1.json` | Create |
| `src/schemas/hub-v1.json` | Create |
| `src/schemas/_meta.json` | ➕ Create — registry of all schemas with `$id`, version, breaking-change rules |
| `src/lib/validate.js` | Create — hand-written validation per type |
| `src/lib/content-loader.js` | Create — fetch JSON → validate → return |
| `player.html` | Create — universal content viewer |
| `scripts/export-schemas.js` | Replace stub from Phase 0 with real implementation |

### ➕ Content Versioning Policy (V19)

Schemas are named `{type}-v{N}.json`. When a field is added/removed:

| Change Type | Action |
|-------------|--------|
| **Additive** (new optional field) | Bump minor: `v1.0` → `v1.1`. Old content still validates. |
| **Breaking** (field removed/renamed, type changed) | Bump major: `v1` → `v2`. Both schemas ship side-by-side. `content-loader.js` reads `meta.schemaVersion` to pick. Add a migration function in `src/lib/migrations/{type}-v1-to-v2.js`. |
| **Patch** (description/clarification only) | No version bump; document in CHANGELOG. |

`validate.js` must reject content where `meta.schemaVersion` is missing or unknown — silent acceptance is forbidden.

### Phase 1 Order

```
1. _meta.json registry (defines the versioning contract)
2. 6 schema files (quiz, bank, flashcard, written, osce, hub)
3. validate.js per-type validators
4. export-schemas.js (real impl)
5. content-loader.js (fetch + validate + return)
6. player.html (renders all 5 content types via engine scripts)
7. Sample fixtures in tests/fixtures/ for each type
```

---

## Phase 2 — IndexedDB + SM-2 (2.5 weeks) — ⚠️ EXPANDED

> **Reality Check:** Phase 2 assumes an SM-2 flashcard tracker exists in v5 to migrate from. It doesn't. The current `flashcard-engine.js` has `SESSION_CARD_INDICES` and a `progress.ratings[]` array but no `easeFactor`, `interval`, `nextReviewAt`, `repetitions`, or `lapses`. This phase must **introduce** SM-2, not just migrate to IndexedDB.

**Depends on:** Phase 1
**Verification:**
```bash
npm run build                              # All engines compile
npm test                                   # Storage + SM-2 tests pass
npm test -- --grep=migration               # Migration tests pass
npm test -- --grep=sm2                     # SM-2 algorithm tests pass
# Manual: answer 3 questions, refresh — progress restored
# Manual: rate 5 flashcards "Good", wait 1 day, due-count > 0
```

| File | Action |
|------|--------|
| `src/lib/storage.js` | Create — **9** per-type stores (not 7) + localStorage fallback |
| `src/lib/quota.js` | Create — 3-stage eviction (85/90/95%) |
| `src/lib/sm2.js` | ➕ Create — SM-2 algorithm: `nextReview(state, rating)` returns updated state |
| `src/lib/migration.js` | Create — v5 localStorage → v1 IndexedDB; **SM-2 fields seeded from defaults** (no source data to migrate from) |
| Engine persistence (5 engines) | Update — use `storage.js` instead of raw `localStorage` |
| `src/lib/tracker.js` | Update — per-type table reads/writes, SM-2 fields for flashcards |
| `tests/unit/lib/storage.test.js` | Create |
| `tests/unit/lib/quota.test.js` | Create |
| `tests/unit/lib/sm2.test.js` | ➕ Create — known-answer tests for SM-2 algorithm |
| `tests/unit/sync/migration.test.js` | Create — empty-state migration (since v5 SM-2 data doesn't exist) |

### ⚠️ IndexedDB Store Count Fix (V15)

Appendix A lists **9** stores (`quizTracker`, `flashcardTracker`, `writtenTracker`, `osceTracker`, `studyEvents`, `userContent`, `streak`, `syncLog`, `settings`). The Phase 2 narrative says "7 per-type stores". Adopt **9** everywhere.

### Phase 2 Order

```
1. storage.js (9 stores, fallback, CRUD)
2. sm2.js (pure algorithm, fully unit-tested)
3. tracker.js (uses storage + sm2)
4. quota.js
5. migration.js (seeds defaults; legacy key cleanup only)
6. quiz-engine persistence rewrite
7. bank/flashcard/written/osce persistence rewrite
8. flashcard-engine: wire SM-2 to "Again/Hard/Good/Easy" buttons
```

⚠️ **Don't reuse the old `engine-tracker.js` shape verbatim.** It currently stores a flat object per quiz; the new schema in Appendix A wants `{contentUid, itemId}` composite keys. Migration must rebuild the index.

---

## Phase 3 — Firebase & Sync (2 weeks)

**Depends on:** Phase 2
**Verification:**
```bash
npm run build                              # Compiles
npm test                                   # Unit + contract tests pass
npm test -- --grep=SM-2                    # SM-2 merge contract tests pass
# Manual: sign in with Google, study on two devices, progress syncs
```

| File | Action |
|------|--------|
| `src/lib/firebase.js` | Create — Firebase init (auth, firestore, analytics) |
| `src/lib/auth.js` | Create — guest → google → github state machine |
| `src/lib/sync.js` | Create — 3-tier conflict resolution + sync log |
| `src/lib/analytics.js` | Create — study event tracking |
| `hub/index.html` | Update — auth UI, "My Content" section |
| `tests/unit/sync/sm2-merge.test.js` | Create — two-device SM-2 merge contract |
| `tests/unit/sync/field-merge.test.js` | Create |

### ➕ Analytics Event Taxonomy (V20)

`analytics.js` emits events with this exact shape — engines must not invent their own:

```json
{
  "type": "study_event",
  "contentType": "quiz|bank|flashcard|written|osce",
  "contentUid": "string",
  "action": "started|answered|flagged|completed|exported",
  "itemId": "string|null",
  "outcome": "correct|wrong|skipped|rating_1|rating_2|rating_3|rating_4|null",
  "durationMs": 0,
  "deviceId": "string",
  "ts": "ISO8601"
}
```

Events land in the `studyEvents` IndexedDB store first, then sync to Firestore in batches. Never block UI on analytics.

No publish buttons in tools (admin-only). Hub shows "My Content" read from `userContent` store.

### Phase 3 Order

```
1. firebase.js (init only — auth + firestore + analytics)
2. auth.js (guest → google → github)
3. hub auth UI
4. sync.js (3 merge strategies + syncLog writes)
5. analytics.js (event taxonomy above)
6. "My Content" hub section
7. SM-2 + field-merge contract tests
```

---

## Phase 4 — UI Polish + Anki CSV (1.5 weeks) — ⚠️ FIXED

> **Reality Check:** Phase 4's emoji grep targets `src/` but emojis live in `engines/*.js`. Verified still present: 📁 (`written-engine.js:556`, `sync-engine.js:1324,1400`), 🃏 (`flashcard-engine.js:36,278`), 🩺 (`osce-engine.js:83`). The original grep would silently pass while doing nothing.

**Depends on:** Phase 0 + 0.5. Can run parallel with Phases 2-3.
**Verification:**
```bash
npm run build                                                   # Compiles
grep -rE '[\xF0\x9F\x80-\xBF][\x80-\xBF]{2}' engines/ src/      # Zero emoji (fixed pattern)
# Manual: export flashcards to CSV, import into Anki
# Manual: tab through quiz UI, all interactive elements reachable
```

⚠️ **V8 fix:** the grep pattern in the original plan only matched a hard-coded list of 10 emoji. Replace with a UTF-8 byte-pattern grep that catches *any* emoji. Or use `rg -uP '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{1F1E6}-\x{1F1FF}]'`.

| File | Action |
|------|--------|
| `src/lib/anki.js` | Create — TSV import/export, cloze detection |
| Hub + all engines | Update — replace emoji with Lucide SVGs |
| `src/css/shared.css` | Update — elevation/spacing tokens applied |
| All engine render functions | Refactor — use `ui.js` instead of `innerHTML +=` |
| Flashcard engine | Update — add "Export to Anki" button in results screen |
| Anki import | Lives in admin `ContentEditor` (Phase 5), not in web tools |

### ➕ Accessibility Checklist (V22)

Engines today use `onclick=""` attributes and lack keyboard support. Phase 4 must:

- [ ] Every button has `type="button"` and is reachable via Tab
- [ ] Every modal traps focus and restores on close
- [ ] All icon-only buttons have `aria-label`
- [ ] Color is never the only signal for correct/wrong (add ✓ / ✗ icons)
- [ ] Quiz answer options are `<label>` wrapping `<input type="radio">` for screen readers
- [ ] Flashcard flip is triggered by Space/Enter, not only click
- [ ] `prefers-reduced-motion` disables flip animations

### Phase 4 Order

```
1. anki.js (TSV export with cloze detection)
2. emoji → Lucide SVG replacement (hub + all engines)
3. CSS tokens applied across all engines
4. ui.js refactor (innerHTML → createElement)
5. Flashcard "Export to Anki" button
6. Accessibility pass per checklist above
```

---

## Phase 5.0 — Tauri Admin Scaffolding (0.5 week) — ➕ NEW

> **Why this phase exists:** Phase 5 says "Update `tauri-admin/src/commands.rs`" but no `tauri-admin/` directory exists in the repo. Phase 5 as written has nothing to update. Scaffolding must happen first.

**Depends on:** Phase 1
**Verification:**
```bash
cd tauri-admin && cargo build          # Empty app compiles
cd tauri-admin && cargo run             # Window opens with "Hello Osler Admin"
```

| File | Action |
|------|--------|
| `tauri-admin/Cargo.toml` | ✓ exists — tauri 2.x, reqwest, serde, tokio, git2 |
| `tauri-admin/tauri.conf.json` | ✓ exists — window config, safe-storage + http plugins |
| `tauri-admin/src/main.rs` | ✓ exists — Tauri boot |
| `tauri-admin/src/lib.rs` | Create — module root |
| `tauri-admin/src/commands.rs` | ✓ exists — empty command registry (Phase 5 fills it) |
| `tauri-admin/frontend/index.html` | ✓ exists — empty shell with nav for 7 pages |
| `tauri-admin/frontend/main.js` | Create — Tauri API glue |

➕ **Security note (V21):** `tauri.conf.json` must enable `safeStorage` for any GitHub token storage. Plain `localStorage` in the webview is forbidden for secrets. Phase 5 will enforce this.

---

## Phase 5 — GitHub CMS (4 weeks) — ⚠️ COUNT FIX

> **Reality Check:** Phase 5 summary says "16 files" but the table lists only 6. The expanded manifest below actually counts 16.

**Depends on:** Phase 1 (content format) + Phase 5.0 (scaffolding). Can run parallel with Phases 2-4.
**Verification:**
```bash
cd tauri-admin && cargo build                    # Compiles
cd tauri-admin && cargo test                     # Rust tests pass
# Manual: sign in with GitHub, create quiz in ContentEditor, preview, commit, deploy
```

### File Manifest (corrected to 16 files)

| File | Action |
|------|--------|
| `tauri-admin/src/commands.rs` | Update — 8 GitHub commands + content CRUD |
| `tauri-admin/src/deploy.rs` | Create — provider-aware deploy (Pages/Netlify/Vercel) |
| `tauri-admin/src/mcp_server.rs` | Create — 14 MCP tools |
| `tauri-admin/src/git.rs` | Create — clone/commit/push/PR helpers (extracted from commands) |
| `tauri-admin/src/auth.rs` | Create — GitHub OAuth flow, safe-storage token persistence |
| `tauri-admin/src/validation.rs` | Create — wraps `src/schemas/*` for live preview validation |
| `tauri-admin/frontend/index.html` | Update — 7 pages |
| `tauri-admin/frontend/dashboard.js` | Create |
| `tauri-admin/frontend/repo-browser.js` | Create |
| `tauri-admin/frontend/content-editor.js` | Create — JSON editor + preview + validate + commit + Anki CSV import |
| `tauri-admin/frontend/pull-requests.js` | Create |
| `tauri-admin/frontend/deploy.js` | Create |
| `tauri-admin/frontend/analytics.js` | Create |
| `tauri-admin/frontend/settings.js` | Create |
| `tauri-admin/tauri.conf.json` | Update — safe-storage, HTTP plugins, updater plugin (for Phase 8) |
| `tauri/src/engines.rs` | Update — embed rebuilt engines (used by instance generator) |

### Admin Pages

| Page | What It Does |
|------|-------------|
| **Dashboard** | Repo overview, recent activity, PR status |
| **RepoBrowser** | Navigate repo tree, filter by `.json` content files |
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

### Phase 5 Order

```
1. auth.rs (GitHub OAuth + safe-storage token)
2. git.rs (clone/commit/push/PR helpers)
3. validation.rs (wraps src/schemas)
4. 8 Rust commands in commands.rs
5. 7 admin frontend pages (start with ContentEditor)
6. mcp_server.rs (thin wrapper around commands)
7. deploy.rs + Deploy page
8. cargo build + cargo test
```

---

## Phase 6 — AI Pipeline (1 week)

**Depends on:** Phase 1 + Phase 5 (MCP). Can run parallel with Phase 7 prep.
**Verification:**
```bash
npm run build                                  # Compiles
npm run export-schemas                         # Schemas in .agents/context/
# Manual: "Create 10 cardiology questions" → AI generates JSON in ContentEditor
```

| File | Action |
|------|--------|
| `src/lib/content-gen.js` | Create — 3-stage Gemini pipeline |
| `.agents/context/*.json` | Generate — via `npm run export-schemas` |
| `.agents/skills/create-quiz.md` | Create |
| `.agents/skills/create-flashcard.md` | Create |
| `.agents/skills/edit-content.md` | Create |
| `.agents/skills/content-review.md` | Create |
| `.agents/skills/anki-csv.md` | Create |

⚠️ **V18:** `npm run export-schemas` is a verification command here. Phase 0 must ship a working version (not a stub) before Phase 6 starts. The Phase 0 stub is acceptable for Phase 1's purposes; Phase 6 requires the real implementation that emits to `.agents/context/`.

3 stages: NL→outline (user prompt → structured outline) → extraction (Flash-Lite, $0.015/K) → conversion (Pro, $0.50/K). Quality gate: score < 0.7 → "Needs Review" queue in admin. Cost caps: $20/day, $200/month.

---

## Phase 7 — Test & Ship (1.5 weeks) — ⚠️ TARGET FIX

> **Reality Check:** Phase 7 says "10+ Playwright journeys" but lists exactly 10 specs; Automation says "20 journeys". Metrics says "Performance 95+", Phase 7 says "90+ all categories". Pick one.

**Adopted:** 10 e2e spec files covering 20 user journeys (2 journeys per spec on average). Lighthouse target: **Performance 95+, Accessibility 90+, Best Practices 95+, SEO 90+, PWA all checks pass.**

**Depends on:** All phases
**Verification:**
```bash
npm run check                                              # Build + validate + unit tests pass
npm run test:e2e                                           # 10 spec files, 20 journeys pass
npx lighthouse http://localhost:5500 --view                # Perf 95+, A11y 90+, PWA pass
npx lighthouse http://localhost:5500 --output=json --output-path=lh.json
node -e "JSON.parse(require('fs').readFileSync('lh.json')).categories.pwa.score"  # === 1
```

| File | Action |
|------|--------|
| `tests/e2e/player.spec.js` | Create — 2 journeys: render quiz, render flashcard |
| `tests/e2e/quiz-session.spec.js` | Create — 2 journeys: complete a quiz, retry wrong answers |
| `tests/e2e/flashcard-study.spec.js` | Create — 2 journeys: SM-2 ratings, export to Anki |
| `tests/e2e/bank-session.spec.js` | Create — 2 journeys: highlight, flag |
| `tests/e2e/written-assessment.spec.js` | Create — 2 journeys: draft save, AI feedback |
| `tests/e2e/osce-simulation.spec.js` | Create — 2 journeys: red-flag detection, differential |
| `tests/e2e/firebase-auth.spec.js` | Create — 2 journeys: Google sign-in, guest mode |
| `tests/e2e/anki-csv.spec.js` | Create — 2 journeys: export, cloze detection |
| `tests/e2e/content-gen.spec.js` | Create — 2 journeys: NL→outline, full pipeline |
| `tests/e2e/github-cms.spec.js` | Create — 2 journeys: create+commit, PR merge |
| `tests/integration/storage.test.js` | Create |
| `tests/integration/sync-adapter.test.js` | Create |
| `sw.js` | Update — cache strategies with named caches (extends Phase 0.5) |
| `AGENTS.md` | Update — Osler V1 reference, fix `v6-plan.md` → `v1-osler-plan.md` |
| `.github/workflows/ci.yml` | Create — matrix: Node 20 + Rust stable, run `npm run check` + `cargo build` |

---

## Phase 8 — Update System (2 weeks) — ⚠️ BUNDLE FIX

> **Reality Check:** Phase 8 update bundle lists 8 engines but the codebase has **13** engine files. Omitting `engine-shared.js`, `engine-tracker.js`, `index-engine.js` from the bundle means generated instances will fail to load any engine — `engine-shared.js` is a hard dependency of every other engine.

**Depends on:** Phase 5 (admin dashboard), Phase 7 (CI/CD)
**Verification:**
```bash
npm run build                                          # Engines + update-manifest.json
cd tauri-admin && cargo build                          # Admin with updater
npm run test:e2e -- --grep=update                      # Update bundle + push tests
npm run check-updates                                  # Verifies bundle integrity
# Manual: admin installs update → restarts → shows new version
# Manual: admin pushes engine update → instance shows update badge
```

### Architecture

Two tiers:
```
Main Repo (osler) ──▶ GitHub Releases ──▶ Admin Dashboard (self-update)
                  │
                  └──▶ Engine Update Bundle ──▶ Generated Instances (push update)
```

### Tier 1 — Admin Dashboard Self-Update

| File | Action |
|------|--------|
| `tauri-admin/src/updater.rs` | Create — GitHub Releases API check, download, hash verify, swap |
| `tauri-admin/src/commands.rs` | Update — add `check_update`, `apply_update`, `get_update_status` |
| `tauri-admin/frontend/index.html` | Update — Update page with status, progress, changelog |
| `tauri-admin/tauri.conf.json` | Update — updater plugin config |

**Updater flow:**
```
Admin starts → Updater checks GitHub Releases API → compares semver
  if newer: notify user with changelog → user clicks "Update & Restart"
  download binary to temp dir → hash verify → swap executable → restart
```

**Fallbacks:**
- No network → skip check, show "Update unavailable (offline)"
- Hash mismatch → abort, log error, notify user
- Permission denied → show manual download instructions
- Admin can disable auto-check in Settings

### Tier 2 — Engine Updates to Generated Instances

| File | Action |
|------|--------|
| `src/lib/update-manifest.json` | Create — version manifest shipped with each build |
| `tauri-admin/src/bundle_engines.rs` | Create — extract engines + critical assets into update bundle |
| `tauri-admin/src/push_update.rs` | Create — push bundle to instance repos via PR |
| `tauri-admin/frontend/index.html` | Update — "Managed Instances" page |
| `sw.js` | Update — check `update-manifest.json` on service worker activation |
| `tauri-admin/src/commands.rs` | Update — `bundle_update`, `push_update`, `check_instance_versions` |
| `tests/e2e/update-bundle.spec.js` | Create |
| `tests/e2e/update-push.spec.js` | Create |

### ⚠️ Corrected Update Bundle Contents (V12)

```
update-v1.2.3.zip
├── engines/
│   ├── engine-shared.js            # ➕ REQUIRED — every engine depends on it
│   ├── engine-tracker.js           # ➕ REQUIRED — persistence layer
│   ├── index-engine.js             # ➕ REQUIRED — hub navigation
│   ├── quiz-engine.js
│   ├── bank-engine.js
│   ├── flashcard-engine.js
│   ├── written-engine.js
│   ├── osce-engine.js
│   ├── uworld-engine.js            # ➕ was missing
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

### Push flow

```
Admin selects instances → "Push Update v1.2.3"
  For each instance: clone → checkout update-branch → apply bundle files
  → commit → push → open PR "[Update] v1.2.3"
  → (optional) auto-merge if CI passes
```

### Instance-side update detection

```
Service worker activates → checks update-manifest.json for version
  if mismatched with stored version → show "Update available" badge in hub
  → (future: auto-update on next load)
```

### ➕ Security Checklist (V21)

- [ ] Update bundles are signed with a release key (hash in `update-manifest.json`)
- [ ] Admin must authenticate via GitHub OAuth before pushing to instances
- [ ] Push targets only instance repos the admin has write access to
- [ ] GitHub token stored in Tauri `safeStorage` only — never `localStorage`, never logs
- [ ] Bundle hash verified on receipt before any file is swapped
- [ ] Rollback tag pushed before each update (`update-v1.2.3-previous`)
- [ ] All GitHub API calls rate-limited and retried with exponential backoff

### Rollback

- Each push creates a git tag `update-v1.2.3-previous`
- Rollback = checkout tag, force-push
- Admin page shows last 5 updates per instance with rollback button

### Phase 8 Order

```
1. update-manifest.json schema + generator (in src/build.js)
2. bundle_engines.rs (all 12 engine files + assets + sw + manifest)
3. updater.rs (Tier 1 self-update)
4. push_update.rs (Tier 2 push to instances)
5. sw.js update-manifest check
6. Admin UI: Update page + Managed Instances page
7. e2e tests: bundle generation + push
8. Security review against checklist above
```

---

## Design Reference

### A — IndexedDB Schema (corrected to 9 stores)

```
DB: osler-v1 (version 1)
├── quizTracker       key: {contentUid, itemId}    value: { wrongCount, consecutiveCorrect, flagged, highlights, notes, updatedAt }
├── flashcardTracker  key: uid                      value: { easeFactor, interval, nextReviewAt, repetitions, lapses, lastRating, lastReviewedAt, totalReviews, avgTimePerReview, updatedAt }
├── writtenTracker    key: uid                      value: { drafts[5], submissions, bestAiScore, lastAiFeedback, updatedAt }
├── osceTracker       key: uid                      value: { rubricScores, missedRedFlags, differentialAccuracy, updatedAt }
├── studyEvents       autoKey                       value: { contentType, contentUid, action, itemId, outcome, durationMs, deviceId, ts }
├── userContent       key: uid                      value: { type, title, questions, tags, createdAt, updatedAt, syncStatus }
├── streak            key: 'global'                 value: { currentStreak, longestStreak, xp, level, lastActivityDate }
├── syncLog           autoKey                       value: { entryType, entryUid, operation, fieldChanges, timestamp, deviceId }
└── settings          key: settingName              value: any
```

⚠️ The `studyEvents` shape is now expanded to match the Phase 3 analytics taxonomy (V20). Original schema was missing `itemId`, `outcome`, `durationMs`. `streak` is missing `lastActivityDate` — added because conflict resolution in Appendix D references it.

### B — CSS Tokens (unchanged)

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
{
  "meta": {
    "uid": "unique_id",
    "title": "Title",
    "description": "...",
    "icon": "heart",
    "tags": [],
    "schemaVersion": "1.0",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  },
  "type": "quiz",
  "questions": [
    { "id": "q-001", "question": "...", "options": [], "correct": 0, "explanation": "...", "tags": [], "difficulty": 5 }
  ]
}
```

➕ Added `meta.schemaVersion` to support the Phase 1 versioning policy (V19). Types: quiz, bank, flashcard, written, osce. Schema per type in `/src/schemas/`.

### D — Conflict Resolution (unchanged in strategy, clarified in scope)

| Data Type | Strategy |
|-----------|----------|
| studyEvents | Append-only |
| quizTracker / writtenTracker / osceTracker | Field-level merge by `updatedAt` |
| flashcardTracker | SM-2: later review wins state, both count toward totals |
| userContent | Last-write-wins body, keep both titles on conflict |
| streak | Max of `currentStreak`, `lastActivityDate` |

### E — Key Decisions (unchanged)

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

### F — Anti-Goals (unchanged)

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

### G — Metrics & Budgets (single source of truth)

| Metric | Target | Owner Phase |
|--------|--------|-------------|
| Bundle per engine | <80 KB gzipped | 0 |
| Lighthouse Performance | 95+ | 7 |
| Lighthouse Accessibility | 90+ | 4, 7 |
| Lighthouse Best Practices | 95+ | 7 |
| Lighthouse SEO | 90+ | 7 |
| PWA audit | All checks pass | 0.5, 7 |
| Unit test coverage | 70%+ on `src/lib/` | 0, 2, 3 |
| E2E pass rate | 100% on 10 spec files / 20 journeys | 7 |
| Sync merge correctness | 100% on contract tests | 3 |
| Content-gen cost per 10-quiz | ≤$0.50 | 6 |
| Content-gen cost cap | $20/day, $200/month | 6 |
| Time-to-first-question | ≤3s on 3G | 0, 0.5 |
| Install prompt gate | 5+ sessions | 0.5 |
| Update bundle size | <2 MB | 8 |
| Update push success rate | 99%+ on retry | 8 |

⚠️ Original Metrics section had inconsistent Lighthouse targets ("90+ all categories" vs "Performance 95+"). This table is the single source of truth.

---

## Cross-Cutting Concerns

These don't belong to any single phase but must be respected throughout:

1. **Engine path resolution** — every engine must use `window.__{NAME}_ENGINE_BASE` (e.g. `__BANK_ENGINE_BASE`), not a sibling engine's constant. Audit in Phase 0, enforce in CI from Phase 1 onward.
2. **Schema validation is mandatory** — no JSON content lands in `content/` without passing `npm run validate`. CI gate from Phase 1.
3. **IndexedDB only for user data** — `localStorage` is allowed only for ephemeral UI state (theme, last engine visited). All tracker/streak/sync data goes through `storage.js`. Enforce via grep in CI from Phase 2.
4. **No new runtime dependencies** — every "Key Decision" in Appendix E is a hard constraint. Adding a dependency requires updating the Anti-Goals list and the user's explicit approval.
5. **Tests follow the pyramid** — unit > integration > e2e. If an e2e journey can be a unit test, it must be. CI runs unit + integration on every PR; e2e only on main merge.
6. **AGENTS.md is the agent contract** — any agent working on the repo reads `AGENTS.md` first, then this plan. Both must stay in sync. Phase 7 finalizes both.
