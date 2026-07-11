
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://capsule-render.vercel.app/api?type=waving&color=0:1e3a5f,100:0ea5e9&height=200&section=header&text=Osler&fontSize=80&fontColor=fff&fontAlignY=35&desc=Medical%20Study%20Platform&descAlignY=55&descSize=20">
  <img alt="Osler Banner" src="https://capsule-render.vercel.app/api?type=waving&color=0:1e3a5f,100:0ea5e9&height=200&section=header&text=Osler&fontSize=80&fontColor=fff&fontAlignY=35&desc=Medical%20Study%20Platform&descAlignY=55&descSize=20">
</picture>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#views"><strong>Views</strong></a> ·
  <a href="#tech-stack"><strong>Tech Stack</strong></a> ·
  <a href="#project-structure"><strong>Structure</strong></a> ·
  <a href="#setup"><strong>Setup</strong></a> ·
  <a href="#content-system"><strong>Content</strong></a> ·
  <a href="#architecture"><strong>Architecture</strong></a>
</p>

<br>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=next.js&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript%205-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind%20CSS%204-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white">
  <img alt="shadcn/ui" src="https://img.shields.io/badge/shadcn/ui-000000?style=for-the-badge&logo=shadcnui&logoColor=white">
  <img alt="Framer" src="https://img.shields.io/badge/Framer%20Motion-0055FF?style=for-the-badge&logo=framer&logoColor=white">
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/github/license/anomalyco/osler?style=flat-square&label=License&color=0ea5e9">
  <img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-Welcome-brightgreen?style=flat-square">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa">
  <img alt="i18n" src="https://img.shields.io/badge/i18n-EN%20%7C%20AR-10b981?style=flat-square">
</p>

<br>

Unified medical study platform combining **Quiz Banks**, **Flashcards**, **OSCE Clinical Cases**, **Video Library**, and an **Article Library** — all in a single, installable PWA with full Arabic RTL support.

---

## ✦ Features

<details open>
<summary><strong>📖 Article Library</strong> — AMBOSS-style reader</summary>

- Collapsible specialty tree TOC sidebar
- 9+ medical articles across Cardiology, Pulmonology, Neurology, Gastroenterology
- Rendered from Markdown via `remark`/`rehype` pipeline
- Article search via Ctrl+K with autocomplete
- Text highlighting with color palette + eraser tool
- Sticky notes, bookmarks, zoom controls (80%–140%)
</details>

<details>
<summary><strong>🧠 QBank Studio</strong> — Unified quiz engine</summary>

All 5 engine types through a single interface:

| Engine | Description |
|--------|-------------|
| **Quiz** | Standard MCQ with 5 choices |
| **Bank** | Passage-based questions |
| **Flashcard** | Front/back reveal (via Flashcard Studio) |
| **Written** | Prompt + rubric review |
| **OSCE** | Scenario + Red Flags + Differential + Rubric (via OSCE Studio) |

Key features: Timed/Tutor modes · Question navigator with state colors · Split-pane explanation · Results dashboard (score, percentile, distribution) · Image lightbox
</details>

<details>
<summary><strong>🃏 Flashcard Studio</strong> — Spaced repetition</summary>
- Folder-based deck navigation with due-count badges
- Tap-to-flip front/back reveal
- Subdeck support for hierarchical organization
</details>

<details>
<summary><strong>🏥 OSCE Studio</strong> — Clinical simulator</summary>
- Full-screen OSCE with history-taking and data-interpretation stations
- AI-powered voice interaction with interruption handling
- Patient avatar, hidden profile, red flags, differential, rubric
- Scoring & evaluation
</details>

<details>
<summary><strong>🎬 Video Library</strong> — Watch & learn</summary>
- Folder-based browser with YouTube IFrame API + Plyr player
- Invidious alternative host support
- Playlist sidebar, chapter markers, search with debounce
- Related article linking, keyboard shortcuts, immersive mode
</details>

<details open>
<summary><strong>🌐 i18n & RTL</strong> — Full Arabic support</summary>

- Full Arabic (RTL) UI — flips shell, nav, settings
- English ↔ Arabic toggle in Settings > Language
- Per-content language filter: All / English / Arabic pills
- Content-language decoupled from UI-language
- Arabic content packs (quiz, flashcards, library articles)
- Cairo variable font · Logical CSS properties · Flash-free hydration
</details>

<details>
<summary><strong>🤖 AI Assistant</strong> — Gemini-powered</summary>
- Configurable model + API key
- Context-aware answers based on current question/content
- Chat history with clear/reset
- Written answer grading via Gemini API
</details>

