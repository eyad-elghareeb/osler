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
    - **shadcn/ui** (`@/components/ui/*`) — 49 primitives already vendored. Use them for dialogs, dropdowns, popovers, tabs, etc. Never re-implement a shadcn component.
    - **framer-motion** — for any animation. Never raw `requestAnimationFrame` transitions.
    - **lucide-react** — for icons. Never inline SVGs.
    - **`@/lib/osler/native`** — for Vibration, View Transitions, WebAuthn, Network Information, Wake Lock. Never call `navigator.vibrate()` / `navigator.credentials.*` / `navigator.wakeLock.*` directly — go through the wrappers.
    - **`@/lib/osler/pdf`** — for PDF exports (QBank test papers, Flashcard notes, Dashboard stats, Articles). Never instantiate `jsPDF` or handle Arabic shaping manually — go through `pdf.ts`, `arabic.ts`, and `pdf-export-dialog.tsx`.
    - **`@/lib/osler/storage`** — for any persistent state. Never touch `localStorage` or IndexedDB directly (biometric credential ID is the documented exception, see `biometric.ts`).
    - **`@/lib/osler/cloud`** — for Cloudflare Worker account sessions, Google OAuth, profile/password updates, data export, account deletion, and automated cloud sync. Never bypass `cloud.ts` or make direct fetch calls to the Worker endpoints outside of it.
    - **`@/lib/osler/sync`** — for P2P cross-device sync. Never open a new PeerJS / MQTT channel outside the existing `NetworkTransport`.
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

