# Osler — Agent Guidelines

## Critical Rules

1. **All interactive components must be `"use client"`.** Server components are only for static content, layouts, and metadata.

2. **Use named exports only.** Never use `export default`. Import with destructured named imports.

3. **Use `@/` path aliases.** Never use relative imports like `../../components/`. Use `@/components/osler/...`, `@/lib/osler/...`, `@/hooks/...`.

4. **Use `cn()` for className merging.** Import from `@/lib/utils`. Never write raw template literal class strings.

5. **All content schemas live in `@/lib/osler/types.ts`.** Never define content types elsewhere. The 7 engine types are `quiz | bank | flashcard | written | osce | library | video`.

6. **Engine metadata comes from `ENGINE_META` in `@/lib/osler/content.ts`.** Never hardcode engine labels, colors, or icons.

7. **Progress and user data uses `@/lib/osler/storage`.** This is an IndexedDB-backed reactive store with in-memory cache. Import the `storage` singleton — never access `localStorage` or IndexedDB directly.

8. **Use `framer-motion` for animations.** Import `motion` from `framer-motion`. Use `AnimatePresence` for mount/unmount transitions. Keep durations under 0.3s for UI elements.

9. **Use `lucide-react` for all icons.** Import icon components by name. Never use inline SVGs or emoji as icons.

10. **Design tokens use oklch color space in `globals.css`.** The `@theme inline` block maps CSS variables to Tailwind classes. Never hardcode color values in components — use Tailwind semantic classes (e.g., `text-primary`, `bg-muted`).

11. **Support both dark and light themes.** The `.dark` class toggles via `OslerThemeProvider`. All components must look correct in both themes. Use `bg-background text-foreground` for page-level elements.

12. **Do not rewrite.** Patch, harden, and consolidate in place. No restructuring, no new frameworks, no green-field rebuilds. The IIFE engine pattern is kept; add test shims if needed.

13. **Always i18n-nize every new change.** Every user-facing string — labels, tooltips, toasts, aria-labels, placeholders, errors, button text — must go through `t()` from `useI18n()`. Never hardcode English in JSX. Add the key to BOTH `en` and `ar` blocks in `@/lib/osler/i18n.ts` in the same commit. If you add a key, both languages must ship together — a missing AR translation is a blocker, not a "TODO".

14. **Always wire native-feel features into new UI.** New screens, modals, and interactive surfaces must:
    - Fire `haptic()` from `@/lib/osler/native` on the primary action (button press, form submit, tab switch). Pick the right pattern: `selection` for nav, `light` for taps, `success`/`error`/`warning` for outcomes.
    - Wrap view-level navigation in `withViewTransition()` so the slide transition kicks in. The `app-shell.tsx` `handleViewChange` wrapper already does this — extend the pattern, don't bypass it.
    - Honor `prefers-reduced-motion` — the haptics + VT libs already do this; do not add motion that ignores the OS preference.
    - Use safe-area utilities (`.safe-pt`, `.safe-pb`, `.safe-screen`) for any full-screen overlay so content never sits under the notch.

15. **Prefer already-made and tested solutions over handrolling.** Before writing new code, check:
    - **shadcn/ui** (`@/components/ui/*`) — 48 primitives already vendored. Use them for dialogs, dropdowns, popovers, tabs, etc. Never re-implement a shadcn component.
    - **framer-motion** — for any animation. Never raw `requestAnimationFrame` transitions.
    - **lucide-react** — for icons. Never inline SVGs.
    - **`@/lib/osler/native`** — for Vibration, View Transitions, WebAuthn, Network Information, Wake Lock. Never call `navigator.vibrate()` / `navigator.credentials.*` / `navigator.wakeLock.*` directly — go through the wrappers.
    - **`@/lib/osler/storage`** — for any persistent state. Never touch `localStorage` or IndexedDB directly (biometric credential ID is the documented exception, see `biometric.ts`).
    - **`@/lib/osler/sync`** — for cross-device sync. Never open a new PeerJS / MQTT channel outside the existing `NetworkTransport`.
    - **`@tanstack/react-query`** + **`zustand`** are in deps but largely unused. Prefer the existing `storage` singleton + React local state unless a feature genuinely needs query caching or cross-component stores.
    - If a third-party library in `package.json` already solves the problem, use it. Do not add a new dependency when an existing one covers the case.

