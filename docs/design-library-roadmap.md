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

Magic UI describes itself as animated React, TypeScript, Tailwind, and Motion components designed to complement shadcn/ui. Cult UI and Kibo UI likewise position their collections as drop-in, composable shadcn/Tailwind components; that alignment makes them useful raw material, but not exceptions to Osler's conventions. [Magic UI](https://magicui.design/), [Cult UI](https://www.cult-ui.com/), [Kibo UI](https://www.kibo-ui.com/)

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

| Priority | Initiative | Outcome | Candidate source |
| --- | --- | --- | --- |
| P0 | Motion audit and shared recipes | Replace the remaining ad-hoc CSS entrance animations with purposeful, reduced-motion-safe Framer Motion patterns. | Motion Primitives |
| P0 | Form field refinement | Standardize grouped fields, validation feedback, and focused controls in Settings and QBank setup. | Origin/Coss UI patterns |
| P1 | Analytics primitives | Introduce accessible chart/table wrappers driven by Osler semantic tokens. | Existing Recharts + TanStack Table; evaluate Tremor later |
| P1 | Content upload experience | Improve the admin content-upload path with a robust, touch-friendly dropzone and image review. | Kibo UI patterns |
| P2 | Public marketing kit | Build a separate, restrained library of landing-page sections and one optional hero accent. | Shadcnblocks + Magic UI + Cult UI |
| P2 | Curated component review | Maintain an allow-list of locally adapted components from external registries. | 21st.dev, all sources |

## What not to do

- Do not install several registries at once or use their defaults side by side.
- Do not replace Radix/shadcn just because a candidate offers a prettier demo.
- Do not introduce a second animation, icon, chart, or theme system without a written technical decision.
- Do not apply marketing visual effects to timed tests, article reading, flashcard review, or OSCE work.
- Do not copy a demo's English strings, non-semantic colors, raw SVGs, or physical left/right spacing into Osler.
- Do not make animation the measure of polish. Clear hierarchy, responsive interaction, reliable input controls, and accessible feedback are the higher-leverage improvements.
