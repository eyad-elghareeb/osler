# Osler V2 — Implementation

This directory contains the V2 implementation for Osler, based on
`v2-osler-plan-enhanced.md`. V2 is **additive** — V1 features continue to
work; V2 features unlock when configured.

## What's here

```
osler-v2-impl/
├── README.md                              ← this file
├── RELEASE_NOTES.md                       ← v2.0.0 release notes
├── SECURITY.md                            ← V2 security model (extends V1)
├── package.json                           ← V2 dependencies (shepherd.js, i18next)
├── firestore.rules                        ← Phase 9: extended Firestore rules
├── storage.rules                          ← Phase 9: Cloud Storage rules
│
├── src/
│   ├── lib/
│   │   ├── firebase.js                    ← Phase 9: extended (Storage + config.json loader)
│   │   ├── sync-user-content.js           ← Phase 9: sync userContent to Firestore
│   │   ├── user-content.js                ← Phase 10: CRUD for user custom content
│   │   ├── user-content-ui.js             ← Phase 10: PWA authoring UI (modal + hub toolbar)
│   │   ├── content-pack.js                ← Phase 10: file-based export/import
│   │   ├── i18n.js                        ← Phase 11: i18next wrapper (EN + AR + RTL)
│   │   ├── language-switcher.js           ← Phase 11: globe icon + dropdown
│   │   ├── tutor.js                       ← Phase 12: Gemini-backed AI tutor API
│   │   ├── tutor-ui.js                    ← Phase 12: chat modal + "Ask AI" button
│   │   ├── generator.js                   ← Phase 13: 5-step site generator wizard
│   │   ├── tour.js                        ← Phase 14: shepherd.js tour + first-run wizard
│   │   └── hub-v2-patch.js                ← V2 hub/engine integration (Phase 10/11/12/14)
│   ├── i18n/
│   │   ├── en.json                        ← Phase 11: English UI strings
│   │   └── ar.json                        ← Phase 11: Arabic UI strings
│   └── css/
│       ├── i18n.css                       ← Phase 11: RTL + language switcher styles
│       └── tutor.css                      ← Phase 12: AI tutor modal styles
│
├── tauri-admin/
│   └── src/
│       └── providers/                     ← Phase 15: deploy provider integrations (Rust)
│           ├── mod.rs                     ← shared trait + types + retry helper
│           ├── github_pages.rs            ← GitHub Pages deploy
│           ├── netlify.rs                 ← Netlify deploy
│           ├── vercel.rs                  ← Vercel deploy
│           └── cloudflare.rs              ← Cloudflare Pages deploy
│
└── tests/
    ├── e2e/
    │   └── v2-flows.spec.js               ← Phase 16: E2E specs for every V2 flow
    └── unit/
        └── lib/
            ├── v2-sync-user-content.test.js   ← Phase 9 unit tests
            ├── v2-content-pack.test.js        ← Phase 10 unit tests
            ├── v2-i18n.test.js                ← Phase 11 unit tests
            └── v2-generator.test.js           ← Phase 13 unit tests
```

## Phase mapping

| Phase | Title | Status | Files |
|-------|-------|--------|-------|
| 9 | Firebase backend consolidation + multi-user sync | ✅ Done | `src/lib/firebase.js`, `src/lib/sync-user-content.js`, `firestore.rules`, `storage.rules` |
| 10 | User custom content + file-based export/import | ✅ Done | `src/lib/user-content.js`, `src/lib/user-content-ui.js`, `src/lib/content-pack.js` |
| 11 | i18n (EN/AR UI + RTL, no AI translation, no TTS) | ✅ Done | `src/lib/i18n.js`, `src/lib/language-switcher.js`, `src/i18n/{en,ar}.json`, `src/css/i18n.css` |
| 12 | Lightweight AI tutor (chat modal, no RAG) | ✅ Done | `src/lib/tutor.js`, `src/lib/tutor-ui.js`, `src/css/tutor.css` |
| 13 | Modular site generator wizard | ✅ Done | `src/lib/generator.js` |
| 14 | New user guides (in-app tour + first-run wizard) | ✅ Done | `src/lib/tour.js` |
| 15 | Provider integrations (GH Pages, Netlify, Vercel, CF Pages) | ✅ Done | `tauri-admin/src/providers/*.rs` |
| 16 | v2.0 ship (E2E, security, release) | ✅ Done | `tests/e2e/v2-flows.spec.js`, `tests/unit/lib/v2-*.test.js`, `SECURITY.md`, `RELEASE_NOTES.md` |