16. **Plan before executing.** Before writing any code:
    - Read the relevant existing files completely — do not skim. Edge cases live in the details.
    - Decide where each piece lives (lib vs hook vs component vs UI primitive) before touching the keyboard.
    - Identify which existing utilities you'll reuse and which i18n keys you'll need to add.
    - For multi-file changes, sequence the edits so the project stays buildable between each step.
    - If a change touches more than 3 files, write a one-paragraph plan as a comment at the top of the first file you edit, then delete it before committing.

17. **Write the best, straight-forward code. One line that does the job is better than three.**
    - Prefer the language's built-in: `Array.find` over a `for` loop, `Object.fromEntries` over a reduce, optional chaining over `&&` chains.
    - Avoid fragile code that breaks in edge cases: nullish coalesce (`??`) for defaults, optional chaining (`?.`) for nested access, `Array.isArray()` before `.map()` on untrusted input, `try/catch` around any `JSON.parse` / `atob` / network call.
    - Never invent a new pattern when the codebase already has one (e.g. use `cn()` for classes, `motion.div` for animated containers, `haptic()` for vibration).
    - No dead code, no commented-out code, no `// TODO` — if it's not done, it doesn't ship.
    - If a function has more than 3 parameters, accept an options object. If a component has more than 5 props, consider splitting it.
    - Every `useEffect` must have an exhaustive dependency array OR an `eslint-disable-next-line react-hooks/exhaustive-deps` with a comment explaining why.

18. **Stage and commit after each new change.** One logical change = one commit.
    - `git add <specific files>` — never `git add -A` or `git add .`. Be explicit so unrelated files don't sneak in.
    - Commit message format: `<short imperative summary>` on the first line (≤72 chars), blank line, then a body explaining *what changed and why*.
    - Commit message must NOT reference the agent or include "Generated with" / "Co-Authored-By" lines.
    - Build + lint must pass before committing. If `npx tsc --noEmit` or `npx eslint <files>` fails, fix it first — never commit broken code.
    - After committing, run `git status` to confirm the tree is clean before moving to the next task.

---

## Conventions

### Project structure

- `src/components/osler/` — app-specific components
- `src/components/ui/` — shadcn/ui primitives (48 files, do not add custom logic here)
- `src/lib/osler/` — business logic, types, data loading, storage
- `src/hooks/` — shared React hooks (`useContentTree`, `useArticleHighlighter`, `useGestures`, `useContentCache`, `useQuizSettings`, `useResizableSidebar`, `useDisableBlur`, `useShortcutBindings`, `useShortcutListener`)
- `public/osler-content/` — folder-based content (see Content system)
- `scripts/` — manifest generator and build helpers
- `tauri-admin/` — separate Tauri desktop admin panel (Rust)

### Code style

- TypeScript strict mode with `noImplicitAny: false`
- ESLint is intentionally permissive (most rules off) — use judgment, not linter configuration
- `prefer-const` is not enforced — use `const` by convention, only `let` when reassignment is required
- Comments are minimal and explain *why*, not *what*

### CSS

- Tailwind CSS v4 with `@tailwindcss/postcss` plugin (not v3 `tailwindcss` PostCSS plugin)
- Use Tailwind utility classes and semantic design tokens (`bg-background`, `text-primary`, `border-border/60`)
- Use `oklch()` for color values in `globals.css`
- Border opacity uses `/60` suffix convention: `border-border/60`

### Keyboard shortcuts

