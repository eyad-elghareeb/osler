# Coding Conventions

Osler V2 enforces a strict set of conventions inherited from V1. Every PR must
follow them — CI catches some, code review catches the rest. The authoritative
list is in `AGENTS.md`; this page reformats it for daily reference.

## 1. Vanilla JS — no frameworks

Osler V2 uses vanilla JS bundled with esbuild. No React, Vue, Svelte, or any
other framework. This is a hard anti-goal (v2 plan §5.1). The V1 stack stays.

Implications:

- DOM manipulation uses `src/lib/dom.js` helpers (`$`, `$$`, `create`).
- State management is hand-rolled (one module per concern).
- No JSX, no template literals-as-render-functions beyond simple cases.
- esbuild handles bundling, tree-shaking, and minification.

## 2. IndexedDB over localStorage

All user data lives in IndexedDB via `src/lib/storage.js`. `localStorage` is
banned except for the allow-list in [Security Model](../architecture/security-model.md#localstorage-allow-list):

- `osler_device_id` (anonymous device metadata)
- `osler_migrated_v1` / `osler_migration_errors_v1` (migration flags)
- `osler_auto_update_check` (admin Settings toggle)
- Theme, sidebar state, editor prefs (ephemeral UI state)

Any new `localStorage` usage must be added to that table and justified in code
review.

## 3. Store name constants

`src/lib/storage.js` exports `STORES` (config array) and `STORE_NAMES` (frozen
map). Import `STORE_NAMES` and use `STORE_NAMES.quizTracker` etc. instead of
hardcoding string literals like `'quizTracker'`.

```javascript
// CORRECT
import { STORE_NAMES } from '../lib/storage.js';
const result = await db.getAll(STORE_NAMES.quizTracker);

// FORBIDDEN
const result = await db.getAll('quizTracker');
```

## 4. Shared device ID

`src/lib/sync-utils.js` is the single source of truth for `getDeviceId()`.
Both `sync.js` and `analytics.js` import from it. Do NOT duplicate the device
ID logic anywhere else.

## 5. Cost caps as constants

`src/lib/content-gen.js` exports `DAILY_CAP` and `MONTHLY_CAP` (currently
`$20` and `$200` respectively). The admin dashboard imports these constants
instead of duplicating magic numbers. If you need to reference the cost caps,
import them — don't hardcode.

## 6. OS keychain for secrets

The Tauri admin uses the `keyring` crate (macOS Keychain / Windows Credential
Manager / Linux Secret Service) for GitHub tokens and deploy provider
credentials. Do NOT store secrets in `tauri-plugin-store` (which writes plain
JSON to the app data dir) or in `localStorage`.

## 7. Lib-bridge

`engines/engine-shared.js` dynamically imports `src/lib/*.js` and exposes them
on `window.OslerTracker`, `window.OslerAnalytics`, `window.OslerAnki`,
`window.OslerUI`, `window.OslerGemini`, `window.OslerSync`, `window.OslerAuth`.
Engines should use these bridges, not duplicate the lib code.

```javascript
// Inside an engine
const { OslerTracker, OslerUI } = window;
await OslerTracker.record('quiz', itemId, outcome);
OslerUI.toast('Saved', { type: 'success' });
```

## 8. No silent catches

`.catch(function(){})` is forbidden. Use
`.catch(e => console.warn('[module] ...', e))` at minimum so bugs are visible.
For user-facing flows, also surface a toast.

```javascript
// FORBIDDEN
fetch(url).then(r => r.json()).catch(() => {});

// CORRECT
fetch(url)
  .then(r => r.json())
  .catch(e => console.warn('[content-loader] failed to load', url, e));
```

## 9. V20 analytics taxonomy

`contentType` must be `quiz|bank|flashcard|written|osce`. `outcome` must be
`correct|wrong|skipped|rating_1|rating_2|rating_3|rating_4|null`.
`analytics.track()` validates and warns on unknown values. If you add a new
content type (don't — V2 explicitly limits to 5), update the taxonomy in
`analytics.js` first.

## 10. JSON content only

All quiz/bank/flashcard/written/osce content is JSON, validated against
schemas in `src/schemas/`. No HTML content. No Markdown content. The admin
dashboard's content editor produces JSON; the PWA consumes JSON.

## 11. Schema-first

Every content type has a JSON Schema in `src/schemas/`. Validate before commit
(`npm run validate`). `meta.schemaVersion` must be a known version in
`src/schemas/_meta.json` (V19 policy enforced by `src/lib/validate.js`). If
you bump a schema version, update `_meta.json` and run
`npm run validate-schemas`.

## 12. Never hardcode engine paths

Use `__{NAME}_ENGINE_BASE` for dynamic path resolution. Every engine must use
its OWN constant (e.g. `__UWORLD_ENGINE_BASE`, not `__QUIZ_ENGINE_BASE`).
This allows the generator wizard to swap engine paths per generated site.

## 13. CSS in `src/css/`

CSS is extracted from engine inline strings, built via esbuild. Do not add
`<style>` tags inside engine JS. Put styles in `src/css/{engine-name}.css` and
import them. The build pipeline handles the rest.

## 14. Logical CSS properties for RTL

When writing CSS, use logical properties (`margin-inline-start`,
`padding-inline-end`, `inset-inline-start`) instead of physical properties
(`margin-left`, `padding-right`, `left`). This makes the layout work
automatically in both LTR (English) and RTL (Arabic) modes without per-rule
overrides. See [i18n → RTL Guide](../i18n/rtl-guide.md) for the full guide.

## 15. No standalone HTML tools

Content creation is admin-dashboard-only. Do not create standalone HTML files
for content authoring, import, or export. The PWA's content editor (V2) is a
modal within the hub, not a separate page.

## 16. Surgical changes

Touch only what you must. Match existing style. If you're refactoring, do it
in a separate PR from the feature work. The v2 plan calls this "surgical
changes" and it's rule 3 in `AGENTS.md`.

## 17. Think before coding

State assumptions. If uncertain, ask. This is rule 1 in `AGENTS.md`. The v2
plan's open questions (§7) are the places where assumptions need to be checked
against the plan before implementation.

## Code style

Osler doesn't use a linter (deliberately — keeps the build fast). Code style
is enforced by code review. The conventions:

- 2-space indentation
- Single quotes for strings
- Trailing commas in multi-line arrays/objects
- Semicolons always
- `const` by default, `let` only when reassignment is needed, `var` never
- Arrow functions for short callbacks, named `function` declarations for
  exported module-level functions
- JSDoc comments for exported functions (parameters, return type, description)

## Commit message format

Osler uses conventional commits:

```
type(scope): subject

body

footer
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`,
`build`, `ci`.

Scopes: `pwa`, `admin`, `engine-quiz`, `engine-bank`, `engine-flashcard`,
`engine-written`, `engine-osce`, `sync`, `auth`, `analytics`, `content`,
`docs`, `ci`, etc.

Examples:

```
feat(engine-flashcard): add SM-2 interval preview tooltip

fix(sync): handle Firestore timestamp divergence on cross-device merge

docs(firebase): expand bring-your-own guide with Storage rules

chore(ci): bump Node to 20.x
```

## What's next

- [Testing](testing.md) — the four test layers.
- [Contributing](contributing.md) — branch model and PR checklist.
- [API Reference → Lib Modules](../api-reference/lib-modules.md) — per-module
  APIs.
