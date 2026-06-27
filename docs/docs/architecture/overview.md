# Architecture Overview

This page describes the V2 architecture at a high level. For deeper details,
read the [V2 plan](https://github.com/osler-app/osler/blob/main/v2-osler-plan-enhanced.md)
— this page summarizes it for daily reference.

## Vision

Osler V1 is a single-tenant offline-first PWA + Tauri admin CMS. Osler V2 is a
**modular quiz-site platform**: a generator app (Tauri) that produces
self-hostable quiz sites, optional user-authored custom content with file-based
sharing, and a Firebase-backed multi-user mode.

The platform has three user-facing surfaces:

1. **Generator (Tauri desktop app)** — Pick engines, content, theme, auth mode,
   deploy target → get a deployable site bundle. Already partially built (V1
   admin dashboard).
2. **Generated sites (PWA)** — Each generated site is a standalone PWA with the
   chosen engines + admin-managed content. Self-hostable on GitHub Pages,
   Netlify, Vercel, or Cloudflare Pages. Users can also author their own custom
   content (in IndexedDB) alongside the admin content.
3. **Firebase backend (optional)** — When configured, enables multi-user sync
   of user custom content, cross-device study progress, and the lightweight AI
   tutor. Auth is Firebase (V1 wiring preserved and extended). Self-hosters
   bring their own Firebase project (free tier).

## Topology diagram

```mermaid
┌─────────────────────────────────────────────────────────────────┐
│                    Generator (Tauri desktop)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ Site wizard │  │ Content     │  │ Deploy      │  │ AI      │ │
│  │ (engines,   │  │ editor      │  │ (GH Pages,  │  │ assist- │ │
│  │  content,   │  │ (admin      │  │ Netlify,    │  │ ant     │ │
│  │  theme)     │  │  content)   │  │ Vercel, CF) │  │ (V1)    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │ generates
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Generated site (PWA)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│
│  │ Quiz     │ │ Bank     │ │ Flashcard│ │ Written  │ │ OSCE   ││
│  │ engine   │ │ engine   │ │ engine   │ │ engine   │ │ engine ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘│
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Shared: i18n (EN/AR + RTL), auth (Firebase), sync,         │ │
│  │ analytics, lightweight AI tutor (chat modal)               │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Content: admin-managed (JSON in /content/) + user custom   │ │
│  │ (IndexedDB, optional Firebase sync) + export/import files  │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │ syncs via
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│        Firebase (V1 preserved + V2 extended, optional)           │
│  Auth: Google, GitHub, anonymous guest (V1 wiring preserved)     │
│  Firestore: study progress + user custom content sync            │
│  Storage: exported content pack files (for download/share)       │
│  Cloud Functions: rate limiting, pack validation (if needed)     │
│  Analytics: study events (V1; stays)                             │
│                                                                   │
│  Self-hosting = "bring your own Firebase project". Free tier     │
│  covers ~10K users. No Supabase, no Postgres, no JWT exchange.   │
└─────────────────────────────────────────────────────────────────┘
```

## Key architectural decisions

The V2 plan locks in 15 key decisions (K1-K15). The most consequential:

1. **Firebase stays as the single backend.** V1 wiring (Phase 3) is preserved
   and extended. No Supabase, no Postgres, no JWT exchange, no second SDK.
   One provider, one bill, one auth system. (K1)
2. **V1 sync stays as the sync mechanism.** `src/lib/sync.js` (Firestore) is
   extended to cover user custom content, not just tracker data. The five
   merge strategies (appendOnly, fieldMergeByUpdatedAt, sm2Merge,
   lwwBodyKeepTitles, maxStreak) are reused. (K13)
3. **Firebase is opt-in.** Generated sites work without Firebase (static
   deploy, no sync, no AI tutor). Users who want sync + AI configure a
   Firebase project in the generator wizard. (K4)
4. **Self-hosting = "bring your own Firebase project".** The user creates a
   Firebase project (free tier, one Google account), pastes the config into
   the generator wizard. They control their data; Google runs the infra. True
   air-gapped self-hosting is NOT supported in V2 — V1 static mode covers
   that use case. (K2)
5. **Content has two tiers:**
   - **Admin-managed content** — JSON files in `/content/`, bundled into the
     generated site. All users see it. Authored via the Tauri admin CMS.
   - **User custom content** — Authored by users in the PWA, stored in
     IndexedDB (always) + Firestore (when backend configured). Private to
     each user. Exportable as JSON files for offline sharing.
6. **Sharing is file-based.** Users export their custom content as a `.json`
     file, share it however they want (email, USB, chat), and recipients
     import it. Like Anki decks today. No public registry, no curation, no
     rate limiting. (K7)
7. **i18n is UI-only + content metadata.** UI strings ship in EN + AR.
     Content declares `meta.lang`. No auto-translation, no TTS. The author
     is responsible for content in whatever language they write. (K5)
8. **AI tutor is lightweight.** A chat modal (like V1 `ai-assistant-engine.js`)
     that pre-fills the current question context and calls Gemini. No RAG, no
     embeddings, no vector DB. Conversation history is ephemeral (IndexedDB,
     not synced). (K8)
9. **The Tauri generator is the single entry point.** Users don't write JSON
     by hand. They pick engines, content, theme, auth, deploy target → get a
     deployable bundle. The V1 admin CMS is subsumed into the V2 generator
     wizard.

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| PWA UI | Vanilla JS + esbuild | V1 stack; no framework migration cost |
| Storage (client) | IndexedDB | Per-type tracker stores, quota-managed |
| Backend (optional) | Firebase Auth + Firestore + Storage + Analytics | V1 already uses it; one provider, one bill |
| Auth | Firebase (guest → Google → GitHub) | V1 wiring preserved |
| Admin desktop | Tauri v2 (Rust) | Native, small binary, OS keychain |
| Docs site | mkdocs-material | V2 plan K11 — mature, search built-in |
| In-app tour | shepherd.js | V2 plan K12 — accessible, no React |
| AI tutor | Gemini via `src/lib/gemini.js` | V1 already wired; cost caps reused |
| Spaced repetition | SM-2 (V1 `src/lib/sm2.js`) | Works; no ML optimizer in V2 (K9) |
| i18n | i18next + EN/AR bundles | Standard, lightweight |
| CI | GitHub Actions | V1 pipeline extended |
| Deploy targets | GitHub Pages / Netlify / Vercel / Cloudflare Pages | Covers 95% of deploy targets (K10) |

## Anti-goals (hard constraints)

If a session tries to add any of the following, stop and ask. The full list is
in [the v2 plan §5](https://github.com/osler-app/osler/blob/main/v2-osler-plan-enhanced.md#5-anti-goals-cross-cutting).

- No React/Vue/Svelte. Vanilla JS + esbuild (V1 stack).
- No Supabase or second backend. Firebase is the single backend provider.
- No orgs / teams. Personal-only tenancy.
- No public content registry. File-based export/import instead.
- No paid content marketplace. No Stripe.
- No native mobile apps. PWA only.
- No auto-translation. Authors write content in whatever language they want.
- No TTS audio. No audio generation, no audio player.
- No RAG / embeddings / vector DB. The AI tutor is a lightweight chat modal.
- No SR optimizer / ML model. SM-2 (V1) stays as the spaced-repetition
  algorithm.
- No custom domain management in the generator. Use provider dashboards.
- No AWS/GCP/Azure deploy. GitHub Pages + Netlify + Vercel + Cloudflare only.
- No DRM on content packs. Packs are JSON; freely copyable.
- No air-gapped self-hosting. Self-hosting = "bring your own Firebase project".

## What's next

- [Data Flow](data-flow.md) — how content moves from authoring to a studying user.
- [Security Model](security-model.md) — token storage, CSP, threat model.
- [Development → Getting Started](../development/getting-started.md) — run the project locally.