19. **Follow the Design System.** Every new view, card, button, or status indicator must use the shared design tokens, primitives, and CSS utility classes defined in [Design System](#design-system) below. Never hand-roll a Tailwind recipe for a page header, section heading, stat tile, empty state, loading state, card, or status color when a canonical version already exists. Never use hardcoded Tailwind palette colors (`text-emerald-500`, `text-amber-500`, `text-red-500`, `bg-orange-500/10`, etc.) — use the semantic `success` / `warning` / `destructive` / `info` tokens instead.

---

## Design System

The Osler design system lives in three places:

1. **CSS design tokens** — `src/app/globals.css` declares the color, radius, and font tokens in the `@theme inline` block, then maps them to light/dark/custom-theme values in `:root`, `.light`, and `.theme-<id>` blocks.
2. **Shared primitives** — `src/components/osler/ui-primitives.tsx` exports `PageHeader`, `SectionHeading`, `StatTile`, `EmptyState`, `LoadingState`, `OslerCard`, `InteractiveCard`. These are the canonical implementations of those patterns.
3. **CSS utility classes** — `src/app/globals.css` defines `.osler-*` utility classes (`.osler-page`, `.osler-page__inner`, `.osler-page-header`, `.osler-section-heading`, `.osler-card--*`, `.osler-stat-tile--*`, `.osler-empty`, `.osler-loading`, `.osler-icon-btn`) that encode the canonical Tailwind recipe for each pattern.

**When in doubt, prefer primitives over raw Tailwind.** The primitives pull the recipe from one place, so a future tweak to spacing or typography ripples through every view automatically.

### Color tokens (semantic, never hardcoded)

| Token | Light value | Dark value | Use it for |
|---|---|---|---|
| `--background` / `--foreground` | near-white / dark navy | dark navy / near-white | Page background and body text |
| `--card` / `--card-foreground` | pure white / dark navy | elevated navy / near-white | Card surfaces |
| `--primary` / `--primary-foreground` | deep navy / white | medium blue / white | Primary actions, active nav, links |
| `--secondary` / `--muted` | light gray / gray | navy-gray / muted gray | Inactive states, secondary surfaces |
| `--accent` | mid blue | darker blue | Hover/focus accents on outline buttons |
| `--destructive` | warm red | red | Destructive actions (delete, sign out) |
| `--border` / `--input` / `--ring` | light gray / light gray / navy | white@8% / white@10% / blue | Borders, inputs, focus rings |
| `--success` | deep green | bright green | Correct answers, positive metrics, "complete" state |
| `--warning` | deep amber | bright amber | Accuracy %, due counts, flagged items, "in progress" |
| `--info` | deep cyan | bright cyan | Informational accents (used sparingly) |
| `--chart-1..5` | brand palette | brand palette | Per-engine accent colors in pack cards / charts |

**Rules:**

- **Never** use `text-emerald-500`, `text-green-500`, `text-amber-500`, `text-orange-500`, `text-red-500`, or any other Tailwind palette color in components. Use `text-success`, `text-warning`, `text-destructive`, or `text-info` instead. Tailwind v4 auto-generates these from the `--color-*` tokens in the `@theme inline` block.
- **Never** use `bg-emerald-500/15`, `border-amber-500/30`, or any palette color with opacity. Use `bg-success/15`, `border-warning/30`, etc.
- The `oklch()` values for per-engine accent colors are exported from `ENGINE_META` in `@/lib/osler/content` — always read them from there, never hardcode.
- Custom themes (`themes.custom[]` in `osler.config.json`) can override `primary`, `background`, `foreground`, `accent`, `border`, `destructive`, `mutedForeground`, and the new `success` / `warning` / `info` tokens.

### Page layout

Every hub view (Dashboard, Learn, Profile, Settings desktop, QBank hub, Flashcard hub, OSCE hub, Videos hub) follows the same outer structure:

```tsx
<div className="osler-page">
  <div className="osler-page__inner">  // or __inner--wide / __inner--narrow
    <PageHeader ... />
    {/* content sections */}
  </div>
</div>
```

- **`osler-page`** — outer scroll wrapper with thin scrollbar styling and mobile bottom-tab-bar padding. Replaces the previous `h-full overflow-y-auto medos-scroll medos-tabbar-pad md:pb-0` string.
- **`osler-page__inner`** — centered content column at `max-w-5xl`. Use `__inner--wide` (`max-w-6xl`) for media-heavy views (Dashboard, Videos) and `__inner--narrow` (`max-w-4xl`) for text-heavy views (Profile, Settings).
- **Standard padding**: `px-4 md:px-6 lg:px-8 py-6 md:py-8`. The previous `py-4 sm:py-6` and `py-3` variants are gone — every hub view uses `py-6 md:py-8` for consistent vertical rhythm.
- **Standard max-widths**: `max-w-4xl` (narrow) / `max-w-5xl` (default) / `max-w-6xl` (wide) / `max-w-7xl` (extra-wide, used by QBank hub only). Never introduce a new max-width without adding it as a new `.osler-page__inner--*` variant.
- **Never** hardcode viewport arithmetic like `h-[calc(100vh-3.5rem)]` to subtract the app-shell header — it breaks if the header height changes. Use `h-full` and let the parent flexbox handle the layout.

### Page headers (`<PageHeader>`)

```tsx
// Stacked variant — default for hub views (Dashboard, Learn, Flashcards)
<PageHeader
  eyebrow="Good afternoon"          // optional, small uppercase label
  eyebrowIcon={Flame}               // optional lucide icon
  title={t("dash.welcomeBack", { name: username })}
  subtitle={t("dash.intro")}
/>

// Inline variant — for views with an icon chip (OSCE, Videos, Settings, Profile)
<PageHeader
  inline
  inlineIcon={Stethoscope}
  inlineIconColor={ENGINE_META.osce.color}  // optional — defaults to primary
  title={t("osce.home.title")}
  subtitle={t("osce.home.subtitle")}
  actions={<Button>...</Button>}    // optional right-aligned actions
/>
```

**Rules:**

- The page title (h1) is always `text-2xl md:text-3xl font-bold tracking-tight` in the stacked variant, or `text-xl md:text-2xl font-bold tracking-tight` in the inline variant. Never `text-xl font-semibold` or `text-lg font-bold` for a page title.
- The subtitle is always `text-sm text-muted-foreground max-w-2xl`.
- The eyebrow is always `text-xs uppercase tracking-wider text-muted-foreground` with an optional lucide icon at `size-3`.
- Use the inline variant when the view has a natural icon (OSCE Stethoscope, Videos PlayCircle, Settings gear, Profile avatar). Use the stacked variant for content-first views (Dashboard, Learn, Flashcards).

### Section headings (`<SectionHeading>`)

```tsx
<SectionHeading>{t("dash.quickActions")}</SectionHeading>
<SectionHeading icon={NotebookPen}>{t("qbank.notes.title")}</SectionHeading>
<SectionHeading actions={<Button size="sm" variant="link">View all</Button>}>
  {t("dash.featuredArticles")}
</SectionHeading>
```

- Always `text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3`.
- Optional `icon` prop renders a `size-4` lucide icon before the label.
- Optional `actions` prop renders a right-aligned row of buttons/links (typically a "View all" link).
- Never hand-roll `<h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">` — use the primitive.

### Cards

Pick exactly one padding scale per card, and prefer `.osler-card--*` CSS classes or the `<OslerCard>` / `<InteractiveCard>` primitives over hand-rolled Tailwind:

| Variant | Padding | When to use |
|---|---|---|
| `.osler-card--compact` | `p-3` | Dense grids, sidebar panels, lab-value rows |
| `.osler-card--default` | `p-4` | Default for most cards (stat tiles, quick actions, featured articles) |
| `.osler-card--roomy` | `p-5 md:p-6` | Hero cards, primary content cards, profile header |
| `.osler-card--interactive` | `p-5 md:p-6` + hover | Clickable pack/module cards |

**Rules:**

- **Always** use `rounded-xl` for cards. Never `rounded-lg` or `rounded-2xl` (the Calculator modal's `rounded-2xl` is a known outlier — do not copy it).
- **Always** use `border border-border` for resting cards. Never `border-border/60` (was the old recipe — too faint).
- **Hover state**: `hover:border-primary/40 hover:shadow-md`. Optionally add `hover:bg-primary/[0.02]` for subtle background tint on interactive cards. Never `hover:border-primary/40` alone without a shadow for clickable cards.
- **Never** use `bg-background` for a card surface — cards are always `bg-card`.
- Use `<InteractiveCard animationDelay={idx * 40}>` for the staggered fade-in mount animation that pack grids use.

### Stat tiles (`<StatTile>`)

```tsx
<StatTile
  label={t("dash.correctLabel")}
  value={stats.correct}
  icon={CheckCircle2}
  color="success"            // primary | success | warning | destructive | info
  onClick={() => onViewChange("profile")}  // optional — renders a <button>
/>
```

- **Default** size: `rounded-xl p-4` with `text-2xl font-bold tabular-nums` value.
- **Compact** size (`compact` prop): `rounded-xl p-3.5` with `text-xl font-bold` value. Use in dense 3-column grids (QBank / Flashcard hub stat bars).
- The label is always `text-[11px] font-medium uppercase tracking-wider text-muted-foreground`.
- Never duplicate the StatTile component across views — import from `ui-primitives.tsx`.

### Empty states (`<EmptyState>`)

```tsx
<EmptyState
  icon={Layers}
  title={t("flash.home.empty")}
  description={t("flash.home.empty")}
  actions={<Button variant="outline">Back to dashboard</Button>}
/>
```

- Always `size-14 rounded-full bg-muted/40` for the icon container.
- Always `text-base font-semibold` for the title.
- Always `text-sm text-muted-foreground max-w-sm` for the body.
- Center vertically with `py-16`. Never `py-20` or `py-12`.

### Loading states (`<LoadingState>`)

```tsx
<LoadingState label={t("videos.loading")} />           // default size-6 spinner
<LoadingState size="sm" />                              // size-5 spinner (inline)
<LoadingState size="lg" label="Loading scenarios…" />   // size-7 spinner (full hub)
```

- Always use `Loader2` from `lucide-react` with `animate-spin`.
- Always `text-muted-foreground` for the spinner (not `text-primary` — the spinner is informational, not a brand cue).
- Always `py-16`. Never `py-20`.

### Buttons

Always use `<Button>` from `@/components/ui/button` — never hand-roll a `<button>` with ad-hoc Tailwind classes for primary actions. The Button component now supports these sizes:

| Size | Height | Use it for |
|---|---|---|
| `sm` | `h-8` | Compact actions in toolbars, table rows, small CTA |
| `default` | `h-9` | Default for most buttons |
| `lg` | `h-10` | Primary CTAs in forms, login submit, modal actions |
| `icon` | `size-9` | Icon-only buttons (36×36px, default) |
| `iconSm` | `size-7` | Compact icon buttons (28×28px, e.g. session top bar) |
| `iconLg` | `size-10` | Large icon buttons (40×40px, e.g. desktop article reader toolbar) |

**Variants:** `default` (filled primary), `outline` (border + bg-background), `secondary` (bg-secondary), `ghost` (transparent, hover bg-accent), `destructive` (red), `link` (text-only with underline).

**Rules:**

- **Never** hand-roll a `<button>` element with `bg-primary text-primary-foreground text-sm font-medium` — use `<Button>` instead.
- **Never** mix `rounded-md`, `rounded-xl`, `rounded-lg` for primary actions within the same form. Login screen used to have `h-12 rounded-xl` biometric + `h-10 rounded-md` submit — that was a bug; both are now `<Button size="lg">`.
- **Icon buttons**: prefer `variant="ghost" size="icon"` (or `iconSm`/`iconLg`) over hand-rolled `<button className="size-9 rounded-md ...">`. The `.osler-icon-btn` CSS class is also available for non-component cases (e.g. avatar triggers in the app shell).

### Icon button sizing — old vs new

| Old (remove) | New (use) |
|---|---|
| `<button className="size-6 rounded-md ...">` | `<Button variant="ghost" size="iconSm">` |
| `<button className="size-7 rounded-md ...">` | `<Button variant="ghost" size="iconSm">` |
| `<button className="size-8 rounded-md ...">` | `<Button variant="ghost" size="icon">` |
| `<button className="size-9 rounded-md ...">` | `<Button variant="ghost" size="icon">` |
| `<button className="size-10 rounded-md ...">` | `<Button variant="ghost" size="iconLg">` |

### Tab bars

Osler uses two tab styles:

1. **Underline tabs** (nav-style) — `border-b-2 border-primary text-primary` for active, `border-b-2 border-transparent text-muted-foreground hover:text-foreground` for inactive. Use for: QBank hub tabs (Content / Create / Previous), Lab Values category tabs.
2. **Pill tabs** (filter-style) — `bg-primary text-primary-foreground` for active, `bg-muted/60 text-muted-foreground hover:text-foreground` for inactive. Use for: content-language filter pills, mobile folder chips, library TOC/Bookmarks toggle.

**Rules:**

- Pick the style that matches the role: nav = underline, filter = pill. Never mix within the same component.
- The desktop top-nav and mobile bottom-tab-bar have their own active-indicator styles (`bg-primary/10 border border-primary/30` for desktop, color change + top accent bar for mobile) — these are intentional form-factor differences, not inconsistencies to "fix".

### In-session top bars

Quiz session (QBank active test) uses a primary-color navy bar (`bg-primary text-primary-foreground` via inline style) — this is the UWorld-style quiz mode indicator and is intentionally distinct.

All other in-session top bars (Flashcard study, OSCE conversation, Library reader, Lab Values panel, Calculator modal) standardize on:

```
h-12 flex items-center px-3 sm:px-4 gap-2 shrink-0
border-b border-border bg-card/60 backdrop-blur-md safe-pt
```

- Always `h-12` (48px). Never `py-2` / `py-3` or any other implicit height.
- Always `bg-card/60 backdrop-blur-md`. Never `bg-card/40` (too faint) or `bg-card/80` (too opaque).
- Always `border-b border-border` (no opacity).
- Always include `safe-pt` so content doesn't sit under the notch on mobile.

### Article typography

Three near-identical typography systems existed (`.medos-article`, `.uworld-prose`, `.library-article`). The canonical system going forward is `.uworld-prose` for QBank/Flashcard rich text and `.library-article` for the Library article viewer. `.medos-article` is being phased out — do not use it in new code.

When adding new rich-text rendering (e.g. AI chat messages, notes), reuse `.uworld-prose` rather than introducing a fourth system.

### Typography hierarchy summary

| Element | Recipe |
|---|---|
| Page title (h1) | `text-2xl md:text-3xl font-bold tracking-tight` (or `text-xl md:text-2xl` in inline header) |
| Section heading (h2) | `text-sm font-semibold uppercase tracking-wider text-muted-foreground` |
| Card title (h3) | `text-sm font-semibold` or `text-base font-semibold` |
| Card subtitle / metadata | `text-xs text-muted-foreground` |
| Body text | `text-sm` (default) |
| Caption / micro label | `text-[11px]` (use sparingly — prefer `text-xs`) |
| Stat value | `text-2xl font-bold tabular-nums` (or `text-xl` in compact stat tiles) |

**Never** use `text-[10px]`, `text-[9px]`, or other sub-11px sizes for visible text. Use `text-xs` (12px) instead.

### Spacing scale

| Token | Use |
|---|---|
| `gap-1.5` (6px) | Tight clusters (icon + label inside a button) |
| `gap-2` (8px) | Default gap between related items in a row |
| `gap-3` (12px) | Default gap between cards in a grid |
| `gap-4` (16px) | Gap between sections / sidebar + main |
| `gap-6` (24px) | Major page-level sections |
| `mb-3` (12px) | Below a section heading |
| `mb-6` (24px) | Between major content blocks |
| `mb-8` (32px) | Between top-level page sections |

### What to do when extending the design system

1. **Adding a new semantic token** (e.g. `--info-soft`): declare it in `:root` and `.light`, add it to the `@theme inline` mapping, then verify Tailwind generates `text-info-soft` / `bg-info-soft` utilities by using it in a component.
2. **Adding a new shared primitive**: add it to `src/components/osler/ui-primitives.tsx`. Export it as a named export. Add a corresponding `.osler-*` CSS class in `globals.css` if the recipe is non-trivial.
3. **Adding a new CSS utility class**: declare it in `globals.css` under the `Osler Design System` section. Use `@apply` only with real Tailwind utilities — never `@apply` another custom class (Tailwind v4 rejects that).
4. **Migrating an existing view**: prefer mechanical, surgical edits that swap hand-rolled Tailwind for the shared primitive. Do not restructure the view's component tree. Keep all behavior identical.

### Cleanup backlog (known drift, not blocking)

These items are documented as known drift and may be cleaned up incrementally. Do not block new work on them, but fix them when you touch the relevant file:

- The QBank session UI (active quiz mode) still uses `text-emerald-500` / `text-amber-500` / `text-red-500` for correct/wrong/flagged indicators. These should eventually migrate to `text-success` / `text-warning` / `text-destructive`.
- The Flashcard study top bar uses `border-border/60` instead of `border-border`. Migrate when next editing `flashcard-studio.tsx`.
- The OSCE session sidebar uses `bg-card/40` and `border-border/60`. Migrate when next editing `osce-studio.tsx`.
- ~28 unused custom CSS classes are defined in `globals.css` (`.osler-card` system, `.osler-engine-*` layout, `.osler-stat` system, `.qbank-topbar*`, `.qbank-nav-strip*`, `.qbank-choice*`, `.uworld-tree-checkbox`, `.uworld-grid-bg`, `.uworld-pulse`, `.library-toc*`, `.medos-grid-bg`, `.medos-pulse`, `.medos-h-dvh`). Delete them when the namespace consolidation work is scheduled.
- The `ENGINE_COLORS` map in `dashboard.tsx` duplicates colors that already live in `ENGINE_META` in `@/lib/osler/content`. Refactor to read from `ENGINE_META` instead.

---

## Conventions

### Project structure

- `src/components/osler/` — app-specific components (including `pdf-export-dialog.tsx` for PDF customization)
- `src/components/ui/` — shadcn/ui primitives (49 files, do not add custom logic here)
- `src/lib/osler/` — business logic, types, data loading, storage, grading, PDF engine (`pdf.ts`, `arabic.ts`, `pdf-fonts.ts`)
- `src/hooks/` — shared React hooks: `useContentTree`, `useArticleHighlighter`, `useGestures`, `useContentCache`, `useQuizSettings`, `useResizableSidebar`, `useDisableBlur`, `useShortcuts` (`useShortcutBindings` / `useShortcutListener` / `useShortcutSequenceReset`), `useSwipeBackDismiss`, `useSwipeTabs`, `useSwipeGallery`, `useToast`, `usePlatform`, `useMobile`, `useNative`
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
- Use Tailwind utility classes and semantic design tokens (`bg-background`, `text-primary`, `border-border`)
- Use `oklch()` for color values in `globals.css`
- Resting cards use `border border-border`; opacity suffixes like `border-border/60` are drift and are being phased out (see cleanup backlog)

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
- **Images**: a leaf node may declare an `images: [...]` file list and ship an `images/` subfolder. Bare filenames in rich text / card fields resolve against the node's `images/` subfolder automatically (`src/lib/osler/richtext.ts`, `articles.ts`). Library article images live in `<articleDir>/images/`.
- **Flashcard types**: `basic` (front/back) and `cloze` (Anki `{{c1::answer::hint}}` syntax). Cloze cards split into one review unit per distinct cloze index; SM-2 tracks each separately. Markdown is supported in all fields; images resolve via the pack's `images/` subfolder. Anki export (`.txt`) is available for basic + cloze decks.
- Auto-generate manifests via `npm run generate-manifests` (script: `scripts/generate-content-manifests.js`) — re-run after adding/removing content or images

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
| `npm run dev:worker` | Start Cloudflare Worker locally (port 8787) |
| `npm run dev:full` | Start both frontend + Worker concurrently |
| `npm run dev:turbo` | Dev with Turbopack |
| `npm run build` | Production build + standalone output |
| `npm run start` | Run standalone server (after build) |
| `npm run lint` | ESLint check |
| `npm run generate-manifests` | Regenerate content manifests after adding/removing content |

## Build Quirks

- `next.config.ts`: `output: "export"`, `trailingSlash: true`, `images.unoptimized: true`, `typescript: { ignoreBuildErrors: true }`, `reactStrictMode: false`
- Build produces `out/` (static export) — the `start` script serves it via `npx serve out -p 3000`
- The service worker is built separately by `scripts/build-sw.js` (esbuild) into `public/sw.js`, before `next build` runs
- Deployment via Cloudflare Pages (`npm run deploy:pages`) + Cloudflare Worker (`npm run deploy:worker`); see `docs/cloudflare-static-worker.md`
- Windows deploy: `scripts/build-deliverable.ps1`
- Linux deploy: `scripts/build-deliverable.sh`
- `.env.local` supplies `NEXT_PUBLIC_INVIDIOUS_HOST` (YouTube alt frontend for video player) and optionally `NEXT_PUBLIC_CLOUD_API_URL` (Worker URL, baked at build time; otherwise read from `public/osler.config.json`)
- No `.env` file required for basic dev — AI assistant Gemini key is configured in-app (Settings > AI Assistant)

## Architecture

### Single-page view routing

The app uses real **path-based Next.js App Router routes** (e.g. `/qbank/[uid]`, `/library/[article]`, `/settings/[section]`) rather than query-param view state. All app views live under the `(app)` route group; the studios render in hub or session mode depending on whether a dynamic segment (`uid` / `article` / `video` / `section`) is present.

Navigation goes through `useOslerRouter()` / `routeFor()` in `@/lib/osler/navigation.ts`:

- `VIEW_ORDER` in `navigation.ts` defines the stable view order used to compute slide-transition direction.
- `useCurrentView()` derives the active `OslerView` from the pathname.
- `navigate(view, params?)` fires `haptic("selection")`, wraps the `router.push` in `withViewTransition(direction)`, and intentionally does NOT maintain a custom history stack (the browser's real history is the single source of truth).

Route gating is enforced **client-side** by `RouteGuard` (`src/components/osler/route-guard.tsx`) — there is no server middleware (static export has no server runtime). Cloud sessions are stored in `sessionStorage` (per-tab fast path) mirrored to `localStorage` (cross-tab / cross-restart persistence) so an active account never silently degrades to a local-only session; local guest sessions use `osler-local-session` in both tiers. Session lifetime is sliding: the client rotates the token via `POST /v1/auth/refresh` before expiry and on 401 (`refreshCloudSession()` in `src/lib/osler/cloud.ts`), and the sync loop retries transient failures/conflicts with exponential backoff. Cross-tab logins/logouts sync via `BroadcastChannel` (see `src/lib/osler/cloud.ts`). There is deliberately no "logged in by name only" half-state — a user is either fully authenticated or on `/login`. Unauthenticated requests redirect to `/login?next=<path>`; the `next` param is validated with `isSafeLocalPath()` to prevent open redirect. See [`docs/cloudflare-static-worker.md`](docs/cloudflare-static-worker.md) for the architecture notes.

Available views: `dashboard`, `learn`, `library`, `qbank`, `flashcards`, `osce`, `videos`, `profile`, `settings`.

Library, Flashcards, OSCE, and Videos are sub-views under the **Learn** hub. They keep their own `OslerView` values but no longer appear in the nav bars. The Learn tab stays highlighted while inside any sub-view via `LEARN_SUBVIEWS` in `app-shell.tsx`.

### Studio components

| View | Component | Handles |
|---|---|---|
| Quiz/Bank/Written | `QBankStudio.tsx` (~6190 lines) | Unified quiz engine, adaptive UI per type |
| Flashcards | `FlashcardStudio.tsx` (~1350 lines) | Deck browser + spaced repetition |
| OSCE | `OsceStudio.tsx` (~2470 lines) | Clinical OSCE simulator + AI voice interaction |
| Videos | `VideosStudio.tsx` | Video player with YouTube/Plyr/Invidious |

### Viewport quirks

- `html, body { overflow: hidden; height: 100%; }` in globals.css
- `userScalable: false`, `maximumScale: 1`, `viewportFit: "cover"` in layout metadata
- Desktop nav hidden at `<768px`, replaced by `MobileTabBar`
- Touch targets must meet 44px minimum

### Sync system

- Sync library: `@/lib/osler/sync/` (6 modules: protocol, helpers, file, QR, network transport, index)
- Three methods: WebRTC (PeerJS + MQTT relay), QR code (LZ-string + CRC32), file backup (`.osler-backup`)
- Sync settings UI in `@/components/osler/sync/` (`sync-modal.tsx`, `sync-settings-section.tsx`, `network-sync-panel.tsx`, `qr-sync-panel.tsx`, `file-sync-panel.tsx`, `network-info-badge.tsx`)

### Offline content cache

- Service worker (`src/app/sw.ts`, Serwist) precaches the app shell + runtime caches content on demand.
- `useContentCache` hook (`src/hooks/use-content-cache.ts`) drives per-pack precaching: a leaf node's data files plus any `images/` URLs are computed via `nodeUrls` and pushed to the SW's runtime cache.
- UI surfaces: `content-cache-button.tsx` (per-pack download/remove in QBank/Flashcard/OSCE/Videos hubs) and the Offline section in `settings.tsx`.
- Images are always precached alongside their pack so decks/articles render fully offline.

---

## Workflows

### Adding a new view

1. Add view name to `OslerView` type in `app-shell.tsx`
2. Create component in `src/components/osler/`
3. Create the route page under `src/app/(app)/<view>/` (dynamic segment `[uid]`/`[article]`/`[video]`/`[section]` where appropriate)
4. Add nav entry in `AppShell` and/or `MobileTabBar` (or add to `LEARN_SUBVIEWS` if it belongs under the Learn hub)
5. Add keyboard shortcut in `shortcuts.ts`
6. Add the new view to `VIEW_ORDER` in `src/lib/osler/navigation.ts` so the slide-transition direction heuristic works correctly
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
