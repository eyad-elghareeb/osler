# Forking Osler

Osler is fully open-source (MIT) and designed to be forked, white-labelled, and re-deployed by anyone — a medical school, a residency program, a study group, an individual educator, or a commercial vendor. This guide walks you through the complete fork-and-customise workflow, with emphasis on **staying in sync with upstream** so you can pull in security fixes and new features without losing your customisations.

> **Source repository:** <https://github.com/eyad-elghareeb/osler>
> **License:** MIT — see [LICENSE](../LICENSE).
> **Related guides:** [`hosting.md`](./hosting.md) · [`deployment.md`](./deployment.md) · [`admin-guide.md`](./admin-guide.md)

---

## Table of Contents

1. [Why fork?](#1-why-fork)
2. [Forking the repo](#2-forking-the-repo)
3. [The single source of truth: `osler.config.json`](#3-the-single-source-of-truth-oslerconfigjson)
4. [White-labelling checklist](#4-white-labelling-checklist)
5. [Keeping your fork in sync with upstream](#5-keeping-your-fork-in-sync-with-upstream)
6. [Resolving common merge conflicts](#6-resolving-common-merge-conflicts)
7. [Customising beyond config](#7-customising-beyond-config)
8. [Contributing back upstream](#8-contributing-back-upstream)
9. [License & attribution](#9-license--attribution)

---

## 1. Why fork?

Forking (rather than just starring or cloning) gives you:

- **Your own GitHub repo** to push changes to.
- **A clean `upstream` remote** pointing at the canonical repo, so you can pull security fixes and new features without losing your customisations.
- **Independent issue tracker & CI** for your instance.
- **The ability to make pull requests back upstream** if you fix a bug or add a feature others would benefit from.

You don't need to fork if you just want to deploy a stock instance — in that case, see [`hosting.md`](./hosting.md) and clone directly.

---

## 2. Forking the repo

### Step 1: Fork on GitHub

Visit <https://github.com/eyad-elghareeb/osler> and click **Fork** in the top-right. Choose your personal account or an organisation you own.

### Step 2: Clone your fork and add upstream

```bash
git clone https://github.com/<your-username>/osler.git
cd osler
git remote add upstream https://github.com/eyad-elghareeb/osler.git
git remote -v
# origin    https://github.com/<your-username>/osler.git (fetch)
# origin    https://github.com/<your-username>/osler.git (push)
# upstream  https://github.com/eyad-elghareeb/osler.git (fetch)
# upstream  https://github.com/eyad-elghareeb/osler.git (push)
```

### Step 3: Create a customisation branch

Reserve `main` for tracking upstream. Do your customisations on a separate branch:

```bash
git checkout -b my-school
# Or, more conventional:
git checkout -b customisations
```

This makes upstream merges trivially clean — `main` always matches upstream, and `customisations` carries only your diffs.

### Step 4: Install dependencies and run

```bash
nvm use                 # uses Node 22 from .nvmrc
npm install
npm run generate-manifests
npm run dev             # → http://localhost:3000
```

---

## 3. The single source of truth: `osler.config.json`

Every white-label decision lives in **`public/osler.config.json`**. The schema is in [`src/lib/osler/config.ts`](../src/lib/osler/config.ts); the loader merges your file over sensible defaults so the app always boots.

```jsonc
{
  "schemaVersion": 1,
  "site": {
    "name": "My Medical School",
    "shortName": "MMS",
    "tagline": "Personalised study platform",
    "githubRepo": "https://github.com/your-org/your-osler",
    "organisation": "Your Organisation",
    "supportEmail": "admin@yourschool.edu"
  },
  "engines": {
    "quiz":      { "enabled": true  },
    "bank":      { "enabled": true  },
    "written":   { "enabled": false },
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
        "primary":    "oklch(0.45 0.18 260)",
        "background": "oklch(0.13 0.02 260)",
        "foreground": "oklch(0.96 0.01 260)"
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
|---|---|
| `site.{name,shortName,tagline,githubRepo,organisation,supportEmail}` | `<title>`, OG/Twitter metadata, PWA manifest name, in-app brand mark, in-app About section, admin sidebar link, support link |
| `engines.<id>.{enabled,label,singular,color,icon}` | **Plugin system** — toggle each of the 7 engines on/off; optional per-engine label/singular/color/icon overrides |
| `themes.{default,custom[]}` | Default theme + custom oklch palettes with full token support |
| `cloud.{enabled,apiUrl,turnstileSiteKey,syncQbank,syncFlashcards}` | Optional Cloudflare Worker accounts + cross-device progress sync |
| `defaults.{view,language,quiz,ai,sync}` | Default options applied on first use |
| `wizard.{completed,completedAt}` | First-time wizard state |

### Editing the config

You have three options, in order of convenience:

1. **Tauri admin app** — Run the admin (see `tauri-admin/README.md`) and use the **Config Editor** view for a structured form, or the **Setup Wizard** for a 6-step first-time flow.
2. **Hand-edit** — Open `public/osler.config.json` in any editor, save, reload the app.
3. **Instance generator** — Use the admin's **New Instance** view to scaffold a brand-new project folder with a fresh config + content stubs + README.

---

## 4. White-labelling checklist

Going from a fresh fork to a fully white-labelled instance:

### Branding & identity

- [ ] Edit `public/osler.config.json` → `site.name`, `site.shortName`, `site.tagline`, `site.githubRepo` (your fork URL), `site.organisation`, `site.supportEmail`
- [ ] Replace `public/assets/favicon.png`, `icon.svg`, and the `public/assets/icons/*` PWA icons with your own (sizes: 192, 512, maskable-192, maskable-512, apple-touch-icon, 1024)
- [ ] (Optional) Replace the brand mark SVG in `src/components/osler/app-shell.tsx` (look for the `<Activity>` lucide icon in the header)
- [ ] (Optional) Edit `public/manifest.webmanifest` to match your brand

### Theme

- [ ] Add at least one custom theme in `themes.custom` with your brand colours
- [ ] Set `themes.default` to your custom theme id

### Engines

- [ ] Toggle engines in `engines` to match what your audience needs
- [ ] (Optional) Override per-engine `label` / `singular` / `color` / `icon`

### Language

- [ ] Set `defaults.language.ui` to your audience's primary language (`en` or `ar`)
- [ ] Set `defaults.language.content` to `all`, `en`, or `ar`
- [ ] (Optional) Translate new strings in `src/lib/osler/i18n/en.ts` and `ar.ts` — keep both files in sync per the i18n rule in `AGENTS.md`

### Content

- [ ] Remove or replace the demo content under `public/osler-content/`
- [ ] Add your own content packs (see `AGENTS.md` → "Content system" for the spec)
- [ ] Run `npm run generate-manifests` (or use the admin's Manifest view → Regenerate)

### Cloud backend (optional)

- [ ] Decide whether you need accounts / sync / admin content management
- [ ] If yes: deploy the Cloudflare Worker (see [`hosting.md`](./hosting.md))
- [ ] Set `cloud.enabled = true` and `cloud.apiUrl` in `osler.config.json`
- [ ] Promote your first user to `admin` role via D1 SQL

### Deploy

- [ ] Choose a hosting option from [`hosting.md`](./hosting.md)
- [ ] Run through the [post-deploy verification checklist](./hosting.md#10-post-deploy-verification-checklist)

---

## 5. Keeping your fork in sync with upstream

### The recommended workflow

```bash
# 1. Fetch upstream changes
git fetch upstream

# 2. Update your local main to match upstream
git checkout main
git merge --ff-only upstream/main
git push origin main

# 3. Rebase your customisations branch on top
git checkout customisations
git rebase main
# Resolve any conflicts (usually just osler.config.json — keep yours)

# 4. Force-push your rebased branch
git push --force-with-lease origin customisations

# 5. Deploy
npm ci                            # in case deps changed
npm run build
# Re-apply migrations if any
cd cloudflare/worker && npm run db:migrate && npm run deploy && cd ../..
# Re-deploy the frontend
```

### Alternative: merge instead of rebase

If you prefer a non-linear history (easier to revert individual upstream commits if they break something):

```bash
git checkout customisations
git merge main
git push origin customisations
```

### How often should I sync?

- **Weekly to monthly** for active development forks — keeps conflict surface small.
- **Immediately** when a security advisory is published (see [`SECURITY.md`](../SECURITY.md) and GitHub Advisories).

### Pinning to a release

If you want stability over features, pin to a specific tag instead of `main`:

```bash
# In your customisations branch:
git merge upstream/tags/v1.2.0
# Or for a clean pin:
git reset --hard upstream/tags/v1.2.0
```

Check [`CHANGELOG.md`](../CHANGELOG.md) for release notes and breaking changes.

---

## 6. Resolving common merge conflicts

### `public/osler.config.json`

This is the most common conflict. The rule is simple: **always keep yours**.

```bash
git checkout --ours public/osler.config.json
git add public/osler.config.json
git rebase --continue
```

The `schemaVersion` field lets the loader migrate old configs forward, so even if upstream bumps the schema, your old config will keep working.

### `package-lock.json` / `bun.lock`

These are auto-generated. Accept theirs and re-resolve:

```bash
git checkout --theirs package-lock.json bun.lock
npm install
git add package-lock.json bun.lock
```

### `src/lib/osler/i18n/en.ts` and `ar.ts`

If you added custom strings AND upstream added new strings in the same area:

1. Open both files.
2. Keep your custom strings.
3. Add any new upstream strings (with their Arabic translations — see `AGENTS.md` i18n rule).
4. Save and `git add`.

### `cloudflare/worker/migrations/`

Never edit existing migration files. If upstream adds a new migration (e.g. `0005_*.sql`), it will apply cleanly on top of yours. If you need to add your own migration, use a high prefix like `9001_my_customisation.sql` to avoid conflicts.

### `cloudflare/worker/src/index.mjs`

If you've made local changes to the worker (not recommended — better to fork the worker into a separate repo), conflicts will be painful. The recommended approach is to keep your customisations in `osler.config.json` only, and treat the worker as upstream-controlled.

---

## 7. Customising beyond config

If config alone isn't enough, you have several extension points:

### Adding a new engine plugin

See `AGENTS.md` → "Adding a new engine". The pattern is:

1. Add the engine id to `EngineType` in `src/lib/osler/types.ts`.
2. Add an entry to `ENGINE_META` in `src/lib/osler/content.ts`.
3. Add a content folder under `public/osler-content/<your-engine>/`.
4. Add a component for the engine in `src/components/osler/`.
5. Wire it into `learn.tsx` and `app-shell.tsx`.

### Customising the AI assistant

The AI assistant uses Gemini by default. To use a different provider, edit `src/lib/osler/grading.ts` and `src/components/osler/ai-assistant.tsx`. The API key is user-configurable in Settings → AI Assistant (each user brings their own key).

### Adding a new sync transport

The sync system is pluggable. Existing transports: Cloudflare Worker, Network (WebRTC), QR, File. To add a new transport, implement the interface in `src/lib/osler/sync/sync-protocol.ts` and register it in `src/lib/osler/sync/index.ts`.

### Forking the Tauri admin

The admin app at `tauri-admin/` is a separate Rust + HTML/JS project. If you want to bundle custom commands or change the UI significantly, fork it as a sibling repo and adjust the build paths.

---

## 8. Contributing back upstream

If you fix a bug or add a feature that would benefit other instances:

1. Open an issue first to discuss the change (avoids wasted work on PRs that won't be accepted).
2. Fork upstream (not your customised fork) into a clean branch.
3. Make your changes following the conventions in `AGENTS.md`:
   - Every new English string must land alongside its Arabic translation in the same commit.
   - Every new file must have a header comment explaining its purpose.
   - No `any` types unless explicitly justified.
4. Open a pull request against `upstream/main`.
4. Respond to review feedback.

Bug fixes and security fixes are prioritised. Feature additions may take longer to review.

---

## 9. License & attribution

Osler is MIT-licensed. You are free to:

- **Use** it commercially or non-commercially.
- **Modify** it without restriction.
- **Distribute** it, including in closed-source deployments.
- **Sublicense** it under different terms.

The only requirement is that the original copyright notice and license text be included in all copies or substantial portions of the software. See [LICENSE](../LICENSE) for the full text.

### Recommended (but not required) attribution

Even though MIT doesn't require it, leaving the "Source" link in the admin sidebar footer and the `site.githubRepo` reference in Settings → About helps other educators discover Osler. If you remove these, consider mentioning Osler somewhere in your project's README or About page.

### Privacy & data protection

If your fork handles personal data (student emails, progress data, etc.), you are responsible for compliance with your local data protection laws (GDPR, FERPA, HIPAA, PIPL, etc.). See [`security.md`](./security.md) for the security model and recommendations. The upstream maintainers are not responsible for how forks handle data.
