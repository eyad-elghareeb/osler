# UI library roadmap

This guide explains how Osler can use external component registries to raise craft without fragmenting its design system. It is a selection policy and implementation playbook, not approval to add every library.

## Decision in brief

Osler should keep its existing stack as the product's foundation:

- `@/components/ui` remains the home for vendored shadcn primitives.
- `@/components/osler/ui-primitives.tsx` remains the home for reusable Osler patterns such as page headers, cards, stat tiles, loading, and empty states.
- `src/app/globals.css` and its semantic OKLCH tokens remain the only color and radius source of truth.
- `framer-motion` remains the only animation runtime. `motion-dom` is already present as its lower-level companion.

External libraries are sources for carefully selected components. Bring a component into Osler only after adapting it to those foundations; never introduce a parallel theme, button family, icon set, or animation system.

## Where each library fits

| Source | Recommendation | Best fit in Osler | Avoid / guardrail |
| --- | --- | --- | --- |
| [Motion Primitives](https://motion-primitives.com/) | Adopt first | Tabs, accordions, dialogs, list reordering, disclosure and layout transitions in the study app | Use its patterns with the installed `framer-motion`; retain Osler's View Transitions for route-level changes. |
| [Magic UI](https://magicui.design/) | Use selectively | Public marketing and onboarding surfaces: a restrained bento, social proof strip, or a single hero focal effect | Do not bring beams, marquees, or decorative motion into focused study sessions, QBank, reader, or settings. |
| [Cult UI](https://www.cult-ui.com/) | Reference and selectively adopt | High-craft app patterns such as progressive cards, command surfaces, and AI-assistant affordances | Reject 3D, physics, and hover-dependent interactions when they obscure clinical content or fail on touch. |
| [Origin UI / Coss UI](https://coss.com/ui) | Adopt patterns, not a replacement foundation | Form fields, input groups, comboboxes, validation layouts, OTP, and settings controls | Origin UI now redirects to Coss UI and uses Base UI; do not replace Osler's existing Radix/shadcn primitives wholesale. Port only the visual/interaction pattern. |
| [Kibo UI](https://www.kibo-ui.com/) | Adopt when a concrete feature needs it | Drag-and-drop upload, image zoom, richer editor or collaborative/admin workflows | Do not add Gantt, kanban, or canvas primitives until a user workflow requires them. Existing `dnd-kit`, QR, and image tooling may already cover the need. |
| [Tremor](https://www.tremor.so/) | Evaluate before adoption | Analytics dashboards, longitudinal progress, cohort reporting, and admin metrics | Osler already uses Recharts and TanStack Table. Prefer a small shared chart layer over adopting Tremor merely for restyling. |
| [21st.dev](https://21st.dev/) | Curated discovery source | One-off inspiration for loaders, inputs, command UI, and small supporting details | Treat every snippet as untrusted: inspect dependencies, accessibility, licensing, client boundary, and token compliance before copying. |
| [Shadcnblocks](https://www.shadcnblocks.com/) | Marketing-only source | Landing, pricing, feature comparison, and self-hosting pages | Do not use product-marketing blocks inside the authenticated study application. |
| [Skiper UI](https://skiper-ui.com/) | Adopt selectively | Uncommon, high-craft shadcn-compatible components: magnetic cursors, bento layouts, premium cards, and motion-rich UI elements that are hard to build from primitives alone | No extra packages — one file per component via shadcn CLI. Inspect each component's dependencies and motion budget against the integration contract before porting; do not adopt layout-heavy or hover-dependent patterns that conflict with touch-first study surfaces. |
| [Motion](https://motion.dev/) | Already the core runtime; adopt new APIs selectively | `animateView()` for View Transitions, Motion UI sections for marketing pages, and the hybrid engine's hardware-accelerated SVG/transform animations for performance-critical UI | Osler already ships `framer-motion` (which is Motion). Avoid adding `motion-dom` or a second Motion API surface unless a specific feature needs it. Motion UI's pre-built sections belong only in marketing surfaces (P2 backlog). |

Magic UI describes itself as animated React, TypeScript, Tailwind, and Motion components designed to complement shadcn/ui. Cult UI and Kibo UI likewise position their collections as drop-in, composable shadcn/Tailwind components; that alignment makes them useful raw material, but not exceptions to Osler's conventions. Skiper UI positions itself as uncommon, detail-driven shadcn-compatible components with strong visual craft. Motion (formerly Framer Motion) is the animation runtime Osler already ships — its new `animateView()` API and Motion UI section library are worth tracking for marketing and View Transitions use cases. [Magic UI](https://magicui.design/), [Cult UI](https://www.cult-ui.com/), [Kibo UI](https://www.kibo-ui.com/), [Skiper UI](https://skiper-ui.com/), [Motion](https://motion.dev/)

### Source status notes (research refresh)

Ownership and maturity of a few sources changed since the table above was first written. These don't change the guardrails, but they matter for what's safe/worth porting today:

- **Kibo UI was acquired by Shadcnblocks (Oct 2025).** It now ships ~41 components (Gantt, Kanban, code editor, AI chat elements, color picker, image zoom, QR, dropzone) plus 1,000+ Shadcnblocks-style blocks under one registry. Still MIT-licensed and still shadcn/Tailwind-compatible, so the existing "adopt when a concrete feature needs it" posture holds — but the catalog worth scanning for a future feature brief is bigger than when this doc was written.
- **Tremor was acquired by Vercel (Jan 2025).** "Tremor Raw" (copy-paste, `tremor.so`) is the actively developed version, and **Tremor Blocks (300+ dashboard sections) is now free and open-source**, where it was previously paid. This lowers the cost of the "evaluate before adoption" step — worth a fresh look now that a concrete admin-analytics need exists (see below) — but the guidance to prefer a small shared chart layer over a second charting runtime is unchanged.
- **Origin UI is now legacy inside `coss.com/ui`**, which has become the official design system of Cal.com. The active layer is built on Base UI (not Radix) with three tiers — Primitives, Particles, Atoms. This confirms the existing guardrail ("port only the pattern, not the dependency") was the right call, and it's now maintained under a company with a strong incentive to keep it current.
- **Skiper UI** is a newer registry (106+ components) that positions itself as uncommon, detail-driven shadcn/UI components. Design is inspired by Rauno's "Devouring Details" philosophy. MIT-licensed, one file per component, no extra packages. Worth scanning for premium card layouts, bento grids, and motion-rich elements that go beyond what 21st.dev or Magic UI offer — but still subject to the same integration-contract checks (token compliance, touch behavior, motion budget). The catalog is growing quickly; revisit periodically for specific feature needs.
- **Motion (formerly Framer Motion)** has shipped significant new capabilities since Osler adopted it: `animateView()` wraps the View Transitions API with a simpler API, **Motion UI** launched with 26 sections and 35 components (production-ready, shadcn-token-compatible), and the hybrid engine now accelerates SVG and `backgroundColor` animations in hardware. Osler already uses `framer-motion` as its sole animation runtime — the new `animateView()` is directly relevant (could simplify `withViewTransition()`), while the Motion UI sections are marketing-grade and belong only in the P2 marketing kit.

## A deliberate adoption order

### 1. Establish an interaction layer

Start with Motion Primitives-inspired patterns because they improve the existing application without changing its visual language.

- Add a small, local motion recipe module only when the first shared transition needs it, for example `@/lib/osler/motion.ts`.
- Standardize state transitions around a short spring (`stiffness: 300`, `damping: 30`) or an equally calm tween; UI feedback should normally finish within 200–250ms.
- Use `AnimatePresence` only for entering and leaving content that needs continuity: tabs, overlays, stacked panels, and expandable answers.
- Keep `withViewTransition()` as the route/view navigation mechanism and `haptic()` on deliberate primary interactions.
- Respect `prefers-reduced-motion`. Reduced motion should retain instant state clarity, not hide content or leave a component halfway through an interaction.

High-value first candidates are QBank explanation panels, Learn hub pack cards, Settings sections, the command/search experience, and empty-to-populated data states. Avoid animating question stems, answer correctness, timers, or score changes in a way that delays comprehension.

### 2. Upgrade form ergonomics

Use Origin/Coss UI and 21st.dev as pattern references for the next form that genuinely needs richer interaction: settings forms, test configuration, content uploads, and sign-in/verification.

The resulting component must still compose the existing shadcn field, label, input, select, dialog, and button primitives. The goal is better focus, validation, grouping, and keyboard behavior—not a visual replacement.

### 3. Build a shared analytics vocabulary

Before introducing Tremor, define Osler wrappers around the existing Recharts and TanStack Table stack: chart container, tooltip, empty/loading/error state, semantic series colors, and accessible summary text. This will improve the Dashboard, Profile, and QBank results immediately while preserving existing dependencies.

Evaluate Tremor only if a proposed analytics feature needs a substantial, maintained component that the shared wrappers cannot reasonably cover. If adopted, use one controlled adapter under `@/components/osler/analytics`, map all colors to `--chart-*` and semantic tokens, and do not expose Tremor primitives directly throughout the app.

### 4. Add specialized primitives only with a product brief

Kibo UI is appropriate for a future administrator upload workflow, image inspection, or an advanced content-management feature. Bring it in only alongside a bounded feature brief that identifies the user task, touch behavior, keyboard support, offline behavior, and an exit criterion.

### 5. Separate product UI from marketing expression

Use Magic UI, Cult UI, and Shadcnblocks for a future public Osler site or optional onboarding campaign. On a learning product, visual spectacle belongs at the edge of the product journey; concentration-oriented study surfaces should remain calm, fast, and information-dense.

## Non-negotiable integration contract

Every adopted component must pass these checks before it is accepted:

1. **Architecture:** interactive code starts with `"use client"`, uses named exports, aliases (`@/`), `cn()`, Lucide icons, existing storage/native wrappers, and no new global state mechanism.
2. **Tokens and themes:** remove hardcoded palette values. Map every surface, border, text state, chart series, and focus state to Osler semantic tokens so dark, light, and custom themes work.
3. **Shared ownership:** generic, adapted primitives live in `@/components/ui`; product-specific compositions live in `@/components/osler` or `ui-primitives.tsx`. Do not paste a third-party snippet into a feature screen when it will recur.
4. **Accessibility:** preserve semantic HTML, labels, visible `:focus-visible`, keyboard navigation, screen-reader descriptions, and touch targets. Hover must enhance—not be required for—understanding or operation.
5. **Internationalization:** all user-facing text goes through `useI18n().t()` and lands in both English and Arabic. Use logical spacing utilities and verify RTL order, icon direction, and Arabic line height.
6. **Motion:** use Framer Motion only; stay below 300ms for UI feedback, define an exit path for `AnimatePresence`, and honour reduced-motion preferences.
7. **Native feel:** primary interactions fire an appropriate `haptic()` pattern, view-level navigation goes through `withViewTransition()`, and full-screen surfaces use safe-area utilities.
8. **Performance:** lazy-load heavy visual-only components, do not ship unused dependencies, avoid a second charting or animation runtime, and verify the mobile route does not regress in bundle size or responsiveness.
9. **Quality:** test keyboard, touch, light/dark/custom themes, English/Arabic, reduced motion, empty/loading/error data, and narrow mobile widths before merging.

## Design engineering rules for Osler

### Spatial rhythm

Continue using the established `gap-2`, `gap-3`, `gap-4`, and `gap-6` rhythm; new cards use the shared card primitives and `rounded-xl`. A component sourced externally must conform to these scales rather than importing its original arbitrary spacing and radius values.

### Borders, depth, and visual focus

Cards rest on `bg-card border border-border`; interactive cards add both `hover:border-primary/40` and `hover:shadow-md`. Blur, glow, or animated background effects are reserved for one focal element at most per viewport. They must never compete with question text, clinical red flags, or answer feedback.

### Type and data density

Keep Geist for Latin UI and Cairo for Arabic, use the established page and section heading primitives, and retain `text-muted-foreground` for supporting information. Medical study flows need scanability before novelty: never use sub-11px visible text, animated numerals that impede reading, or decorative letter spacing in Arabic.

### Motion grammar

Motion should communicate one of four meanings: navigation, state change, spatial continuity, or feedback. If it does none of these, omit it. Prefer opacity plus a small positional change over scale, rotation, parallax, or perpetual animation; spring motion is useful when it clarifies a direct manipulation, while short tweens are better for routine opacity and color state changes.

## Component intake workflow

For each proposed component:

1. Write a small issue/brief with the exact Osler screen, user problem, success measure, and the candidate source.
2. Check `@/components/ui`, `@/components/osler/ui-primitives.tsx`, and installed dependencies first. Reuse an existing primitive when it covers the need.
3. Copy or install the smallest necessary source, then strip demo copy, global styles, duplicate providers, dependencies, fonts, and hardcoded colors.
4. Adapt it to the integration contract above and place it in the correct shared home.
5. Test it in the target flow across themes, RTL, reduced motion, keyboard, and mobile touch.
6. Run `npm run lint` and `npx tsc --noEmit`; record the source URL and any local deviations in the component's short comment or feature PR.

## Suggested backlog

| Priority | Initiative | Outcome | Candidate source | Status |
| --- | --- | --- | --- | --- |
| P0 | Motion audit and shared recipes | Replace the remaining ad-hoc CSS entrance animations with purposeful, reduced-motion-safe Framer Motion patterns. | Motion Primitives | **In progress** — `motion.ts` extended with `listItemEnter`, `tabIndicator`, `disclosureVariants`, `feedbackPulse`, `pressFeedback`, `stackedPanelEnter`. Ad-hoc `osler-fade-in` CSS keyframes retained for one-shot mount fades that don't need `AnimatePresence`; new components should prefer the Framer Motion recipes. |
| P0 | Form field refinement | Standardize grouped fields, validation feedback, and focused controls in Settings and QBank setup. | Origin/Coss UI patterns | **Partial** — `<FormField>` primitive added to `ui-primitives.tsx` with label + description + error + hint rhythm. `<SegmentedControl>` added for compact option toggles. Migration of existing Settings / QBank setup forms to the new primitives is incremental — adopt on next edit of each form. |
| P1 | Analytics primitives | Introduce accessible chart/table wrappers driven by Osler semantic tokens. | Existing Recharts + TanStack Table; evaluate Tremor later | **Done** — `analytics-primitives.tsx` ships `<ChartContainer>`, `<ChartTooltip>`, `<ChartEmpty>`, `<ChartLoading>`, `<ChartError>`, `<ChartLegend>`, and `chartSeries()`. All colors read from `--chart-1..5` semantic tokens. Tremor not adopted; the wrapper covers the immediate Dashboard / Profile / QBank-results / admin analytics needs. |
| P1 | Content upload experience | Improve the admin content-upload path with a robust, touch-friendly dropzone and image review. | Kibo UI patterns | Not started. Triggered by a future content-upload feature brief. |
| P2 | Public marketing kit | Build a separate, restrained library of landing-page sections and one optional hero accent. | Shadcnblocks + Magic UI + Cult UI | Not started. Triggered by a future public Osler site. |
| P2 | Curated component review | Maintain an allow-list of locally adapted components from external registries. | 21st.dev, all sources | Ongoing. This document is the allow-list. |
| P2 | `animateView()` adoption | Simplify `withViewTransition()` by using Motion's `animateView()` which wraps the View Transitions API with a simpler, safer API. | Motion (already installed as `framer-motion`) | Not started. The existing `withViewTransition()` works; this would be a polish/simplification pass, not a feature. |
| P2 | Skiper UI premium components | Port high-craft card layouts, bento grids, or magnetic-cursor patterns for marketing surfaces or the P2 public site. | Skiper UI | Not started. Triggered by a future public Osler site or a specific feature brief needing premium hover/scroll effects that are hard to build from shadcn primitives. |

## Number animation hook

A `useCountUp` hook at `@/hooks/use-count-up.ts` provides a smooth count-up animation for numeric stat values:

```tsx
const { ref, display } = useCountUp(42);                     // basic
const { ref, display } = useCountUp(1250, { observe: true }); // animate on scroll-in
const { ref, display } = useCountUp(98.5, { decimals: 1, suffix: "%" });
```

Honors `prefers-reduced-motion` by snapping to the final value immediately. Uses an easeOutQuart curve over 500ms by default. The `observe` option uses IntersectionObserver to only animate when the element scrolls into view.

## Local deviations from source patterns

Each adopted pattern deviates from its source in ways that keep it on Osler's design foundations. Recorded here so future component intake can verify the deviation is still intentional.

- **SegmentedControl** (Origin/Coss UI): the source uses Base UI's `Tabs` primitive under the hood. Osler's version stays on a plain `<button role="radio">` set so it composes the existing Radix/shadcn stack without a new dependency. The sliding thumb uses Framer Motion `layoutId` instead of Base UI's internal animation.
- **FormField** (Origin UI): the source ships its own `Label` and `Input` derivatives. Osler's version is layout-only — it composes the existing `@/components/ui/label` and `@/components/ui/input` so the canonical a11y behavior and form-state wiring stay in one place.
- **ChartTooltip** (Osler): not sourced from a registry — written from scratch to match the existing dashboard tooltip styling while adding accessible semantics (`role="tooltip"`, semantic series colors, themed backdrop blur).
- **Soft tint tokens** (`--success-soft` etc.): not in the source patterns. Added so status callouts on cards read as a perceptually consistent pair with their foreground color across dark and light themes. The Tailwind v4 `@theme inline` mapping auto-generates `bg-success-soft` etc. utilities.
- **Elevation scale** (`--shadow-e1..e4`): not in the source patterns. Added so cards, popovers, and dialogs share a single depth vocabulary instead of ad-hoc `shadow-sm` / `shadow-md` / `shadow-lg` choices that drift over time.
- **Skeleton shimmer** (21st.dev): the source typically uses Tailwind's `animate-pulse` on a flat tinted block. Osler's version sweeps a soft `linear-gradient` highlight across the surface via a custom `osler-shimmer` keyframe, reading as "content arriving" rather than a flat pulse. Honours `prefers-reduced-motion` and the user's animations toggle by falling back to a flat tint.
- **EmptyState staggered entrance** (Motion Primitives): the source typically animates children with a single `staggerChildren` container. Osler's version uses per-element variants so the icon springs in (scale + y) while the title / body / actions fade up — the icon gets a spring while text gets a tween, matching each element's perceptual weight.
- **AnimatedDisclosure** (Motion Primitives): the source uses `height: auto` animation via `motion.div` with `AnimatePresence`. Osler's version adds a rotating chevron (90° on open) and a divider between header and body so it composes cleanly on top of the `.osler-card--default` recipe without a separate card wrapper.
- **QuickAction progressive card** (Cult UI): the source typically uses a `group-hover` scale + glow. Osler's version keeps the icon-container scale and arrow nudge but drops the glow so the hover reads as a subtle lift — the icon container's `bg-primary-soft` tint carries the color without an accent stripe (the inline-start accent stripe was removed — see the reversal note below).
- **Global search active row** (21st.dev): the source typically uses a static `↵` hint or a flat background tint. Osler's version uses a flat `bg-primary/10` tint on the active row — the `↵` hint stays as the keyboard affordance. The animated `layoutId` accent bar was removed (see the reversal note below).

**Reversal — inline-start accent stripes removed**: the 3px inline-start accent stripe (dashboard continue-learning hero, QuickAction hover, admin sidebar active bar) and the search-row `layoutId` accent bar were removed after review — they read as an unwanted vertical border on buttons/tabs. Active rows now rely on flat tints (`bg-primary/10`) and the `.osler-accent-start` utility was deleted from `globals.css`.
- **Login ambient glow** (Magic UI / Cult UI): the source patterns often use animated gradient beams or marquee effects for hero sections. Osler's version uses a single static radial gradient at 14% primary tint — reads as a polished ambient light without motion that would distract from the form. Reserved for the login screen only; not used on study surfaces per the roadmap's "separate product UI from marketing expression" rule.

## Editorial typography system

Osler now ships with a dedicated editorial typography stack for English long-form content, layered on top of the existing Geist Sans UI font:

| Font | Role | Where it lives |
|---|---|---|
| **Newsreader** | Editorial serif — body text in Library articles | `--font-serif` → `.library-article` body |
| **Playfair Display** | Display serif — headings, pull quotes, brand moments | `--font-display` → `.library-article` and `.osler-prose` h1–h3 |
| **JetBrains Mono** | Code — inline code, code blocks, technical content | `--font-code` → `code`, `pre`, `.osler-explanation code` |

All three are loaded via `next/font/google` (self-hosted, zero layout shift). The editorial fonts apply only to content surfaces — UI chrome (buttons, labels, nav, stat tiles) stays on Geist Sans.

**Typography refinements shipped:**

- `hanging-punctuation: first` on `blockquote` — optically crisp quote edges
- `text-wrap: balance` on all h1–h3 — no single-word orphans on wrap
- Lead paragraph (`1.05rem` first paragraph) — hooks the reader
- `.pullquote` — centered editorial break with display-serif + large opening mark
- Refined inline code — JetBrains Mono + subtle border + muted tint
- `font-variation-settings: "wght" 550` on `strong` — subtle weight bump instead of harsh 700

**Visual utility classes shipped:**

- `.osler-section-divider` — hairline divider with optional floating label
- `.osler-gradient-text` — primary-to-accent gradient fill for brand moments
- `.osler-table` — refined table typography with `tabular-nums` on `.numeric` cells
- `.osler-noise` — subtle SVG noise texture overlay (3% opacity) for hero surfaces

## Component adoptions shipped

The following individual components were stepped up by adopting patterns from the source libraries. Each adoption is documented in `AGENTS.md → Component adoptions` with the file location and the specific pattern applied.

- **Skeleton + SkeletonText + SkeletonCard** (21st.dev) — shimmer placeholder + composed patterns for paragraph and card layouts.
- **HubSkeleton** (21st.dev + Osler) — premium loading state for hub views; mirrors the real layout (header → hero → stats → cards).
- **EmptyState + LoadingState** (Motion Primitives) — staggered entrance choreography.
- **AnimatedDisclosure** (Motion Primitives) — smooth height + opacity disclosure with rotating chevron.
- **Login screen** (Motion Primitives + Origin UI) — ambient glow, staggered brand header, premium input focus rings.
- **Dashboard QuickAction + featured + recent pack cards** (Cult UI) — progressive card hover with icon scale + arrow nudge.
- **Global search panel** (21st.dev) — shimmer loading rows; active row uses a flat `bg-primary/10` tint.
- **QBank explanation card** (Motion Primitives) — entrance animation + semantic soft-tint status header.
- **Settings → About section** (Motion Primitives) — `AnimatedDisclosure` wraps informational subsections.
- **Dashboard / QBank / OSCE / Videos hub loading** (21st.dev) — `<HubSkeleton>` replaces centered spinners; Videos folder-loading uses a shimmer video-card grid.
- **Library article loading** (21st.dev) — shimmer paragraph skeleton while article content fetches.
- **Admin StatsOverview** (21st.dev + Osler) — skeleton stat tiles while fetching; `MetricBar` on each populated tile shows relative scale.
- **Admin AdminTable** (21st.dev) — shimmer row loading that mirrors the real table layout.
- **Admin sidebar nav** (Motion Primitives) — shared-layout tinted active background that slides between nav items; premium brand block.
- **Admin content dropzone** (Kibo UI) — premium dashed-border dropzone with drag-over scale + primary glow + icon-container scale.
- **Admin analytics charts** (Osler pre-Tremor wrapper) — all 5 panels (timeseries, web-vitals, top-pages, api-performance, errors) wrapped with `<ChartCard>` + `<ChartTooltip>` + `<ChartEmpty>` + `<ChartLoading>` + `<ChartLegend>`. Series colors read from `chartSeries(index)`.
- **Admin dashboard loading** (21st.dev) — `<HubSkeleton>` in `<Suspense>` while `StatsOverview` mounts.
- **Theme preview** (Osler) — mini app-surface preview replaces flat color dots in Settings → Appearance.
- **Library / Flashcard / Videos empty states** (Osler) — consolidated three divergent local implementations onto the shared `<EmptyState>` primitive; Library's local version also had hardcoded English strings that bypassed `useI18n` — now wired to `library.emptyTitle`/`library.emptyDesc`.
- **Videos hub loading** (21st.dev) — added the initial-fetch `<HubSkeleton>` this doc previously (incorrectly) described as already shipped; only the per-folder shimmer grid existed before.
- **Profile engine breakdown** (Osler) — fixed a real bug where the per-engine stat breakdown briefly showed "no sessions" for users with real history, because it read async content metadata before it resolved; now gated on a proper skeleton.
- **OSCE completion confetti** (Osler) — colors now read the resolved `--chart-1..5`/`--primary` custom properties at trigger time instead of a hardcoded hex palette, so the celebration matches the active theme family.
- **`<SparkTrend>`** (Tremor pattern, Recharts implementation) — shipped in `analytics-primitives.tsx`; wired into the Profile and QBank Tracker accuracy `<StatTile>`s using real per-session history from `sessions.list()`. Deliberately *not* added to Admin `StatsOverview` — no historical series backs those tiles yet, and a fabricated one wasn't worth shipping.
- **`<Combobox>`** (Coss UI pattern) — shipped in `ui-primitives.tsx` on the existing `Popover` + `Command` primitives; applied to the AI Assistant model picker (8 long-label options that were previously a bare native `<select>`). Other candidate sites from the original brief (QBank pack filter, content-language filter, Settings language picker) were checked and didn't actually need it — see the component's own doc comment for the reasoning.
- **`<PopoverForm>`** (Cult UI pattern) — shipped in `ui-primitives.tsx`; replaced the Admin content browser's "New folder" and "New file" full-screen `Dialog`s with inline popovers anchored to their toolbar buttons. Rename was left as a `Dialog` — it's triggered from a context menu with no persistent anchor element, which the pattern needs.
- **Settings section switcher — direction-aware transitions** (Cult UI pattern) — the content pane now slides down/up based on the picked section's position in `SECTIONS`, instead of a fixed fade. Pivoted from the original "QBank/Admin tabs" targets after finding neither is actually a tabbed UI in this codebase.
- **`ImageLightbox` — zoom & pan** (Kibo UI pattern) — extended in place (not duplicated) with wheel zoom, two-pointer pinch, double-click/tap, drag-to-pan, and +/-/0 keyboard shortcuts. All three existing callers (content-review preview, content browser, structured-editor image fields) gained it automatically since they share one component.
- **App-wide English typography baseline** (Osler) — previously the editorial refinements (`text-wrap: balance`, hanging punctuation, tabular figures, etc.) only applied to `.osler-prose`/`.library-article`. Added to `@layer base` in `globals.css`, so it now applies everywhere by inheritance/attribute-selector rather than only in long-form prose:
  - `text-rendering: optimizeLegibility` + the standard WebKit/Firefox font-smoothing pair + `font-optical-sizing: auto` on `body` — a rendering-quality floor under every glyph in the app.
  - `text-wrap: balance` on native `h1–h4` **and** every shadcn title (`[data-slot$="-title"]` — one attribute selector catches Dialog/AlertDialog/Sheet/Drawer/Card/Alert titles across the whole app without touching each component file).
  - `text-wrap: pretty` on `p` and every shadcn description (`[data-slot$="-description"]`) — reduces last-line orphans in dialog copy, empty-state bodies, and settings blurbs, not just article bodies.
  - Minor consistency fix: `.ai-chat-msg a` was missing the `text-underline-offset: 2px` every other prose-link rule already had.
  - Deliberately **not** touched: `next/font` weight loading for Newsreader (currently a static 400-weight instance, not variable) — enabling its real optical-size axis would need a build to verify, which wasn't possible in the sandbox this work was done in. Flagged as a follow-up, not shipped speculatively. Numeral consistency (`tabular-nums`) was already mature across the app (26+ deliberate uses in QBank alone) and needed no changes.

## Theming system — curated

The theme catalog was consolidated from 9 families (18 variants) down to **6 curated families** (12 variants). Each remaining family has a distinct primary hue — no two share the same color identity:

- **Built-in Dark + Light** (osler-default) — the navy palette.
- **Forest Rounds** (dark + light) — green.
- **Crimson ED** (dark + light) — red.
- **Midnight** (dark + light) — violet.
- **Slate** (dark + light) — neutral gray.
- **Warm Sand** (light + dark) — terracotta.

**Removed** (documented in `config.ts`):
- Navy Clinic (dark + light) — near-duplicate of the built-in Dark + Light.
- Cream Journal (light) — byte-identical to Navy Clinic Light.
- Cream Journal Dark — orphaned after Cream Journal Light was removed.

**Stale theme validation**: `OslerThemeProvider` now validates the stored theme id against the available themes on mount. If a user had previously selected a removed theme (e.g. "navy-clinic"), the provider falls back to the configured default and persists the resolved id — so theme removal never leaves the user on a theme class with no matching CSS.

**Theme preview**: each theme variant button in Settings → Appearance now shows a mini app-surface preview (background → card with primary accent dot + muted text line → primary bar + secondary tint + accent) instead of flat color dots. The preview is scoped to the theme's CSS class so CSS variables resolve to the theme's actual values.

## Language selector (data-driven)

The Settings → Language section now derives both the UI language selector and the content-language filter from `LANGUAGES` in `src/lib/osler/i18n/languages.ts`. Adding a new language is a one-file edit (plus the i18n string table + registration). The content-filter label falls back to a generic `contentLangOnly` template when a per-language override key is absent, and the language icon is auto-detected from the native-name script.

## Next-wave candidate additions (research pass)

Everything below was checked against each source's current, live component catalog. Each row is scoped to a specific Osler surface — not "adopt the library" — and every entry still has to pass the non-negotiable integration contract above (tokens, i18n, a11y, motion budget) before it ships. This list is a candidate backlog, not a commitment; treat it the same way as the existing "Suggested backlog" table.

| Priority | Component/pattern | Source | Target Osler surface | Why it earns "premium" without breaking calm | Guardrail |
| --- | --- | --- | --- | --- | --- |
| ~~P0~~ **Shipped** | `OTPField` — **not implemented; descoped** | Coss UI | Sign-in / verification flow | On inspection, Osler's actual auth model (email/password, Google OAuth, link-based password reset) has no OTP/verification-code entry step to attach this to. Building it speculatively without a call site would be exactly the kind of unused component the intake workflow warns against. | Revisit only if a real OTP-based flow (2FA, email verification code) gets scoped — port as a layout-only wrapper the way `FormField` was, don't import Coss's own `Input`. |
| ~~P0~~ **Shipped** | `Combobox` — implemented, applied to AI Assistant model picker | Coss UI | AI Assistant model picker (8 long-label options, was a bare native `<select>`) | Closes a genuine gap found after checking the originally-proposed sites (QBank filters, Settings language picker), which turned out not to need it. | Delivered on Osler's existing Radix `Popover`/`Command` — no new dependency. |
| ~~P0~~ **Shipped** | `<SparkTrend>` — implemented, wired to Profile + QBank Tracker | Tremor (pattern reference only — implemented locally) | Profile accuracy tile, QBank Tracker accuracy tile | Real per-session accuracy history from `sessions.list()`, not fabricated data. Admin `StatsOverview` was deliberately left out — no time-series backs those tiles today. | Delivered on Recharts + `chartSeries()` tokens in `analytics-primitives.tsx` — no `@tremor/react` dependency added. |
| ~~P1~~ **Shipped** | `Popover Form` — implemented, applied to Admin "New folder"/"New file" | Cult UI | Admin content browser toolbar (was a full `Dialog` for a one-field form) | Removes modal weight for a genuinely small, toolbar-anchored action. | Rename intentionally left as a `Dialog` — context-menu-triggered actions have no stable anchor element for a Popover. |
| ~~P1~~ **Shipped** | `Direction Aware Tabs` — implemented, applied to Settings section switcher | Cult UI | Settings sidebar (**pivoted** from the original "QBank result tabs / Admin analytics panel tabs" — on inspection neither exists as a tabbed UI; QBank Tracker is one scrolling view, and the 5 admin analytics panels render together in a grid, not as tabs) | Settings' switcher is a *vertical* sidebar, not horizontal tabs, so "direction" means down/up through the section list rather than left/right — same underlying pattern (spatial continuity tied to list position), applied to the shape that actually exists in this codebase. | Delivered via the existing `AnimatePresence` + a `custom` direction variant — no new dependency. RTL-neutral since it's vertical, not horizontal. |
| ~~P1~~ **Shipped** | `Image Zoom` — implemented as an enhancement to the existing `ImageLightbox`, not a new component | Kibo UI | Admin content-review workflow, content browser, structured-editor image fields (all three already shared one `ImageLightbox` — extending it means all three gained zoom for free) | The codebase already had a fit-to-container lightbox; the actual gap was inspecting fine detail on dense figures past 100%. Wheel/pinch/double-click zoom + drag-to-pan close that without duplicating the existing dialog. | Extended in place rather than building a second, competing lightbox — avoids exactly the kind of duplicate-primitive drift this doc's audit found in the empty-state components. |
| P2 | `SegmentedControl`-adjacent gradient heading / eyebrow label treatment | Cult UI (`Gradient Heading`, `Neumorph Eyebrow` — visual pattern only) | Hub page headers (Dashboard, Learn, QBank) as a restrained accent on `PageHeader` | A one-line typographic accent, in the spirit of `.osler-gradient-text` which already exists in `globals.css` — this extends an established pattern rather than introducing a new one. | Reuse the existing `.osler-gradient-text` utility instead of porting new CSS; if it doesn't already cover the effect, extend that utility rather than adding a second gradient-text mechanism. |
| P2 | `Progressive Blur` (edge-of-content blur-out, e.g. bottom of a scrollable card list) | Magic UI | Long scrollable lists that are truncated by a card boundary — QBank folder browser, Video folder grid | Signals "more content below" without a hard-cut fade line or an explicit "show more" button; subtle enough to sit inside a study surface unlike Magic UI's louder effects. | This is the one Magic UI pattern that's arguably not "marketing-only" — treat it as an exception only if it ships with zero motion (a static gradient mask), so it doesn't fight the "no decorative motion in study surfaces" rule. |
| P2 | `Code Block` (syntax highlighting + copy button) | Kibo UI | Library articles / QBank explanations that already render inline code via `JetBrains Mono` (`--font-code`) | If any content surfaces multi-line code (drug-dosing pseudocode, calculation snippets), this upgrades the existing bare `<pre><code>` styling to something with line numbers and copy-to-clipboard — a real utility gain, not spectacle. | Only worth doing if an editorial content audit confirms multi-line code actually appears; otherwise skip — don't add the dependency speculatively. |
| P3 | Bento grid + single Border Beam/Shine Border hero accent | Magic UI / Shadcnblocks | Future public marketing site only | This is where Magic UI's spectacle belongs per the existing "separate product UI from marketing expression" rule — not proposed for anything inside `(app)`. | Build as a fully separate `apps/marketing`-style surface (or route group) so none of its dependencies or classes leak into the study application's bundle. |
| P3 | Magnetic cursor / premium hover effects | Skiper UI | Future public marketing site only — hero sections, CTA cards, or portfolio-style surfaces | Skiper UI's signature craft pattern; reads as premium on marketing surfaces but would fight touch-first study interactions. | Same marketing-surface-only rule as the bento/beam row above — never inside `(app)`. |
| P2 | `animateView()` for View Transitions | Motion (already installed) | `withViewTransition()` wrapper in `src/lib/osler/native/view-transitions.ts` | `animateView()` wraps the browser View Transitions API with a simpler, safer API that handles edge cases the current manual implementation may not cover. Since Motion is already installed, this is a simplification pass, not a new dependency. | Audit the current `withViewTransition()` first — if it already handles all needed cases (direction, reduced-motion, nested calls), skip. Only adopt if `animateView()` genuinely reduces code or adds capability (e.g., `crossDocument` transitions). |

**Explicitly not recommended right now, and why:**
- **Number Ticker (Magic UI)** — already solved by the existing `useCountUp` hook; adopting this would be a second implementation of the same idea.
- **Marquee, Dock, 3D Carousel, Meteors/Particles (Magic UI, Cult UI)** — pure marketing spectacle with no product surface that needs them; belongs in the P2 marketing kit if it ever ships, not before.
- **Kibo UI Gantt/Kanban/Canvas** — no admin workflow currently needs project-board or canvas primitives; the roadmap's existing guardrail against adding these speculatively still applies even though Kibo UI's catalog has grown since the acquisition.
- **Tremor as an installed dependency** — the spark-trend pattern above gets most of the visual benefit without a second charting runtime; only revisit full Tremor adoption if a future feature genuinely needs something Recharts + the existing wrapper can't reasonably do (e.g., a dense correlation heatmap).

## What not to do

- Do not install several registries at once or use their defaults side by side.
- Do not replace Radix/shadcn just because a candidate offers a prettier demo.
- Do not introduce a second animation, icon, chart, or theme system without a written technical decision.
- Do not apply marketing visual effects to timed tests, article reading, flashcard review, or OSCE work.
- Do not copy a demo's English strings, non-semantic colors, raw SVGs, or physical left/right spacing into Osler.
- Do not make animation the measure of polish. Clear hierarchy, responsive interaction, reliable input controls, and accessible feedback are the higher-leverage improvements.
