# Osler — Medical Study Platform

> Quiz, Question Bank, Flashcards, Written Prompts, and OSCE clinical cases — unified in a single medical study platform.

**Stack:** Next.js 16 · React 19 · TypeScript 5 · Tailwind CSS 4 · shadcn/ui · Framer Motion

---

## Features

### i18n & RTL
- Full Arabic (RTL) UI — flips shell, nav, settings
- English ↔ Arabic toggle in Settings > Language
- Per-content language filter: All / English / Arabic pills across QBank, Flashcards, Library, OSCE
- Content-language decoupled from UI-language — Arabic packs render RTL even in English UI
- Arabic content packs: quiz, flashcards, and library articles
- Cairo variable font loaded for Arabic glyph support
- Logical CSS properties (`ms-`/`me-`/`start`/`end`) for direction-agnostic layout
- Flash-free hydration via inline `<head>` script that sets `lang`/`dir` from localStorage

### QBank Studio — Unified Quiz Engine
All 5 engine types play through the same interface:

| Engine | Description |
|---|---|
| **Quiz** | Standard MCQ with 5 choices |
| **Bank** | Passage-based questions |
| **Flashcard** | Front/back reveal (handled by Flashcard Studio) |
| **Written** | Prompt + rubric review |
| **OSCE** | Scenario + Red Flags + Differential + Rubric (handled by OSCE Studio) |

Features:
- Timed vs Tutor mode
- Left strip question navigator with state colors
- Split-pane question + explanation view
- Progress tracking (localStorage)
- Results dashboard with score, percentile, distribution
- Image lightbox for content images

### Flashcard Studio
- Dedicated flashcard browser with folder-based deck navigation
- Spaced repetition scheduling (due-count badges on tree nodes)
- Front/back reveal with tap-to-flip
- Subdeck support for hierarchical card organization

### OSCE Studio
- Full-screen clinical OSCE simulator
- History-taking and data-interpretation station types
- AI-powered voice interaction with interruption handling
- Patient avatar with opening statement
- Hidden profile, red flags, differential, and rubric
- Scoring and evaluation

### Article Library (AMBOSS-style)
- Collapsible specialty tree TOC sidebar
- 9+ medical articles across Cardiology, Pulmonology, Neurology, Gastroenterology
- Articles rendered from Markdown (frontmatter metadata via `remark`/`rehype`)
- Article search via Ctrl+K with autocomplete
- Text highlighting with color palette + eraser tool
- Sticky notes
- Zoom controls (80%–140%)
- Bookmarks

### AI Assistant
- Gemini-powered study assistant (configurable model + API key)
- Context-aware answers based on current question/content
- Chat history with clear/reset
- Written answer grading via Gemini API (`grading.ts`)

### Lab Values & Calculator
- Quick-reference lab values by category (Chemistry, Hematology, ABG, Coagulation)
- Drag-and-drop floating calculator

### Profile & Settings
- Performance stats + engine breakdown
- 6 achievements (First Steps, Sharp Shooter, On Fire, Consistent, Determined, Marathon)
- Customizable keyboard shortcuts
- PWA install button
- Data management (clear progress)

### PWA Support
- Installable progressive web app with manifest + service worker
- Offline-capable service worker with auto-update
- Platform-aware install button (Android/iOS/desktop)

---

## Views

| View | Component | Description |
|---|---|---|
| Dashboard | `dashboard.tsx` | Greeting, continue-learning card, stat tiles, quick actions, featured articles, recent activity |
| Library | `library.tsx` | AMBOSS-style article reader with TOC sidebar, Markdown-rendered articles, bookmarks, highlighting |
| Q-Bank | `qbank-studio.tsx` | Unified engine UI — Create Test home, quiz player, results dashboard |
| Flashcards | `flashcard-studio.tsx` | Deck browser with spaced repetition, flip-to-reveal |
| OSCE | `osce-studio.tsx` | Full-screen clinical OSCE simulator |
| Profile | `profile.tsx` | Stats + engine breakdown + 6 achievements |
| Settings | `settings.tsx` | Theme, AI config, language, keyboard shortcuts, data management |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI Library | React 19 |
| Language | TypeScript 5 (strict, `noImplicitAny: false`) |
| Styling | Tailwind CSS 4 (`@theme inline` tokens, oklch colors) |
| Components | shadcn/ui (48 components) |
| Icons | lucide-react |
| Motion | framer-motion |
| Fonts | Geist Sans + Geist Mono + Cairo (via `next/font/google`) |
| i18n | Custom flat-dictionary system with en/ar + RTL support |
| Content | Markdown articles + JSON content packs in `/public/osler-content/` |
| Storage | localStorage (IndexedDB-ready schema) |
| AI | Gemini API (configurable model + key) |
| Markdown | unified + remark + rehype pipeline |

