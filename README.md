# Osler V1

Medical study platform — offline-first PWAs, Firebase sync, GitHub CMS, and AI content generation.

> Named after Sir William Osler, the father of modern medical education.

## Architecture

- **Vanilla JS** — no frameworks, esbuild for bundling
- **IndexedDB** — per-type tracker stores with quota management
- **Firebase** — auth (guest → Google → GitHub), Firestore sync, Analytics
- **PWA** — offline-first with service worker
- **Admin Dashboard** — Tauri desktop app for GitHub CMS content management
- **AI Pipeline** — 3-stage Gemini for content generation (Flash-Lite outline → Flash-Lite extract → Pro convert)

## Project Structure

```
src/
├── lib/        — Shared modules (theme, toast, keyboard, dom, ui, icons, storage, auth, sync, validate, gemini, anki)
├── css/        — Extracted engine stylesheets
└── schemas/    — JSON Schema for all 6 content types
engines/        — 9 quiz engines (quiz, bank, index, flashcard, written, uworld, search, ai-assistant, osce)
scripts/        — Build tools and utilities
tests/          — Unit, integration, and E2E tests
```

## Development

```bash
npm install
npm run build     # esbuild all engines, copy CSS
npm test          # Vitest unit + integration tests
npm run test:e2e  # Playwright E2E tests
npm run check     # build + test + validate
```

## Content Types

quiz · bank · flashcard · written · osce · hub

All content is JSON, validated against schemas in `src/schemas/`. Created exclusively through the admin dashboard's GitHub CMS.
