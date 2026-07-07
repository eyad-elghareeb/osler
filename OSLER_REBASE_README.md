# Osler — Rebased on MedOS Lite UI/UX

> Osler's medical study platform rebuilt with the **exact UI/UX design system** from MedOS Lite: topbar-only AppShell, QBank Studio quiz UI, and AMBOSS-style article library — all on Next.js 16 + React 19 + Tailwind 4 + shadcn/ui.

## What's New (v2 — Topbar + QBank Studio + Library)

| Aspect | Before (v1) | After (v2) |
|---|---|---|
| AppShell | Sidebar + topbar (medos-lite-incompatible) | **Topbar-only** — exact medos-lite pattern |
| Quiz/Bank UI | Custom Osler engines | **QBank Studio** — copied from medos-lite (navy topbar, left strip nav, split-pane explanation) |
| Article support | None | **AMBOSS-style Library** — TOC sidebar + 9 sample articles + search + bookmarks |
| Engines | 5 separate React components | **Unified QBank Studio** handles all 5 engine types |
| Profile | None | New view with stats + engine breakdown + 6 achievements |

## App Structure

### Top-bar-only AppShell (matches medos-lite)

- **Logo** (left) — Activity icon in primary-tinted rounded square + "Osler / Medical Study Platform"
- **Horizontal nav** with animated active indicator (`layoutId="nav-active"`):
  - Dashboard (LayoutDashboard)
  - Library (BookOpen)
  - Q-Bank Studio (ListChecks)
- **Center search pill** (desktop ≥lg) — Popover with article autocomplete; "Ctrl+K" shortcut
- **Theme toggle** — Sun/Moon icon, dark/light toggle (persists to localStorage)
- **User menu** — Avatar with initials + dropdown (Profile / Settings / Sign out)
- **Mobile bottom tab bar** (<768px) — 5 tabs: Home / Library / Q-Bank / Profile / Settings

### Five views

1. **Dashboard** — Greeting + continue-learning card + 4 stat tiles + quick actions + featured articles + recent activity
2. **Library** — AMBOSS-style article reader with TOC sidebar (specialty tree) + article panel with rich HTML + zoom + bookmarks
3. **Q-Bank Studio** — Unified engine UI (Create Test home + Quiz player + Results dashboard)
4. **Profile** — Stats + performance by engine + 6 achievements
5. **Settings** — Theme toggle + data management + keyboard shortcuts + about

## QBank Studio — exact copy from medos-lite

### Home view
- **Section 1**: Timed vs Tutor mode cards
- **Section 2**: Available content packs with per-pack progress
- **Right rail**: Sticky Test Summary

### Quiz view
- **Navy topbar** — QBank Studio logo, engine label, "Question X of Y", timer (red when < 5 min), pause button
- **Left strip navigator** — Numbered grid with state colors (current ring, flagged amber, correct blue, wrong red, answered primary)
- **Center question panel** — Stem in `uworld-prose` style + 5 choices with circular letter badges
- **Choice buttons** — 2px border, hover state, blue (correct) / red (wrong) on submit with checkmark/X icons
- **Split-pane explanation** (tutor mode after submit) — Right column with ExplanationCard
- **Bottom action bar** — Prev / Flag / Submit (or Retry) / Next (or End Test)

### Results view
- Score % with color (blue/amber/red)
- Percentile rank
- Answered / Incorrect / Flagged / Total Time / Avg per question
- Score distribution bar
- Per-question review list

### Engine unification
All 5 engine types play through the same QBank Studio UI:
- **Quiz** — Standard MCQ
- **Bank** — Passage prepended to stem, then standard MCQ
- **Flashcard** — Front as stem, "Reveal Answer" shows back as explanation
- **Written** — Prompt as stem, rubric shown inline, "Reveal Answer" shows rubric
- **OSCE** — Scenario as stem, Red Flags + Differential + Rubric inline

## Article Library — AMBOSS-style

