
<p align="center">
  <img alt="Osler Logo" src="public/assets/icon.svg" width="128" height="128">
</p>

<h1 align="center">Osler</h1>

<p align="center"><strong>Medical Study Platform</strong></p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#views"><strong>Views</strong></a> ·
  <a href="#tech-stack"><strong>Tech Stack</strong></a> ·
  <a href="#project-structure"><strong>Structure</strong></a> ·
  <a href="#setup"><strong>Setup</strong></a> ·
  <a href="#content-system"><strong>Content</strong></a> ·
  <a href="#configuration-oslerconfigjson"><strong>Config</strong></a> ·
  <a href="SELF-HOSTING.md"><strong>Self-Hosting</strong></a> ·
  <a href="docs/"><strong>Docs</strong></a> ·
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
  <img alt="License" src="https://img.shields.io/github/license/eyad-elghareeb/osler?style=flat-square&label=License&color=0ea5e9">
  <img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-Welcome-brightgreen?style=flat-square">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa">
  <img alt="i18n" src="https://img.shields.io/badge/i18n-EN%20%7C%20AR-10b981?style=flat-square">
</p>

<br>

Unified medical study platform combining **Quiz Banks**, **Flashcards**, **OSCE Clinical Cases**, **Video Library**, and an **Article Library** — all in a single, installable PWA with full Arabic RTL support.

> **🔗 Source:** <https://github.com/eyad-elghareeb/osler> · **License:** MIT · **Self-hosting guide:** [`SELF-HOSTING.md`](SELF-HOSTING.md) · **Full docs:** [`docs/`](docs/)
>
> Osler is fully open-source and built for self-hosting. Fork the repo, edit `public/osler.config.json` to white-label the platform, choose which of the 7 engine plugins to include, deploy to your favourite host, and manage everything from the bundled Tauri admin app. See [`SELF-HOSTING.md`](SELF-HOSTING.md) for the quick guide, or [`docs/`](docs/) for the complete documentation set (hosting, forking, security, admin guide, API reference, troubleshooting, and more).

---

## ✦ Features

<details open>
<summary><strong>📄 PDF Export Engine & Customizer</strong> — Export tests & articles</summary>

- Full PDF export engine powered by `jsPDF` v4 with multi-style layout support (Standard MCQ, Flashcard Notes, AMBOSS-style)
- Customizable export dialog (`pdf-export-dialog.tsx`) with page size (A4/Letter), single or two-column layout, score summary, and detailed review toggles
- High-fidelity typography with embedded Poppins, Lora, and Cairo (v31, all 8 weights) fonts
- Full Arabic RTL support using `bidi-js` for proper Bidirectional reordering and contextual shaping
- Hyperlinked Table of Contents and `KeepTogether` block layout protection to prevent split questions across page breaks
</details>

<details open>
<summary><strong>📖 Article Library</strong> — AMBOSS-style reader</summary>

- Collapsible specialty tree TOC sidebar
- 9+ medical articles across Cardiology, Pulmonology, Neurology, Gastroenterology
- Rendered from Markdown via `remark`/`rehype` pipeline
- Inline images (`images/` subfolder per article) and Mermaid diagrams with theme-aware rendering
- Inline & standalone PDF content, article printing (PDF/HTML export)
- Article search via Ctrl+K with autocomplete
- Text highlighting with color palette + eraser tool
- Sticky notes, bookmarks, zoom controls (80%–140%)
</details>

<details>
<summary><strong>🧠 QBank Studio</strong> — Unified quiz engine</summary>

The 7 engine types in Osler (`quiz`, `bank`, `flashcard`, `written`, `osce`, `library`, `video`) provide comprehensive coverage. QBank Studio unifies test and practice engines through a single interface:

| Engine | Description |
|--------|-------------|
| **Quiz** | Standard MCQ with 5 choices |
| **Bank** | Passage-based question sets |
| **Flashcard** | Front/back & cloze review (via Flashcard Studio) |
| **Written** | Short-answer prompt + rubric review + photo mode (camera capture, crop, Gemini OCR) |
| **OSCE** | Clinical stations + patient/hidden profile + rubric (via OSCE Studio) |
| **Library** | AMBOSS-style medical articles with specialty TOC |
| **Video** | Video lectures & clinical skills resources with custom player |

Key features: Timed/Tutor modes · Question navigator with state colors · Split-pane explanation with inline images & Markdown · Mixed quiz+written sessions · Written photo mode (camera capture & Gemini transcription) · Session auto-resume banner on Dashboard · Cross-pack pool builder · Results dashboard (score, percentile, distribution) · Tracker & review sessions (wrong/flagged, previous-session review) · Per-pack offline download · Image lightbox
</details>

