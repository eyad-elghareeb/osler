# Osler V1 — LLM Execution Guide

> **Audience:** cheaper LLMs (GPT-4o-mini / Claude Haiku / Sonnet / local 7B-14B) executing one session at a time.
> **Companion to:** `v1-osler-plan-enhanced.md` (the validated plan).
> **How to use:** Each session is self-contained. The agent reads **only its session block**, executes the steps in order, runs the gate, and stops. Do not peek at later sessions. Do not skip the gate.

---

## How To Use This Document

### Rules for the executing agent

1. **One session per invocation.** Read the session header, do the work, run the gate, stop.
2. **Do not assume context.** If a session says "depends on Session X.Y", that session's outputs are on disk; verify by reading the file paths listed in `Verify Inputs`.
3. **Files are sacred.** Only touch files listed in `Files Touched`. If you need to touch another file, stop and ask.
4. **The gate is the contract.** If the gate doesn't pass, you are not done. Do not mark the session complete.
5. **No improvisation.** If the session doesn't say how to do something, ask the human. Don't invent patterns.
6. **Commit after every session.** Use the commit message template in the session.
7. **If you're stuck for >3 attempts on the same step**, stop and report the blocker. Don't burn tokens.

### Reading order per session

```
1. Session Header (phase, ID, depends on)
2. Goal (one sentence)
3. Verify Inputs (files that must exist on disk)
4. Files Touched (exact paths)
5. Steps (numbered, atomic)
6. Test Gate (must pass before commit)
7. Commit Message (copy-paste)
8. Rollback (how to undo)
9. Hand-off (what the next session expects)
```

### Tier tagging

Each session is tagged with the minimum model tier that can reliably execute it:

| Tag | Tier | Notes |
|-----|------|-------|
| `[T1]` | GPT-4o-mini / Haiku / Qwen-7B | Atomic, mechanical, well-specified |
| `[T2]` | GPT-4.1 / Sonnet / Llama-70B | Requires multi-file coordination, some judgment |
| `[T3]` | Opus / GPT-4.5 / Pro-class | Architectural decisions, novel code |

Cheaper models should be routed to T1 sessions. T2 sessions can go to mid-tier. T3 sessions need a strong model and human review.

---

## Cost & Time Estimates (per session)

| Phase | Sessions | Total Est. Tokens | Total Est. Wall-Clock |
|-------|----------|-------------------|----------------------|
| Phase 0 (reopened) | 8 | ~85K | ~6 hours |
| Phase 0.5 | 2 | ~18K | ~1 hour |
| Phase 1 | 5 | ~60K | ~4 hours |
| Phase 2 | 7 | ~95K | ~8 hours |
| Phase 3 | 6 | ~80K | ~6 hours |
| Phase 4 | 5 | ~70K | ~5 hours |
| Phase 5.0 | 3 | ~30K | ~2 hours |
| Phase 5 | 9 | ~140K | ~14 hours |
| Phase 6 | 4 | ~55K | ~4 hours |
| Phase 7 | 6 | ~85K | ~6 hours |
| Phase 8 | 7 | ~110K | ~8 hours |
| **Total** | **62 sessions** | **~830K tokens** | **~64 hours** |

Tokens assume a Sonnet-class model. Haiku will use ~1.3× tokens due to more retry loops. Opus will use ~0.8× due to fewer mistakes.

---

## Dependency Graph (Session-Level)

```
P0.1 ─▶ P0.2 ─▶ P0.3 ─▶ P0.4 ─▶ P0.5 ─▶ P0.6 ─▶ P0.7 ─▶ P0.8
                                                        │
                                                        ▼
                                                       P0.5.1 ─▶ P0.5.2
                                                                   │
                                                                   ▼
P1.1 ─▶ P1.2 ─▶ P1.3 ─▶ P1.4 ─▶ P1.5
                                  │
       ┌─────────────────────────┼─────────────────────────┐
       ▼                         ▼                         ▼
P2.1 ─▶ P2.2 ─▶ P2.3 ─▶ P2.7   P4.1 ─▶ P4.2 ─▶ P4.5      P5.0.1 ─▶ P5.0.2 ─▶ P5.0.3
              │                                                │
              ▼                                                ▼
       P2.4 ─▶ P2.5 ─▶ P2.6                                P5.1 ─▶ P5.2 ─▶ P5.3 ─▶ P5.4 ─▶ P5.5 ─▶ P5.6 ─▶ P5.7 ─▶ P5.8 ─▶ P5.9
                                                            │
                                                            ▼
                                                          P6.1 ─▶ P6.2 ─▶ P6.3 ─▶ P6.4
                                                            │
P3.1 ─▶ P3.2 ─▶ P3.3 ─▶ P3.4 ─▶ P3.5 ─▶ P3.6                │
                                                            ▼
                                                          P7.1 ─▶ P7.2 ─▶ P7.3 ─▶ P7.4 ─▶ P7.5 ─▶ P7.6
                                                            │
                                                            ▼
                                                          P8.1 ─▶ P8.2 ─▶ P8.3 ─▶ P8.4 ─▶ P8.5 ─▶ P8.6 ─▶ P8.7
```

**Parallelizable after Phase 1:** P2.x (left branch), P4.x (middle branch), P5.0.x + P5.x (right branch). P3 requires P2 done.

---

# PHASE 0 — FOUNDATION (REOPENED)

> **Status:** Phase 0 was completed in the initial commit but the llm-execution-guide was written before the work was done. The following sessions (P0.1-P0.8) serve as a **verification trace** — execute the test gates to confirm everything is in place, then skip creation steps for files that already exist.
> **Sessions:** 8 · **Estimated:** ~6 hours · **Minimum tier:** T2 for P0.1, T1 for the rest.

---

## Session P0.1 — Rewrite `src/build.js` to use esbuild `[T2]`

**Depends on:** nothing (this is the unblocker)
**Goal:** Replace the `fs.copyFileSync` pass-through with actual esbuild bundling so all downstream lib work is possible.

### Verify Inputs
- `package.json` exists at repo root and lists `esbuild` in devDependencies
- `engines/*.js` contains 13 IIFE browser scripts (source of truth)
- `src/build.js` currently uses `copyFileSync` (verified broken)

### Files Touched
- `src/build.js` (rewrite)
- `dist/.gitignore` (create — gitignore build output)

### Steps

1. Read `src/build.js`. It already uses esbuild (or copyFileSync — verify). The key change: ensure `assets/` → `dist/assets/` and `manifest.webmanifest`, `sw.js` are copied to dist/. If build.js is a copy pass-through, add these files to the copy list.
2. Run `npm run build` and confirm zero errors

### Test Gate
```bash
npm run build
test -f dist/quiz-engine.js
test -f dist/engine-shared.js
test -f dist/uworld-engine.js
test -f dist/shared.css
node -e "const fs=require('fs'); const s=fs.statSync('dist/quiz-engine.js'); if(s.size<1000) throw new Error('output too small')"
```

All commands must exit 0. If `npm run build` errors, the most likely cause is an engine file with syntax errors — fix the engine, not the build script.

### Commit Message
```
build(phase-0): rewrite src/build.js to use esbuild

Replaces copyFileSync pass-through with actual esbuild.build() per engine.
Engines remain IIFE (bundle:false) since they rely on script-load order.

Unblocks Phase 0 lib work.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
Session P0.2 expects `npm run build` to succeed. Verify with `npm run build && ls dist/`.

---

## Session P0.2 — Create test infrastructure `[T1]`

**Depends on:** P0.1
**Goal:** Vitest and Playwright configs that allow `npm test` and `npm run test:e2e` to run (even with zero tests initially).

### Verify Inputs
- `npm run build` succeeds (P0.1 done)
- `package.json` lists `vitest`, `@playwright/test`, `happy-dom`, `jsdom` in devDependencies

### Files Touched
- `vitest.config.js` (create)
- `playwright.config.js` (create)
- `tests/.gitkeep` (create)
- `tests/e2e/.gitkeep` (create)
- `tests/unit/.gitkeep` (create)
- `tests/fixtures/.gitkeep` (create)

### Steps

1. Verify `vitest.config.js` exists. Run `npm test` to confirm it works.
2. Create `playwright.config.js` (verified missing). Create the four `.gitkeep` files if needed.
3. Run `npm test` — should report "No test files found" and exit 0
4. Run `npx playwright test` — should report "No tests found" and exit 0

### Test Gate
```bash
npm test 2>&1 | grep -q "No test files found" && echo OK
npx playwright test 2>&1 | grep -q "No tests found" && echo OK
```

### Commit Message
```
test(phase-0): add vitest + playwright configs

Vitest uses happy-dom, coverage threshold 70% on src/lib/.
Playwright uses serve on :5500 for dev server.
```

### Rollback
```bash
git rm vitest.config.js playwright.config.js tests/
git commit -m "revert: test infra"
```

### Hand-off
P0.3 expects `npm test` to be runnable.

---

## Session P0.3 — Create missing npm scripts `[T1]`

**Depends on:** P0.2
**Goal:** `npm run validate` and `npm run export-schemas` must exit 0 (stubs acceptable for now; real impl in Phase 1).

### Verify Inputs
- `npm test` exits 0

### Files Touched
- `scripts/validate-content.js` (create — stub)
- `scripts/export-schemas.js` (create — stub)
- `scripts/.gitkeep` (create if dir empty)

### Steps

1. Create `scripts/validate-content.js`:
   ```js
   // Stub — real implementation lands in Phase 1 once src/schemas/ exists.
   // Validates all JSON in content/ against src/schemas/*.json
   import { readdirSync, existsSync } from 'fs';
   import { join } from 'path';
   const contentDir = join(process.cwd(), 'content');
   const schemasDir = join(process.cwd(), 'src', 'schemas');
   if (!existsSync(schemasDir)) {
     console.log('validate: no schemas yet (Phase 0 stub), skipping');
     process.exit(0);
   }
   if (!existsSync(contentDir)) {
     console.log('validate: no content/ dir, nothing to validate');
     process.exit(0);
   }
   console.log('validate: stub — real implementation pending Phase 1');
   process.exit(0);
   ```
2. Create `scripts/export-schemas.js`:
   ```js
   // Stub — real implementation lands in Phase 1.
   // Copies src/schemas/*.json to .agents/context/
   import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
   import { join } from 'path';
   const src = join(process.cwd(), 'src', 'schemas');
   const dst = join(process.cwd(), '.agents', 'context');
   if (!existsSync(src)) {
     console.log('export-schemas: no src/schemas/ yet, skipping');
     process.exit(0);
   }
   if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
   for (const f of readdirSync(src)) {
     if (f.endsWith('.json')) copyFileSync(join(src, f), join(dst, f));
   }
   console.log('export-schemas: stub — copied schemas to .agents/context/');
   ```
3. Run both commands to confirm exit 0
4. Run `npm run check` — should now succeed (build + test + validate all green)

### Test Gate
```bash
npm run validate; test $? -eq 0 && echo "validate OK"
npm run export-schemas; test $? -eq 0 && echo "export-schemas OK"
npm run check; test $? -eq 0 && echo "check OK"
```

### Commit Message
```
scripts(phase-0): add validate-content + export-schemas stubs

Both commands exit 0 today. Real implementations land in Phase 1
once src/schemas/ exists. This unblocks `npm run check` in CI.
```

### Rollback
```bash
git rm scripts/validate-content.js scripts/export-schemas.js
```

### Hand-off
P0.4 expects `npm run check` to exit 0.

---

## Session P0.4 — Extract `src/lib/{theme,toast,dom}.js` `[T1]`

**Depends on:** P0.3
**Goal:** Pull theme/toast/dom utilities out of `engine-shared.js` into importable ES modules. Engines continue to work because `engine-shared.js` re-exports them for backward compat.

### Verify Inputs
- `npm run check` exits 0
- `engines/engine-shared.js` exists and contains `toggleTheme`, `showToast`, `createElement`-like helpers

### Files Touched
- `src/lib/theme.js` (create)
- `src/lib/toast.js` (create)
- `src/lib/dom.js` (create)

### Steps

1. Verify `src/lib/theme.js`, `src/lib/toast.js`, `src/lib/dom.js` exist. Read each to confirm they export the expected API.
2. If any are missing OR incomplete, create/fix them.
3. **Do NOT modify `engine-shared.js` yet** — that's P0.7. The lib modules are standalone for now; engines still use the inline versions.

### Test Gate
```bash
# Modules must be importable in isolation
node --input-type=module -e "import * as theme from './src/lib/theme.js'; console.log(typeof theme.initTheme)" | grep -q function
node --input-type=module -e "import * as toast from './src/lib/toast.js'; console.log(typeof toast.showToast)" | grep -q function
node --input-type=module -e "import * as dom from './src/lib/dom.js'; console.log(typeof dom.h)" | grep -q function
npm run check  # still passes
```

### Commit Message
```
lib(phase-0): extract theme, toast, dom modules

Standalone ES modules in src/lib/. engine-shared.js still uses
inline versions — wiring happens in P0.7.
```

### Rollback
```bash
git rm src/lib/theme.js src/lib/toast.js src/lib/dom.js
```

### Hand-off
P0.5 expects theme/toast/dom modules to exist.

---

## Session P0.5 — Create `src/lib/{keyboard,ui,icons}.js` `[T2]`

**Depends on:** P0.4
**Goal:** Build the three new lib modules that don't have a source to extract from.

### Verify Inputs
- `src/lib/{theme,toast,dom}.js` exist and import cleanly

### Files Touched
- `src/lib/keyboard.js` (create)
- `src/lib/ui.js` (create)
- `src/lib/icons.js` (create)

### Steps

1. Verify `src/lib/keyboard.js`, `src/lib/ui.js`, `src/lib/icons.js` exist. Read each to confirm API surface.
2. If any are missing OR incomplete (e.g., fewer than 30 icons), create/fix them.
3. Smoke test: verify `tests/unit/lib/ui.test.js` exists and passes. Run `npm test`.

### Test Gate
```bash
npm test 2>&1 | grep -q "2 passed"
node --input-type=module -e "import { Icon } from './src/lib/icons.js'; const s=Icon('heart'); if(!s.includes('<svg')) throw new Error('no svg'); console.log('icons OK')"
npm run check
```

### Commit Message
```
lib(phase-0): add keyboard, ui, icons modules

keyboard.js: bindShortcuts() with mod+k / esc support.
ui.js: Card, Button, Modal, InstallPrompt, CmdKPalette using dom.h().
icons.js: 30 Lucide icons as inline SVG strings.
2 unit tests for ui.js (smoke).
```

### Rollback
```bash
git rm src/lib/keyboard.js src/lib/ui.js src/lib/icons.js tests/unit/lib/ui.test.js
```

### Hand-off
P0.6 expects all six lib modules to exist.

---

## Session P0.6 — Extract `src/lib/gemini.js` from `ai-assistant-engine.js` `[T2]`

**Depends on:** P0.5
**Goal:** Pull the Gemini API client out of `ai-assistant-engine.js` into a reusable module. Note: source is `ai-assistant-engine.js`, NOT `engine-shared.js` (the original plan had this wrong — V10).

### Verify Inputs
- `engines/ai-assistant-engine.js` exists, contains Gemini API call logic

### Files Touched
- `src/lib/gemini.js` (create)

### Steps

1. Verify `src/lib/gemini.js` exists. Read it to confirm `getClient`, `MODELS`, `streamGenerate` are exported.
2. If missing or incomplete, create/fix.
3. **Do NOT modify `ai-assistant-engine.js` yet** — wiring is P0.7.

### Test Gate
```bash
node --input-type=module -e "import { getClient, MODELS } from './src/lib/gemini.js'; console.log(MODELS.length, typeof getClient)"
# Should print "5 function" (5 models)
npm run check
```

### Commit Message
```
lib(phase-0): extract gemini.js from ai-assistant-engine

Source correction: original plan said "extracted from engine-shared.js"
but Gemini code lives in ai-assistant-engine.js. (V10 fix)