### TOC sidebar
- Collapsible specialty → subcategory → article tree
- Chevron icons rotate when expanded
- Active article highlighted with primary tint
- Bookmark indicator on leaf nodes

### Article panel
- Breadcrumb header (specialty › system) + read time + zoom + bookmark
- Rich HTML: h1/h2/h3, tables, callouts, warnings, code blocks, blockquotes, lists
- Zoom: 80%–140% with reset
- Animated page transitions

### Sample articles (9 total)
- **Cardiology**: STEMI, Acute Coronary Syndromes, HFrEF
- **Pulmonology**: COPD, Asthma, Pulmonary Embolism
- **Neurology**: Acute Ischemic Stroke, Subarachnoid Hemorrhage
- **Gastroenterology**: Cirrhosis & Portal Hypertension

Each 6–10 minute read with full pathophysiology, presentation, diagnosis, management, complications, prognosis.

### Search integration
Topbar Ctrl+K pill searches articles by title / specialty / tags. Result click → Library view with article open.

## Design tokens (matches medos-lite `globals.css`)

```css
:root {
  /* Dark navy + light blue (default) */
  --background: oklch(0.14 0.018 260);
  --foreground: oklch(0.96 0.005 240);
  --card: oklch(0.19 0.022 260);
  --primary: oklch(0.58 0.14 245);   /* UWorld blue */
  --accent: oklch(0.45 0.12 250);
  --radius: 0.625rem;
}
.light {
  --background: oklch(0.99 0.005 240);  /* cream */
  --primary: oklch(0.38 0.09 255);      /* dark navy */
}
```

## Tech stack

- **Next.js 16** (App Router, Turbopack)
- **React 19**
- **TypeScript 5** (strict)
- **Tailwind CSS 4** (`@theme inline` design tokens)
- **shadcn/ui** (48 components)
- **lucide-react** icons
- **framer-motion** for transitions
- **Geist Sans + Geist Mono** fonts (via `next/font/google`)

## Project structure

```
src/
├── app/
│   ├── globals.css         # MedOS Lite tokens + QBank Studio + Library styles
│   ├── layout.tsx          # Root layout with OslerThemeProvider
│   └── page.tsx            # Entry — wires AppShell + view routing
├── components/
│   ├── osler/
│   │   ├── app-shell.tsx           # Topbar-only shell (medos-lite pattern)
│   │   ├── mobile-tab-bar.tsx      # Bottom nav (mobile only)
│   │   ├── theme-provider.tsx      # Dark/light theme context
│   │   ├── login-screen.tsx        # Demo login
│   │   ├── dashboard.tsx           # Home with featured articles
│   │   ├── library.tsx             # AMBOSS-style article reader
│   │   ├── qbank-studio.tsx        # Unified QBank Studio (all 5 engines)
│   │   ├── ai-assistant.tsx        # Chat panel
│   │   ├── profile.tsx             # Stats + achievements
│   │   └── settings.tsx            # Theme/data/shortcuts/about
│   └── ui/                         # shadcn/ui components (unchanged)
└── lib/
    ├── osler/
    │   ├── types.ts                # TypeScript schemas (5 content types)
    │   ├── content.ts              # Manifest + content-pack loader
    │   ├── storage.ts              # localStorage progress tracking
    │   └── articles.ts             # 9 sample articles + TOC + search
    ├── db.ts
    └── utils.ts
public/
└── osler-content/                  # 5 sample content packs
```

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint       # eslint
```

## Replacing the mock AI assistant

`src/components/osler/ai-assistant.tsx` returns canned responses via `generateMockReply()`. To wire a real model:

1. Add an API route at `src/app/api/ai/route.ts` that proxies to your LLM provider.
2. Replace the `setTimeout` block in `send()` with a `fetch('/api/ai', { method: 'POST', body: JSON.stringify({ prompt }) })` call.
3. Stream the response back into the chat bubble.

The `z-ai-web-dev-sdk` package is already in `package.json` if you want to use it server-side.

## License

Same as upstream Osler.