<details>
<summary><strong>🃏 Flashcard Studio</strong> — Spaced repetition</summary>
- Folder-based deck navigation with due-count badges
- Tap-to-flip front/back reveal
- Anki-style support: images, Markdown, and cloze (`{{c1::answer}}`) cards with one review unit per cloze
- Anki export (`.txt` import files) for basic + cloze decks
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
- Written answer grading & handwritten photo OCR via Gemini API
</details>

<details>
<summary><strong>🔗 Progress Sync & Accounts</strong> — Cross-device & Cloud</summary>

Four transport & auth methods:

| Method | Technology | Scope |
|--------|------------|-------|
| **Cloud Backend** | Cloudflare Workers + D1 | Accounts (Email/Password, Google OAuth), roles (`student`/`admin`), PBKDF2 hashes, automated background sync |
| **Network** | WebRTC via PeerJS + MQTT relay | P2P device-to-device room sync |
| **QR Code** | Multi-part encoding with LZ-string + CRC32 | Instant offline camera scan |
| **File** | Download/import `.osler-backup` files | Manual JSON backup/restore |

Syncs progress, sessions, flashcard reviews, and notes. See [`docs/cloudflare-backend.md`](docs/cloudflare-backend.md) for Worker deployment steps.

The network panel surfaces live connection info from the **Network Information API** — Wi-Fi/cellular type, effective type (2g/3g/4g), downlink speed, RTT, and Data Saver flag — so users can immediately see whether peer-to-peer sync is likely to succeed.
</details>

<details open>
<summary><strong>📱 Native App Feel</strong> — PWA-grade UX</summary>

Osler is built to feel like a real native app, not a website. Six browser-native APIs are wired in through a typed wrapper library at `src/lib/osler/native/`:

| Feature | API | Where it shows up |
|---|---|---|
| **Slide transitions** | View Transitions API | Every view-level navigation in `app-shell.tsx` — forward/backward push animation with RTL-aware slide direction |
| **Biometric unlock** | WebAuthn | Login screen "Unlock with biometric" button (Face ID / Touch ID / Windows Hello), plus enrollment + disable in Settings |
| **Viewport for phones** | `viewport-fit: cover` + PWA meta tags | Layout extends under the notch; safe-area utilities handle insets; standalone mode when launched from home screen |
| **Vibration haptics** | Vibration API | Tab-bar taps, button presses, form submits, sync actions, video controls, error/success feedback (Android) |
| **Network info** | Network Information API | Live network badge in the sync panel showing Wi-Fi/cellular, effective type, downlink, RTT, Data Saver |
| **Screen wake lock** | Screen Wake Lock API | Auto-acquired while a video is playing; toggle button in the video player top bar |

Every feature is **feature-detected and degrades gracefully** — iOS Safari silently ignores vibration, Firefox falls back to instant transitions, older browsers skip biometric, etc. The app never breaks when an API is missing.
</details>

<br>

<p align="center">
  <b>Also includes:</b> PDF Export & Customizer · Lab Values reference · Floating Calculator · Notes System (Markdown editor) · 
  Quiz Reader Customization · Mermaid diagram explorer · 8 custom themes + visual theme selector · 
  PWA Install · Offline Content Cache (per-pack precache) · 6 Achievements
</p>

---

## ✦ Views

| View | Component | Description |
|------|-----------|-------------|
| 🏠 **Dashboard** | `dashboard.tsx` | Greeting, active-session resume banner, continue-learning, stat tiles, quick actions, featured articles, activity |
| 🎓 **Learn** | `learn.tsx` | Hub grouping Library, Flashcards, OSCE, and Videos — module grid with counts & continue badge |
| 📝 **Q-Bank** | `qbank-studio.tsx` | Unified engine — Create Test, quiz player, results dashboard, written photo mode, PDF export |
| 👤 **Profile** | `profile.tsx` | Stats, engine breakdown, achievements, notes |
| ⚙️ **Settings** | `settings.tsx` | Theme, AI, language, shortcuts, sync, downloads |

*Sub-views under Learn:* `library.tsx` · `flashcard-studio.tsx` · `osce-studio.tsx` · `videos-studio.tsx`

---