---

## Project Structure

```
src/
├── app/
│   ├── api/route.ts            # API route
│   ├── globals.css             # Design tokens + component styles
│   ├── layout.tsx              # Root layout with theme provider
│   └── page.tsx                # Entry — view routing + state
├── components/
│   ├── osler/                  # App-specific components
│   │   ├── app-shell.tsx       # Topbar-only shell with search, theme, user menu
│   │   ├── mobile-tab-bar.tsx  # Bottom nav (<768px)
│   │   ├── theme-provider.tsx  # Dark/light context
│   │   ├── i18n-provider.tsx   # UI language + RTL context
│   │   ├── login-screen.tsx    # Demo login
│   │   ├── dashboard.tsx       # Home view
│   │   ├── library.tsx         # Article reader with TOC
│   │   ├── qbank-studio.tsx    # Unified quiz engine (~3100 lines)
│   │   ├── flashcard-studio.tsx# Flashcard deck browser
│   │   ├── osce-studio.tsx     # OSCE clinical simulator
│   │   ├── ai-assistant.tsx    # Gemini chat panel
│   │   ├── profile.tsx         # Stats + achievements
│   │   ├── settings.tsx        # Config + shortcuts + data
│   │   ├── calculator.tsx      # Floating calculator
│   │   ├── lab-values.tsx      # Lab reference sidebar
│   │   ├── article-modal.tsx   # Floating article modal
│   │   ├── folder-tree-nav.tsx # Reusable tree navigation
│   │   ├── highlighted-content.tsx  # Text highlight renderer
│   │   ├── highlighter-toolbar.tsx  # Highlight color picker + eraser
│   │   ├── sticky-note.tsx     # Sticky note card
│   │   ├── lightbox-provider.tsx    # Image lightbox overlay
│   │   ├── pwa-install-button.tsx   # PWA install trigger
│   │   └── service-worker-registrar.tsx # SW registration
│   └── ui/                     # 48 shadcn/ui primitives
├── hooks/
│   ├── use-article-highlighter.ts  # Text highlight logic
│   ├── use-content-tree.ts         # Content tree loading + query
│   ├── use-gestures.ts             # Touch swipe/pinch/edge
│   ├── use-mobile.ts               # Mobile breakpoint detection
│   ├── use-platform.ts             # OS + form factor detection
│   ├── use-shortcuts.ts            # Keyboard shortcut bindings
│   └── use-toast.ts                # Toast notifications
└── lib/
    ├── osler/
    │   ├── types.ts             # TypeScript schemas (6 engine types + ContentLang)
    │   ├── i18n.ts              # UI dictionary (en/ar), translation helpers, RTL utils
    │   ├── content.ts           # Manifest + content pack loader
    │   ├── articles.ts          # Markdown article loader + search
    │   ├── storage.ts           # localStorage progress + highlights + review logs
    │   ├── shortcuts.ts         # Keyboard shortcut system
    │   ├── grading.ts           # Gemini-powered written answer grading
    │   ├── highlight-palette.ts # Color palette definitions
    │   └── article-highlights.ts# HTML highlight engine
    └── utils.ts                 # cn() helper (clsx + tailwind-merge)

public/
└── osler-content/               # Folder-based content structure
    ├── qbank/                   # Quiz, Bank, Written content
    │   ├── manifest.json
    │   ├── multisystem-quiz/    # Leaf node with questions.json
    │   ├── clinical-vignettes/  # Leaf node with passages.json
    │   ├── clinical-written/    # Leaf node with prompts.json
    │   └── arabic-clinical-quiz/
    ├── flashcard/               # Flashcard content
    │   ├── manifest.json
    │   └── medical-board-review/ # Branch node (subdecks)
    ├── osce/                    # OSCE stations
    │   ├── manifest.json
    │   └── clinical-skills/     # Leaf node with stations.json
    └── library/                 # Markdown articles
        ├── manifest.json
        ├── cardiology/
        ├── pulmonology/
        ├── neurology/
        ├── gastroenterology/
        └── arabic/

scripts/
├── generate-content-manifests.js  # Auto-generate per-category manifests
├── generate-articles.js           # Article build helpers
├── build-deliverable.sh           # Linux deployment
└── build-deliverable.ps1          # Windows deployment

tauri-admin/                       # Desktop admin panel (Tauri app)
```

