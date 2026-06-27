# Osler V2 — Developer & Site Admin Docs

Welcome to the technical documentation for **Osler V2**, a modular quiz-site
platform for medical education (and beyond). Osler V2 is the successor to
Osler V1 — an offline-first PWA + Tauri admin CMS shipped in Phase 8.

## What is Osler V2?

Osler V2 turns the V1 single-tenant app into a **generator platform**. A Tauri
desktop app (the *generator*) lets an educator or self-hoster pick engines,
content, theme, auth mode, and deploy target — and produces a self-contained
PWA bundle that runs on GitHub Pages, Netlify, Vercel, or Cloudflare Pages.

Each generated site is a standalone PWA with the chosen engines and
admin-managed content. Users of a generated site can also author their own
custom content (stored in IndexedDB, optionally synced to Firebase), and export
or import it as JSON files for offline sharing.

An optional Firebase backend enables multi-user sync of user custom content,
cross-device study progress, and a lightweight AI tutor. Self-hosters bring
their own Firebase project (free tier covers ~10K users).

## Three user-facing surfaces

1. **Generator (Tauri desktop app)** — Pick engines, content, theme, auth mode,
   deploy target → get a deployable site bundle. Already partially built in V1
   as the admin dashboard.
2. **Generated sites (PWA)** — Each generated site is a standalone PWA with the
   chosen engines and admin-managed content. Self-hostable on GitHub Pages /
   Netlify / Vercel / Cloudflare Pages. Users can also author their own custom
   content alongside the admin content.
3. **Firebase backend (optional)** — When configured, enables multi-user sync
   of user custom content, cross-device study progress, and the lightweight AI
   tutor. Auth is Firebase (V1 wiring preserved and extended).

## Three personas

- **Solo learner** — Generates a site for personal study. Uses Firebase auth
  (guest → Google → GitHub). User custom content syncs via Firestore.
- **Educator** — Authors admin-managed content via the Tauri admin CMS,
  generates sites for students, exports content packs as files for offline
  distribution.
- **Self-hoster** — Deploys a generated site + their own Firebase project.
  Controls their data while leveraging Google's managed infra.

## Documentation map

| If you are... | Start here |
|----------------|-----------|
| A new developer joining the project | [Development → Getting Started](development/getting-started.md) |
| A site admin operating the Tauri app | [Admin Dashboard → Overview](admin-dashboard/overview.md) |
| Deploying a site to a hosting provider | [Deployment → GitHub Pages](deployment/github-pages.md) |
| Self-hosting with your own Firebase | [Firebase → Bring Your Own](firebase/bring-your-own.md) |
| Authoring quiz/bank/flashcard content | [Content Authoring → Schemas](content-authoring/schemas.md) |
| Migrating an existing V1 instance to V2 | [Migration → V1 to V2](migration/v1-to-v2.md) |
| Debugging a broken build or sync conflict | [Troubleshooting → Common Issues](troubleshooting/common-issues.md) |

## Status

| Phase | Title | Status |
|-------|-------|--------|
| 0-8 | V1 (PWA + admin CMS + Firebase sync) | Shipped — v1.0.0 |
| 9 | Firebase backend consolidation + multi-user sync | In progress |
| 10 | User custom content + file-based export/import | Pending |
| 11 | i18n (EN/AR UI + RTL) | Pending |
| 12 | Lightweight AI tutor (chat modal) | Pending |
| 13 | Modular site generator wizard | Pending |
| 14 | New user guides (this docs site) | In progress |
| 15 | Provider integrations (GH Pages, Netlify, Vercel, CF) | Pending |
| 16 | v2.0 ship (E2E, Lighthouse, security, release) | Pending |

V2 ships when the success metrics in
[the v2 plan §9](https://github.com/osler-app/osler/blob/main/v2-osler-plan-enhanced.md#9-success-metrics)
are met.

## Where to go next

- Read the [Architecture Overview](architecture/overview.md) for the big picture.
- Skim the [Glossary](glossary.md) if a term is unfamiliar.
- Clone the repo and run through [Getting Started](development/getting-started.md).
