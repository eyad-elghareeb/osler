# Osler — Medical Study Platform

> Quiz, Question Bank, Flashcards, Written Prompts, and OSCE clinical cases — unified in a single medical study platform. Rebased on MedOS Lite UI/UX.

**Stack:** Next.js 16 · React 19 · TypeScript 5 · Tailwind CSS 4 · shadcn/ui · Framer Motion

---

## Features

### Topbar-only AppShell
- Logo + horizontal nav with animated active indicator
- Center search pill (Ctrl+K) with article autocomplete
- Theme toggle (dark/light, persists to localStorage)
- User menu with avatar + dropdown (Profile / Settings / Sign out)
- Mobile bottom tab bar (<768px)

### QBank Studio — Unified Quiz Engine
All 5 engine types play through the same interface:

| Engine | Description |
|---|---|
| **Quiz** | Standard MCQ with 5 choices |
| **Bank** | Passage-based questions |
| **Flashcard** | Front/back reveal |
| **Written** | Prompt + rubric review |
| **OSCE** | Scenario + Red Flags + Differential + Rubric |

Features:
- Timed vs Tutor mode
- Left strip question navigator with state colors
- Split-pane question + explanation view
- Progress tracking (localStorage)
- Results dashboard with score, percentile, distribution

### Article Library (AMBOSS-style)
- Collapsible specialty tree TOC sidebar
- 9 sample medical articles across Cardiology, Pulmonology, Neurology, Gastroenterology
- Rich HTML rendering with zoom controls (80%–140%)
- Bookmarks + search integration
- Text highlighting + sticky notes

### AI Assistant
- Gemini-powered study assistant (configurable model + API key)
- Context-aware answers based on current question/content
- Chat history with clear/reset

### Lab Values & Calculator
- Quick-reference lab values by category (Chemistry, Hematology, ABG, Coagulation)
- Drag-and-drop floating calculator

### Profile & Settings
- Performance stats + engine breakdown
- 6 achievements (First Steps, Sharp Shooter, On Fire, Consistent, Determined, Marathon)
- Customizable keyboard shortcuts
- Data management (clear progress)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI Library | React 19 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 (`@theme inline` tokens) |
| Components | shadcn/ui (48 components) |
| Icons | lucide-react |
| Motion | framer-motion |
| Fonts | Geist Sans + Geist Mono (via `next/font/google`) |
| Content | JSON-based content packs in `/public/osler-content/` |
| Storage | localStorage (IndexedDB-ready schema) |
| AI | Gemini API (configurable model + key) |

---

## Project Structure

```
src/
├── app/
│   ├── api/route.ts            # API route (Hello World)
│   ├── globals.css             # Design tokens + component styles
│   ├── layout.tsx              # Root layout with theme provider
│   └── page.tsx                # Entry — view routing + state
├── components/
│   ├── osler/                  # App-specific components
│   │   ├── app-shell.tsx       # Topbar-only shell
│   │   ├── dashboard.tsx       # Home view
│   │   ├── library.tsx         # Article reader
│   │   ├── qbank-studio.tsx    # Unified QBank Studio (~3100 lines)
│   │   ├── ai-assistant.tsx    # Gemini chat panel
│   │   ├── article-modal.tsx   # Floating article modal
│   │   ├── profile.tsx         # Stats + achievements
│   │   ├── settings.tsx        # AI config + shortcuts + data
│   │   ├── login-screen.tsx    # Demo login
│   │   ├── mobile-tab-bar.tsx  # Bottom nav (mobile)
│   │   ├── theme-provider.tsx  # Dark/light context
│   │   ├── calculator.tsx      # Floating calculator
│   │   ├── lab-values.tsx      # Lab reference sidebar
│   │   ├── highlighted-content.tsx  # Text highlight renderer
│   │   ├── highlighter-toolbar.tsx  # Highlight color picker
│   │   └── sticky-note.tsx     # Sticky note card
│   └── ui/                     # 48 shadcn/ui primitives
├── hooks/
│   ├── use-article-highlighter.ts  # Text highlight logic
│   ├── use-gestures.ts             # Touch swipe/pinch/edge
│   ├── use-mobile.ts               # Mobile breakpoint detection
│   ├── use-platform.ts             # OS + form factor detection
│   └── use-shortcuts.ts            # Keyboard shortcut bindings
└── lib/
    ├── osler/
    │   ├── types.ts             # TypeScript schemas (5 content types)
    │   ├── content.ts           # Manifest + content pack loader
    │   ├── articles.ts          # 9 sample articles + TOC + search
    │   ├── storage.ts           # localStorage progress + highlights
    │   ├── shortcuts.ts         # Keyboard shortcut system
    │   └── article-highlights.ts # HTML highlight engine
    └── utils.ts                 # cn() helper (clsx + tailwind-merge)

public/
└── osler-content/               # 5 sample content packs
    ├── manifest.json
    ├── sample-quiz.json
    ├── sample-bank.json
    ├── sample-flashcard.json
    ├── sample-written.json
    └── sample-osce.json
```

---

## Setup

```bash
# Prerequisites: Node.js 22 (see .nvmrc)

npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint       # eslint
```

### Environment

No `.env` file is required for local development. The AI assistant requires a Gemini API key configured in Settings > AI Assistant.

---

## Content Packs

Content is served from `/public/osler-content/` as static JSON files. Each pack follows a typed schema defined in `src/lib/osler/types.ts`. The manifest (`manifest.json`) registers all available packs.

To add custom content:
1. Create a new JSON file in `public/osler-content/`
2. Add an entry to `manifest.json`
3. Restart the dev server

---

## Architecture Notes

### View Routing
The app uses a client-side view state (`OslerView` type) rather than Next.js pages. All views live under a single route (`/`) and are toggled via the `AppShell` component.

### Content Types
```typescript
type EngineType = "quiz" | "bank" | "flashcard" | "written" | "osce";
```

### Unified QBank Studio
All 5 engine types render through `QBankStudio.tsx`, which detects the content type at runtime and adapts its UI. This replaced the previous pattern of separate engine components.

### Theme System
Dark mode by default (navy + light blue — UWorld style). Light mode uses cream background with dark navy primary. Theme persists to `localStorage` under key `osler-theme`.

### Progress Tracking
All progress is stored in `localStorage` under namespaced keys (`osler-progress-v1`, `osler-qbank-sessions-v1`, etc.). The `storage.ts` module provides a reactive subscribe pattern for real-time UI updates.

---

## License

Same as upstream Osler. See `OSLER_REBASE_README.md` for the rebase history and `PATCH_NOTES_REBASE.md` for the v2 UI overhaul changelog.
