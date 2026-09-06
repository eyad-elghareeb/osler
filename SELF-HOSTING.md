# Self-Hosting Osler

Osler is fully open-source and designed to be self-hosted by anyone — a medical school, a residency program, a study group, or an individual educator. This guide walks you through starting a **complete instance from zero** (frontend + cloud backend + database), then white-labelling it, scaling it out, and keeping it up to date.

> **Source repository:** <https://github.com/eyad-elghareeb/osler> · **License:** MIT — see [LICENSE](./LICENSE)
>
> The deployment walkthrough in **§4** is the canonical step sequence — the Tauri admin app's Setup Wizard automates exactly these steps, and future automation builds on the same contract.

---

## 1. What you'll build

| Piece | Service | Free tier |
|---|---|---|
| **Frontend** — installable PWA | Cloudflare Pages | Unlimited requests |
| **Backend** — accounts, sync, admin API | Cloudflare Worker | 100k requests/day |
| **Database** — users, sessions, sync, telemetry | Cloudflare D1 | 500 MB/database |
| **Content storage** — managed content objects | Cloudflare R2 (optional) | 10 GB-month |

Everything runs comfortably on the free tier. The instance is local-first: students can use the app without an account, and the cloud backend only adds accounts + cross-device sync.

**Prerequisites:** Node.js 22 (`.nvmrc`), npm, Git, a [Cloudflare](https://dash.cloudflare.com/) account, and `npx wrangler login` once to authenticate the CLI.

---

## 2. Get the code

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/osler.git
cd osler
git remote add upstream https://github.com/eyad-elghareeb/osler.git
npm install
```

The `upstream` remote lets you pull updates from the canonical repo while keeping your customisations in your fork (see §8).

---

## 3. Configure your instance

Every white-label decision lives in **`public/osler.config.json`** (schema: [`src/lib/osler/config.ts`](src/lib/osler/config.ts); the loader merges your file over defaults, so a partial config always boots):

| Section | Drives |
|---|---|
| `site.{name,shortName,tagline,githubRepo,organisation,supportEmail,url}` | `<title>`, PWA manifest, brand mark, About section, social previews (`site.url` = your final https origin) |
| `engines.<id>.{enabled,label,singular,color,icon}` | **Plugin system** — toggle each of the 7 engines; per-engine overrides |
| `themes.{default,custom[]}` | Default theme + custom oklch palettes (all design tokens) |
| `cloud.{enabled,apiUrl,turnstileSiteKey,syncQbank,syncFlashcards}` | Cloud backend + cross-device sync — `cloud.apiUrl` is your Worker URL (set it in step 7 below) |
| `defaults.{view,language,quiz,ai,sync}` | Defaults applied on first use |

**Engine plugins are admin-controlled**: the instance admin decides which of `quiz | bank | written | flashcard | osce | library | video` ship; end users see read-only badges. Disabling an engine hides it and skips its content loading — nothing is deleted.

You can hand-edit the file, or use the Tauri admin's **Config Editor** / **Setup Wizard** (§5).

---

## 4. Deploy a full instance A → Z (Cloudflare, free tier)

Each step below lists its command, the files it touches, and how to verify it. Steps are ordered so the instance is never half-configured.

### Step 1 — Authenticate and pick your names

```bash
npx wrangler login         # opens the browser; authorize your Cloudflare account
```

Choose:
- **Pages project name** → your frontend URL becomes `https://<name>.pages.dev` (used in step 3 and step 8).
- The Worker name defaults to `osler-cloud` (`cloudflare/worker/wrangler.toml` → `name`) — rename it here if you deploy multiple instances; your backend URL becomes `https://<worker-name>.<account-subdomain>.workers.dev` (the subdomain is shown after the first deploy in step 5).

### Step 2 — Create the core database

```bash
cd cloudflare/worker
npx wrangler d1 create osler-cloud
```

Copy the returned `database_id` into `cloudflare/worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "osler-cloud"
database_id = "<paste-the-uuid-here>"
```

**Verify:** `npx wrangler d1 list` shows `osler-cloud`.

> R2 (optional, for the web-admin content workflow): `npx wrangler r2 bucket create osler-content` — the binding already exists in `wrangler.toml`. Skip it if you only ship static content packs; content-admin routes return 500 without it.

### Step 3 — Point the Worker at your frontend

In `cloudflare/worker/wrangler.toml` → `[vars]`:

```toml
ALLOWED_ORIGIN = "https://<name>.pages.dev"   # exact origin of your frontend
WORKER_URL      = "https://osler-cloud.<account-subdomain>.workers.dev"
```

`ALLOWED_ORIGIN` is enforced for CORS — a mismatch means every browser request fails. `WORKER_URL` backs Google OAuth callbacks and transactional email; set it now and correct the subdomain after the first deploy if needed.

### Step 4 — Set the Worker secrets

```bash
npx wrangler secret put JWT_SECRET        # REQUIRED — openssl rand -base64 32
```

Optional secrets (set later, each documented in [`docs/environment.md`](docs/environment.md)): `AUDIT_HMAC_KEY` (tamper-evident audit chain), `TURNSTILE_SECRET_KEY` (bot protection — then set `TURNSTILE_ENABLED = "true"` in `[vars]`), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google Sign-In), `RESEND_API_KEY` + `EMAIL_FROM` (transactional email), `GEMINI_ENCRYPTION_KEY` (encrypts users' stored Gemini keys), `CF_ANALYTICS_TOKEN` (live quota panel; add **D1 → Read** to that token for measured storage numbers).

### Step 5 — Apply migrations and deploy the Worker

```bash
npm run db:migrate      # applies migrations/*.sql to the core D1 database
npm run deploy          # deploys the Worker; prints its URL
```

**Verify:** `curl https://<worker-url>/v1/health` → `{"ok":true,...}`.

### Step 6 — Point the frontend at the Worker

In `public/osler.config.json`:

```jsonc
"cloud": {
  "enabled": true,
  "apiUrl": "https://osler-cloud.<account-subdomain>.workers.dev",
  "syncQbank": true,
  "syncFlashcards": true
}
```

`cloud.apiUrl` is the recommended way to set the backend URL (it wins over the `NEXT_PUBLIC_CLOUD_API_URL` env var and can be changed post-build via the Tauri admin without rebuilding).

### Step 7 — Build and deploy the frontend

```bash
npm run generate-manifests     # only needed after adding/removing content packs
npm run build                  # static export → out/
npx wrangler pages deploy out --project-name <name>
```

(Or edit the `deploy:pages` script in the root `package.json` to your project name and run `npm run deploy:pages`.)

**Verify:** open `https://<name>.pages.dev` — the app loads, and Settings → Sync shows the cloud backend as available.

### Step 8 — Create the first admin

Admin is **not** granted at registration. Register through the app (`/login` → create account), then promote yourself:

```bash
npx wrangler d1 execute osler-cloud --remote \
  --command "UPDATE users SET role = 'admin' WHERE username = '<your-username>' COLLATE NOCASE;"
```

**Verify:** reload the app — the admin panel appears in the navigation.

### Step 9 — Verify the whole stack

- [ ] `GET /v1/health` returns `ok`
- [ ] Register + login works (password reset email needs the optional Resend setup)
- [ ] Answer a quiz question with two devices / browsers signed into the same account — progress syncs (the second device pulls within seconds via the realtime hub)
- [ ] Admin → Analytics renders; the **Cloudflare Free Tier** panel shows your quotas

### Step 10 — Optional scale-out and integrations

- **D1 sharding (~2.5 GB sync pool)** — when sync data grows: `npm run db:shard` creates six sync shard databases + a telemetry database, migrates every user's rows into their shard, and activates the bindings; deploy again, then `npm run db:shard -- --prune`. Details: [`cloudflare/worker/README.md`](cloudflare/worker/README.md) → "D1 sharding". Uses 8 of the 10 free-tier database slots.
- **Turnstile, Google Sign-In, email, live quota panel** — each is a secret + a config flip; exact steps in [`docs/environment.md`](docs/environment.md) and [`docs/cloudflare-backend.md`](docs/cloudflare-backend.md).
- **Custom domain** — attach it to the Pages project, update `ALLOWED_ORIGIN` (step 3) + `site.url`, and redeploy both sides.

---

## 5. The Tauri admin suite (automates §3–§4)

The desktop app in [`tauri-admin/`](tauri-admin/) wraps the manual steps above into guided flows:

| App | What it does |
|---|---|
| **Osler Instance & Cloud Manager** (`instance-manager.html`) | 5-step instance generator (prerequisites → identity & engines → Cloudflare config → automated deployment → ready actions), prerequisites auto-installer, D1/R2/Pages/Worker provisioning, 1-click deploys, and an update engine with backups (`.osler-backup/`) |
| **Osler Content Studio** (`studio.html`) | CMS for question banks, flashcards, OSCE stations, written cases, and articles — WYSIWYG/Markdown editors, LaTeX, Mermaid, schema validation, Git workflows |

```bash
cd tauri-admin
cargo tauri dev      # development
cargo tauri build    # release installer
```

---

## 6. Themes

Beyond the built-in dark/light themes, `themes.custom[]` defines brand palettes. Each entry has `id`, `name`, `variant` (`"dark"` | `"light"`), and optional oklch overrides for every design token — core (`primary`, `background`, `foreground`, `accent`, `border`, `ring`, …), surfaces (`card`, `popover`, `secondary`, …), and the 9 `sidebar*` tokens. The provider injects one CSS rule per theme scoped to `.theme-<id>`, so existing `.dark`/`.light` checks keep working. See [`docs/hosting.md`](docs/hosting.md) for a filled-in example.

---

## 7. Adding content

Content lives in `public/osler-content/` in category folders:

```
public/osler-content/
├── qbank/           ← quiz / bank / written (JSON, type auto-detected from file keys)
├── flashcard/       ← flashcard (JSON)
├── osce/            ← osce (JSON)
├── library/         ← library (Markdown with YAML frontmatter)
└── videos/          ← video (JSON)
```

Branch folders group; leaf folders hold one or more merged JSON files. After adding or removing content:

```bash
npm run generate-manifests
```

Every pack can declare `lang: "en" | "ar"` so content renders RTL inside an English UI shell and vice versa. Full spec: [`AGENTS.md`](AGENTS.md) → "Content system".

---

## 8. Keeping your instance up to date

**Option A — Tauri Instance Updater (recommended):** open the Instance Manager → **Check for Updates**. It previews file diffs, snapshots your instance into `.osler-backup/`, merges core updates while protecting your content, branding, and secrets, and supports 1-click rollback.

**Option B — Git:**

```bash
git fetch upstream
git merge upstream/main
# resolve conflicts in osler.config.json (usually keep yours)
git push origin main
```

After pulling backend changes, re-run `npm run db:migrate` (and `npm run db:migrate:shards` if sharded) before redeploying the Worker. The `osler.config.json` schema is versioned; the loader migrates old configs forward automatically.

---

## 9. Branding checklist

- [ ] `site.name`, `site.shortName`, `site.tagline`, `site.githubRepo`, `site.organisation`, `site.url`
- [ ] Toggle `engines` to your audience's needs
- [ ] Add a custom theme in `themes.custom` with your brand colours
- [ ] Set `defaults.language.ui` to your audience's primary language
- [ ] Replace `public/assets/icon.svg`, `favicon.png`, and the PWA icons (`192`, `512`, maskable, apple-touch)
- [ ] (Optional) Edit `public/manifest.webmanifest`
- [ ] Add content under `public/osler-content/` + `npm run generate-manifests`
- [ ] Deploy (§4) and promote the first admin (§4 step 8)

---

## 10. Getting help

- **Source & issues:** <https://github.com/eyad-elghareeb/osler>
- **Full documentation:** [`docs/`](docs/) — hosting, deployment runbooks, security, admin guide, API reference, environment variables, troubleshooting
- **Worker internals & sharding:** [`cloudflare/worker/README.md`](cloudflare/worker/README.md)
- **Conventions:** [`AGENTS.md`](AGENTS.md)

Pull requests are welcome — please follow the conventions in `AGENTS.md`, especially the rule that every new English string lands with its Arabic translation in the same commit.