Exports MODELS, getClient, streamGenerate. ai-assistant-engine.js
still uses inline code — wiring happens in P0.7.
```

### Rollback
```bash
git rm src/lib/gemini.js
```

### Hand-off
P0.7 expects all 6 lib modules to exist (`theme`, `toast`, `dom`, `keyboard`, `ui`, `icons`, `gemini`).

---

## Session P0.7 — Re-extract CSS + fix `__BANK_ENGINE_BASE` bug `[T1]`

**Depends on:** P0.6
**Goal:** (1) Re-extract `src/css/uworld-engine.css` (currently 0 bytes), (2) extract `src/css/written-engine.css` (missing), (3) audit `src/css/osce-engine.css` (only 2 lines), (4) fix `bank-engine.js:9` `__QUIZ_ENGINE_BASE` → `__BANK_ENGINE_BASE`.

### Verify Inputs
- All 6 lib modules exist
- `src/css/uworld-engine.css` is 0 bytes (verified)
- `engines/bank-engine.js` line 9 reads `window.__QUIZ_ENGINE_BASE`

### Files Touched
- `src/css/uworld-engine.css` (rewrite — extract from `engines/uworld-engine.js`)
- `src/css/written-engine.css` (create — extract from `engines/written-engine.js`)
- `src/css/osce-engine.css` (rewrite if extraction is incomplete)
- `engines/bank-engine.js` (fix line 9)

### Steps

1. Verify all `src/css/*.css` files are non-empty. Specifically check `src/css/uworld-engine.css` (should be non-zero bytes).
2. In `engines/bank-engine.js`, check line 9 for the `__BANK_ENGINE_BASE` fix. If not already fixed, apply:
   ```js
   var ENGINE_BASE = EngineShared.ENGINE_BASE || (window.__BANK_ENGINE_BASE || window.__QUIZ_ENGINE_BASE || '');
   ```
   The `__QUIZ_ENGINE_BASE` fallback preserves backward compat with any existing deployments that set the global.
3. Run `npm run build && npm test`.

### Test Gate
```bash
test -s src/css/uworld-engine.css && echo "uworld CSS non-empty"
test -s src/css/written-engine.css && echo "written CSS non-empty"
test $(wc -l < src/css/osce-engine.css) -gt 5 && echo "osce CSS reasonable"
grep -q "__BANK_ENGINE_BASE" engines/bank-engine.js && echo "bank fix applied"
npm run check
```

### Commit Message
```
fix(phase-0): re-extract CSS + fix bank engine path bug

- uworld-engine.css: was 0 bytes, re-extracted (V7)
- written-engine.css: was missing, created (V11)
- osce-engine.css: was 2 lines, re-extracted
- bank-engine.js:9: __QUIZ_ENGINE_BASE → __BANK_ENGINE_BASE (V5)
  with __QUIZ_ENGINE_BASE kept as backward-compat fallback
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
P0.8 expects all CSS files non-empty and the bank-engine bug fixed.

---

## Session P0.8 — Wire lib modules into engines + sample test + doc sync `[T2]`

**Depends on:** P0.7
**Goal:** (1) Make `engine-shared.js` re-export from `src/lib/*` so engines transparently use the new modules. (2) Add a sample quiz fixture and unit test. (3) Fix `AGENTS.md` reference from `v6-plan.md` to `v1-osler-plan.md`.

### Verify Inputs
- All 6 lib modules + 9 CSS files exist and are non-empty
- `engines/engine-shared.js` still uses inline versions

### Files Touched
- `engines/engine-shared.js` (update — re-export from src/lib)
- `tests/fixtures/sample-quiz.json` (create)
- `tests/unit/lib/theme.test.js` (create)
- `AGENTS.md` (update line 19)

### Steps

1. Verify `tests/fixtures/sample-quiz.json` exists. Verify `tests/unit/lib/theme.test.js` exists and passes.
2. Run `npm test` to confirm all tests pass.
3. Update `AGENTS.md` line 19: change `v6-plan.md` to `v1-osler-plan.md` if not already done. Also update the heading on line 1 if it still says "V1" inconsistently.
4. Run `npm run check`.

### Test Gate
```bash
npm test 2>&1 | grep -E "[0-9]+ passed" | head -1   # at least 2 tests pass
test -f tests/fixtures/sample-quiz.json
grep -q "v1-osler-plan" AGENTS.md
npm run check
```

### Commit Message
```
phase-0: finalize lib modules, add sample test, fix AGENTS.md reference

- tests/fixtures/sample-quiz.json: minimal valid quiz
- tests/unit/lib/theme.test.js: 2 unit tests
- AGENTS.md: v6-plan.md → v1-osler-plan.md (V13 fix)

Phase 0 complete. Engines continue to use engine-shared.js inline
helpers; new code (Phase 2+) imports from src/lib/* directly.
Phase 4 will refactor engines to consume src/lib/*.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
Phase 0 is done. P0.5.1 (PWA) can begin. P1.1 (schemas) can begin in parallel.

---

# PHASE 0.5 — PWA SKELETON

> **Sessions:** 2 · **Estimated:** ~1 hour · **Minimum tier:** T2 for P0.5.1, T1 for P0.5.2.

---

## Session P0.5.1 — Create `sw.js` with named caches `[T2]`

**Depends on:** Phase 0 complete
**Goal:** Four engines register `sw.js` but it doesn't exist. Create it.

### Verify Inputs
- `npm run check` passes
- `grep -r "sw.js" engines/` shows 4 references (bank, flashcard, quiz, uworld)
- `manifest.webmanifest` exists at repo root

### Files Touched
- `sw.js` (verify exists at repo root)
- `src/build.js` (update — copy `sw.js` to `dist/`)

### Steps

1. Verify `sw.js` exists at repo root.
2. Update `src/build.js` to copy `sw.js` to `dist/` if not already doing so.
3. Run `npm run build && test -f dist/sw.js`

### Test Gate
```bash
npm run build
test -f dist/sw.js
node -e "const fs=require('fs'); const s=fs.readFileSync('sw.js','utf8'); if(!s.includes('osler-static-v1')) throw new Error('missing static cache'); if(!s.includes('stale-while-revalidate')) throw new Error('missing SWR'); console.log('sw.js OK')"
npm run check
```

### Commit Message
```
pwa(phase-0.5): add sw.js with named caches

Two caches: osler-static-v1 (engines, CSS, icons) and
osler-content-v1 (JSON content). Strategies:
- *.js, *.css: stale-while-revalidate
- *.json: network-first, 5s timeout, cache fallback
- icons: cache-first

Phase 8 will extend activate handler to check update-manifest.json.
```

### Rollback
```bash
git rm sw.js
# revert build.js change
git checkout HEAD~1 -- src/build.js
```

### Hand-off
P0.5.2 expects `dist/sw.js` to exist after build.

---

## Session P0.5.2 — Manifest audit + install prompt `[T1]`

**Depends on:** P0.5.1
**Goal:** Audit `manifest.webmanifest` for completeness and add the install-prompt lib.

### Verify Inputs
- `dist/sw.js` exists after build
- `manifest.webmanifest` exists

### Files Touched
- `manifest.webmanifest` (update if needed)
- `src/lib/install-prompt.js` (create)

### Steps

1. Read `manifest.webmanifest`. Verify it has: `name`, `short_name`, `description`, `start_url: "."`, `display: "standalone"`, `background_color`, `theme_color`, `icons` array with sizes 48/72/96/144/192/512, `purpose: "any maskable"`.
2. If any field is missing, add it. Theme/background colors: `#0d1117` and `#161b22` (match `engine-shared.js` CSS vars).
3. Create `src/lib/install-prompt.js`:
   ```js
   let deferredPrompt = null;
   const SESSION_KEY = 'osler_session_count';
   export function initInstallPrompt() {
     window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
     window.addEventListener('appinstalled', () => { deferredPrompt = null; });
   }
   export function canPrompt() {
     if (!deferredPrompt) return false;
     const count = parseInt(localStorage.getItem(SESSION_KEY) || '0', 10);
     return count >= 5;  // gate at 5 sessions per Metrics target
   }
   export async function promptInstall() {
     if (!canPrompt()) return false;
     deferredPrompt.prompt();
     const { outcome } = await deferredPrompt.userChoice;
     deferredPrompt = null;
     return outcome === 'accepted';
   }
   export function incrementSession() {
     const n = parseInt(localStorage.getItem(SESSION_KEY) || '0', 10) + 1;
     localStorage.setItem(SESSION_KEY, String(n));
   }
   ```
4. Run `npm run check`.

### Test Gate
```bash
node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest','utf8')); console.log('manifest parses')"
test -f src/lib/install-prompt.js
grep -q "maskable" manifest.webmanifest
npm run check
```

### Commit Message
```
pwa(phase-0.5): audit manifest, add install-prompt

manifest.webmanifest: added missing fields (theme_color, maskable purpose).
src/lib/install-prompt.js: 5-session gate before showing prompt.
```

### Rollback
```bash
git rm src/lib/install-prompt.js
git checkout HEAD~1 -- manifest.webmanifest
```

### Hand-off
Phase 0.5 done. Lighthouse PWA audit should now pass (verify in Phase 7).

---

# PHASE 1 — CONTENT FORMAT

> **Sessions:** 5 · **Estimated:** ~4 hours · **Minimum tier:** T2 for P1.1, T1 for rest.

---

## Session P1.1 — Create `_meta.json` schema registry + 6 type schemas `[T2]`

**Depends on:** Phase 0 complete
**Goal:** Define the JSON Schemas for all 6 content types + the registry that pins them.

### Verify Inputs
- `npm run check` passes
- `src/schemas/` does not exist yet (we're creating it)

### Files Touched
- `src/schemas/_meta.json` (create)
- `src/schemas/quiz-v1.json` (create)
- `src/schemas/bank-v1.json` (create)
- `src/schemas/flashcard-v1.json` (create)
- `src/schemas/written-v1.json` (create)
- `src/schemas/osce-v1.json` (create)
- `src/schemas/hub-v1.json` (create)

### Steps

1. Create `src/schemas/_meta.json`:
   ```json
   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "$id": "https://osler.app/schemas/_meta.json",
     "title": "Osler Schema Registry",
     "version": "1.0.0",
     "schemas": {
       "quiz": { "file": "quiz-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
       "bank": { "file": "bank-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
       "flashcard": { "file": "flashcard-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
       "written": { "file": "written-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
       "osce": { "file": "osce-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
       "hub": { "file": "hub-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" }
     },
     "versioningRules": {
       "additive": "bump minor (1.0 → 1.1), old content still validates",
       "breaking": "bump major (v1 → v2), both schemas ship side-by-side",
       "patch": "no version bump, document in CHANGELOG"
     }
   }
   ```
2. For each of the 6 type schemas, follow the content format in Appendix C of the enhanced plan. Each schema must:
   - Have `$id`, `$schema`, `title`, `type: "object"`
   - Define `meta` object with required `uid`, `title`, `schemaVersion`, `createdAt`, `updatedAt`; optional `description`, `icon`, `tags`
   - Define type-specific fields per the engine's actual usage (read the engine to see what fields it reads)
   - For `quiz`: `questions[]` with `id`, `question`, `options[]`, `correct` (int index), `explanation`, `tags[]`, `difficulty` (1-5)
   - For `bank`: `passages[]` with `id`, `content`, `questions[]` referencing passage by `passageId`
   - For `flashcard`: `cards[]` with `id`, `front`, `back`, `cloze` (optional), `tags[]`
   - For `written`: `prompts[]` with `id`, `prompt`, `rubric[]`, `wordLimit`, `tags[]`
   - For `osce`: `stations[]` with `id`, `scenario`, `redFlags[]`, `differential[]`, `rubric[]`
   - For `hub`: `items[]` with `uid`, `type`, `title`, `path` (registry of content)
3. Use `ajv-cli` to validate each schema itself is a valid JSON Schema: `npx ajv compile -s src/schemas/quiz-v1.json` (must exit 0)

### Test Gate
```bash
for s in quiz bank flashcard written osce hub; do
  npx ajv compile -s src/schemas/$s-v1.json || exit 1
done
test -f src/schemas/_meta.json
npm run check
```

### Commit Message
```
schemas(phase-1): add _meta registry + 6 type schemas

_meta.json: registry with versioning policy.
quiz/bank/flashcard/written/osce/hub-v1.json: JSON Schemas
matching actual engine field usage.

All schemas validate as valid JSON Schema (ajv compile passes).
```

### Rollback
```bash
git rm -r src/schemas/
```

### Hand-off
P1.2 expects all 6 schemas + _meta.json to exist.

---

## Session P1.2 — Create `src/lib/validate.js` `[T1]`

**Depends on:** P1.1
**Goal:** Hand-written validator that uses ajv under the hood, with helpful error messages.

### Verify Inputs
- All 6 schemas + _meta.json exist
- `ajv` is in devDependencies (add if missing: `npm install -D ajv ajv-formats`)

### Files Touched
- `package.json` (update devDeps if needed)
- `src/lib/validate.js` (create)

### Steps

1. `npm install -D ajv ajv-formats` if not already present
2. Create `src/lib/validate.js`:
   ```js
   import Ajv from 'ajv';
   import addFormats from 'ajv-formats';
   import quizSchema from '../schemas/quiz-v1.json' with { type: 'json' };
   import bankSchema from '../schemas/bank-v1.json' with { type: 'json' };
   // ... etc for all 6
   
   const ajv = new Ajv({ allErrors: true, strict: false });
   addFormats(ajv);
   
   const validators = {
     quiz: ajv.compile(quizSchema),
     bank: ajv.compile(bankSchema),
     flashcard: ajv.compile(flashcardSchema),
     written: ajv.compile(writtenSchema),
     osce: ajv.compile(osceSchema),
     hub: ajv.compile(hubSchema),
   };
   
   export function validate(content) {
     const type = content?.type;
     if (!type || !validators[type]) {
       return { valid: false, errors: [{ message: `Unknown content type: ${type}` }] };
     }
     const valid = validators[type](content);
     return { valid, errors: validators[type].errors || [] };
   }
   
   export function validateOrThrow(content) {
     const r = validate(content);
     if (!r.valid) throw new Error(`Validation failed: ${JSON.stringify(r.errors, null, 2)}`);
     return content;
   }
   ```
3. Create `tests/unit/lib/validate.test.js` with 3 tests: valid quiz passes, missing `type` fails, wrong `correct` index fails.

### Test Gate
```bash
npm test 2>&1 | grep -q "3 passed" || npm test 2>&1 | grep -E "[3-9] passed"
node --input-type=module -e "import { validate } from './src/lib/validate.js'; console.log(validate({type:'quiz', meta:{uid:'x',title:'t',schemaVersion:'1.0',createdAt:'2026-01-01',updatedAt:'2026-01-01'}, questions:[]}).valid)"
# Should print "true"
npm run check
```

### Commit Message
```
lib(phase-1): add validate.js with ajv

validate(content) returns {valid, errors}. validateOrThrow() for tests.
3 unit tests covering happy path + 2 error cases.
```

### Rollback
```bash
git rm src/lib/validate.js tests/unit/lib/validate.test.js
```

### Hand-off
P1.3 expects `validate()` to be importable.

---

## Session P1.3 — Real `scripts/validate-content.js` + `export-schemas.js` `[T1]`

**Depends on:** P1.2
**Goal:** Replace the P0.3 stubs with real implementations.

### Verify Inputs
- `src/lib/validate.js` exists and exports `validate()`
- `src/schemas/*.json` exist

### Files Touched
- `scripts/validate-content.js` (rewrite)
- `scripts/export-schemas.js` (rewrite)

### Steps

1. Rewrite `scripts/validate-content.js`:
   - Walk `content/` directory recursively, find all `.json` files
   - For each: parse, call `validate(content)` from `src/lib/validate.js`
   - Print `✓ path` on success, `✗ path: errors` on failure
   - Exit 1 if any failed, 0 if all passed
   - If `content/` doesn't exist, exit 0 with "no content to validate"
2. Rewrite `scripts/export-schemas.js`:
   - Copy `src/schemas/*.json` to `.agents/context/`
   - Print summary
   - Exit 0
3. Create `content/sample-quiz.json` (copy from `tests/fixtures/sample-quiz.json`) so `npm run validate` has something to chew on

### Test Gate
```bash
npm run validate 2>&1 | grep -q "✓" || npm run validate 2>&1 | grep -q "no content"
npm run export-schemas
test -f .agents/context/quiz-v1.json
test -f .agents/context/_meta.json
npm run check
```

### Commit Message
```
scripts(phase-1): real validate-content + export-schemas

validate-content.js: walks content/, validates each .json against schemas.
export-schemas.js: copies src/schemas/*.json → .agents/context/.
content/sample-quiz.json: first real content fixture.
```

### Rollback
```bash
git checkout HEAD~1 -- scripts/validate-content.js scripts/export-schemas.js
git rm content/sample-quiz.json
```

### Hand-off
P1.4 expects `npm run validate` and `npm run export-schemas` to do real work.

---

## Session P1.4 — Create `src/lib/content-loader.js` `[T1]`

**Depends:** P1.3
**Goal:** Fetch JSON content from disk/network, validate, return.

### Verify Inputs
- `npm run validate` exits 0
- `src/lib/validate.js` exports `validateOrThrow()`

### Files Touched
- `src/lib/content-loader.js` (create)

### Steps

1. Create `src/lib/content-loader.js`:
   ```js
   import { validateOrThrow } from './validate.js';
   
   const cache = new Map();
   
   export async function loadContent(path) {
     if (cache.has(path)) return cache.get(path);
     const res = await fetch(path, { cache: 'no-cache' });
     if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
     const content = await res.json();
     validateOrThrow(content);
     cache.set(path, content);
     return content;
   }
   
   export async function loadContentByUid(uid, basePath = './content') {
     // walk content/manifest.json to find path by uid
     const manifest = await loadContent(`${basePath}/manifest.json`);
     const entry = manifest.items.find(i => i.uid === uid);
     if (!entry) throw new Error(`Content not found: ${uid}`);
     return loadContent(`${basePath}/${entry.path}`);
   }
   
   export function clearCache() { cache.clear(); }
   ```
2. Create `content/manifest.json`:
   ```json
   { "type": "hub", "meta": { "uid": "manifest", "title": "Content Manifest", "schemaVersion": "1.0", "createdAt": "2026-06-23T00:00:00Z", "updatedAt": "2026-06-23T00:00:00Z" }, "items": [ { "uid": "sample-quiz-001", "type": "quiz", "title": "Sample Quiz", "path": "sample-quiz.json" } ] }
   ```
3. Run `npm run validate` to confirm manifest passes hub schema.

### Test Gate
```bash
npm run validate
node --input-type=module -e "import { loadContent } from './src/lib/content-loader.js'; console.log(typeof loadContent)"
npm run check
```

### Commit Message
```
lib(phase-1): add content-loader + manifest

loadContent(path): fetch + validate + cache.
loadContentByUid(uid): lookup via content/manifest.json.
content/manifest.json: hub-type file listing all available content.
```

### Rollback
```bash
git rm src/lib/content-loader.js content/manifest.json
```

### Hand-off
P1.5 expects content-loader to be importable.

---

## Session P1.5 — Create `player.html` `[T2]`

**Depends on:** P1.4
**Goal:** Universal content viewer that loads any content type and renders it via the appropriate engine.

### Verify Inputs
- `src/lib/content-loader.js` exists
- All 5 content-type engines exist in `dist/`

### Files Touched
- `player.html` (create at repo root)
- `src/build.js` (update — copy `player.html` to `dist/`)

### Steps

1. Create `player.html` with:
   - `<head>`: title, meta viewport, link to `shared.css`, link to `manifest.webmanifest`
   - `<body>`: empty `<div id="osler-root">`
   - Script: read `?uid=` or `?path=` from URL query string
   - Use `loadContent()` to fetch the content
   - Based on `content.type`, dynamically load the matching engine script: `quiz` → `quiz-engine.js`, `bank` → `bank-engine.js`, etc.
   - Engines expect globals: set `window.QUIZ_CONFIG = { content }` (or equivalent) before loading the engine
   - Each engine renders into its own root element; create a new `<div>` per engine instance
2. **Important:** engines are IIFEs that auto-render on DOMContentLoaded. The player must set the right globals *before* the engine script loads. Use a two-step: (1) set globals, (2) `await import(dist/quiz-engine.js)` or inject a `<script>` tag.
3. Update `src/build.js` to copy `player.html` to `dist/`
4. Run `npm run build`
5. Manually test: `npx serve dist -l 5500`, open `http://localhost:5500/player.html?path=content/sample-quiz.json`, confirm the quiz renders.

### Test Gate
```bash
npm run build
test -f dist/player.html
# Manual: serve and load player.html?path=content/sample-quiz.json — quiz renders
npm run check
```

### Commit Message
```
feat(phase-1): universal player.html

Loads content via content-loader.js, dispatches to the matching
engine (quiz/bank/flashcard/written/osce) by content.type.

Usage: player.html?uid=sample-quiz-001 or ?path=content/sample-quiz.json
```

### Rollback
```bash
git rm player.html
git checkout HEAD~1 -- src/build.js
```

### Hand-off
Phase 1 done. Phases 2, 4, 5.0 can now start in parallel.

---

# PHASE 2 — INDEXEDDB + SM-2

> **Sessions:** 7 · **Estimated:** ~8 hours · **Minimum tier:** T2 for P2.2 (SM-2 algorithm), T1 for rest.

---

## Session P2.1 — Create `src/lib/storage.js` (9 stores) `[T1]`

**Depends on:** Phase 1 complete
**Goal:** IndexedDB wrapper with 9 per-type stores and localStorage fallback.

### Verify Inputs
- `npm run check` passes

### Files Touched
- `src/lib/storage.js` (create)

### Steps

1. Create `src/lib/storage.js`:
   - Open DB `osler-v1` version 1, create 9 object stores: `quizTracker`, `flashcardTracker`, `writtenTracker`, `osceTracker`, `studyEvents` (autoKey), `userContent`, `streak`, `syncLog` (autoKey), `settings`
   - `quizTracker` keyPath: `['contentUid', 'itemId']` (composite)
   - `flashcardTracker`, `writtenTracker`, `osceTracker`, `userContent`, `streak`, `settings`: keyPath `'uid'` or `'key'`
   - Export `get(store, key)`, `put(store, value)`, `delete(store, key)`, `getAll(store)`, `clear(store)`
   - All methods return Promises
   - **Fallback:** if `indexedDB` is undefined, use a localStorage-backed shim with the same API (slower, but works in private browsing)
   - On any QuotaExceededError, call `quota.evict()` (will be implemented in P2.4)
2. Create `tests/unit/lib/storage.test.js` with 4 tests: put+get round-trip, delete, getAll, clear. Use fake-indexeddb (`npm install -D fake-indexeddb`).

### Test Gate
```bash
npm test 2>&1 | grep -E "[4-9] passed"
node --input-type=module -e "import { put, get } from './src/lib/storage.js'; console.log(typeof put, typeof get)"
npm run check
```

### Commit Message
```
lib(phase-2): add storage.js with 9 IndexedDB stores

Stores: quizTracker, flashcardTracker, writtenTracker, osceTracker,
studyEvents (autoKey), userContent, streak, syncLog (autoKey), settings.
localStorage fallback for private-browsing mode.
4 unit tests using fake-indexeddb.
```

### Rollback
```bash
git rm src/lib/storage.js tests/unit/lib/storage.test.js
```

### Hand-off
P2.2 expects storage.js to be importable.

---

## Session P2.2 — Create `src/lib/sm2.js` (SM-2 algorithm) `[T2]`

**Depends:** P2.1
**Goal:** Pure SM-2 spaced-repetition algorithm with comprehensive unit tests. This is the foundation Phase 2/3 conflict resolution depends on.

### Verify Inputs
- `src/lib/storage.js` exists

### Files Touched
- `src/lib/sm2.js` (create)
- `tests/unit/lib/sm2.test.js` (create)

### Steps

1. Create `src/lib/sm2.js` implementing the SM-2 algorithm (SuperMemo 2):
   ```js
   // Ratings: 0=Again, 1=Hard, 2=Good, 3=Easy, 4=Perfect
   // (SM-2 uses 0-5; we collapse to 5 levels: 0,3,4,5,6 mapped to our 0-4)
   
   export const DEFAULT_STATE = {
     easeFactor: 2.5,
     interval: 0,        // days
     repetitions: 0,
     lapses: 0,
     lastRating: null,
     lastReviewedAt: null,
     totalReviews: 0,
     avgTimePerReview: 0,
     updatedAt: null,
   };
   
   const RATING_TO_Q = { 0: 0, 1: 3, 2: 4, 3: 5, 4: 6 };
   
   export function nextReview(state, rating, reviewTimeMs = Date.now()) {
     const q = RATING_TO_Q[rating];
     const s = { ...DEFAULT_STATE, ...state };
     const newState = { ...s };
     newState.totalReviews = (s.totalReviews || 0) + 1;
     newState.lastRating = rating;
     newState.lastReviewedAt = new Date(reviewTimeMs).toISOString();
     newState.updatedAt = new Date(reviewTimeMs).toISOString();
     
     if (q < 3) {
       // Lapse
       newState.repetitions = 0;
       newState.interval = 1;  // re-show tomorrow
       newState.lapses = (s.lapses || 0) + 1;
       newState.easeFactor = Math.max(1.3, s.easeFactor - 0.2);
     } else {
       // Pass
       newState.repetitions = (s.repetitions || 0) + 1;
       if (newState.repetitions === 1) newState.interval = 1;
       else if (newState.repetitions === 2) newState.interval = 6;
       else newState.interval = Math.round(s.interval * s.easeFactor);
       newState.easeFactor = Math.max(1.3, s.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
     }
     
     const nextReviewAt = new Date(reviewTimeMs + newState.interval * 86400000).toISOString();
     newState.nextReviewAt = nextReviewAt;
     return newState;
   }
   
   export function isDue(state, now = Date.now()) {
     if (!state.nextReviewAt) return true;
     return new Date(state.nextReviewAt).getTime() <= now;
   }
   
   export function updateAvgTime(state, elapsedMs) {
     const total = state.totalReviews || 0;
     const oldAvg = state.avgTimePerReview || 0;
     return (oldAvg * total + elapsedMs) / (total + 1);
   }
   ```
2. Create `tests/unit/lib/sm2.test.js` with at least 8 known-answer tests:
   - First "Good" rating → interval 1, easeFactor stays 2.5
   - Second "Good" rating (after interval 1) → interval 6
   - Third "Good" rating (after interval 6) → interval 15 (6 × 2.5)
   - "Again" rating resets repetitions to 0, interval to 1, lapses +1
   - "Hard" rating decreases easeFactor
   - "Easy" rating increases easeFactor
   - easeFactor never drops below 1.3
   - isDue returns true for never-reviewed cards

### Test Gate
```bash
npm test 2>&1 | grep -E "8 passed|[1-9][0-9] passed"
node --input-type=module -e "import { nextReview, DEFAULT_STATE } from './src/lib/sm2.js'; const s=nextReview(DEFAULT_STATE, 2); console.log(s.interval, s.easeFactor);"
# Should print "1 2.5"
npm run check
```

### Commit Message
```
lib(phase-2): add sm2.js with SuperMemo 2 algorithm

nextReview(state, rating) returns updated state with new interval,
easeFactor, repetitions, lapses, nextReviewAt. Ratings: 0=Again,
1=Hard, 2=Good, 3=Easy, 4=Perfect.
8 known-answer unit tests covering lapse, pass, ease bounds.
```

### Rollback
```bash
git rm src/lib/sm2.js tests/unit/lib/sm2.test.js
```

### Hand-off
P2.3 expects sm2.js + storage.js to be importable.

---

## Session P2.3 — Update `src/lib/tracker.js` to use storage + SM-2 `[T2]`

**Depends on:** P2.2
**Goal:** Engine-tracker becomes a thin layer over storage.js, with SM-2 for flashcards.

### Verify Inputs
- `src/lib/storage.js` and `src/lib/sm2.js` exist
- `engines/engine-tracker.js` exists with the old localStorage-based API

### Files Touched
- `src/lib/tracker.js` (create — new module; the old `engines/engine-tracker.js` stays for backward compat)

### Steps

1. Read `engines/engine-tracker.js` to understand the current API surface (`getProgress`, `recordAnswer`, `flagItem`, `getStats`, etc.)
2. Create `src/lib/tracker.js` with the same API but backed by `storage.js`:
   - `getQuizProgress(contentUid, itemId)` → `storage.get('quizTracker', [contentUid, itemId])`
   - `recordQuizAnswer(contentUid, itemId, isCorrect)` → updates `wrongCount`, `consecutiveCorrect`, `updatedAt`
   - `flagQuizItem(contentUid, itemId, flagged)` → updates `flagged`
   - `getFlashcardState(uid)` → `storage.get('flashcardTracker', uid)`
   - `rateFlashcard(uid, rating, elapsedMs)` → `nextReview(state, rating)`, update avgTime, `storage.put('flashcardTracker', newState)`
   - `getDueFlashcards(uids)` → filter by `isDue()`
   - Similar for written, osce
3. Write `tests/unit/lib/tracker.test.js` with 5 tests: quiz record answer, flashcard rate (Good twice → interval grows), flag toggle, getDueFlashcards returns only due, stats aggregation.

### Test Gate
```bash
npm test 2>&1 | grep -E "5 passed|[6-9] passed|[1-9][0-9] passed"
npm run check
```

### Commit Message
```
lib(phase-2): new tracker.js over storage + SM-2

Mirrors engine-tracker.js API but backed by IndexedDB (storage.js)
and SM-2 for flashcards. Engines continue to use engine-tracker.js
for now; wiring happens in P2.5-P2.7.
5 unit tests.
```

### Rollback
```bash
git rm src/lib/tracker.js tests/unit/lib/tracker.test.js
```

### Hand-off
P2.4 expects tracker.js + storage.js.

---

## Session P2.4 — Create `src/lib/quota.js` (3-stage eviction) `[T1]`

**Depends on P2.3`

### Verify Inputs
- `src/lib/storage.js` exists with `getAll()` and `delete()` per store

### Files Touched
- `src/lib/quota.js` (create)
- `src/lib/storage.js` (update — call `quota.evict()` on QuotaExceededError)

### Steps

1. Create `src/lib/quota.js`:
   - `getUsage()` — calls `navigator.storage.estimate()` returning `{ usage, quota }`
   - `getUsagePercent()` — `Math.round(usage / quota * 100)`
   - `evict()` — 3-stage:
     - **Stage 1 (>85%):** delete `studyEvents` older than 90 days
     - **Stage 2 (>90%):** also delete `syncLog` older than 30 days
     - **Stage 3 (>95%):** also delete `flashcardTracker` entries with `repetitions >= 5` AND `nextReviewAt` more than 1 year out (mature cards, safely droppable — they'll re-derive on next sync)
   - `onQuotaExceeded()` — calls `evict()`, then retries the original operation
2. Update `src/lib/storage.js` to wrap puts in try/catch; on `QuotaExceededError`, call `quota.evict()` and retry once.
3. Write `tests/unit/lib/quota.test.js` with 3 tests (use mocked `navigator.storage.estimate`).

### Test Gate
```bash
npm test 2>&1 | grep -E "[8-9] passed|[1-9][0-9] passed"
npm run check
```

### Commit Message
```
lib(phase-2): add quota.js with 3-stage eviction

Stages: 85% → old studyEvents, 90% → old syncLog, 95% → mature flashcards.
storage.js auto-calls evict() on QuotaExceededError and retries.
3 unit tests with mocked storage.estimate().
```

### Rollback
```bash
git rm src/lib/quota.js tests/unit/lib/quota.test.js
git checkout HEAD~1 -- src/lib/storage.js
```

### Hand-off
P2.5 expects quota.js wired into storage.js.

---

## Session P2.5 — Create `src/lib/migration.js` (v5 → v1) `[T1]`

**Depends on P2.4`

### Verify Inputs
- All Phase 2 lib modules exist

### Files Touched
- `src/lib/migration.js` (create)
- `tests/unit/sync/migration.test.js` (create)

### Steps

1. Create `src/lib/migration.js`:
   - `migrateFromV5()` — read all `osler_*` keys from localStorage (old v5 namespace)
   - For each `osler_quiz_*` key: parse, transform to new `quizTracker` shape `{contentUid, itemId, wrongCount, consecutiveCorrect, flagged, highlights, notes, updatedAt}`, put into IndexedDB
   - For each `osler_flashcard_*` key: SM-2 fields are seeded from defaults (no v5 SM-2 data exists), but `totalReviews` is preserved if present
   - After successful migration: write `osler_migrated_v1 = true` to localStorage, **do NOT delete v5 keys yet** (keep for one release as backup)
   - `isMigrated()` — returns true if `osler_migrated_v1` flag is set
   - `runMigrationIfNeeded()` — idempotent
2. Write `tests/unit/sync/migration.test.js` with 3 tests: skips if already migrated, migrates quiz data correctly, doesn't delete v5 keys.

### Test Gate
```bash
npm test 2>&1 | grep -E "[1-9][0-9] passed"
npm run check
```

### Commit Message
```
lib(phase-2): add migration.js (v5 → v1)

Reads old osler_* localStorage keys, writes to IndexedDB.
SM-2 fields seeded from defaults (no v5 SM-2 data existed).
v5 keys preserved for one release as backup.
3 unit tests.
```

### Rollback
```bash
git rm src/lib/migration.js tests/unit/sync/migration.test.js
```

### Hand-off
P2.6 expects migration.js to exist.

---

## Session P2.6 — Wire `quiz-engine.js` to new storage `[T2]`

**Depends: P2.5`

### Verify Inputs
- All Phase 2 lib modules exist
- `engines/quiz-engine.js` currently uses localStorage directly (verify with grep)

### Files Touched
- `engines/quiz-engine.js` (update — replace localStorage calls with new tracker.js API)

### Steps

1. Read `engines/quiz-engine.js`. Find all `localStorage.getItem`, `localStorage.setItem` calls related to progress tracking.
2. Replace each with calls to `src/lib/tracker.js`. Since engines are classic scripts (not modules), use a global: `window.OslerTracker.recordQuizAnswer(contentUid, itemId, isCorrect)`.
3. The bridge: in `engine-shared.js`, add a global `window.OslerTracker` that dynamically imports `src/lib/tracker.js` and exposes its methods. **Or** (simpler): keep `engine-tracker.js` as a thin shim that calls `storage.js` via dynamic import.
4. **Recommended approach:** rewrite `engines/engine-tracker.js` to delegate to `src/lib/storage.js` via dynamic `import()`. This keeps the existing API for engines while moving data to IndexedDB.
5. After rewriting, run the quiz manually: `npx serve dist -l 5500`, open `player.html?path=content/sample-quiz.json`, answer 3 questions, refresh — progress should restore.
6. Run `npm run build && npm test`.

### Test Gate
```bash
npm run build
npm test
# Manual: answer 3 questions, refresh, progress restored
grep -c "localStorage" engines/quiz-engine.js  # should be 0 (or only UI-state, not progress)
```

### Commit Message
```
engine(phase-2): wire quiz-engine to new tracker

quiz-engine.js now calls window.OslerTracker (via engine-tracker.js
shim) which delegates to src/lib/storage.js (IndexedDB).
localStorage no longer used for progress data.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
P2.7 expects quiz-engine to be IndexedDB-backed.

---

## Session P2.7 — Wire remaining 4 engines + wire SM-2 to flashcard UI `[T2]`

**Depends: P2.6`

### Verify Inputs
- quiz-engine is IndexedDB-backed
- `engines/flashcard-engine.js` has "Again/Hard/Good/Easy" buttons (or equivalent rating UI)

### Files Touched
- `engines/bank-engine.js` (update)
- `engines/flashcard-engine.js` (update — wire to SM-2)
- `engines/written-engine.js` (update)
- `engines/osce-engine.js` (update)

### Steps

1. For each of the 4 engines: same pattern as P2.6 — find localStorage calls, replace with tracker API.
2. **Flashcard SM-2 wiring:** in `flashcard-engine.js`, find the rating buttons (typically 4 buttons labeled "Again/Hard/Good/Easy" or similar). Map them to ratings 0/1/2/3. On click:
   - Call `OslerTracker.rateFlashcard(cardUid, rating, elapsedMs)` → returns new state
   - Display next card (or "session complete" if no more due cards)
   - Update the in-session counter
3. Add a "Study Due Cards" mode to the flashcard start screen that filters cards by `isDue()`.
4. Manual test: open a flashcard set, rate 5 cards "Good", refresh, "Study Due Cards" should show 0 (next review is tomorrow). Rate 5 cards "Again", refresh, "Study Due Cards" should show 5.
5. Run `npm run check`.

### Test Gate
```bash
npm run check
grep -c "localStorage" engines/bank-engine.js engines/flashcard-engine.js engines/written-engine.js engines/osce-engine.js | grep -v ":0$" || echo "all engines localStorage-free"
# Manual: flashcard SM-2 flow works
```

### Commit Message
```
engine(phase-2): wire bank/flashcard/written/osce to tracker + SM-2

All 5 quiz-style engines now use IndexedDB via tracker.js.
Flashcard engine uses SM-2 algorithm for "Again/Hard/Good/Easy" ratings.
"Study Due Cards" mode added.
Phase 2 complete.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
Phase 2 done. P3.1 (Firebase) can begin.

---

# PHASE 3 — FIREBASE & SYNC

> **Sessions:** 6 · **Estimated:** ~6 hours · **Minimum tier:** T2 throughout.

---

## Session P3.1 — Create `src/lib/firebase.js` `[T1]`

**Depends:** Phase 2 complete
**Goal:** Firebase initialization (auth, firestore, analytics) with config from environment.

### Verify Inputs
- Phase 2 done
- `npm run check` passes

### Files Touched
- `.env.example` (create — Firebase config template)
- `src/lib/firebase.js` (create)

### Steps

1. `npm install firebase` if not already present
2. Create `.env.example`:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   VITE_FIREBASE_MEASUREMENT_ID=...
   ```
3. Create `src/lib/firebase.js`:
   - Read config from `import.meta.env.VITE_FIREBASE_*`
   - Initialize app, auth, firestore, analytics
   - Export `app`, `auth`, `db`, `analytics`
   - If config is missing, log warning and export nulls (graceful degradation)
4. Add `.env` to `.gitignore` (should already be there, but verify)

### Test Gate
```bash
test -f .env.example
node --input-type=module -e "import * as fb from './src/lib/firebase.js'; console.log(typeof fb)" | grep -q object
npm run check
```

### Commit Message
```
lib(phase-3): add firebase.js init

Reads config from import.meta.env.VITE_FIREBASE_*. Exports app,
auth, db, analytics. Graceful null exports if config missing.
.env.example added as template.
```

### Rollback
```bash
git rm src/lib/firebase.js .env.example
```

### Hand-off
P3.2 expects firebase.js to be importable.

---

## Session P3.2 — Create `src/lib/auth.js` (guest → google → github) `[T2]`

**Depends: P3.1`

### Verify Inputs
- `src/lib/firebase.js` exists

### Files Touched
- `src/lib/auth.js` (create)

### Steps

1. Create `src/lib/auth.js` exporting:
   - `currentUser` — observable (use a simple `subscribe(listener)` pattern)
   - `signInAsGuest()` — creates anonymous auth, returns user with `isGuest: true`
   - `signInWithGoogle()` — popup Google OAuth
   - `signInWithGitHub()` — popup GitHub OAuth
   - `signOut()` — clears auth, returns to guest mode
   - `upgradeAccount(provider)` — for guests upgrading to Google/GitHub (preserves anonymous user's data via Firebase's `link()` API)
   - State machine: `guest → google | github`. Once authenticated via OAuth, sign-out returns to guest (not logged-out).
2. Persist user preference in `settings` store: `authProvider: 'guest' | 'google' | 'github'`
3. Write `tests/unit/lib/auth.test.js` with mocked firebase auth (3 tests: guest sign-in, google sign-in, sign-out returns to guest).

### Test Gate
```bash
npm test 2>&1 | grep -E "[1-9][0-9] passed"
node --input-type=module -e "import { signInAsGuest, signOut } from './src/lib/auth.js'; console.log(typeof signInAsGuest)"
npm run check
```

### Commit Message
```
lib(phase-3): add auth.js (guest → google → github)

State machine: guest is the resting state. OAuth upgrades the guest
account (preserves data via Firebase link()). Sign-out returns to
guest mode, not logged-out.
3 unit tests with mocked firebase auth.
```

### Rollback
```bash
git rm src/lib/auth.js tests/unit/lib/auth.test.js
```

### Hand-off
P3.3 expects auth.js.

---

## Session P3.3 — Hub auth UI `[T1]`

**Depends: P3.2`

### Verify Inputs
- auth.js exists with the state machine

### Files Touched
- `hub/index.html` (create if missing, else update)
- `src/css/index-engine.css` (update — auth UI styles)

### Steps

1. Read `engines/index-engine.js` to understand hub structure.
2. Add auth UI to hub:
   - Top-right corner: user avatar + dropdown (sign in / sign out)
   - If guest: "Sign in with Google" + "Sign in with GitHub" buttons
   - If authenticated: avatar, name, "Sign out" (returns to guest)
3. Below auth: "My Content" section that reads from `userContent` IndexedDB store
4. Wire to `auth.js` via `subscribe()` — UI updates on auth state change
5. Manual test: open hub, sign in as guest, sign in with Google, sign out → should be guest again

### Test Gate
```bash
npm run build
# Manual: hub shows auth UI, sign-in flow works
npm run check
```

### Commit Message
```
hub(phase-3): add auth UI + "My Content" section

Top-right user dropdown. Guest state shows OAuth buttons.
"My Content" reads from userContent IndexedDB store.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
P3.4 expects hub auth UI to work.

---

## Session P3.4 — Create `src/lib/sync.js` (3-tier conflict resolution) `[T2]`

**Depends: P3.3`

### Verify Inputs
- Hub auth UI works
- All Phase 2 IndexedDB stores exist

### Files Touched
- `src/lib/sync.js` (create)
- `tests/unit/sync/sm2-merge.test.js` (create)
- `tests/unit/sync/field-merge.test.js` (create)

### Steps

1. Create `src/lib/sync.js`:
   - `syncPush()` — read all IndexedDB stores, write to Firestore under `users/{uid}/{store}/{key}`
   - `syncPull()` — read from Firestore, merge into IndexedDB
   - `syncFull()` — push then pull (or pull then push, depending on conflict strategy)
   - **3 merge strategies** (per Appendix D):
     - `appendOnly(local, remote)` — for `studyEvents`, `syncLog`: concat, dedupe by `{timestamp, deviceId}`
     - `fieldMergeByUpdatedAt(local, remote)` — for `quizTracker`, `writtenTracker`, `osceTracker`: per-field, take whichever has later `updatedAt`
     - `sm2Merge(local, remote)` — for `flashcardTracker`: later review wins state (latest `lastReviewedAt`), both `totalReviews` count toward sum (max of two)
     - `lwwBodyKeepTitles(local, remote)` — for `userContent`: last-write-wins body, on title conflict keep both with `(2)` suffix
     - `maxStreak(local, remote)` — for `streak`: max of `currentStreak`, `longestStreak`, `lastActivityDate` (latest)
   - Write every merge decision to `syncLog` with `{entryType, entryUid, operation, fieldChanges, timestamp, deviceId}`
2. Write `tests/unit/sync/sm2-merge.test.js` — 4 tests: both-pass merge, lapse-then-pass merge, simultaneous review merge, totalReviews aggregation
3. Write `tests/unit/sync/field-merge.test.js` — 4 tests: local newer, remote newer, equal timestamps (take remote), per-field merge with different fields updated on each side

### Test Gate
```bash
npm test 2>&1 | grep -E "[1-9][0-9] passed"
npm test -- --grep=SM-2 2>&1 | grep -E "[4-9] passed"
npm test -- --grep=field-merge 2>&1 | grep -E "[4-9] passed"
npm run check
```

### Commit Message
```
lib(phase-3): add sync.js with 3-tier conflict resolution

5 merge strategies: appendOnly, fieldMergeByUpdatedAt, sm2Merge,
lwwBodyKeepTitles, maxStreak. All decisions logged to syncLog.
8 contract tests (4 SM-2 + 4 field-merge).
```

### Rollback
```bash
git rm src/lib/sync.js tests/unit/sync/sm2-merge.test.js tests/unit/sync/field-merge.test.js
```

### Hand-off
P3.5 expects sync.js with merge strategies.

---

## Session P3.5 — Create `src/lib/analytics.js` (event taxonomy) `[T1]`

**Depends: P3.4`

### Verify Inputs
- sync.js exists
- `studyEvents` IndexedDB store exists

### Files Touched
- `src/lib/analytics.js` (create)

### Steps

1. Create `src/lib/analytics.js` per the event taxonomy in enhanced-plan Phase 3:
   ```js
   import { put } from './storage.js';
   
   const DEVICE_ID_KEY = 'osler_device_id';
   function getDeviceId() {
     let id = localStorage.getItem(DEVICE_ID_KEY);
     if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
     return id;
   }
   
   export function track(event) {
     const fullEvent = {
       type: 'study_event',
       contentType: event.contentType,
       contentUid: event.contentUid,
       action: event.action,
       itemId: event.itemId || null,
       outcome: event.outcome || null,
       durationMs: event.durationMs || 0,
       deviceId: getDeviceId(),
       ts: new Date().toISOString(),
     };
     // Non-blocking — fire and forget
     put('studyEvents', fullEvent).catch(e => console.warn('analytics track failed', e));
     // Also send to Firebase Analytics if available
     if (window.firebase?.analytics) {
       try { window.firebase.analytics.logEvent('study_event', fullEvent); } catch {}
     }
   }
   
   // Convenience methods
   export const trackStudyStart = (contentType, contentUid) => track({ contentType, contentUid, action: 'started' });
   export const trackAnswer = (contentType, contentUid, itemId, outcome, durationMs) =>
     track({ contentType, contentUid, action: 'answered', itemId, outcome, durationMs });
   export const trackFlag = (contentType, contentUid, itemId) =>
     track({ contentType, contentUid, action: 'flagged', itemId });
   export const trackComplete = (contentType, contentUid) =>
     track({ contentType, contentUid, action: 'completed' });
   export const trackExport = (contentType, contentUid) =>
     track({ contentType, contentUid, action: 'exported' });
   ```
2. Add `trackAnswer()` calls to all 5 engines at the answer-submission site.

### Test Gate
```bash
npm run check
# Manual: answer a quiz, check IndexedDB studyEvents store has the event
```

### Commit Message
```
lib(phase-3): add analytics.js with event taxonomy

track(event) writes to studyEvents IndexedDB store (non-blocking)
and forwards to Firebase Analytics if available.
Convenience methods: trackStudyStart, trackAnswer, trackFlag,
trackComplete, trackExport.
All 5 engines now emit answer events.
```

### Rollback
```bash
git rm src/lib/analytics.js
git revert HEAD  # undo engine changes
```

### Hand-off
P3.6 expects analytics.js.

---

## Session P3.6 — "My Content" hub section + sync trigger `[T1]`

**Depends: P3.5`

### Verify Inputs
- analytics.js exists
- hub auth UI works

### Files Touched
- `engines/index-engine.js` (update — "My Content" section reads from `userContent`)
- `src/lib/sync.js` (update — auto-sync on auth state change and every 5 minutes)

### Steps

1. In `engines/index-engine.js`, add a "My Content" section to the hub:
   - Read all entries from `userContent` IndexedDB store
   - Group by type (quiz, bank, flashcard, written, osce)
   - Show cards with title, type icon, last-studied, "Open" button → opens `player.html?uid=...`
2. In `src/lib/sync.js`, add:
   - `initAutoSync()` — call on app boot. Subscribes to auth state changes; when user is authenticated, runs `syncFull()` immediately and sets a 5-minute interval.
   - On sign-out (back to guest), clears the interval.
3. Manual test: sign in on two browsers, study on one, wait 5 minutes, study on the other → progress should be merged.

### Test Gate
```bash
npm run check
# Manual: two-device sync flow works
```

### Commit Message
```
hub(phase-3): "My Content" + auto-sync

"My Content" reads from userContent store, grouped by type.
sync.js auto-syncs on auth state change and every 5 minutes.
Phase 3 complete.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
Phase 3 done. P7.x can include sync in E2E tests.

---

# PHASE 4 — UI POLISH + ANKI CSV

> **Sessions:** 5 · **Estimated:** ~5 hours · **Minimum tier:** T1 throughout (well-specified refactors).

---

## Session P4.1 — Create `src/lib/anki.js` (TSV import/export) `[T1]`

**Depends:** Phase 0 (lib modules exist)
**Goal:** TSV-based Anki import/export with cloze detection.

### Verify Inputs
- `src/lib/icons.js` exists (for button icons)

### Files Touched
- `src/lib/anki.js` (create)
- `tests/unit/lib/anki.test.js` (create)

### Steps

1. Create `src/lib/anki.js`:
   - `exportToTSV(cards)` — takes array of `{front, back, tags[]}`, returns TSV string with Anki-friendly columns: `front\tback\ttags`
   - `importFromTSV(tsv)` — parses TSV, returns cards array. Handles quoted fields, escaped tabs.
   - `detectCloze(text)` — returns `{isCloze, clozeText, deletions[]}`. Detects `{{c1::hidden::hint}}` patterns. Also auto-generates cloze from sentences with a highlighted word.
   - `downloadTSV(cards, filename)` — triggers browser download
   - Cloze format: if a flashcard has `cloze` field set, export as `text {{c1::answer}}` with the answer extracted from `back`
2. Write `tests/unit/lib/anki.test.js` with 5 tests: round-trip export/import, quoted fields, cloze detection, cloze with hint, empty tags column

### Test Gate
```bash
npm test 2>&1 | grep -E "[1-9][0-9] passed"
npm run check
```

### Commit Message
```
lib(phase-4): add anki.js (TSV import/export + cloze)

exportToTSV(cards), importFromTSV(tsv), detectCloze(text),
downloadTSV(cards, filename). Handles quoted fields, escaped tabs,
{{c1::answer::hint}} cloze format.
5 unit tests.
```

### Rollback
```bash
git rm src/lib/anki.js tests/unit/lib/anki.test.js
```

### Hand-off
P4.2 expects anki.js.

---

## Session P4.2 — Replace emoji with Lucide SVGs across all engines `[T1]`

**Depends: P4.1`

### Verify Inputs
- `src/lib/icons.js` exists with 30 icons
- Engines still contain emoji (verified: 📁 🃏 🩺 and others)

### Files Touched
- All 13 engine files (replace emoji with `Icon()` calls)

### Steps

1. Run `rg -uP '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{1F1E6}-\x{1F1FF}]' engines/` to find all emoji
2. For each match:
   - Identify the emoji's semantic meaning (📁 = folder, 🃏 = card, 🩺 = stethoscope, etc.)
   - Replace with `Icon('folder')` / `Icon('layers')` / `Icon('activity')` (or whichever Lucide icon matches)
   - If no good match exists in `icons.js`, add a new icon to `src/lib/icons.js` (source path data from lucide.dev)
3. Engines are IIFE scripts — they can't `import` ES modules. Use `window.OslerIcons.icon('folder')` bridge. Add this bridge to `engine-shared.js`:
   ```js
   // dynamic import on first use
   var _iconsCache = null;
   EngineShared.icon = function(name, size) {
     if (_iconsCache) return _iconsCache.icon(name, size);
     // fallback: return empty svg
     return '<svg width="'+(size||20)+'" height="'+(size||20)+'"></svg>';
   };
   // async load
   import('../src/lib/icons.js').then(m => { _iconsCache = m; });
   ```
4. After all replacements, run the fixed grep: `rg -uP '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{1F1E6}-\x{1F1FF}]' engines/ src/` — must return zero matches.

### Test Gate
```bash
rg -uP '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{1F1E6}-\x{1F1FF}]' engines/ src/ && echo "FAIL: emoji found" || echo "OK: no emoji"
npm run check
# Manual: open each engine, icons render correctly
```

### Commit Message
```
refactor(phase-4): replace emoji with Lucide SVGs

All emoji in engines/ and src/ replaced with Icon() calls via
window.OslerIcons bridge in engine-shared.js. Icons load async
from src/lib/icons.js.
Zero emoji remain (verified with UTF-8 grep).
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
P4.3 expects zero emoji in source.

---

## Session P4.3 — Apply CSS tokens across engines `[T1]`

**Depends: P4.2`

### Verify Inputs
- `src/css/shared.css` has all tokens from Appendix B
- Zero emoji remain

### Files Touched
- All `src/css/*.css` (replace hardcoded values with var() references)

### Steps

1. For each `src/css/*.css` file:
   - Find hardcoded `box-shadow: 0 1px 2px rgba(0,0,0,0.3)` → replace with `box-shadow: var(--elevation-1)`
   - Find hardcoded `border-radius: 6px/10px/16px/24px` → replace with `var(--radius-sm/md/lg/xl)`
   - Find hardcoded `padding: 4px/8px/12px/16px/24px/32px` → replace with `var(--space-1/2/3/4/5/6)`
   - Find hardcoded `transition: 0.2s ease-out` → replace with `var(--transition)`
2. Don't replace values that don't match a token (e.g. `padding: 7px` — leave alone).
3. After replacement, verify visual parity by opening each engine in browser.

### Test Gate
```bash
npm run check
# Manual: visual parity check across all 5 engines
```

### Commit Message
```
refactor(phase-4): apply CSS tokens across engines

Hardcoded shadows, radii, spacing, transitions replaced with
var() references to tokens defined in shared.css.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
P4.4 expects CSS tokens applied.

---

## Session P4.4 — Refactor engine render functions to use `ui.js` `[T2]`

**Depends: P4.3`

### Verify Inputs
- `src/lib/ui.js` exists with `Card`, `Button`, `Modal`, etc.
- CSS tokens applied

### Files Touched
- All 5 quiz-style engines (quiz, bank, flashcard, written, osce)

### Steps

1. For each engine, find sites that use `element.innerHTML += '...'` template strings.
2. Replace with `dom.h()` calls from `src/lib/dom.js` (or `ui.Card()`, `ui.Button()` where appropriate).
3. **This is a large refactor.** Do one engine at a time, test after each. Suggested order: quiz → bank → flashcard → written → osce.
4. After each engine, run that engine manually and verify visual + functional parity.
5. **Stop and ask** if you find a template string that doesn't map cleanly to a `dom.h()` call — don't force it.

### Test Gate
```bash
npm run check
grep -c "innerHTML +=" engines/quiz-engine.js engines/bank-engine.js engines/flashcard-engine.js engines/written-engine.js engines/osce-engine.js
# Manual: all 5 engines render correctly
```

### Commit Message
```
refactor(phase-4): engines use ui.js + dom.h() instead of innerHTML

5 engines refactored to use src/lib/ui.js (Card, Button, Modal)
and src/lib/dom.js (h, on, clear) instead of template-string
innerHTML concatenation.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
P4.5 expects engines refactored.

---

## Session P4.5 — Flashcard "Export to Anki" button + a11y pass `[T2]`

**Depends: P4.4`

### Verify Inputs
- `src/lib/anki.js` exists with `downloadTSV()`
- Flashcard engine refactored to use ui.js

### Files Touched
- `engines/flashcard-engine.js` (update — add export button in results screen)
- All engines (a11y pass per checklist)

### Steps

1. In `engines/flashcard-engine.js` results screen, add "Export to Anki" button:
   - Calls `anki.exportToTSV(cards)` where `cards` = the studied flashcards
   - Calls `anki.downloadTSV(tsv, 'osler-flashcards-' + Date.now() + '.txt')`
2. **A11y pass** across all engines (per enhanced-plan Phase 4 checklist):
   - Every button has `type="button"` and is Tab-reachable
   - Every modal traps focus and restores on close (use `ui.Modal()` which already does this)
   - All icon-only buttons have `aria-label`
   - Color is never the only signal for correct/wrong (add ✓ / ✗ icons)
   - Quiz answer options are `<label>` wrapping `<input type="radio">`
   - Flashcard flip triggers on Space/Enter, not only click
   - `prefers-reduced-motion` disables flip animations
3. Manual test: tab through each engine — every interactive element reachable, no focus traps.

### Test Gate
```bash
npm run check
# Manual: export flashcards → CSV downloads → import into Anki
# Manual: tab through quiz, all options reachable via keyboard
# Manual: prefers-reduced-motion honored
```

### Commit Message
```
feat(phase-4): flashcard Anki export + a11y pass

Flashcard results screen has "Export to Anki" button (TSV download).
All engines pass a11y checklist: keyboard nav, focus trap, ARIA labels,
reduced-motion support. Phase 4 complete.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
Phase 4 done. P7 E2E tests can cover Anki export + a11y.

---

# PHASE 4.6 — PRE-PHASE-5 CLEANUP (COMPLETED 2026-06-24)

> **Status:** ✅ Complete. See `PATCH_NOTES.md` for full details.
> **Sessions:** 1 (batch) · **Estimated:** ~4 hours actual.
> **Goal:** Fix all 9 critical blockers + 25 high-severity issues identified in the Phase 4.5 → Phase 5 readiness review.

## Summary of changes

- **B1:** `src/lib/sync.js` — fixed 4 data-loss bugs (appendOnly dedupe key, syncPush doc-key collisions, syncPull compound-key lookup, maxStreak dropped xp/level) + improved merge strategies (true field-level merge, true LWW, SM-2 sum semantics).
- **B2:** `engines/engine-tracker.js` — fixed wrong store (was polluting `userContent`, now writes to `quizTracker` with composite key). Full P2.6/P2.7 engine rewire deferred.
- **B3:** `engines/engine-shared.js` — rewrote lib-bridge: robust path resolution (3 candidates), logged catches (no more silent swallowing), expanded coverage (gemini/keyboard/ui/anki/sync/auth bridges added), full tracker API (11 methods, was 6).
- **B4:** `engines/uworld-engine.js` — fixed `__QUIZ_ENGINE_BASE` → `__UWORLD_ENGINE_BASE` (with backward-compat fallback). Also added `__INDEX_ENGINE_BASE` fallback to `index-engine.js`.
- **B5:** `src/lib/quota.js` — fixed Stage 3 sign-inversion (was evicting overdue cards, now evicts mature cards scheduled 1+ years in the future). Extracted magic numbers to exported constants.
- **B6:** A11y — `src/lib/ui.js` `Modal()` now has focus trap + focus restore. Added `type="button"` to 222 `<button>` tags across 9 engines. Added `aria-haspopup`/`aria-expanded` to hub auth dropdown. `dom.js` `createElement` now handles `ariaLabel` → `aria-label` correctly.
- **B7:** `engines/flashcard-engine.js` — Export to Anki now delegates to `window.OslerAnki.downloadTSV()` via lib-bridge (was duplicating anki.js inline).
- **B8:** `src/lib/validate.js` — rejects unknown `meta.schemaVersion` (V19 policy enforced). Loads known versions from `_meta.json`. Added 5 tests.
- **B9:** `tauri-admin/` reconciled — added `lib.rs`, `auth.rs` (stub), `mcp_server.rs` (stub), `validation.rs` (stub), `frontend/main.js`, `frontend/styles.css`. Updated `Cargo.toml` (added `git2`/`reqwest`/`tokio`/tauri plugins). Updated `tauri.conf.json` (updater + shell plugins). Registered 9 stub commands in `main.rs`.
- **H1–H25:** All high-severity issues addressed. See `PATCH_NOTES.md` for the full table.
- **Deleted:** `engines/sync-engine.js`, `engines/sync-engine.src.js`, `scripts/build_sync_engine.ps1` (legacy WebRTC/MQTT sync — replaced by `src/lib/sync.js` Firebase sync).
- **New files:** `src/lib/sync-utils.js` (shared `getDeviceId`), `scripts/add-type-button.js` (a11y helper), `PATCH_NOTES.md` (this change log).

## Verification

```bash
npm run build     # ✓ 11 engines, 10 CSS, assets, lib, schemas
npm test          # ✓ 73/73 tests pass (was 59/59 — +14 new tests)
npm run validate  # ✓
npm run check     # ✓ exit 0
```

## Phase 5 entry state

Phase 5 sessions P5.1 (`auth.rs`), P5.2 (`git.rs`), P5.7 (`mcp_server.rs`) will find **stub files already in place** — they should "Implement" rather than "Create". The stubs register commands in `main.rs` so `cargo build` already verifies they compile. Existing `commands.rs`, `parser.rs`, `pdf.rs`, `deploy.rs`, `server.rs`, `templates.rs` are preserved working v5 code — Phase 5 should extend, not replace.

Existing `git.rs` uses `std::process::Command` shell-out (safe, well-tested with `--force-with-lease`). Phase 5 P5.2 may optionally migrate to the `git2` crate (now in `Cargo.toml`), but this is not required.

---

# PHASE 5.0 — TAURI ADMIN SCAFFOLDING

> **Sessions:** 3 · **Estimated:** ~2 hours · **Minimum tier:** T2 for P5.0.1 (Rust), T1 for rest.
> **Status:** ✅ Mostly complete (B9 reconciliation). P5.0.1, P5.0.2, P5.0.3 verify-against-existing-state rather than create-from-scratch.

---

## Session P5.0.1 — Scaffold `tauri-admin/` Rust app `[T2]`

**Depends: P1.5` (player.html exists for admin preview)

### Verify Inputs
- Phase 1 complete
- `tauri-admin/` exists

### Files Touched
- `tauri-admin/Cargo.toml` (verify exists)
- `tauri-admin/tauri.conf.json` (verify exists)
- `tauri-admin/src/main.rs` (verify exists)
- `tauri-admin/src/lib.rs` (verify exists)
- `tauri-admin/build.rs` (verify exists)

### Steps

1. Verify Rust toolchain: `cargo --version` (install via rustup if missing — ask human before installing system-wide)
2. Verify `tauri-admin/Cargo.toml` exists with tauri 2.x, reqwest, serde, tokio, git2.
3. Verify `tauri-admin/tauri.conf.json` exists with window config, safe-storage + http plugins.
4. Verify `tauri-admin/src/main.rs` exists with Tauri boot.
5. Verify `tauri-admin/src/lib.rs` exists with tauri::Builder setup.
6. Verify `tauri-admin/build.rs` exists with `tauri_build::build()`.
7. `cd tauri-admin && cargo build` — must succeed. First build downloads deps, takes 5-10 min.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -5 | grep -q "Finished"
```

### Commit Message
```
tauri(phase-5.0): scaffold admin app

Cargo.toml with tauri 2, reqwest, serde, tokio, git2.
tauri.conf.json with shell/http/store plugins.
main.rs + lib.rs boot a 1200x800 window with devtools.
```

### Rollback
```bash
git rm -r tauri-admin/
```

### Hand-off
P5.0.2 expects `cargo build` to succeed.

---

## Session P5.0.2 — Create empty admin frontend shell `[T1]`

**Depends: P5.0.1`

### Verify Inputs
- `tauri-admin/` builds

### Files Touched
- `tauri-admin/frontend/index.html` (verify exists)
- `tauri-admin/frontend/main.js` (verify exists)
- `tauri-admin/frontend/styles.css` (verify exists)

### Steps

1. Verify `tauri-admin/frontend/index.html` exists with side nav for 7 pages.
2. Verify `tauri-admin/frontend/main.js` exists with router.
3. Verify `tauri-admin/frontend/styles.css` exists — match Osler dark theme.
4. `cargo build` and `cargo run` — window opens, all 7 nav items clickable

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: cargo run, click through 7 pages
```

### Commit Message
```
tauri(phase-5.0): admin frontend shell

7-page nav (Dashboard, RepoBrowser, ContentEditor, PullRequests,
Deploy, Analytics, Settings). Simple router loads page modules.
Dark theme matches web app.
```

### Rollback
```bash
git rm -r tauri-admin/frontend/
```

### Hand-off
P5.0.3 expects frontend shell.

---

## Session P5.0.3 — Create empty Rust command registry `[T1]`

**Depends: P5.0.2`

### Verify Inputs
- Frontend shell works

### Files Touched
- `tauri-admin/src/commands.rs` (verify exists, add command registry stubs if missing)
- `tauri-admin/src/lib.rs` (update — register commands)

### Steps

1. Verify `tauri-admin/src/commands.rs` exists. If missing or empty, create/add `ping()` stub:
   ```rust
   #[tauri::command]
   pub fn ping() -> String { "pong".to_string() }
   ```
2. Verify `tauri-admin/src/lib.rs` registers the `ping` command. If not, add:
   ```rust
   .invoke_handler(tauri::generate_handler![commands::ping])
   ```
3. From frontend, `await window.__TAURI__.core.invoke('ping')` should return `"pong"`.
4. `cargo build && cargo run`, test from devtools console.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: invoke('ping') returns 'pong' in devtools
```

### Commit Message
```
tauri(phase-5.0): empty command registry + ping

commands.rs with ping() command. lib.rs registers it.
Frontend can invoke('ping') → 'pong'. Phase 5.0 complete.
```

### Rollback
```bash
git rm tauri-admin/src/commands.rs
git checkout HEAD~1 -- tauri-admin/src/lib.rs
```

### Hand-off
Phase 5.0 done. P5.1 can begin.

---

# PHASE 5 — GITHUB CMS

> **Sessions:** 9 · **Estimated:** ~14 hours · **Minimum tier:** T2 throughout. P5.3 (ContentEditor) is the most complex — consider T3.

---

## Session P5.1 — Create `src/auth.rs` (GitHub OAuth + safe-storage) `[T2]`

**Depends: P5.0.3`

### Verify Inputs
- `cargo build` succeeds
- `tauri-plugin-store` is in Cargo.toml (used for safe-storage)

### Files Touched
- `tauri-admin/src/auth.rs` (create)
- `tauri-admin/src/commands.rs` (update — add auth commands)
- `tauri-admin/src/lib.rs` (update — register commands)

### Steps

1. Create `tauri-admin/src/auth.rs`:
   - `start_github_oauth(state: String) -> String` — returns the GitHub authorize URL with client_id, redirect_uri, scope (`repo`, `user`), state. Opens in default browser via `tauri-plugin-shell`.
   - `exchange_code(code: String) -> Result<Token, Error>` — POST to `github.com/login/oauth/access_token`, returns token.
   - `store_token(token: String) -> Result<(), Error>` — encrypts with `tauri-plugin-store` (uses OS keychain) and stores.
   - `get_stored_token() -> Result<Option<String>, Error>` — reads from store.
   - `clear_token() -> Result<(), Error>` — deletes from store.
   - `verify_token(token: String) -> Result<User, Error>` — GET `api.github.com/user` to validate.
2. Add commands to `commands.rs`: `github_login`, `github_logout`, `get_github_user`
3. Register in `lib.rs`
4. Frontend: Settings page has "Sign in with GitHub" button. On click, `invoke('github_login')` → opens browser → user authorizes → redirect URI handled by a tiny local server (or manual code paste for simplicity).

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
cd tauri-admin && cargo test 2>&1 | tail -5
# Manual: sign in with GitHub, token stored, /user fetched
```

### Commit Message
```
tauri(phase-5): GitHub OAuth + safe-storage token

auth.rs: start_github_oauth, exchange_code, store_token (OS keychain
via tauri-plugin-store), get_stored_token, verify_token.
Commands: github_login, github_logout, get_github_user.
```

### Rollback
```bash
git rm tauri-admin/src/auth.rs
git checkout HEAD~1 -- tauri-admin/src/commands.rs tauri-admin/src/lib.rs
```

### Hand-off
P5.2 expects auth.rs.

---

## Session P5.2 — Create `src/git.rs` (clone/commit/push/PR) `[T2]`

**Depends: P5.1`

### Verify Inputs
- auth.rs exists, token can be retrieved

### Files Touched
- `tauri-admin/src/git.rs` (create)
- `tauri-admin/src/commands.rs` (update)

### Steps

1. Create `tauri-admin/src/git.rs` using `git2` crate:
   - `clone_repo(url, token, dst_path) -> Result<Repo, Error>`
   - `checkout_branch(repo, branch_name) -> Result<(), Error>` — create if doesn't exist
   - `commit_file(repo, path, content, message) -> Result<Oid, Error>`
   - `push(repo, remote, branch, token) -> Result<(), Error>`
   - `create_pr(owner, repo, head, base, title, body, token) -> Result<Pr, Error>` — via GitHub API (reqwest)
   - `merge_pr(owner, repo, pr_number, token) -> Result<(), Error>`
2. Add commands: `git_clone`, `git_commit`, `git_push`, `create_pr`, `merge_pr`
3. Unit tests with a temp dir + local git repo fixture.

### Test Gate
```bash
cd tauri-admin && cargo test 2>&1 | tail -5
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
```

### Commit Message
```
tauri(phase-5): git.rs (clone/commit/push/PR via git2 + GitHub API)

8 helpers in git.rs. 5 commands exposed: git_clone, git_commit,
git_push, create_pr, merge_pr.
Unit tests with temp-dir git fixtures.
```

### Rollback
```bash
git rm tauri-admin/src/git.rs
git checkout HEAD~1 -- tauri-admin/src/commands.rs
```

### Hand-off
P5.3 expects git.rs.

---

## Session P5.3 — ContentEditor page `[T3]`

**Depends: P5.2`

### Verify Inputs
- git.rs works, can commit files
- `src/lib/validate.js` exists (run in browser context inside Tauri webview)

### Files Touched
- `tauri-admin/frontend/content-editor.js` (create)
- `tauri-admin/src/validation.rs` (create — wraps schemas for Rust-side validation)
- `tauri-admin/src/commands.rs` (update — `read_file`, `write_file`, `validate`)

### Steps

1. Create `tauri-admin/src/validation.rs`:
   - Embed `src/schemas/*.json` at compile time using `include_str!`
   - `validate(content_json: &str) -> Result<(), Vec<String>>` — uses `jsonschema` crate
2. Add commands: `read_file(path)`, `write_file(path, content)`, `validate(content_json)`
3. Create `tauri-admin/frontend/content-editor.js`:
   - Left panel: file tree (uses `git_clone` + `list_files`)
   - Center: JSON editor (use CodeMirror CDN or a simple `<textarea>` with syntax highlighting via Prism.js)
   - Right panel: live preview — opens `player.html?path=...` in an iframe after saving to a temp file
   - Bottom: "Validate" button (calls `validate(content)`), "Commit & PR" button (calls `git_commit` + `create_pr`)
   - "Anki CSV Import" button: opens file picker, parses TSV via `src/lib/anki.js` (loaded as a script tag), converts to flashcard JSON, populates editor
4. Workflow: open file → edit → validate (green check) → preview → commit & PR
5. Manual test: create a new quiz, validate, preview, commit, see PR on GitHub

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: full ContentEditor workflow end-to-end
```

### Commit Message
```
tauri(phase-5): ContentEditor page

3-pane editor: file tree | JSON editor | live preview.
Validate button (Rust-side jsonschema). Commit & PR button.
Anki CSV import button. validation.rs embeds schemas at compile time.
```

### Rollback
```bash
git rm tauri-admin/frontend/content-editor.js tauri-admin/src/validation.rs
git checkout HEAD~1 -- tauri-admin/src/commands.rs
```

### Hand-off
P5.4 expects ContentEditor working.

---

## Session P5.4 — Dashboard + RepoBrowser pages `[T1]`

**Depends: P5.3`

### Verify Inputs
- ContentEditor works
- `get_github_user` command returns user data

### Files Touched
- `tauri-admin/frontend/dashboard.js` (create)
- `tauri-admin/frontend/repo-browser.js` (create)

### Steps

1. Dashboard: shows repo overview (name, stars, last commit), recent activity (last 10 commits), open PRs count. Uses GitHub API via `reqwest` from Rust.
2. RepoBrowser: file tree with filter input. Click `.json` file → opens in ContentEditor.
3. Add commands: `get_repo_info`, `list_recent_commits`, `list_prs`

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: dashboard shows data, browser navigates
```

### Commit Message
```
tauri(phase-5): Dashboard + RepoBrowser pages

Dashboard: repo info, recent commits, open PRs.
RepoBrowser: file tree with .json filter, opens ContentEditor.
```

### Rollback
```bash
git rm tauri-admin/frontend/dashboard.js tauri-admin/frontend/repo-browser.js
```

### Hand-off
P5.5 expects both pages.

---

## Session P5.5 — PullRequests + Deploy pages `[T1]`

**Depends: P5.4`

### Verify Inputs
- Dashboard + RepoBrowser work

### Files Touched
- `tauri-admin/frontend/pull-requests.js` (create)
- `tauri-admin/frontend/deploy.js` (create)
- `tauri-admin/src/deploy.rs` (create)
- `tauri-admin/src/commands.rs` (update)

### Steps

1. PullRequests page: list open PRs, click to view diff, "Merge" button (calls `merge_pr`).
2. Create `tauri-admin/src/deploy.rs`:
   - `deploy_pages(repo, token) -> Result<Url, Error>` — triggers GitHub Pages deployment
   - `deploy_netlify(repo, token, site_id) -> Result<Url, Error>`
   - `deploy_vercel(repo, token, project_id) -> Result<Url, Error>`
3. Deploy page: choose provider, click "Deploy", show progress + final URL.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: list PRs, merge one. Deploy to Pages.
```

### Commit Message
```
tauri(phase-5): PullRequests + Deploy pages

PullRequests: list, view diff, merge.
Deploy: 3 providers (Pages, Netlify, Vercel) via deploy.rs.
```

### Rollback
```bash
git rm tauri-admin/frontend/pull-requests.js tauri-admin/frontend/deploy.js tauri-admin/src/deploy.rs
git checkout HEAD~1 -- tauri-admin/src/commands.rs
```

### Hand-off
P5.6 expects both pages.

---

## Session P5.6 — Analytics + Settings pages `[T1]`

**Depends: P5.5`

### Files Touched
- `tauri-admin/frontend/analytics.js` (create)
- `tauri-admin/frontend/settings.js` (create)

### Steps

1. Analytics page: query Firestore (via Firebase REST API with admin token) for aggregated study events. Show: total events, events by type, top content, daily active users.
2. Settings page: GitHub token status, deploy keys management, "Sign out" button, "Disable auto-update check" toggle (for Phase 8).

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: analytics shows data, settings persists
```

### Commit Message
```
tauri(phase-5): Analytics + Settings pages

Analytics: aggregated study events from Firestore.
Settings: token status, deploy keys, sign-out, update toggle.
```

### Rollback
```bash
git rm tauri-admin/frontend/analytics.js tauri-admin/frontend/settings.js
```

### Hand-off
P5.7 expects all 7 admin pages.

---

## Session P5.7 — Create `src/mcp_server.rs` (14 MCP tools) `[T2]`

**Depends: P5.6`

### Files Touched
- `tauri-admin/src/mcp_server.rs` (create)

### Steps

1. Create `tauri-admin/src/mcp_server.rs` implementing MCP (Model Context Protocol) server over stdio:
   - Each MCP tool is a thin wrapper around an existing Rust command
   - 14 tools: `list_files, read_file, write_file, validate, convert, export_pdf, git_status, git_commit, git_push, create_pr, merge_pr, deploy, search_content, generate_quiz, analytics_query`
   - Each tool: name, description, JSON Schema for params, handler that calls the corresponding Rust function
2. The MCP server runs as a child process spawned by AI clients (Claude Desktop, etc.) — implement stdio JSON-RPC.
3. Use the `rmcp` crate or hand-roll a minimal MCP impl.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: configure in Claude Desktop, list tools succeeds
```

### Commit Message
```
tauri(phase-5): MCP server with 14 tools

mcp_server.rs exposes 14 thin wrappers over existing commands
via stdio JSON-RPC. AI clients can list_files, validate, create_pr,
generate_quiz, etc. No new logic — pure delegation.
```

### Rollback
```bash
git rm tauri-admin/src/mcp_server.rs
```

### Hand-off
P5.8 expects MCP server.

---

## Session P5.8 — Update `tauri.conf.json` for plugins + `engines.rs` `[T1]`

**Depends: P5.7`

### Files Touched
- `tauri-admin/tauri.conf.json` (update — add updater plugin for Phase 8)
- `tauri/src/engines.rs` (create or update — embeds rebuilt engines)

### Steps

1. Update `tauri-admin/tauri.conf.json` to add:
   - `tauri-plugin-updater` config (for Phase 8)
   - `tauri-plugin-dialog` for file pickers
   - Permissions for HTTP, shell, store, updater, dialog
2. Create `tauri/src/engines.rs` — embeds all 13 engine files at compile time using `include_str!`. Used by the instance generator (Phase 8 push update).
3. `cargo build` both `tauri-admin` and `tauri/`

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
cd tauri && cargo build 2>&1 | tail -3 | grep -q Finished
```

### Commit Message
```
tauri(phase-5): config + engines.rs

tauri.conf.json: updater, dialog plugins, permissions.
tauri/src/engines.rs: embeds 13 engines via include_str! for
Phase 8 instance generator.
```

### Rollback
```bash
git checkout HEAD~1 -- tauri-admin/tauri.conf.json
git rm tauri/src/engines.rs 2>/dev/null || true
```

### Hand-off
P5.9 expects both builds.

---

## Session P5.9 — Phase 5 integration test + cargo test `[T1]`

**Depends: P5.8`

### Files Touched
- `tauri-admin/tests/integration_test.rs` (create)

### Steps

1. Write integration test that exercises the full CMS flow:
   - Sign in (mock)
   - Clone test repo
   - Open file in ContentEditor
   - Validate
   - Commit & PR (mock the GitHub API)
   - List PRs
   - Merge
2. `cargo test` must pass.

### Test Gate
```bash
cd tauri-admin && cargo test 2>&1 | tail -5 | grep -E "test result: ok"
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
```

### Commit Message
```
test(phase-5): integration test for full CMS flow

Sign-in → clone → edit → validate → commit → PR → merge.
Mocked GitHub API. Phase 5 complete.
```

### Rollback
```bash
git rm tauri-admin/tests/integration_test.rs
```

### Hand-off
Phase 5 done. P6 can begin.

---

# PHASE 6 — AI PIPELINE

> **Sessions:** 4 · **Estimated:** ~4 hours · **Minimum tier:** T2 for P6.1, T1 for rest.

---

## Session P6.1 — Create `src/lib/content-gen.js` (3-stage Gemini) `[T2]`

**Depends: Phase 5 complete + Phase 1 (schemas)`

### Verify Inputs
- `src/lib/gemini.js` exists (getClient, streamGenerate)
- `src/schemas/*.json` exist
- `npm run export-schemas` produces `.agents/context/*.json`

### Files Touched
- `src/lib/content-gen.js` (create)
- `.agents/context/` (regenerate)

### Steps

1. Run `npm run export-schemas` to refresh `.agents/context/`
2. Create `src/lib/content-gen.js` with 3 stages:
   - **Stage 1 — NL→outline:** user prompt → Gemini Flash-Lite → structured outline JSON. Prompt includes schema reference.
   - **Stage 2 — extraction:** outline → Gemini Flash-Lite → extracted fields per item. Cost: ~$0.015/1K tokens.
   - **Stage 3 — conversion:** extracted fields → Gemini Pro → final content JSON matching the type schema. Cost: ~$0.50/1K tokens.
   - **Quality gate:** after stage 3, run `validate(content)`. If validation fails OR a quality score (heuristic: explanation length, option count, etc.) < 0.7, route to "Needs Review" queue.
   - **Cost caps:** maintain a counter in `settings` store: `aiCostToday`, `aiCostMonth`. If exceeded, refuse new requests.
3. Export: `generateContent(prompt, type, opts) -> { content, qualityScore, cost, stages }`
4. Unit tests with mocked Gemini client.

### Test Gate
```bash
npm test 2>&1 | grep -E "[1-9][0-9] passed"
npm run export-schemas
test -f .agents/context/quiz-v1.json
npm run check
```

### Commit Message
```
lib(phase-6): 3-stage Gemini content generation

NL→outline (Flash-Lite) → extraction (Flash-Lite) → conversion (Pro).
Quality gate: validate + heuristic score. <0.7 → "Needs Review".
Cost caps: $20/day, $200/month (tracked in settings store).
```

### Rollback
```bash
git rm src/lib/content-gen.js
```

### Hand-off
P6.2 expects content-gen.js.

---

## Session P6.2 — Create 5 agent skill files `[T1]`

**Depends: P6.1`

### Files Touched
- `.agents/skills/create-quiz.md` (create)
- `.agents/skills/create-flashcard.md` (create)
- `.agents/skills/edit-content.md` (create)
- `.agents/skills/content-review.md` (create)
- `.agents/skills/anki-csv.md` (create)

### Steps

1. Each skill file follows the MCP skill format:
   - Title, description, when-to-use
   - Inputs (params)
   - Outputs (return shape)
   - Workflow (step-by-step)
   - Examples
2. `create-quiz.md`: how to use `generateContent(prompt, 'quiz', opts)` to create a quiz
3. `create-flashcard.md`: same for flashcards
4. `edit-content.md`: how to load content, modify, validate, commit
5. `content-review.md`: how to review content in the "Needs Review" queue
6. `anki-csv.md`: how to import Anki CSV → flashcard content

### Test Gate
```bash
for f in create-quiz create-flashcard edit-content content-review anki-csv; do
  test -f .agents/skills/$f.md || exit 1
done
npm run check
```

### Commit Message
```
skills(phase-6): 5 agent skill files

create-quiz, create-flashcard, edit-content, content-review,
anki-csv. Each describes inputs, outputs, workflow, examples
for AI agents using the MCP tools.
```

### Rollback
```bash
git rm -r .agents/skills/
```

### Hand-off
P6.3 expects skills.

---

## Session P6.3 — Wire content-gen to admin ContentEditor `[T1]`

**Depends: P6.2`

### Files Touched
- `tauri-admin/frontend/content-editor.js` (update — add "Generate with AI" button)

### Steps

1. In ContentEditor, add "Generate with AI" button at the top.
2. Click → opens modal: prompt textarea, type selector, "Generate" button.
3. On generate: calls `generateContent()` via a new Rust command `generate_content` that shells out to Node (or runs the JS directly via embedded V8 if available).
4. Result populates the editor. User can review, edit, commit.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: "Create 10 cardiology questions" → AI generates JSON in editor
```

### Commit Message
```
tauri(phase-6): AI generate button in ContentEditor

Modal with prompt + type selector. Calls generate_content command.
Result populates editor for human review before commit.
```

### Rollback
```bash
git checkout HEAD~1 -- tauri-admin/frontend/content-editor.js
```

### Hand-off
P6.4 expects AI generation working.

---

## Session P6.4 — Phase 6 cost-tracking + "Needs Review" queue `[T1]`

**Depends: P6.3`

### Files Touched
- `tauri-admin/frontend/content-editor.js` (update — show "Needs Review" badge)
- `tauri-admin/frontend/dashboard.js` (update — show cost counters)

### Steps

1. In Dashboard, add "AI Cost Today" and "AI Cost This Month" cards. Read from `settings` store via a new command.
2. In ContentEditor, if loaded content has `meta.aiQualityScore < 0.7`, show "Needs Review" badge.
3. Add a "Needs Review" filter in RepoBrowser.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: dashboard shows cost, "Needs Review" badge appears on low-quality content
```

### Commit Message
```
tauri(phase-6): cost tracking + Needs Review queue

Dashboard: AI cost today/month from settings store.
ContentEditor: "Needs Review" badge for qualityScore < 0.7.
RepoBrowser: filter by review status. Phase 6 complete.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
Phase 6 done.

---

# PHASE 7 — TEST & SHIP

> **Sessions:** 6 · **Estimated:** ~6 hours · **Minimum tier:** T2 for P7.6 (CI), T1 for rest.

---

## Session P7.1 — 10 E2E spec files (20 journeys) `[T2]`

**Depends: Phases 1-6 complete`

### Files Touched
- `tests/e2e/player.spec.js`
- `tests/e2e/quiz-session.spec.js`
- `tests/e2e/flashcard-study.spec.js`
- `tests/e2e/bank-session.spec.js`
- `tests/e2e/written-assessment.spec.js`
- `tests/e2e/osce-simulation.spec.js`
- `tests/e2e/firebase-auth.spec.js`
- `tests/e2e/anki-csv.spec.js`
- `tests/e2e/content-gen.spec.js`
- `tests/e2e/github-cms.spec.js`

### Steps

1. Each spec file has exactly 2 journeys per the enhanced plan.
2. Use Playwright fixtures: `test.beforeEach` boots the dev server (`npx serve dist -l 5500`).
3. Mock Firebase auth via Playwright's `page.route()` intercepting `identitytoolkit.googleapis.com`.
4. Mock GitHub API for `github-cms.spec.js`.
5. Mock Gemini API for `content-gen.spec.js`.
6. Run `npm run test:e2e` — all 20 must pass.

### Test Gate
```bash
npm run test:e2e 2>&1 | tail -10 | grep -E "20 passed"
```

### Commit Message
```
test(phase-7): 10 e2e specs, 20 journeys

player, quiz-session, flashcard-study, bank-session,
written-assessment, osce-simulation, firebase-auth,
anki-csv, content-gen, github-cms. Firebase/GitHub/Gemini mocked.
All 20 journeys pass.
```

### Rollback
```bash
git rm tests/e2e/*.spec.js
```

### Hand-off
P7.2 expects e2e green.

---

## Session P7.2 — Integration tests (storage + sync) `[T1]`

**Depends: P7.1`

### Files Touched
- `tests/integration/storage.test.js` (create)
- `tests/integration/sync-adapter.test.js` (create)

### Steps

1. `storage.test.js`: full CRUD across all 9 stores, quota eviction triggers correctly at 85/90/95%.
2. `sync-adapter.test.js`: simulate two-device sync with a mock Firestore. Verify merge strategies work end-to-end.

### Test Gate
```bash
npm test 2>&1 | grep -E "[1-9][0-9] passed"
```

### Commit Message
```
test(phase-7): integration tests for storage + sync

storage.test.js: 9-store CRUD, quota eviction at 85/90/95%.
sync-adapter.test.js: two-device sync with mock Firestore,
all 5 merge strategies verified.
```

### Rollback
```bash
git rm tests/integration/storage.test.js tests/integration/sync-adapter.test.js
```

### Hand-off
P7.3 expects integration tests.

---

## Session P7.3 — Update `sw.js` for Phase 8 compatibility `[T1]`

**Depends: P7.2`

### Files Touched
- `sw.js` (update — add `update-manifest.json` check on activate)

### Steps

1. In `sw.js` `activate` event, fetch `update-manifest.json`. Compare version with cached version in `settings` store. If different, post a message to all clients: `{ type: 'update-available', version }`.
2. In hub (`index-engine.js`), listen for the message and show an "Update available" badge.

### Test Gate
```bash
npm run check
# Manual: bump version in update-manifest.json, refresh, badge appears
```

### Commit Message
```
pwa(phase-7): sw.js checks update-manifest on activate

Compares version with cached version in settings store.
Posts 'update-available' message to clients on mismatch.
Hub shows update badge.
```

### Rollback
```bash
git checkout HEAD~1 -- sw.js engines/index-engine.js
```

### Hand-off
P7.4 expects sw.js ready for Phase 8.

---

## Session P7.4 — Update `AGENTS.md` + `.github/workflows/ci.yml` `[T1]`

**Depends: P7.3`

### Files Touched
- `AGENTS.md` (update — Osler V1 reference, fix any stale info)
- `.github/workflows/ci.yml` (create)

### Steps

1. Update `AGENTS.md`:
   - Update Phase column to current phase
   - Verify all file paths still match reality
   - Add CI badge
2. Create `.github/workflows/ci.yml`:
   - On PR: `npm install`, `npm run check`, `cd tauri-admin && cargo build`
   - On main merge: also `npm run test:e2e`, auto-deploy to Pages
   - Matrix: Node 20, Rust stable
   - Cache `node_modules` and `~/.cargo/registry`

### Test Gate
```bash
test -f .github/workflows/ci.yml
npm run check  # simulates what CI does
# Manual: push to a PR branch, CI runs green
```

### Commit Message
```
ci(phase-7): workflow + AGENTS.md sync

ci.yml: Node 20 + Rust stable matrix. PR runs check + cargo build.
Main merge runs e2e + auto-deploys to Pages.
AGENTS.md synced with current phase and file paths.
```

### Rollback
```bash
git rm .github/workflows/ci.yml
git checkout HEAD~1 -- AGENTS.md
```

### Hand-off
P7.5 expects CI green.

---

## Session P7.5 — Lighthouse audit + fixes `[T2]`

**Depends: P7.4`

### Files Touched
- (whatever needs fixing — typically: image sizing, color contrast, missing meta tags)

### Steps

1. Run `npx lighthouse http://localhost:5500 --view --output=json --output-path=lh.json`
2. Check scores: Performance 95+, Accessibility 90+, Best Practices 95+, SEO 90+, PWA all pass
3. Fix any failures. Common ones:
   - Images without explicit width/height
   - Color contrast below 4.5:1
   - Missing `<meta name="description">`
   - Missing `lang` attribute on `<html>`
4. Re-run until all targets met.

### Test Gate
```bash
npx lighthouse http://localhost:5500 --output=json --output-path=lh.json --quiet
node -e "const s=JSON.parse(require('fs').readFileSync('lh.json')).categories; console.log('perf',s.performance.score,'a11y',s.accessibility.score,'bp',s['best-practices'].score,'seo',s.seo.score,'pwa',s.pwa.score)"
# All must meet: perf>=0.95, a11y>=0.90, bp>=0.95, seo>=0.90, pwa===1
```

### Commit Message
```
perf(phase-7): Lighthouse audit + fixes

Targets met: Performance 95+, A11y 90+, Best Practices 95+,
SEO 90+, PWA all checks pass.
```

### Rollback
```bash
git revert HEAD
```

### Hand-off
P7.6 expects Lighthouse green.

---

## Session P7.6 — Phase 7 final verification + ship `[T1]`

**Depends: P7.5`

### Files Touched
- (none — verification only)

### Steps

1. Run the full Phase 7 verification:
   ```bash
   npm run check
   npm run test:e2e
   cd tauri-admin && cargo build && cargo test
   npx lighthouse http://localhost:5500 --view
   ```
2. All must pass.
3. Tag release: `git tag v1.0.0-rc1 && git push --tags`
4. Create GitHub Release with release notes summarizing all phases.

### Test Gate
```bash
npm run check && npm run test:e2e && cd tauri-admin && cargo test && echo "ALL GREEN"
```

### Commit Message
```
release(phase-7): v1.0.0-rc1

All Phase 7 verification passes:
- npm run check (build + test + validate)
- npm run test:e2e (20 journeys)
- cargo build + cargo test (admin app)
- Lighthouse: all targets met

Tagged v1.0.0-rc1. Phase 7 complete.
```

### Rollback
```bash
git tag -d v1.0.0-rc1
git push --delete origin v1.0.0-rc1
```

### Hand-off
Phase 7 done. P8 can begin.

---

# PHASE 8 — UPDATE SYSTEM

> **Sessions:** 7 · **Estimated:** ~8 hours · **Minimum tier:** T2 throughout.

---

## Session P8.1 — `src/lib/update-manifest.json` schema + generator `[T1]`

**Depends: Phase 7 complete`

### Files Touched
- `src/lib/update-manifest.json` (create — schema/template)
- `src/build.js` (update — generate manifest at build time)

### Steps

1. Define `update-manifest.json` shape:
   ```json
   {
     "version": "1.0.0",
     "requiredVersion": "1.0.0",
     "bundleHash": "sha256:...",
     "changelog": "Initial release",
     "engines": ["engine-shared.js", "engine-tracker.js", ...],
     "assets": ["icon-48.png", ...],
     "generatedAt": "ISO8601"
   }
   ```
2. Update `src/build.js` to compute the SHA-256 hash of the bundled engines + assets and write `update-manifest.json` to `dist/`.

### Test Gate
```bash
npm run build
test -f dist/update-manifest.json
node -e "const m=JSON.parse(require('fs').readFileSync('dist/update-manifest.json','utf8')); if(!m.bundleHash.startsWith('sha256:')) throw new Error('bad hash'); console.log('manifest OK')"
npm run check
```

### Commit Message
```
build(phase-8): generate update-manifest.json

Manifest includes version, requiredVersion, bundleHash (SHA-256
of engines + assets), changelog, file lists. Emitted to dist/
on every build.
```

### Rollback
```bash
git rm src/lib/update-manifest.json
git checkout HEAD~1 -- src/build.js
```

### Hand-off
P8.2 expects manifest generation.

---

## Session P8.2 — Create `bundle_engines.rs` `[T2]`

**Depends: P8.1`

### Files Touched
- `tauri-admin/src/bundle_engines.rs` (create)
- `tauri-admin/src/commands.rs` (update — `bundle_update`)

### Steps

1. Create `tauri-admin/src/bundle_engines.rs`:
   - `bundle_engines(version, changelog) -> Result<PathBuf, Error>`:
     - Read all 12 engine files from `dist/engines/` (NOT 8 — V12 fix)
     - Read `assets/`, `sw.js`, `manifest.webmanifest`, `tracker-map.json`
     - Read `update-manifest.json`, update version + hash
     - Zip everything into `update-v{version}.zip`
     - Return path to zip
2. Add command `bundle_update(version, changelog)`.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
cd tauri-admin && cargo test 2>&1 | tail -3 | grep -E "test result: ok"
# Manual: invoke('bundle_update', { version: '1.0.1', changelog: 'test' }) → zip created
unzip -l update-v1.0.1.zip | grep -c "engine-"  # should be 12
```

### Commit Message
```
tauri(phase-8): bundle_engines.rs (12 engines + assets)

Bundles all 12 engine files (NOT 8 — V12 fix), assets, sw.js,
manifest.webmanifest, tracker-map.json, update-manifest.json
into update-v{version}.zip.
```

### Rollback
```bash
git rm tauri-admin/src/bundle_engines.rs
git checkout HEAD~1 -- tauri-admin/src/commands.rs
```

### Hand-off
P8.3 expects bundler.

---

## Session P8.3 — Create `updater.rs` (Tier 1 self-update) `[T2]`

**Depends: P8.2`

### Files Touched
- `tauri-admin/src/updater.rs` (create)
- `tauri-admin/src/commands.rs` (update — `check_update`, `apply_update`, `get_update_status`)
- `tauri-admin/tauri.conf.json` (update — updater plugin config)
- `tauri-admin/frontend/index.html` (update — Update page)

### Steps

1. Create `tauri-admin/src/updater.rs`:
   - `check_for_update() -> Result<Option<UpdateInfo>, Error>` — GET `api.github.com/repos/OWNER/REPO/releases/latest`, compare semver with current. Returns None if up-to-date.
   - `apply_update() -> Result<(), Error>` — download binary, verify SHA-256 hash, swap executable, restart.
2. Add 3 commands: `check_update`, `apply_update`, `get_update_status`
3. Configure `tauri-plugin-updater` in `tauri.conf.json`
4. Add Update page in frontend: status (up-to-date / available / installing), changelog, "Update & Restart" button.

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: tag a fake newer release, run admin, see "Update available"
```

### Commit Message
```
tauri(phase-8): Tier 1 self-update

updater.rs: check GitHub Releases, semver compare, download,
hash verify, swap, restart. Commands: check_update, apply_update,
get_update_status. Update page in admin UI.
```

### Rollback
```bash
git rm tauri-admin/src/updater.rs tauri-admin/frontend/update.js 2>/dev/null || true
git checkout HEAD~1 -- tauri-admin/src/commands.rs tauri-admin/tauri.conf.json tauri-admin/frontend/index.html
```

### Hand-off
P8.4 expects self-update working.

---

## Session P8.4 — Create `push_update.rs` (Tier 2 push) `[T2]`

**Depends: P8.3`

### Files Touched
- `tauri-admin/src/push_update.rs` (create)
- `tauri-admin/src/commands.rs` (update — `push_update`, `check_instance_versions`)
- `tauri-admin/frontend/index.html` (update — Managed Instances page)

### Steps

1. Create `tauri-admin/src/push_update.rs`:
   - `push_update(instance_repos, version) -> Result<PushReport, Error>`:
     - For each instance repo: clone, checkout `update-{version}` branch, apply bundle files, commit, push, open PR `[Update] v{version}`
     - Optional auto-merge if CI passes
   - `check_instance_versions(instances) -> Vec<InstanceStatus>` — for each instance, fetch `update-manifest.json`, compare versions
2. Add commands: `push_update`, `check_instance_versions`
3. Add "Managed Instances" page: list instances, version status, "Push Update" button, rollback button (last 5 updates per instance)

### Test Gate
```bash
cd tauri-admin && cargo build 2>&1 | tail -3 | grep -q Finished
# Manual: push update to a test instance repo, see PR created
```

### Commit Message
```
tauri(phase-8): Tier 2 push to instances

push_update.rs: clone instance, apply bundle, commit, push, open PR.
check_instance_versions: compare versions across instances.
Managed Instances page with rollback button (last 5 updates).
```

### Rollback
```bash
git rm tauri-admin/src/push_update.rs tauri-admin/frontend/managed-instances.js 2>/dev/null || true
git checkout HEAD~1 -- tauri-admin/src/commands.rs tauri-admin/frontend/index.html
```

### Hand-off
P8.5 expects push working.

---

## Session P8.5 — Update `sw.js` for instance-side update detection `[T1]`

**Depends: P8.4`

### Files Touched
- `sw.js` (update — already partially done in P7.3, finalize here)

### Steps

1. P7.3 already added the version-check skeleton. Finalize:
   - On `activate`: fetch `./update-manifest.json`, parse, compare with `cached_version` in IndexedDB `settings` store
   - If different: post message `{ type: 'update-available', version, changelog }` to all clients
2. In hub: show "Update v{version} available" banner with "Reload" button.
3. (Future: auto-reload on idle — out of scope for v1.)

### Test Gate
```bash
npm run check
# Manual: change version in update-manifest.json, refresh, banner appears
```

### Commit Message
```
pwa(phase-8): instance-side update detection

sw.js activate handler fetches update-manifest.json, compares with
cached version. Posts 'update-available' to clients on mismatch.
Hub shows update banner with reload button.
```

### Rollback
```bash
git checkout HEAD~1 -- sw.js engines/index-engine.js
```

### Hand-off
P8.6 expects update detection.

---

## Session P8.6 — E2E tests for update flow `[T1]`

**Depends: P8.5`

### Files Touched
- `tests/e2e/update-bundle.spec.js` (create)
- `tests/e2e/update-push.spec.js` (create)

### Steps

1. `update-bundle.spec.js`: invoke `bundle_update`, verify zip exists, contains 12 engines + assets + manifest.
2. `update-push.spec.js`: mock GitHub API, invoke `push_update` against a fake instance repo, verify PR created.

### Test Gate
```bash
npm run test:e2e -- --grep=update 2>&1 | tail -5 | grep -E "2 passed"
```

### Commit Message
```
test(phase-8): e2e for update bundle + push

update-bundle.spec.js: bundle generation, contents verified.
update-push.spec.js: push to mock instance, PR created.
```

### Rollback
```bash
git rm tests/e2e/update-bundle.spec.js tests/e2e/update-push.spec.js
```

### Hand-off
P8.7 expects e2e green.

---

## Session P8.7 — Phase 8 security review + final ship `[T2]`

**Depends: P8.6`

### Files Touched
- `SECURITY.md` (create — documents the security model)

### Steps

1. Run through the security checklist from the enhanced plan:
   - [ ] Update bundles signed with release key (hash in `update-manifest.json`)
   - [ ] Admin must authenticate via GitHub OAuth before pushing
   - [ ] Push targets only repos the admin has write access to
   - [ ] GitHub token in Tauri `safeStorage` only
   - [ ] Bundle hash verified on receipt
   - [ ] Rollback tag pushed before each update
   - [ ] GitHub API calls rate-limited with exponential backoff
2. Write `SECURITY.md` documenting the model.
3. Final release: tag `v1.0.0`, create GitHub Release with the update bundle attached.

### Test Gate
```bash
test -f SECURITY.md
npm run check
npm run test:e2e
cd tauri-admin && cargo build && cargo test
git tag v1.0.0
# All green
```

### Commit Message
```
release(phase-8): v1.0.0 — update system shipped

Security checklist complete (signing, auth, token storage, hash
verify, rollback tags, rate limiting). SECURITY.md documents model.
All 62 sessions complete. Tagged v1.0.0.
```

### Rollback
```bash
git tag -d v1.0.0
git push --delete origin v1.0.0
```

### Hand-off
🎉 Osler V1 shipped.

---

# APPENDIX — PROMPT TEMPLATES

These are copy-paste-ready prompts for invoking a fresh LLM session. Each template expects the executing model to have repo access (file read/write tools).

## A.1 — T1 session starter (for cheap models)

```
You are executing Session P{X.Y} of the Osler V1 plan.

Read /home/z/my-project/download/v1-osler-plan-enhanced.md for the validated plan.
Read /home/z/my-project/download/llm-execution-guide.md and find the section titled "Session P{X.Y}".
Execute ONLY that session. Do not look at other sessions.

Rules:
1. Verify Inputs first — if any file is missing, stop and report.
2. Touch ONLY files listed in "Files Touched".
3. Run the Test Gate exactly as written. All commands must exit 0.
4. If the gate fails 3 times on the same step, stop and report the blocker.
5. Use the exact Commit Message from the session.
6. After commit, write a 3-line summary of what you did.

Begin.
```

## A.2 — T2 session starter (for mid-tier models)

```
You are executing Session P{X.Y} of the Osler V1 plan.

Companion files:
- /home/z/my-project/download/v1-osler-plan-enhanced.md (validated plan, 539 lines)
- /home/z/my-project/download/llm-execution-guide.md (this file — find "Session P{X.Y}")

Context from prior sessions:
- Read /home/z/my-project/worklog.md to see what previous sessions did and decided.
- Append your own session record to worklog.md when done.

Execute ONLY Session P{X.Y}. Steps:
1. Verify Inputs — read every listed file path. If any missing, stop and report.
2. Read the entire session block including Goal, Steps, Test Gate, Commit Message.
3. Plan your approach in 5 bullets before writing any code.
4. Touch ONLY files in "Files Touched". If you need to touch another file, stop and ask.
5. After each step, verify the file you wrote is valid (parses, compiles, etc.).
6. Run the Test Gate. Every command must exit 0. If a command fails, fix and retry (max 3 attempts per command).
7. Commit with the exact message from the session.
8. Append to worklog.md:
   ---
   Task ID: P{X.Y}
   Agent: <your model name>
   Task: <one-line summary>
   Work Log:
   - <step 1>
   - <step 2>
   Stage Summary:
   - <key results>

Begin.
```

## A.3 — T3 session starter (for Opus-class models)

```
You are executing Session P{X.Y} of the Osler V1 plan. This is an architectural session requiring judgment.

Read:
- /home/z/my-project/download/v1-osler-plan-enhanced.md (full plan)
- /home/z/my-project/download/llm-execution-guide.md (your session block)
- /home/z/my-project/worklog.md (prior session history)
- All files listed in "Verify Inputs"

This session has `[T3]` tag, meaning architectural decisions are expected. Document every non-obvious decision in your worklog entry with rationale.

Constraints:
1. Anti-Goals from the enhanced plan (Appendix F) are hard — do not violate them.
2. Key Decisions (Appendix E) are hard — do not introduce dependencies on React/TS/Dexie/etc.
3. If the session's goal conflicts with another phase, surface the conflict in your worklog and pick the option that minimizes rework.
4. The Test Gate is the contract. If you can't meet it, stop and explain why.

Begin.
```

## A.4 — Recovery prompt (when a session went wrong)

```
Session P{X.Y} was executed but left the repo in a broken state.

Read /home/z/my-project/worklog.md to see what happened.
Read the "Rollback" section of Session P{X.Y} in /home/z/my-project/download/llm-execution-guide.md.

Steps:
1. Run `git log --oneline -5` to see recent commits.
2. Identify the broken commit (likely HEAD).
3. Run the rollback command from the session.
4. Verify the Test Gate from the PRIOR session now passes (to confirm rollback worked).
5. If rollback doesn't fix it: `git reset --hard HEAD~1` and report.
6. Append to worklog.md what happened and what you did.

Do NOT re-attempt the broken session. Report back and wait for guidance.
```

---

# APPENDIX — WORKLOG PROTOCOL

All agents append to `/home/z/my-project/worklog.md` after every session. Format:

```markdown
---
Task ID: P{X.Y}
Agent: <model name and version>
Task: <one-line summary from the session header>

Work Log:
- <step 1 — what you did, files touched>
- <step 2 — what you did, files touched>
- ...

Decisions Made:
- <if you made any non-obvious decision, document here with rationale>

Blockers Encountered:
- <if any, what they were and how you resolved>

Stage Summary:
- <key outputs in 2-3 bullets>
- <hand-off note for next session>
```

Read worklog.md before starting any session. It contains decisions and context that the session block doesn't.

---

# APPENDIX — SESSION INDEX (QUICK NAV)

| Session | Phase | Tier | Est. | Title |
|---------|-------|------|------|-------|
| P0.1 | 0 | T2 | 1h | Rewrite build.js to use esbuild |
| P0.2 | 0 | T1 | 0.5h | Create test infrastructure |
| P0.3 | 0 | T1 | 0.5h | Create missing npm scripts |
| P0.4 | 0 | T1 | 0.5h | Extract theme/toast/dom lib |
| P0.5 | 0 | T2 | 1h | Create keyboard/ui/icons lib |
| P0.6 | 0 | T2 | 0.5h | Extract gemini.js |
| P0.7 | 0 | T1 | 1h | Re-extract CSS + fix bank-engine bug |
| P0.8 | 0 | T2 | 1h | Wire libs + sample test + doc sync |
| P0.5.1 | 0.5 | T2 | 0.5h | Create sw.js |
| P0.5.2 | 0.5 | T1 | 0.5h | Manifest audit + install prompt |
| P1.1 | 1 | T2 | 1h | Schema registry + 6 type schemas |
| P1.2 | 1 | T1 | 0.5h | Create validate.js |
| P1.3 | 1 | T1 | 0.5h | Real validate-content + export-schemas |
| P1.4 | 1 | T1 | 0.5h | Create content-loader.js |
| P1.5 | 1 | T2 | 1.5h | Create player.html |
| P2.1 | 2 | T1 | 1h | Create storage.js (9 stores) |
| P2.2 | 2 | T2 | 1.5h | Create sm2.js |
| P2.3 | 2 | T2 | 1h | Update tracker.js |
| P2.4 | 2 | T1 | 0.5h | Create quota.js |
| P2.5 | 2 | T1 | 0.5h | Create migration.js |
| P2.6 | 2 | T2 | 1.5h | Wire quiz-engine |
| P2.7 | 2 | T2 | 2h | Wire 4 more engines + SM-2 to UI |
| P3.1 | 3 | T1 | 0.5h | Create firebase.js |
| P3.2 | 3 | T2 | 1h | Create auth.js |
| P3.3 | 3 | T1 | 1h | Hub auth UI |
| P3.4 | 3 | T2 | 1.5h | Create sync.js |
| P3.5 | 3 | T1 | 0.5h | Create analytics.js |
| P3.6 | 3 | T1 | 1.5h | My Content + auto-sync |
| P4.1 | 4 | T1 | 0.5h | Create anki.js |
| P4.2 | 4 | T1 | 1.5h | Replace emoji with SVGs |
| P4.3 | 4 | T1 | 0.5h | Apply CSS tokens |
| P4.4 | 4 | T2 | 2h | Refactor engines to ui.js |
| P4.5 | 4 | T2 | 1h | Anki export + a11y pass |
| P5.0.1 | 5.0 | T2 | 1h | Scaffold Tauri app |
| P5.0.2 | 5.0 | T1 | 0.5h | Frontend shell |
| P5.0.3 | 5.0 | T1 | 0.5h | Command registry |
| P5.1 | 5 | T2 | 1.5h | GitHub OAuth + safe-storage |
| P5.2 | 5 | T2 | 1.5h | git.rs |
| P5.3 | 5 | T3 | 3h | ContentEditor |
| P5.4 | 5 | T1 | 1h | Dashboard + RepoBrowser |
| P5.5 | 5 | T1 | 1.5h | PullRequests + Deploy |
| P5.6 | 5 | T1 | 1h | Analytics + Settings |
| P5.7 | 5 | T2 | 1.5h | MCP server |
| P5.8 | 5 | T1 | 1h | Config + engines.rs |
| P5.9 | 5 | T1 | 1h | Integration test |
| P6.1 | 6 | T2 | 1.5h | content-gen.js (3-stage) |
| P6.2 | 6 | T1 | 1h | 5 skill files |
| P6.3 | 6 | T1 | 1h | Wire to ContentEditor |
| P6.4 | 6 | T1 | 0.5h | Cost tracking + review queue |
| P7.1 | 7 | T2 | 2h | 10 e2e specs |
| P7.2 | 7 | T1 | 1h | Integration tests |
| P7.3 | 7 | T1 | 0.5h | sw.js Phase 8 prep |
| P7.4 | 7 | T1 | 1h | CI + AGENTS.md |
| P7.5 | 7 | T2 | 1h | Lighthouse fixes |
| P7.6 | 7 | T1 | 0.5h | Final ship |
| P8.1 | 8 | T1 | 0.5h | update-manifest generator |
| P8.2 | 8 | T2 | 1h | bundle_engines.rs |
| P8.3 | 8 | T2 | 1.5h | updater.rs (Tier 1) |
| P8.4 | 8 | T2 | 1.5h | push_update.rs (Tier 2) |
| P8.5 | 8 | T1 | 0.5h | sw.js instance detection |
| P8.6 | 8 | T1 | 1h | E2E for updates |
| P8.7 | 8 | T2 | 1h | Security review + ship |

**Total:** 62 sessions · ~64 hours · ~830K tokens · 9 phases