---

## Setup

```bash
# Prerequisites: Node.js 22 (see .nvmrc)

npm install
npm run generate-manifests  # Generate content manifests after changes
npm run dev                 # http://localhost:3000
npm run build               # production build
npm run lint                # eslint
```

### Environment

No `.env` file is required for local development. The AI assistant requires a Gemini API key configured in Settings > AI Assistant.

---

## Content System

Content is organized into category folders under `public/osler-content/`:

| Folder | Types | File Format |
|---|---|---|
| `qbank/` | `quiz`, `bank`, `written` | JSON |
| `flashcard/` | `flashcard` | JSON |
| `osce/` | `osce` | JSON |
| `library/` | `library` | Markdown (.md) |

**Folder-based discovery**: Content packs are organized in a tree structure. Branch nodes (folders with subfolders) act as grouping decks. Leaf nodes (no subfolders) contain one or more `.json` data files whose arrays are merged on load. Manifest files (`manifest.json`) are auto-generated per category via `npm run generate-manifests` and must be re-run after adding/removing content.

**Type inheritance**: Content under `flashcard/` is auto-typed as `"flashcard"`; under `qbank/` types are auto-detected from JSON file keys (`questions` → `quiz`, `passages` → `bank`, `prompts` → `written`); `osce/` → `"osce"`.

**Articles**: Library articles are Markdown files with YAML frontmatter (title, specialty, system, tags, read time). They are rendered to HTML via `unified`/`remark`/`rehype` pipeline at runtime.

### Content loading API

- `loadCategoryTree(type)` — loads the tree for a category from `manifest.json`
- `loadNodeContent(node)` — fetches and merges all JSON files in a leaf node
- `loadAllContent()` — loads all content across all categories, returns `{ items, trees }`
- `loadContentByUid(uid)` — loads a single content pack by UID
- `flattenTree(node)` — flattens a tree node into an array of leaf nodes
- `useContentTree(options?)` — React hook wrapping `loadAllContent` with tree query helpers (collectLeafUids, mergeCards, nodeCardCount, nodeDueCount)

---

## Architecture Notes

### View Routing
The app uses a client-side view state (`OslerView` type in `app-shell.tsx`) rather than Next.js pages. All views live under a single route (`/`) and are toggled via the `AppShell` component.

Available views: `dashboard`, `library`, `qbank`, `flashcards`, `osce`, `profile`, `settings`.

### Unified QBank Studio
Quiz, Bank, and Written content types play through `QBankStudio.tsx`, which adapts its UI based on the content type. Flashcards and OSCE have their own dedicated studios (`FlashcardStudio`, `OsceStudio`).

### Theme System
Dark mode by default (navy + light blue — UWorld style). Light mode uses cream background with dark navy primary. Theme persists to `localStorage` under key `osler-theme`. Uses oklch color space in `globals.css` with `@theme inline` tokens.

### Progress Tracking
All progress is stored in `localStorage` under namespaced keys (`osler-progress-v1`, `osler-qbank-sessions-v1`, etc.). The `storage.ts` module provides a reactive subscribe pattern for real-time UI updates. Flashcard spaced repetition data is stored separately via `flashcardReview`.

### PWA
The app is fully installable. Service worker is registered in `ServiceWorkerRegistrar` and auto-updates on new builds. The `PwaInstallButton` component handles cross-platform install flows (Android Chrome, iOS Safari, desktop).

---

## License

MIT — same as upstream Osler.
