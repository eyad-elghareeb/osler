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
4. **Read the plan first** — `v6-plan.md` has the full implementation plan, dependency graph, and per-phase file manifests.

## Dependency Map

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 7
                │                                          ▲
                └──▶ Phase 5 ──▶ Phase 6 ──────────────────┘
```

## Critical Rules

- **No standalone HTML tools** — Content creation is admin-dashboard-only (Phase 5).
- **JSON content only** — All quiz/bank/flashcard/written/osce content is JSON, not HTML.
- **Schema-first** — Every content type has a JSON Schema in `src/schemas/`. Validate before commit.
- **Never hardcode engine paths** — Use `__{NAME}_ENGINE_BASE` for dynamic path resolution.
- **CSS in src/css/** — Extracted from engine inline strings, built via esbuild.
- **IndexedDB over localStorage** — Per-type tracker tables, quota management.