<details>
<summary><strong>🔗 Progress Sync</strong> — Cross-device</summary>

Three transport methods:

| Method | Technology |
|--------|------------|
| **Network** | WebRTC via PeerJS + MQTT relay discovery, room-based |
| **QR Code** | Multi-part encoding with LZ-string + CRC32 checksum |
| **File** | Download/import `.osler-backup` files |

Syncs progress, sessions, flashcard reviews, and notes.
</details>

<br>

<p align="center">
  <b>Also includes:</b> Lab Values reference · Floating Calculator · Notes System (Markdown editor) · 
  Quiz Reader Customization · PWA Install · Offline Content Cache · 6 Achievements
</p>

---

## ✦ Views

| View | Component | Description |
|------|-----------|-------------|
| 🏠 **Dashboard** | `dashboard.tsx` | Greeting, continue-learning, stat tiles, quick actions, featured articles, activity |
| 📖 **Library** | `library.tsx` | Article reader with TOC sidebar, bookmarks, highlighting, sticky notes |
| 📝 **Q-Bank** | `qbank-studio.tsx` | Unified engine — Create Test, quiz player, results dashboard |
| 🃏 **Flashcards** | `flashcard-studio.tsx` | Deck browser with spaced repetition, flip-to-reveal |
| 🏥 **OSCE** | `osce-studio.tsx` | Full-screen clinical OSCE simulator |
| 🎬 **Videos** | `videos-studio.tsx` | Video browser + player with playlists, chapters |
| 👤 **Profile** | `profile.tsx` | Stats, engine breakdown, achievements, notes |
| ⚙️ **Settings** | `settings.tsx` | Theme, AI, language, shortcuts, sync, downloads |

---

## ✦ Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **UI Library** | React 19 |
| **Language** | TypeScript 5 (strict, `noImplicitAny: false`) |
| **Styling** | Tailwind CSS 4 (`@theme inline` tokens, oklch colors) |
| **Components** | shadcn/ui (48 primitives) |
| **Icons** | lucide-react |
| **Motion** | framer-motion |
| **Fonts** | Geist Sans · Geist Mono · Cairo (`next/font/google`) |
| **i18n** | Custom flat-dictionary system (en/ar) + RTL support |
| **Content** | Markdown articles + JSON content packs |
| **Storage** | localStorage (IndexedDB-ready schema) |
| **AI** | Gemini API (configurable model + key) |
| **Markdown** | unified + remark + rehype + react-markdown + remark-gfm |
| **Video** | YouTube IFrame API + Plyr + Invidious |
| **Sync** | PeerJS (WebRTC) + MQTT relay + QR (LZ-string + CRC32) |
| **Notifications** | sonner |
| **Tables** | @tanstack/react-table |
| **Carousel** | embla-carousel-react |
| **Drag & Drop** | @dnd-kit |
| **Validation** | zod |
| **QR** | html5-qrcode + qrcode |

---

## ✦ Project Structure

<pre>
src/
├── <a href="src/app">app</a>/                     # Next.js App Router
│   ├── api/route.ts           # API route
│   ├── globals.css            # Design tokens + component styles
│   ├── layout.tsx             # Root layout with theme provider
│   └── page.tsx               # Entry — view routing + state
├── <a href="src/components">components</a>/
│   ├── <a href="src/components/osler">osler</a>/                 # App-specific components
│   │   ├── app-shell.tsx      # Topbar shell with search, theme, user menu
│   │   ├── mobile-tab-bar.tsx # Bottom nav (&lt;768px)
│   │   ├── theme-provider.tsx # Dark/light context
│   │   ├── i18n-provider.tsx  # UI language + RTL context
│   │   ├── dashboard.tsx      # Home view
│   │   ├── library.tsx        # Article reader
│   │   ├── qbank-studio.tsx   # Unified quiz engine (~3100 lines)
│   │   ├── flashcard-studio.tsx
│   │   ├── osce-studio.tsx    # OSCE clinical simulator
│   │   ├── videos-studio.tsx  # Video library + player
│   │   ├── notes-panel.tsx    # Markdown notes editor
│   │   ├── ai-assistant.tsx   # Gemini chat panel
│   │   ├── profile.tsx        # Stats + achievements
│   │   ├── settings.tsx       # Config + shortcuts + sync
│   │   ├── calculator.tsx     # Floating calculator
│   │   ├── lab-values.tsx     # Lab reference sidebar
│   │   ├── sync/              # Sync setting panels
│   │   └── ...                # Utilities, overlays, providers
│   └── <a href="src/components/ui">ui</a>/                   # 48 shadcn/ui primitives
├── <a href="src/hooks">hooks</a>/                    # Shared React hooks
│   ├── use-article-highlighter.ts
│   ├── use-content-tree.ts
│   ├── use-content-cache.ts
│   ├── use-gestures.ts
│   ├── use-shortcuts.ts
│   └── ...
└── <a href="src/lib">lib</a>/
    ├── <a href="src/lib/osler">osler</a>/                 # Business logic
    │   ├── types.ts           # TypeScript schemas
    │   ├── i18n.ts            # UI dictionary (en/ar)
    │   ├── content.ts         # Manifest + content pack loader
    │   ├── articles.ts        # Markdown article loader
    │   ├── videos.ts          # Video content loader
    │   ├── storage.ts         # Progress + highlights + notes
    │   ├── shortcuts.ts       # Keyboard shortcut system
    │   ├── grading.ts         # Gemini answer grading
    │   └── sync/              # Cross-device sync
    └── utils.ts               # cn() helper