- Defined in `@/lib/osler/shortcuts.ts` with scopes: `global`, `qbank`, `reader`, `videos`
- Handled via `useShortcutListener` / `useShortcutBindings` from `@/hooks/use-shortcuts.ts`
- User-customizable in Settings > Keyboard

### Content system (folder-based)

- All content lives under `public/osler-content/` in category folders: `flashcard/`, `qbank/`, `osce/`, `library/`, `videos/`
- **Folder name = title** — no separate metadata file needed; name is title-cased for display
- **Type inheritance**: content under `flashcard/` is auto-type "flashcard"; `qbank/` types auto-detected from file keys (`questions` → `quiz`, `passages` → `bank`, `prompts` → `written`); `osce/` → "osce"; `videos/` → "video"
- **Multiple `.json` files per leaf folder**: all files fetched and merged (arrays concatenated)
- **Branch nodes** (folders with subfolders) → grouping decks; **Leaf nodes** (no subfolders) → content items
- Auto-generate manifests via `npm run generate-manifests` (script: `scripts/generate-content-manifests.js`) — re-run after adding/removing content

### Content loading

- `loadCategoryTree(type)` — loads the tree for a category (from `manifest.json`)
- `loadNodeContent(node)` — fetches and merges all JSON files in a leaf node
- `loadAllContent()` — loads all content across all categories, returns `{ items, trees }`
- `loadContentByUid(uid)` — loads a single content pack by UID
- `flattenTree(node)` — flattens a tree node into an array of leaf nodes
- `useContentTree(options?)` — React hook wrapping `loadAllContent` with helpers: `collectLeafUids`, `mergeCards`, `nodeCardCount`, `nodeDueCount`
- All content is JSON fetched from `/osler-content/`
- Library articles are Markdown (.md) files rendered to HTML via `unified`/`remark`/`rehype` pipeline at runtime

### State management

- Component-local state with `React.useState` for UI state
- `storage` singleton (IndexedDB-backed reactive store with in-memory cache) for progress and user data
- `React.useReducer` only for complex state machines within a component
- Avoid global state libraries — zustand is available in deps but not used

### i18n & RTL

- UI translation lives in `@/lib/osler/i18n.ts` — flat key→record dictionary with `en` and `ar`
- `useI18n()` from `@/components/osler/i18n-provider.tsx` provides `t(key)`, `tList(key)`, `rtl`, `lang`, `dir`, `contentFilter`, `setLang`, `setContentFilter`
- UI language decoupled from content language
- Content packs declare `lang?: ContentLang` (`"en" | "ar"`) on `ContentTreeNode` and `ContentMeta`
- Use Tailwind logical properties (`ms-`/`me-`/`text-start`/`text-end`) instead of `ml-`/`mr-`/`text-left`/`text-right`
- Use `.rtl-flip-x` utility (defined in `globals.css`) to mirror animated arrow/chevron icons
- Cairo font loaded as `--font-cairo` CSS variable in `layout.tsx`
- **Every new key must land in BOTH `en` and `ar` in the same commit.** A missing AR translation is a blocker.

### Native app feel (PWA features)

Osler is a PWA that should feel like a native app. The native-feature library lives at `@/lib/osler/native/` with framework-agnostic implementations + React hooks at `@/hooks/use-native.ts`. Always go through these wrappers — never call the underlying browser APIs directly.

| Module | Browser API | Use it for |
|---|---|---|
| `haptics.ts` | Vibration API | `haptic("selection")` on tab taps, `haptic("success")` on form submit, `haptic("error")` on validation failure. iOS Safari silently no-ops — that's expected. |
| `view-transitions.ts` | View Transitions API | `withViewTransition(() => setState(...), "forward")` for any view-level navigation. Direction is `forward` / `backward` / `none`. The `app-shell.tsx` `handleViewChange` wrapper is the canonical example. |
| `biometric.ts` | WebAuthn | `enrollBiometric(username)` for first-time setup, `authenticateWithBiometric()` for quick unlock, `disableBiometric()` to revoke. Used in `login-screen.tsx` and Settings. |
| `network-info.ts` | Network Information API | `useNetworkInfo()` hook exposes `{ type, effectiveType, downlink, rtt, saveData, online }`. iOS Safari reports `available: false` — handle it. |
| `wake-lock.ts` | Screen Wake Lock API | `acquireWakeLock(predicate)` / `releaseWakeLock()`. Auto re-acquires on visibility regained. Used in `videos-studio.tsx` player view. |

