# Self-Hosting Osler

Osler is fully open-source and designed to be self-hosted by anyone — a medical school, a residency program, a study group, or an individual educator. This guide walks you through forking the repo, white-labelling the platform, choosing which engines to include, deploying, and managing your instance with the Tauri admin app.

> **Source repository:** <https://github.com/eyad-elghareeb/osler>
>
> **License:** MIT — see [LICENSE](./LICENSE).

---

## 1. Fork & clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/osler.git
cd osler
git remote add upstream https://github.com/eyad-elghareeb/osler.git
```

Keeping the `upstream` remote lets you pull in feature updates and bug fixes from the canonical repo while keeping your customisations in your fork.

---

## 2. The single source of truth: `osler.config.json`

Every white-label decision lives in **`public/osler.config.json`**. The schema is in [`src/lib/osler/config.ts`](src/lib/osler/config.ts); the loader merges your file over sensible defaults so the app always boots.

```jsonc
{
  "schemaVersion": 1,
  "site": {
    "name": "My Medical School",          // shown in header, login, <title>, PWA manifest
    "shortName": "MMS",                   // mobile home-screen label
    "tagline": "Personalised study platform",
    "githubRepo": "https://github.com/your-org/your-osler",
    "organisation": "Your Organisation",
    "supportEmail": "admin@yourschool.edu"
  },
  "engines": {
    "quiz":      { "enabled": true  },
    "bank":      { "enabled": true  },
    "written":   { "enabled": false },   // ← disabled engines disappear entirely
    "flashcard": { "enabled": true  },
    "osce":      { "enabled": true  },
    "library":   { "enabled": true  },
    "video":     { "enabled": false }
  },
  "themes": {
    "default": "dark",
    "custom": [
      {
        "id": "school-navy",
        "name": "School Navy",
        "variant": "dark",
        "primary":      "oklch(0.45 0.18 260)",
        "background":   "oklch(0.13 0.02 260)",
        "foreground":   "oklch(0.96 0.01 260)"
      }
    ]
  },
  "defaults": {
    "view": "dashboard",
    "language": { "ui": "en", "content": "all" },
    "quiz":     { "questionCount": 20, "secondsPerQuestion": 90, "tutorMode": false, "shuffle": true },
    "ai":       { "model": "gemini-2.5-flash", "enabled": true, "temperature": 0.4 },
    "sync":     { "method": "network", "defaultRoom": "mms-2026" }
  },
  "cloud": {
    "enabled": false,
    "apiUrl": "",
    "syncQbank": true,
    "syncFlashcards": true
  },
  "wizard": { "completed": true, "version": 1 }
}
```

### What each section drives

| Section | Drives |
|---|---|---|
| `site.{name,shortName,tagline,githubRepo,organisation,supportEmail}` | `<title>`, OG/Twitter metadata, PWA manifest name, in-app brand mark, in-app About section, admin sidebar link, support link |
| `engines.<id>.{enabled,label,singular,color,icon}` | **Plugin system** — toggle each of the 7 engines on/off; optional per-engine label/singular/color/icon overrides |
| `themes.{default,custom[]}` | Default theme + custom oklch palettes with full token support (primary, primaryForeground, background, foreground, card, cardForeground, popover, popoverForeground, secondary, secondaryForeground, muted, mutedForeground, accent, destructive, border, input, ring, plus 9 sidebar* tokens); CSS variable overrides injected at runtime |
| `cloud.{enabled,apiUrl,turnstileSiteKey,syncQbank,syncFlashcards}` | Optional Cloudflare Worker accounts + cross-device progress sync |
| `defaults.{view,language,quiz,ai,sync}` | Default options applied on first use |
| `wizard.{completed,completedAt}` | First-time wizard state |

### Editing the config

You have three options, in order of convenience:

1. **Tauri admin app** — Run the admin (see §4 below) and use the **Config Editor** view for a structured form, or the **Setup Wizard** for a 6-step first-time flow.
2. **Hand-edit** — Open `public/osler.config.json` in any editor, save, reload the app.
3. **Instance generator** — Use the admin's **New Instance** view to scaffold a brand-new project folder with a fresh config + content stubs + README.

---

## 3. Engine plugins (admin-only)

The 7 engine types are each treated as a toggleable plugin:

| Engine | Content folder | What it does |
|---|---|---|
| `quiz` | `public/osler-content/qbank/` | Standard MCQ quizzes with 5 choices |
| `bank` | `public/osler-content/qbank/` | Passage-based questions (shares folder with `quiz`) |
| `written` | `public/osler-content/qbank/` | Free-text prompts with rubric review (shares folder) |
| `flashcard` | `public/osler-content/flashcard/` | Spaced-repetition decks with subdecks |
| `osce` | `public/osler-content/osce/` | Clinical OSCE simulator with AI voice |
| `library` | `public/osler-content/library/` | Markdown article reader with highlighting |
| `video` | `public/osler-content/videos/` | Video library with YouTube / mp4 / HLS |

### ⚠️ Plugins are admin-controlled, not user-controlled

End users of your hosted instance **cannot** toggle plugins on or off. The decision of which engines to include is made by the instance admin (you) via `osler.config.json` and applies to every user of the instance. The in-app Settings → About section shows the enabled plugins as read-only badges with an explicit "Admin-controlled" tag.

Disabling an engine:
- Hides its module from the Learn hub (`learn.tsx` filters `ALL_MODULES` by `isEngineEnabled`).
- Skips its category in `loadAllContent()` / `loadContentByUid()` — content is never fetched from disk.
- **Does NOT delete content on disk** — re-enabling the engine brings it back.

### Per-engine overrides

Each engine entry accepts optional overrides that take precedence over the built-in `ENGINE_META`:

```jsonc
"engines": {
  "quiz": {
    "enabled": true,
    "label": "Weekly Quiz",       // overrides "Quiz"
    "singular": "Quiz",
    "color": "oklch(0.55 0.20 16)",  // overrides default oklch
    "icon": "clipboard-list"          // overrides default lucide icon name
  }
}
```

Read these via `getEngineMeta(type)` from `@/lib/osler/content`.

---

## 4. The Tauri admin app

The admin app is a separate Tauri (Rust + HTML/JS) desktop application that lives in [`tauri-admin/`](tauri-admin/). It binds to a project root (your Osler folder) and lets you:

- Edit content files in `public/osler-content/` with a tree browser + JSON / Markdown editors
- Regenerate content manifests
- Run `npm run build` / `npm run start` with live log streaming
- Git add / commit / push / pull against your remote
- Deploy to Vercel / GitHub Pages / Cloudflare (Pages + Worker full stack) / Netlify
- **Read & write `osler.config.json`** with a structured editor (the Config view)
- **Run the first-time setup wizard** (auto-launches on first bind if no config exists)
- **Generate brand-new Osler instances** into a target directory

### Running the admin

```bash
cd tauri-admin
cargo tauri dev     # development
cargo tauri build   # produce a distributable installer
```

The admin's frontend is plain HTML/JS (no build step) — open `tauri-admin/frontend/index.html` directly in a browser to preview the UI without Tauri (it falls back to a mock backend).

### Three new admin views

| View | Purpose |
|---|---|
| **Setup Wizard** (`views/wizard.js`) | 6-step first-time setup: site identity → GitHub repo → engine plugins → theme → language → review. Auto-launches when no `osler.config.json` exists. |
| **Instance Generator** (`views/instance.js`) | Scaffolds a brand-new Osler project into a target directory with a fresh config, content stubs, optional sample content, and a README. |
| **Config Editor** (`views/config.js`) | Structured editor for every section of `osler.config.json` with 5 tabs: Site / Engines / Themes / Defaults / Raw JSON. |

---

## 5. Custom themes

Beyond the built-in `dark` and `light` themes, you can define any number of custom palettes in `themes.custom[]`. Each entry has:

- `id` — stable identifier used in the `data-theme` attribute and the theme switcher
- `name` — display name
- `variant` — `"dark"` or `"light"` (controls base background/foreground defaults; also drives any code that checks `.dark` / `.light` such as Mermaid)
- Optional oklch color overrides for all design tokens:
  - Core: `primary`, `primaryForeground`, `background`, `foreground`, `accent`, `muted`, `mutedForeground`, `destructive`, `border`, `input`, `ring`
  - Surfaces: `card`, `cardForeground`, `popover`, `popoverForeground`, `secondary`, `secondaryForeground`
  - Sidebar: `sidebar`, `sidebarForeground`, `sidebarPrimary`, `sidebarPrimaryForeground`, `sidebarAccent`, `sidebarAccentForeground`, `sidebarBorder`, `sidebarRing`

The theme provider injects a single `<style id="osler-custom-themes">` block into `<head>` with one rule per custom theme, scoped to `.theme-<id>`. Switching to a custom theme adds both `.theme-<id>` and the variant class to `<html>` so existing `.dark` / `.light` checks keep working.

```jsonc
"themes": {
  "default": "school-navy",
  "custom": [
    {
      "id": "school-navy",
      "name": "School Navy",
      "variant": "dark",
      "primary":    "oklch(0.45 0.18 260)",
      "primaryForeground": "oklch(0.99 0 0)",
      "accent":     "oklch(0.55 0.15 250)",
      "background": "oklch(0.13 0.02 260)",
      "foreground": "oklch(0.96 0.01 260)",
      "card":       "oklch(0.19 0.022 260)",
      "cardForeground": "oklch(0.96 0.01 260)",
      "popover":    "oklch(0.19 0.022 260)",
      "popoverForeground": "oklch(0.96 0.01 260)",
      "secondary":  "oklch(0.26 0.025 260)",
      "secondaryForeground": "oklch(0.96 0.01 260)",
      "muted":      "oklch(0.24 0.02 260)",
      "mutedForeground": "oklch(0.7 0.015 240)",
      "destructive":"oklch(0.68 0.21 22)",
      "border":     "oklch(1 0 0 / 8%)",
      "input":      "oklch(1 0 0 / 10%)",
      "ring":       "oklch(0.45 0.18 260)",
      "sidebar":    "oklch(0.17 0.02 260)",
      "sidebarForeground": "oklch(0.96 0.01 260)",
      "sidebarPrimary": "oklch(0.45 0.18 260)",
      "sidebarPrimaryForeground": "oklch(0.99 0 0)",
      "sidebarAccent": "oklch(0.26 0.025 260)",
      "sidebarAccentForeground": "oklch(0.96 0.01 260)",
      "sidebarBorder": "oklch(1 0 0 / 6%)",
      "sidebarRing": "oklch(0.45 0.18 260)"
    },
    {
      "id": "clinic-light",
      "name": "Clinic Light",
      "variant": "light",
      "primary":    "oklch(0.35 0.10 255)",
      "primaryForeground": "oklch(0.99 0 0)",
      "accent":     "oklch(0.65 0.12 250)",
      "background": "oklch(0.99 0.005 240)",
      "foreground": "oklch(0.18 0.02 250)",
      "card":       "oklch(1 0 0)",
      "cardForeground": "oklch(0.18 0.02 250)",
      "popover":    "oklch(1 0 0)",
      "popoverForeground": "oklch(0.18 0.02 250)",
      "secondary":  "oklch(0.95 0.01 240)",
      "secondaryForeground": "oklch(0.2 0.02 250)",
      "muted":      "oklch(0.95 0.01 240)",
      "mutedForeground": "oklch(0.5 0.015 240)",
      "destructive":"oklch(0.58 0.24 27)",
      "border":     "oklch(0.9 0.01 240)",
      "input":      "oklch(0.9 0.01 240)",
      "ring":       "oklch(0.38 0.09 255)",
      "sidebar":    "oklch(0.97 0.005 240)",
      "sidebarForeground": "oklch(0.18 0.02 250)",
      "sidebarPrimary": "oklch(0.35 0.10 255)",
      "sidebarPrimaryForeground": "oklch(0.99 0 0)",
      "sidebarAccent": "oklch(0.92 0.025 240)",
      "sidebarAccentForeground": "oklch(0.2 0.02 250)",
      "sidebarBorder": "oklch(0.9 0.01 240)",
      "sidebarRing": "oklch(0.38 0.09 255)"
    }
  ]
}
```

End users can switch between any of the built-in + custom themes from the in-app theme toggle (top-right). The choice is persisted to `localStorage`.

---

## 6. Adding content

Content lives in `public/osler-content/` in category folders. See [`AGENTS.md`](AGENTS.md) → "Content system" for the full spec; the short version:

```
public/osler-content/
├── qbank/           ← quiz / bank / written (JSON, type auto-detected from file keys)
│   └── cardiology/
│       └── arrhythmias/
│           └── questions.json
├── flashcard/       ← flashcard (JSON)
├── osce/            ← osce (JSON)
├── library/         ← library (Markdown with YAML frontmatter)
└── videos/          ← video (JSON)
```

After adding or removing content, regenerate manifests:

```bash
npm run generate-manifests
```

Or use the admin's **Manifest** view → "Regenerate" button.

### Per-pack language

Every content pack can declare `lang: "en" | "ar"` on its manifest node and/or its `ContentMeta`. The renderer wraps the content body in the appropriate `dir`/`lang` container so an Arabic article renders RTL even inside an English UI shell.

---

## 7. Deployment

Osler is a standard Next.js 16 standalone app. The build produces `.next/standalone/` which you run with `node .next/standalone/server.js`.

### Quick deploy options

| Target | How |
|---|---|
| **Vercel** | Connect your GitHub fork → new project → deploy. No config needed. |
| **GitHub Pages** | Use the admin's Deploy view → GitHub Pages provider. |
| **Cloudflare Pages** | Admin's Deploy view → Cloudflare Pages provider. |
| **Netlify** | Admin's Deploy view → Netlify provider. |
| **Self-hosted (VPS)** | `npm run build` → copy `.next/standalone/` + `.next/static/` + `public/` to the server → `node server.js` behind a Caddy/nginx reverse proxy. A sample [`Caddyfile`](Caddyfile) is included. |

See [`scripts/build-deliverable.sh`](scripts/build-deliverable.sh) (Linux) and [`scripts/build-deliverable.ps1`](scripts/build-deliverable.ps1) (Windows) for a packaged-deploy helper.

### Environment variables

Only one optional env var:

- `NEXT_PUBLIC_INVIDIOUS_HOST` — alternate host for the YouTube video facade (privacy-friendly YouTube alternative). If unset, the standard YouTube IFrame API is used.

The Gemini AI key is configured in-app (Settings → AI Assistant), not via env, so each user can bring their own.

---

## 8. Keeping your fork in sync

```bash
git fetch upstream
git merge upstream/main           # or rebase if you prefer a linear history
# Resolve any conflicts in osler.config.json (usually just keep yours)
git push origin main
```

The `osler.config.json` schema is versioned (`schemaVersion`). Breaking changes to the schema will bump the version and the loader will migrate old configs forward automatically.

---

## 9. Branding checklist

Going from a fresh fork to a fully white-labelled instance:

- [ ] Edit `public/osler.config.json` → `site.name`, `site.shortName`, `site.tagline`, `site.githubRepo` (your fork URL), `site.organisation`
- [ ] Toggle engines in `engines` to match what your audience needs
- [ ] Add at least one custom theme in `themes.custom` with your brand colours
- [ ] Set `defaults.language.ui` to your audience's primary language
- [ ] Replace `public/assets/favicon.png`, `icon.svg`, and the `public/assets/icons/*` PWA icons with your own (sizes: 192, 512, maskable-192, maskable-512, apple-touch-icon)
- [ ] (Optional) Replace the brand mark SVG in `src/components/osler/app-shell.tsx` (look for the `<Activity>` lucide icon in the header)
- [ ] (Optional) Edit `public/manifest.webmanifest` to match your brand
- [ ] Add your content under `public/osler-content/` and run `npm run generate-manifests`
- [ ] Deploy (see §7)

---

## 10. Getting help

- **Source & issues:** <https://github.com/eyad-elghareeb/osler>
- **Architecture & conventions:** [`AGENTS.md`](AGENTS.md)
- **Main README:** [`README.md`](README.md)

Pull requests are welcome. Please follow the conventions in `AGENTS.md` — especially the i18n rule that every new English string must land alongside its Arabic translation in the same commit.