<a href="public">public</a>/
└── <a href="public/osler-content">osler-content</a>/            # Folder-based content
    ├── qbank/                 # Quiz, Bank, Written (JSON)
    ├── flashcard/             # Flashcard content (JSON)
    ├── osce/                  # OSCE stations (JSON)
    ├── library/               # Markdown articles (.md)
    └── videos/                # Video content (JSON)

<a href="scripts">scripts</a>/                      # Build tooling
├── generate-content-manifests.js
├── generate-articles.js
├── build-deliverable.sh      # Linux deployment
└── build-deliverable.ps1     # Windows deployment

<a href="tauri-admin">tauri-admin</a>/                  # Desktop admin panel (Tauri + Rust)
</pre>

---

## ✦ Setup

```bash
# Prerequisites: Node.js 22 (see .nvmrc)

npm install                    # Install dependencies
npm run generate-manifests     # Generate content manifests
npm run dev                    # Start dev → http://localhost:3000

npm run build                  # Production build
npm run lint                   # ESLint
```

> No `.env` file required. Gemini AI key configured in-app (Settings > AI Assistant).

---

## ✦ Content System

Content organized into category folders under `public/osler-content/`:

| Folder | Types | Format |
|--------|-------|--------|
| `qbank/` | `quiz`, `bank`, `written` | JSON |
| `flashcard/` | `flashcard` | JSON |
| `osce/` | `osce` | JSON |
| `library/` | `library` | Markdown (.md) |
| `videos/` | `video` | JSON |

**Folder-based discovery** — Branch nodes (folders with subfolders) act as grouping decks. Leaf nodes contain one or more `.json` data files merged on load. Manifests auto-generated via `npm run generate-manifests`.

**Type inheritance** — `flashcard/` → auto-typed `"flashcard"`. Under `qbank/`, types detected from JSON keys: `questions` → `quiz`, `passages` → `bank`, `prompts` → `written`.

**Articles** — Markdown with YAML frontmatter (title, specialty, system, tags, read time), rendered via `unified`/`remark`/`rehype`.

### Loading API

| Function | Description |
|----------|-------------|
| `loadCategoryTree(type)` | Loads tree for a category from `manifest.json` |
| `loadNodeContent(node)` | Fetches + merges all JSON files in a leaf node |
| `loadAllContent()` | Loads all content across categories → `{ items, trees }` |
| `loadContentByUid(uid)` | Loads single content pack by UID |
| `flattenTree(node)` | Flattens tree into leaf node array |
| `useContentTree(options?)` | React hook with tree query helpers |

---

## ✦ Architecture

### View Routing
Client-side view state (`OslerView` in `app-shell.tsx`) rather than Next.js pages. All views under a single route (`/`), toggled via `AppShell`.

**Available views:** `dashboard`, `library`, `qbank`, `flashcards`, `osce`, `videos`, `profile`, `settings`.

### Unified QBank Studio
Quiz, Bank, Written → `QBankStudio.tsx` adapts UI per content type. Flashcards and OSCE have dedicated studios.

### Theme System
Dark mode default (navy + light blue — UWorld style). Light mode: cream background, dark navy primary. Persisted to `localStorage` (`osler-theme`). Uses oklch color space with `@theme inline` tokens.

### Progress Tracking
Namespaced `localStorage` keys (`osler-progress-v1`, `osler-qbank-sessions-v1`). Reactive subscribe pattern via `storage.ts`. Flashcard spaced repetition stored separately.

### PWA
Fully installable. Service worker auto-updates on new builds. Cross-platform install flows (Android Chrome, iOS Safari, desktop).

---

## ✦ License

<p align="center">
  <a href="LICENSE">
    <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-0ea5e9?style=for-the-badge">
  </a>
</p>
