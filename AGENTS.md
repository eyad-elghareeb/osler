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

### Testing

- **No test framework is configured.** There are no test files, no test runner config, and no test scripts.
- There are no CI workflows in this repo.

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

Available views: `dashboard`, `library`, `qbank`, `flashcards`, `osce`, `videos`, `profile`, `settings`.

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
3. Add nav entry in `AppShell` and/or `MobileTabBar`
4. Wire the view in `src/app/page.tsx` with conditional rendering
5. Add keyboard shortcut in `shortcuts.ts`

### Adding a new content type

1. Define TypeScript interface in `@/lib/osler/types.ts`
2. Add it to the `AnyContent` union type
3. Add type guard in `@/lib/osler/content.ts`
4. Add entry in `ENGINE_META`
5. Add rendering support (QBankStudio / FlashcardStudio / OsceStudio / new studio)
6. Add type detection key in `scripts/generate-content-manifests.js` (`fileKeyMap`)
7. Add category folder under `public/osler-content/`