Rules:
- Every interactive surface should fire at least one haptic on user action. Pick the right pattern from `HAPTIC_PATTERNS`.
- Every view-level navigation should go through `withViewTransition()`. Don't bypass it with raw `setState`.
- All native features must degrade gracefully — feature-detect before use, fall back to a no-op or the legacy behavior when the API is unavailable.
- Honor `prefers-reduced-motion` — the libs do this automatically, but don't add raw CSS animations that ignore it.
- For full-screen overlays (video player, OSCE simulator, sync modal), use `.safe-screen` / `.safe-pt` / `.safe-pb` so content doesn't sit under the notch.

### Swipe-back navigation (Learn sub-views)

Learn sub-views (Library, Flashcards, OSCE, Videos) support iOS-style swipe-back to return to the Learn hub:

- Use `useSwipeBackDismiss` from `@/hooks/use-swipe-back-dismiss` with `direction: "horizontal"`.
- Wrap the component root in `<motion.div {...swipeDismissProps}>` to enable the gesture.
- **Disable the gesture** during immersive states where swipe conflicts with content interaction:
  - Flashcards: `disabled: mode === "study" || mode === "complete"`
  - Videos: `disabled: !!activeVideo`
  - Library: `disabled: isMobile ? !!activeFile : false` (disable when reading an article on mobile)
  - OSCE: `disabled: phase !== "select"` (only enable on the scenario picker)
- The hook already handles RTL, haptic feedback, velocity-aware dismiss, and snap-to-origin.
- Do NOT add edge-zone detection — the existing hook works from anywhere on the page.
- View transitions via `withViewTransition()` in `app-shell.tsx` handle the slide animation automatically.

### Testing

- **No test framework is configured.** There are no test files, no test runner config, and no test scripts.
- There are no CI workflows in this repo.

---

## Configuration system (`osler.config.json`)

Osler is fully driven by a runtime-loaded, user-editable config file at
`public/osler.config.json`. The schema lives in `src/lib/osler/config.ts`;
the loader (`loadConfig()`) merges the user's file over `DEFAULT_CONFIG` so
every field is optional and the app always boots.

### What the config drives

| Section | Drives |
|---|---|
| `site.{name,shortName,tagline,githubRepo,organisation,supportEmail}` | `<title>`, OG/Twitter metadata, PWA manifest name, in-app brand mark, in-app About section, admin sidebar footer link |
| `engines.<id>.{enabled,label,singular,color,icon}` | Engine plugin enable/disable; per-engine label/color/icon overrides via `getEngineMeta(type)` |
| `themes.{default,custom[]}` | Default theme + custom palettes; each custom theme injects CSS variable overrides scoped to `.theme-<id>` |
| `defaults.view` | Default landing view after login |
| `defaults.language.{ui,content}` | Default UI language + content-language filter |
| `defaults.quiz.*` | Default quiz builder options (question count, sec/question, tutor, shuffle) |
| `defaults.ai.*` | Default AI assistant model + enabled + temperature |
| `defaults.sync.*` | Default sync transport + room name |
| `wizard.{completed,completedAt,version}` | First-time wizard state |

### Engine plugin system

The 7 engine types (`quiz | bank | written | flashcard | osce | library | video`)
are each treated as a toggleable plugin. Disabling an engine:

- Hides its module from the Learn hub (`learn.tsx` filters `ALL_MODULES` by `isEngineEnabled`).
- Skips its category in `loadAllContent()` / `loadContentByUid()` — content is
  never fetched from disk.