## ✦ Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **UI Library** | React 19 |
| **Language** | TypeScript 5 (strict, `noImplicitAny: false`) |
| **Styling** | Tailwind CSS 4 (`@theme inline` tokens, oklch colors) |
| **Components** | shadcn/ui (49 primitives) |
| **Icons** | lucide-react |
| **Motion** | framer-motion |
| **Fonts** | Geist Sans · Geist Mono · Cairo (`next/font/google`) · Poppins · Lora |
| **PDF Generation** | jsPDF v4 · bidi-js (Arabic BiDi & shaping) · Custom Embedded Fonts |
| **i18n** | Custom flat-dictionary system (en/ar) + RTL support |
| **Content** | Markdown articles + JSON content packs |
| **Storage** | IndexedDB (reactive `storage.ts` with in-memory cache) + localStorage (config cache, theme, UI lang) |
| **AI** | Gemini API (configurable model + key, OCR & grading) |
| **Markdown** | unified + remark + rehype + react-markdown + remark-gfm |
| **Video** | YouTube IFrame API + Plyr + Invidious |
| **Sync** | PeerJS (WebRTC) + MQTT relay + QR (LZ-string + CRC32) |
| **Native PWA** | Vibration API · View Transitions API · WebAuthn · Network Information API · Screen Wake Lock API |
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
├── <a href="src/app">app</a>/                     # Next.js App Router (path-based routes)
│   ├── api/                    # API routes (session, r2-fetch)
│   │   └── auth/session/route.ts  # Issues/verifies the osler-session cookie
│   ├── (app)/                  # Route group — protected app views
│   │   ├── page.tsx            # Dashboard entry (/)
│   │   ├── learn/  qbank/  library/  flashcards/  osce/  videos/  profile/  settings/
│   │   └── .../[uid]/          # Dynamic pack/article/video routes
│   ├── login/page.tsx          # Login gate
│   ├── globals.css             # Design tokens + component styles
│   └── layout.tsx              # Root layout with theme provider
├── <a href="src/components">components</a>/
│   ├── <a href="src/components/osler">osler</a>/                 # App-specific components
│   │   ├── app-shell.tsx      # Topbar shell with search, theme, user menu
│   │   ├── mobile-tab-bar.tsx # Bottom nav (&lt;768px)
│   │   ├── theme-provider.tsx # Dark/light context
│   │   ├── i18n-provider.tsx  # UI language + RTL context
│   │   ├── dashboard.tsx      # Home view + session resume banner
│   │   ├── learn.tsx          # Learn hub (Library/Flashcards/OSCE/Videos)
│   │   ├── library.tsx        # Article reader
│   │   ├── qbank-studio.tsx   # Unified quiz engine (~6190 lines)
│   │   ├── flashcard-studio.tsx
│   │   ├── osce-studio.tsx    # OSCE clinical simulator
│   │   ├── videos-studio.tsx  # Video library + player
│   │   ├── pdf-export-dialog.tsx # PDF export customization modal
│   │   ├── notes-panel.tsx    # Markdown notes editor
│   │   ├── ai-assistant.tsx   # Gemini chat panel
│   │   ├── profile.tsx        # Stats + achievements
│   │   ├── settings.tsx       # Config + shortcuts + sync
│   │   ├── calculator.tsx     # Floating calculator
│   │   ├── lab-values.tsx     # Lab reference sidebar
│   │   ├── sync/              # Sync setting panels
│   │   └── ...                # Utilities, overlays, providers
│   └── <a href="src/components/ui">ui</a>/                   # 49 shadcn/ui primitives
├── <a href="src/hooks">hooks</a>/                    # Shared React hooks
│   ├── use-article-highlighter.ts
│   ├── use-content-tree.ts
│   ├── use-content-cache.ts
│   ├── use-gestures.ts
│   ├── use-native.ts          # useNetworkInfo, useBiometricAvailability, useDocumentVisibility
│   ├── use-shortcuts.ts
│   └── ...
└── <a href="src/lib">lib</a>/
    ├── <a href="src/lib/osler">osler</a>/                 # Business logic
    │   ├── types.ts           # TypeScript schemas
    │   ├── i18n.ts            # UI dictionary (en/ar)
    │   ├── content.ts         # Manifest + content pack loader
    │   ├── articles.ts        # Markdown article loader
    │   ├── videos.ts          # Video content loader
    │   ├── storage.ts         # Progress + active session + highlights + notes
    │   ├── shortcuts.ts       # Keyboard shortcut system
    │   ├── grading.ts         # Gemini answer grading & photo OCR
    │   ├── pdf.ts             # PDF export engine (jsPDF + bidi-js layout)
    │   ├── arabic.ts          # Arabic BiDi reordering & letter shaping helper
    │   ├── pdf-fonts.ts       # Embedded Poppins, Lora, Cairo font loader
    │   ├── native/            # PWA native-feature wrappers
    │   │   ├── haptics.ts         # Vibration API
    │   │   ├── view-transitions.ts # View Transitions API
    │   │   ├── biometric.ts       # WebAuthn (Face ID / Touch ID)
    │   │   ├── network-info.ts    # Network Information API
    │   │   └── wake-lock.ts       # Screen Wake Lock API
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
  ├── build.rs                # Build-time GitHub OAuth secret injection
  ├── src/
  │   ├── commands.rs         # File CRUD, manifest, build/start runner, git
  │   ├── config.rs           # osler.config.json read/write + instance generator
  │   ├── deploy.rs           # Vercel / GitHub Pages / Cloudflare / Netlify deploy
  │   ├── github.rs           # GitHub OAuth & repo sync
  │   ├── manifest.rs         # Content manifest generator (port of scripts/)
  │   ├── runner.rs           # Build/start process runner
  │   └── validate.rs         # Content JSON validator
  ├── frontend/
  │   ├── index.html          # Admin shell (4 main sections: Dashboard, Content, Configure, Run & Publish)
  │   ├── main.js             # Tauri bridge + router + helpers
  │   ├── i18n.js             # English + Arabic strings
  │   ├── styles.css          # Admin theme tokens + components
  │   └── views/
  │       ├── dashboard.js    # Quick stats + recent activity + GitHub link
  │       ├── content.js      # Simplified content tree browser & editor
  │       ├── configure.js    # osler.config.json & instance generator hub
  │       ├── run-publish.js  # Build, start, git & deploy hub
  │       ├── wizard.js       # First-time setup wizard
  │       ├── instance.js     # Instance generator
  │       ├── config.js       # Config editor
  │       ├── start.js        # Server runner
  │       └── build.js        # Build runner & PDF preview tools
  └── default-osler-config.json  # Bundled template used by the instance generator