## How to integrate with the V1 codebase

These files are designed to be **dropped into** the existing V1 repository.
The integration points:

1. **Copy the `src/lib/*.js` files** into the V1 `src/lib/` directory.
   They coexist with V1 modules — no V1 file is replaced.
2. **Copy `src/i18n/` and `src/css/`** into the V1 `src/` directory.
3. **Copy `firestore.rules` and `storage.rules`** to the V1 project root.
4. **Copy `tauri-admin/src/providers/`** into the V1 `tauri-admin/src/`
   directory. Add `pub mod providers;` to `tauri-admin/src/lib.rs`.
5. **Copy `tests/`** into the V1 `tests/` directory.
6. **Update `package.json`** to add `shepherd.js` and `i18next` dependencies.
7. **Patch `engines/index-engine.js`** to call `initV2Hub()` from
   `src/lib/hub-v2-patch.js` on hub load.
8. **Patch each engine file** (`engines/{engine}-engine.js`) to call
   `initV2Engine(itemContext, itemUid)` on engine init and
   `cleanupV2Engine()` on engine unload.

The V2 modules are designed to gracefully degrade when V1 dependencies are
missing — for example, `tutor.js` checks `isFirebaseEnabled()` before
attempting to call Gemini, and the hub toolbar shows even when Firebase
is not configured (user content works in local-only mode).

## Conventions followed

All V2 code follows the V1 conventions documented in `AGENTS.md`:

- Vanilla JS + esbuild (no React/Vue/Svelte — V2 anti-goal §5.1)
- IndexedDB over localStorage (the only new localStorage keys added:
  `osler_lang`, `osler_tour_seen`, `osler_first_run_done`, `osler-wizard-state`
  — all in the allow-list with justification)
- `STORE_NAMES` constants (no string literals for store names)
- Shared `getDeviceId()` from `sync-utils.js`
- Cost caps as constants imported from `content-gen.js` / `gemini.js`
- OS keychain for secrets (via Rust `keyring` crate in Tauri admin)
- Lib-bridge (`engines/engine-shared.js` exposes modules on `window.Osler*`)
- No silent catches (`.catch(function(){})` is forbidden)
- V20 analytics taxonomy
- JSON content only, schema-first
- Logical CSS properties for RTL (`margin-inline-start`, not `margin-left`)
- Surgical changes (touch only what's needed)

## Anti-goals reaffirmed

V2 explicitly does NOT add (see `v2-osler-plan-enhanced.md` §5):

- React/Vue/Svelte
- Supabase or second backend
- Orgs/teams
- Public content registry
- Paid marketplace (Stripe)
- Native mobile apps
- Auto-translation
- TTS audio
- RAG / embeddings / vector DB
- SR optimizer / ML model
- Custom domain management in the generator
- AWS/GCP/Azure deploy
- General-purpose chatbot (tutor is item-scoped)
- DRM on content packs
- Drag-and-drop site builder
- Real-time collaboration
- Air-gapped self-hosting

If a session tries to add any of these, stop and ask.

## Testing

```bash
npm test                    # unit + integration tests (Vitest)
npm run test:e2e            # E2E tests (Playwright, Chromium only)
npm run validate            # validate content files against schemas
npm run validate-schemas    # validate schemas themselves
npm run check               # all of the above combined
```

V2 unit tests live in `tests/unit/lib/v2-*.test.js`. They use
`fake-indexeddb` and mocked Firebase modules. E2E specs live in
`tests/e2e/v2-flows.spec.js` and cover user content, i18n, AI tutor,
and the generator wizard.

## Migration from V1

V2 is additive — no V1 features break. The migration path:

1. Update the admin dashboard (Settings → Updates → Check now).
2. For each deployed V1 instance, push the V2 update via the Updates tab.
3. (Optional) Enable Firebase Storage for cloud-based content pack sharing.
4. (Optional) Configure the Gemini API key in Settings → AI Generation.
5. (Optional) Regenerate sites with the V2 wizard.

See `docs/migration/v1-to-v2.md` (in the docs package) for the full
walkthrough.

## License

See the repository LICENSE file.