- Does NOT delete content on disk — re-enabling the engine brings it back.

**Plugins are admin-controlled, not user-controlled.** The decision of which
engines to include is made by the instance admin via `osler.config.json` and
applies to every user of the instance. There is no end-user UI to toggle
plugins — the in-app Settings → About section shows the enabled plugins as
read-only badges with an explicit "Admin-controlled" tag. Only the Tauri
admin app (Setup Wizard, Instance Generator, Config Editor) writes plugin
state.

Per-engine overrides (label, color, icon) are surfaced through
`getEngineMeta(type)` (override-aware); import `ENGINE_META` directly only when
you intentionally want the built-in defaults.

> 📖 **Self-hosting guide:** [`SELF-HOSTING.md`](SELF-HOSTING.md) covers forking,
> white-labelling, plugin selection, deployment, and the branding checklist.

### Custom themes

`themes.custom[]` defines palettes in addition to the built-in `dark` / `light`.
Each entry has `id`, `name`, `variant` ("dark" / "light"), and optional oklch
color overrides (`primary`, `background`, `foreground`, `accent`, `border`,
`destructive`, `mutedForeground`). The theme provider injects a single
`<style id="osler-custom-themes">` block into `<head>` with one rule per
custom theme, scoped to `.theme-<id>`. Switching to a custom theme adds both
`.theme-<id>` and the variant class to `<html>` so existing `.dark` / `.light`
checks (e.g. Mermaid) keep working.

### Tauri admin integration

The Tauri admin app reads/writes the config via three commands in
`tauri-admin/src/config.rs`:

- `read_config` — returns the parsed JSON (errors if file missing)
- `write_config` — pretty-prints and writes the file
- `config_exists` — boolean check used by the auto-wizard
- `generate_instance` — scaffolds a brand-new Osler project into a target
  directory with the user's site identity, engines, and theme patched into a
  fresh `osler.config.json`

The admin frontend exposes three new views (registered in
`tauri-admin/frontend/main.js`):

- **Setup Wizard** (`views/wizard.js`) — 6-step first-time setup, auto-launches
  when no config exists on project bind.
- **Instance Generator** (`views/instance.js`) — scaffolds new Osler projects.
- **Config Editor** (`views/config.js`) — structured editor for every section
  of `osler.config.json`, with a raw-JSON tab for power users.

### Adding a new engine plugin

1. Add the id to `EngineType` in `src/lib/osler/types.ts`.
2. Add a default entry to `ENGINE_META` in `src/lib/osler/content.ts`.
3. Add the id to `ENGINE_PLUGIN_IDS` and `DEFAULT_CONFIG.engines` in `src/lib/osler/config.ts`.
4. Add the id to the `ENGINES` list in `tauri-admin/frontend/views/wizard.js`
   and `tauri-admin/frontend/views/config.js` (so the admin UI surfaces it).
5. Add the id to the bundled template in `tauri-admin/default-osler-config.json`.
6. Add rendering support (a studio component + a branch in `page.tsx`).
7. Add i18n keys for the new engine's labels (both `en` and `ar`).

---

## Developer Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server on port 3000 |
| `npm run dev:turbo` | Dev with Turbopack |
| `npm run build` | Production build + standalone output |
| `npm run start` | Run standalone server (after build) |
| `npm run lint` | ESLint check |
| `npm run generate-manifests` | Regenerate content manifests after adding/removing content |

## Build Quirks

- `next.config.ts`: `output: "standalone"`, `typescript: { ignoreBuildErrors: true }`, `reactStrictMode: false`
- Build produces `.next/standalone/` — the `start` script runs `server.js` from that directory
- Deployment via Caddy (port 81, reverse-proxy to localhost:3000)
- Windows deploy: `scripts/build-deliverable.ps1`
- Linux deploy: `scripts/build-deliverable.sh`
- `.env.local` supplies `NEXT_PUBLIC_INVIDIOUS_HOST` (YouTube alt frontend for video player)
- No `.env` file required for basic dev — AI assistant Gemini key is configured in-app (Settings > AI Assistant)