</pre>

---

## ✦ Setup

```bash
# Prerequisites: Node.js 22 (see .nvmrc)

npm install                    # Install dependencies
npm run generate-manifests     # Generate content manifests
npm run dev                    # Start dev → http://localhost:3000
npm run dev:full               # Frontend + Cloudflare Worker backend
npm run dev:worker             # Worker only on http://localhost:8787

npm run build                  # Production build
npm run lint                   # ESLint
```

> Environment templates available in `.env.example` (root) and `cloudflare/worker/.env.example` (backend). Gemini AI key configured in-app (Settings > AI Assistant).

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

## ✦ Configuration (`osler.config.json`)

Every aspect of an Osler instance is driven by a single user-editable config file at `public/osler.config.json`. The schema lives in [`src/lib/osler/config.ts`](src/lib/osler/config.ts); the loader merges the user's file over sensible defaults so the app always boots, even with a missing or partial config.

**What the config drives:**

| Section | Drives |
|---|---|---|
| `site.{name,shortName,tagline,githubRepo,organisation,supportEmail}` | `<title>`, OG/Twitter metadata, PWA manifest name, in-app brand mark, About section, admin sidebar link, support link |
| `engines.<id>.{enabled,label,singular,color,icon}` | **Plugin system** — toggle each of the 7 engines on/off; override label/singular/color/icon per engine |
| `themes.{default,custom[]}` | Default theme + custom oklch palettes with full token support (primary, primaryForeground, background, foreground, card, cardForeground, popover, popoverForeground, secondary, secondaryForeground, muted, mutedForeground, accent, destructive, border, input, ring, plus 9 sidebar* tokens); CSS variable overrides injected at runtime |
| `cloud.{enabled,apiUrl,turnstileSiteKey,syncQbank,syncFlashcards}` | Optional Cloudflare Worker accounts + cross-device progress sync |
| `defaults.{view,language,quiz,ai,sync}` | Default options applied on first use |
| `wizard.{completed,completedAt}` | First-time wizard state |

**Engine plugins:** Each of `quiz | bank | written | flashcard | osce | library | video` can be enabled or disabled. Disabling an engine hides it from the UI and skips its content loading — content packs on disk are preserved.

