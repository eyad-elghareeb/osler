# Osler — Agent Guidelines

## Critical Rules

1. **All interactive components must be `"use client"`.** Server components are only for static content, layouts, and metadata.

2. **Use named exports only.** Never use `export default`. Import with destructured named imports.

3. **Use `@/` path aliases.** Never use relative imports like `../../components/`. Use `@/components/osler/...`, `@/lib/osler/...`, `@/hooks/...`.

4. **Use `cn()` for className merging.** Import from `@/lib/utils`. Never write raw template literal class strings.

5. **All content schemas live in `@/lib/osler/types.ts`.** Never define content types elsewhere. The 6 engine types are `quiz | bank | flashcard | written | osce | library`.

6. **Engine metadata comes from `ENGINE_META` in `@/lib/osler/content.ts`.** Never hardcode engine labels, colors, or icons.

7. **Progress and user data uses `@/lib/osler/storage`.** This is a localStorage-backed reactive store. Import the `storage` singleton — never access `localStorage` directly.

8. **Use `framer-motion` for animations.** Import `motion` from `framer-motion`. Use `AnimatePresence` for mount/unmount transitions. Keep durations under 0.3s for UI elements.

9. **Use `lucide-react` for all icons.** Import icon components by name. Never use inline SVGs or emoji as icons.

10. **Design tokens use oklch color space in `globals.css`.** The `@theme inline` block maps CSS variables to Tailwind classes. Never hardcode color values in components — use Tailwind semantic classes (e.g., `text-primary`, `bg-muted`).

11. **Support both dark and light themes.** The `.dark` class toggles via `OslerThemeProvider`. All components must look correct in both themes. Use `bg-background text-foreground` for page-level elements.

12. **Do not rewrite.** Patch, harden, and consolidate in place. No restructuring, no new frameworks, no green-field rebuilds. The IIFE engine pattern is kept; add test shims if needed.

---

## Conventions

### Project structure principles

- `src/components/osler/` — app-specific components (not generic UI)
- `src/components/ui/` — shadcn/ui primitives (48 files, do not add custom logic here)
- `src/lib/osler/` — business logic, types, data loading, storage
- `src/hooks/` — shared React hooks (including `useContentTree`, `useArticleHighlighter`, `useGestures`)

### Code style

- TypeScript strict mode with `noImplicitAny: false`
- ESLint is intentionally permissive (most rules off) — use judgment, not linter configuration, for code quality
- `prefer-const` is not enforced by linter — use `const` by convention, only use `let` when reassignment is required
- Comments should be minimal and explain *why*, not *what*

### Component patterns

```tsx
"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { SomeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComponentProps {
  title: string;
  onAction?: () => void;
}

export function Component({ title, onAction }: ComponentProps) {
  return (
    <motion.div className={cn("flex items-center gap-2", "text-foreground")}>
      <SomeIcon className="size-4" />
      <span>{title}</span>
    </motion.div>
  );
}
```

### CSS

- Use Tailwind utility classes and semantic design tokens (`bg-background`, `text-primary`, `border-border/60`)
- Avoid custom CSS in `globals.css` for one-off styles — use Tailwind
- Use `oklch()` for color values in `globals.css`
- Border opacity uses `/60` suffix convention: `border-border/60`

### Keyboard shortcuts

- Defined in `@/lib/osler/shortcuts.ts` with scopes: `global`, `qbank`, `reader`
- Handled via `useShortcutListener` from `@/hooks/use-shortcuts.ts`
- User-customizable in Settings > Keyboard

### Content system (folder-based)

- All content lives under `public/osler-content/` in category folders: `flashcard/`, `qbank/`, `osce/`, `library/`
- **Folder name = title** — no separate metadata file needed; name is title-cased for display
- **Type inheritance**: content under `flashcard/` is auto-type "flashcard"; `qbank/` types auto-detected from file keys (`questions` → `quiz`, `passages` → `bank`, `prompts` → `written`); `osce/` → "osce"
- **Multiple `.json` files per leaf folder**: all files fetched and merged (arrays concatenated)
- **Branch nodes** (folders with subfolders) → grouping decks; **Leaf nodes** (no subfolders) → content items
- `ContentTreeNode` in `@/lib/osler/types.ts` replaces `ManifestItem` (now deleted)
- Auto-generate manifests via `npm run generate-manifests` (script: `scripts/generate-content-manifests.js`) — re-run after adding/removing content

