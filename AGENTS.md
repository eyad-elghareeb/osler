# AGENTS.md — Osler V1

> Complete reference for AI agents working on this repository. Read this before touching any file.

## Project Identity

| Key | Value |
|-----|-------|
| Name | Osler V1 |
| Type | Medical study platform — offline-first PWA + Tauri admin dashboard |
| Deployment | GitHub Pages (site) + Tauri (admin desktop app) |
| Status | Phase 0 — Foundation |

## Rules

1. **Think Before Coding** — State assumptions. If uncertain, ask.
2. **Simplicity First** — Minimum code that solves the problem.
3. **Surgical Changes** — Touch only what you must. Match existing style.
4. **Read the plan first** — `v1-osler-plan-enhanced.md` has the full implementation plan with validation findings. `llm-execution-guide.md` has per-session execution steps.

## Dependency Map

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 7 ──▶ Phase 8
                │                                          ▲
                └──▶ Phase 5 ──▶ Phase 6 ──────────────────┘
```

## Critical Rules

- **No standalone HTML tools** — Content creation is admin-dashboard-only (Phase 5).
- **JSON content only** — All quiz/bank/flashcard/written/osce content is JSON, not HTML.
- **Schema-first** — Every content type has a JSON Schema in `src/schemas/`. Validate before commit. `meta.schemaVersion` must be a known version in `_meta.json` (V19 policy enforced by `src/lib/validate.js`).
- **Never hardcode engine paths** — Use `__{NAME}_ENGINE_BASE` for dynamic path resolution. Every engine must use its OWN constant (e.g. `__UWORLD_ENGINE_BASE`, not `__QUIZ_ENGINE_BASE`).
- **CSS in src/css/** — Extracted from engine inline strings, built via esbuild.
- **IndexedDB over localStorage** — Per-type tracker tables, quota management. The only localStorage exceptions are: theme (UI state), `osler_device_id` (anonymous device metadata, not user data), and `osler_migrated_v1` / `osler_migration_errors_v1` (migration flags).
- **Shared device ID** — `src/lib/sync-utils.js` is the single source of truth for `getDeviceId()`. Both `sync.js` and `analytics.js` import from it. Do NOT duplicate.
- **Lib-bridge** — `engines/engine-shared.js` dynamically imports `src/lib/*.js` and exposes them on `window.OslerTracker`, `window.OslerAnalytics`, `window.OslerAnki`, `window.OslerUI`, `window.OslerGemini`, `window.OslerSync`, `window.OslerAuth`. Engines should use these bridges, not duplicate the lib code.
- **No silent catches** — `.catch(function(){})` is forbidden. Use `.catch(e => console.warn('[module] ...', e))` at minimum so bugs are visible.
- **V20 analytics taxonomy** — `contentType` must be `quiz|bank|flashcard|written|osce`. `outcome` must be `correct|wrong|skipped|rating_1|rating_2|rating_3|rating_4|null`. `analytics.track()` validates and warns on unknown values.