## Architecture

### Single-page view routing

The app uses a client-side view state (`OslerView` type in `app-shell.tsx`) rather than Next.js pages. All views live under a single route (`/`) and are toggled via the `AppShell` component.

Available views: `dashboard`, `learn`, `library`, `qbank`, `flashcards`, `osce`, `videos`, `profile`, `settings`.

Library, Flashcards, OSCE, and Videos are sub-views under the **Learn** hub. They keep their own `OslerView` values but no longer appear in the nav bars. The Learn tab stays highlighted while inside any sub-view via `LEARN_SUBVIEWS` in `app-shell.tsx`.

### Studio components

| View | Component | Handles |
|---|---|---|
| Quiz/Bank/Written | `QBankStudio.tsx` (~4300 lines) | Unified quiz engine, adaptive UI per type |
| Flashcards | `FlashcardStudio.tsx` (~880 lines) | Deck browser + spaced repetition |
| OSCE | `OsceStudio.tsx` (~2400 lines) | Clinical OSCE simulator + AI voice interaction |
| Videos | `VideosStudio.tsx` | Video player with YouTube/Plyr/Invidious |

### Viewport quirks

- `html, body { overflow: hidden; height: 100%; }` in globals.css
- `userScalable: false`, `maximumScale: 1`, `viewportFit: "cover"` in layout metadata
- Desktop nav hidden at `<768px`, replaced by `MobileTabBar`
- Touch targets must meet 44px minimum

### Sync system

- Sync library: `@/lib/osler/sync/` (6 modules: protocol, helpers, file, QR, network transport, index)
- Three methods: WebRTC (PeerJS + MQTT relay), QR code (LZ-string + CRC32), file backup (`.osler-backup`)
- Sync settings UI in `@/components/osler/sync/` (4 panel components)

---

## Workflows

### Adding a new view

1. Add view name to `OslerView` type in `app-shell.tsx`
2. Create component in `src/components/osler/`
3. Add nav entry in `AppShell` and/or `MobileTabBar` (or add to `LEARN_SUBVIEWS` if it belongs under the Learn hub)
4. Wire the view in `src/app/page.tsx` with conditional rendering
5. Add keyboard shortcut in `shortcuts.ts`
6. Add the new view to `VIEW_ORDER` in `app-shell.tsx` so the slide-transition direction heuristic works correctly
7. Add i18n keys for every label/string in the new view — both `en` and `ar` in the same commit
8. Wire `haptic()` calls into the view's primary interactions (button taps, form submits)
9. If the view has full-screen overlays, use `.safe-screen` / `.safe-pt` / `.safe-pb`
10. Stage and commit after the view is buildable and lint-clean

### Adding a new content type

1. Define TypeScript interface in `@/lib/osler/types.ts`
2. Add it to the `AnyContent` union type
3. Add type guard in `@/lib/osler/content.ts`
4. Add entry in `ENGINE_META`
5. Add rendering support (QBankStudio / FlashcardStudio / OsceStudio / new studio)
6. Add type detection key in `scripts/generate-content-manifests.js` (`fileKeyMap`)
7. Add category folder under `public/osler-content/`

### Adding a new native-feature integration

If you need to use a new browser API (e.g. Contacts, File System Access, Web Share):
1. Add a new module under `src/lib/osler/native/<feature>.ts` — framework-agnostic, feature-detected, gracefully degrading.
2. Export it through `src/lib/osler/native/index.ts`.
3. If it needs React state, add a hook to `src/hooks/use-native.ts`.
4. Add i18n keys for any UI strings it surfaces (both `en` and `ar`).
5. Wire it into the consuming component via the wrapper — never call the browser API directly from a component.
6. Update the table in this file's "Native app feel" section.
7. Stage + commit.