### Content loading

- `loadCategoryTree(type)` — loads the tree for a category (from `manifest.json`); `type` is `EngineType`
- `loadNodeContent(node)` — fetches and merges all JSON files in a leaf node
- `loadAllContent()` — loads all content across all categories, returns `{ items, trees }`
- `loadContentByUid(uid)` — loads a single content pack by UID
- `flattenTree(node)` — flattens a tree node into an array of leaf nodes
- `useContentTree(options?)` — React hook wrapping `loadAllContent` with helpers: `collectLeafUids`, `mergeCards`, `nodeCardCount`, `nodeDueCount`
- All content is JSON fetched from `/osler-content/`
- Library articles are Markdown (.md) files rendered to HTML via `unified`/`remark`/`rehype` pipeline at runtime

### Mobile responsiveness

- Desktop nav hidden at `<768px`, replaced by `MobileTabBar`
- Use `useIsMobile()` from `@/hooks/use-mobile.ts` for responsive logic
- Use `usePlatform()` from `@/hooks/use-platform.ts` for OS detection
- Touch targets must meet 44px minimum

---

## Workflow

### Adding a new view

1. Add the view name to `OslerView` type in `app-shell.tsx`
2. Create the component in `src/components/osler/`
3. Add a nav entry in `AppShell` and/or `MobileTabBar`
4. Wire the view in `src/app/page.tsx` with conditional rendering
5. Add a keyboard shortcut in `shortcuts.ts`

### Adding a new content type

1. Define the TypeScript interface in `@/lib/osler/types.ts`
2. Add it to the `AnyContent` union type
3. Add a type guard in `@/lib/osler/content.ts`
4. Add an entry in `ENGINE_META`
5. Add rendering support — use `QBankStudio.tsx` for quiz/bank/written types, `FlashcardStudio.tsx` for flashcards, `OsceStudio.tsx` for OSCE, or create a dedicated studio component
6. Add type detection key in `scripts/generate-content-manifests.js` (`fileKeyMap`)
7. Add category folder under `public/osler-content/`

### i18n & RTL support

- UI translation lives in `@/lib/osler/i18n.ts` — flat key→record dictionary with `en` and `ar`.
- `useI18n()` from `@/components/osler/i18n-provider.tsx` provides `t(key)`, `tList(key)`, `rtl`, `lang`, `dir`, `contentFilter`, `setLang`, `setContentFilter`.
- UI language is decoupled from content language. Arabic UI flips the shell; Arabic content packs render RTL regardless of UI language.
- Content packs declare `lang?: ContentLang` (`"en" | "ar"`) on `ContentTreeNode` and `ContentMeta` in `@/lib/osler/types.ts`.
- Content body containers use `dir`/`lang` attributes + `.osler-content-ar`/`.osler-content-en` CSS classes.
- `ContentLangFilter` (exported from `@/components/osler/qbank-studio.tsx`) provides All/English/Arabic pills — shared across QBank, Flashcards, and OSCE.
- `LANG_INIT_SCRIPT` in `i18n.ts` runs inline in `<head>` to prevent flash of LTR layout.
- Use Tailwind logical properties (`ms-`/`me-`/`text-start`/`text-end`) instead of `ml-`/`mr-`/`text-left`/`text-right`.
- Use `.rtl-flip-x` utility (defined in `globals.css`) to mirror animated arrow/chevron icons.
- The Cairo font is loaded as a CSS variable (`--font-cairo`) in `layout.tsx` for Arabic glyphs.

### Handling state

- Component-local state with `React.useState` for UI state
- `storage` singleton (reactive localStorage) for progress and user data
- `React.useReducer` only for complex state machines within a component
- Avoid global state libraries — zustand is available in deps but not currently used