**Custom themes:** Define additional palettes beyond dark/light. Each entry has an `id`, `name`, `variant`, and optional oklch color overrides for all design tokens: `primary`, `primaryForeground`, `background`, `foreground`, `card`, `cardForeground`, `popover`, `popoverForeground`, `secondary`, `secondaryForeground`, `muted`, `mutedForeground`, `accent`, `destructive`, `border`, `input`, `ring`, plus 9 `sidebar*` tokens. The theme provider injects one CSS rule per custom theme scoped to `.theme-<id>`.

**GitHub repo reference:** The canonical repo URL is always surfaced — in the admin sidebar footer, on the admin dashboard, and in the in-app Settings → About section. Setting `site.githubRepo` in the config lets each instance point at its own fork.

### Tauri admin: wizard + instance generator

The Tauri admin app exposes three new views for managing the config:

| View | Purpose |
|---|---|
| **Setup Wizard** | 6-step first-time setup — site identity, GitHub repo, engine plugins, theme, language. Auto-launches when no `osler.config.json` exists. |
| **Instance Generator** | Scaffolds a brand-new Osler project into a target directory with a fresh config, content stubs, and a README. |
| **Config Editor** | Structured editor for every section of `osler.config.json`, with a raw-JSON tab for power users. |

The Rust backend (`tauri-admin/src/config.rs`) exposes `read_config`, `write_config`, `config_exists`, and `generate_instance` commands.

---

## ✦ Architecture

### View Routing
Path-based Next.js App Router routes (`/qbank/[uid]`, `/library/[article]`, `/settings/[section]`) replace the old query-param view state. `useOslerRouter()` / `routeFor()` in `src/lib/osler/navigation.ts` build the paths and drive haptic + View Transitions slide navigation. Route gating is client-side: `RouteGuard` (`src/components/osler/route-guard.tsx`) redirects unauthenticated users to `/login?next=<path>` with a validated `next` param. Sessions live in `sessionStorage` (bearer token) with a username hint in `localStorage`; there is no server middleware (static export).

**Views:** `dashboard`, `learn`, `library`, `qbank`, `flashcards`, `osce`, `videos`, `profile`, `settings` (see `VIEW_ORDER` in `navigation.ts`).

Library, Flashcards, OSCE, and Videos are sub-views under the **Learn** hub — the Learn tab stays highlighted while inside any sub-view (`LEARN_SUBVIEWS` set in `app-shell.tsx`).

### Unified QBank Studio
Quiz, Bank, Written → `QBankStudio.tsx` adapts UI per content type. Flashcards and OSCE have dedicated studios.

### Theme System
Dark mode default (navy + light blue — UWorld style). Light mode: cream background, dark navy primary. Persisted to `localStorage` (`osler-theme`). Uses oklch color space with `@theme inline` tokens.

### Progress Tracking
IndexedDB-backed reactive store with in-memory cache (`storage.ts`). Old `localStorage` keys (`osler-progress-v1`, `osler-qbank-sessions-v1`) are migrated to IndexedDB on first boot. Reactive subscribe pattern (`osler-progress-changed` events) for cross-component state updates. Flashcard spaced repetition stored separately.

### PWA
Fully installable. Service worker auto-updates on new builds. Cross-platform install flows (Android Chrome, iOS Safari, desktop).

**Native app feel** — once installed, Osler behaves like a real native app:
- **Slide transitions** between views via the View Transitions API (forward/backward push navigation, RTL-aware)
- **Biometric unlock** via WebAuthn (Face ID / Touch ID / Windows Hello) — skip the username field on returning sessions
- **Vibration haptics** on every meaningful tap (tab switches, button presses, form submits, sync actions)
- **Screen wake lock** while a video is playing so the screen doesn't auto-lock mid-lecture
- **Network Information API** surfaces live Wi-Fi/cellular type, effective type, downlink, RTT, and Data Saver state in the sync panel
- **Standalone mode** — `viewport-fit: cover` + safe-area utilities extend the layout under the notch; PWA meta tags hide the URL bar when launched from the home screen

All native features are wrapped in `src/lib/osler/native/` and feature-detect gracefully — the app never breaks when a browser doesn't support an API.

---

## ✦ License

<p align="center">
  <a href="LICENSE">
    <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-0ea5e9?style=for-the-badge">
  </a>
</p>

<p align="center">
  <a href="https://github.com/eyad-elghareeb/osler">github.com/eyad-elghareeb/osler</a> ·
  <a href="SELF-HOSTING.md">Self-hosting guide</a> ·
  <a href="docs/">Full documentation</a> ·
  <a href="docs/security.md">Security</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="AGENTS.md">Contributor guide</a>
</p>
