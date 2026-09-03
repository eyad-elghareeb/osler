# Environment & configuration reference

This is the complete reference for every environment variable, secret, config file, and hardcoded constant in the Osler stack — frontend (Next.js), Cloudflare Worker backend, Tauri admin app, the `osler.config.json` runtime config, and the `wrangler.toml` Worker manifest.

If you're looking for a quick start, see [`hosting.md`](./hosting.md). For the security model around these values, see [`security.md`](./security.md). This document is the source of truth for "what does this knob do, what's the default, and where do I set it".

> **Related guides:** [`hosting.md`](./hosting.md) · [`cloudflare-backend.md`](./cloudflare-backend.md) · [`security.md`](./security.md) · [`troubleshooting.md`](./troubleshooting.md)

---

## Table of Contents

1. [Frontend (Next.js) environment variables](#1-frontend-nextjs-environment-variables)
2. [Cloudflare Worker environment variables & secrets](#2-cloudflare-worker-environment-variables--secrets)
3. [Tauri admin environment variables](#3-tauri-admin-environment-variables)
4. [`osler.config.json` schema reference](#4-oslerconfigjson-schema-reference)
5. [`wrangler.toml` configuration reference](#5-wranglertoml-configuration-reference)
6. [Hardcoded constants in the Worker](#6-hardcoded-constants-in-the-worker)
7. [How to set secrets](#7-how-to-set-secrets)
8. [Configuration precedence](#8-configuration-precedence)
9. [Validation rules](#9-validation-rules)
10. [Quick-reference cheat sheet](#10-quick-reference-cheat-sheet)

---

## 1. Frontend (Next.js) environment variables

The frontend is a Next.js static export (`output: "export"`). Variables prefixed `NEXT_PUBLIC_` are inlined into the client bundle at build time, so they're readable by anyone with the deployed JavaScript — never put a secret in a `NEXT_PUBLIC_` variable.

The canonical template lives at `.env.example` in the repo root. Copy it to `.env.local` for local overrides.

### 1.1 `NEXT_PUBLIC_INVIDIOUS_HOST`

| | |
| --- | --- |
| **Required** | No |
| **Default** | `invidious.tiekoetter.com` |
| **Description** | Hostname of an Invidious instance used as an alternative YouTube frontend for the "pipe via alternative host" button in the video player. Used when YouTube is slow or blocked in a region. |
| **Example** | `NEXT_PUBLIC_INVIDIOUS_HOST=invidious.snopyta.org` |
| **Where to set** | Root `.env.local` (local dev), or the Pages/Vercel/Dashboard environment variable (production). Bundled at build time via the `NEXT_PUBLIC_` prefix. |

> Public Invidious instances rotate frequently and may go offline. The default `invidious.tiekoetter.com` was selected for stability, but operators in restricted regions should run their own Invidious instance and point this variable at it.

### 1.2 `NEXT_PUBLIC_CLOUD_API_URL`

| | |
| --- | --- |
| **Required** | Only if `cloud.enabled = true` in `osler.config.json` and `cloud.apiUrl` is not set there |
| **Default** | _(empty)_ |
| **Description** | Absolute base URL of the deployed Cloudflare Worker backend, e.g. `https://osler-cloud.example.workers.dev`. The frontend uses this to call `/v1/auth/*`, `/v1/sync/*`, and `/v1/admin/*`. |
| **Example** | `NEXT_PUBLIC_CLOUD_API_URL=https://osler-cloud.example.workers.dev` |
| **Where to set** | Root `.env.local` (local dev), or hosting-provider environment variable (production). |

> **Precedence:** If both `NEXT_PUBLIC_CLOUD_API_URL` and `cloud.apiUrl` (in `osler.config.json`) are set, the value in `osler.config.json` wins (see [§8](#8-configuration-precedence)). The recommended approach is to use `osler.config.json` only — it's editable post-build via the Tauri admin without a rebuild.

### 1.3 `OSLER_SESSION_SECRET`

> **Removed in v0.3.** Osler is a static export (`output: "export"`) — there is no server runtime, so there is no `osler-session` cookie, no middleware, and no server-side session secret. Route gating is client-side (`RouteGuard`), and the security boundary is the Worker (bearer token in `sessionStorage`, sent as `Authorization` on every request). This variable is no longer read by the app; any existing value can be ignored/removed.

### 1.4 Other build-time knobs (not in `.env.example`)

These are not exposed as `.env.example` entries but are honoured by Next.js when set:

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Standard Node env. `production` enables optimisations; `development` enables React devtools. | `development` |
| `NEXT_TELEMETRY_DISABLED` | Set to `1` to disable Next.js telemetry. | _(unset — telemetry on)_ |

---

## 2. Cloudflare Worker environment variables & secrets

The Worker reads configuration from three places, in order of precedence:

1. **Secrets** — set via `wrangler secret put` or the Cloudflare dashboard. Encrypted at rest, never appear in `wrangler.toml`. Used for anything sensitive.
2. **`[vars]` block in `wrangler.toml`** — non-sensitive runtime config. Committed to git. Used for `ALLOWED_ORIGIN`, `WORKER_URL`, `TURNSTILE_ENABLED`, `APP_ORIGIN`, `EMAIL_FROM`.
3. **Bindings (`[[d1_databases]]`, `[[r2_buckets]]`)** — declarative in `wrangler.toml`. Used for D1 and R2 access.

The canonical templates are `cloudflare/worker/.env.example` (documentation reference) and `cloudflare/worker/.dev.vars.example` (template for local dev). For local `wrangler dev`, copy the latter to `.dev.vars`.

> **Naming caveat:** Wrangler normalises secret/variable names to uppercase on the Worker side (`env.JWT_SECRET`, `env.ALLOWED_ORIGIN`). Names are case-sensitive in your code — always reference them as uppercase.

### 2.1 Required variables

#### 2.1.1 `JWT_SECRET`

| | |
| --- | --- |
| **Required** | **Yes** |
| **Default** | _(none — Worker returns 500 on every auth request without it)_ |
| **Description** | HMAC-SHA-256 signing key for session tokens. Must be a long, random, unguessable string. Used to sign and verify all session tokens; rotating it invalidates every active session. |
| **Example** | `JWT_SECRET=v3RYs3cret-and-long-base64-string-48-bytes-or-more` |
| **Where to set** | **Secret** (never in `wrangler.toml`): `npx wrangler secret put JWT_SECRET` (production), or `.dev.vars` (local dev). |

**Generate a secure value:**

```bash
openssl rand -base64 48
```

**Rotation:** If you must rotate `JWT_SECRET`, all active sessions become unverifiable and users will be signed out on their next request. They can simply sign in again. There is no recovery mechanism for "validating old tokens against the previous secret" — by design, secrets are stateless.

#### 2.1.2 `ALLOWED_ORIGIN`

| | |
| --- | --- |
| **Required** | **Yes** |
| **Default** | `http://localhost:3000` (in `wrangler.toml` — must change for production) |
| **Description** | Exact origin of the Osler web app, for CORS. Must be the scheme + host + port the browser uses. **Single origin only** — multiple origins are not supported. An empty `Origin` header (server-to-server, curl) is treated as allowed so the Worker can be tested locally. |
| **Example** | `ALLOWED_ORIGIN = "https://your-app.pages.dev"` |
| **Where to set** | `[vars]` block in `wrangler.toml`. Requires redeploy. |

Common pitfalls:
- `https://app.example.com` and `https://app.example.com:443` are **different** origins to the CORS spec (the port is implicit but must match what the browser sends).
- `https://app.example.com/` (trailing slash) does **not** match `https://app.example.com`. Omit the trailing slash.
- `https://www.example.com` and `https://example.com` are different origins. Pick one and redirect the other to it.

#### 2.1.3 `WORKER_URL`

| | |
| --- | --- |
| **Required** | **Yes** (for Google Sign-In; otherwise optional but recommended) |
| **Default** | `http://localhost:8787` (in `wrangler.toml` — must change for production) |
| **Description** | Public URL of the deployed Worker. Used to construct Google OAuth redirect URIs (`<WORKER_URL>/v1/auth/google/callback`) and other self-referencing links. |
| **Example** | `WORKER_URL = "https://osler-cloud.example.workers.dev"` |
| **Where to set** | `[vars]` block in `wrangler.toml`. |

> This must match the URL Google Cloud Console has registered as an authorized redirect URI, character-for-character. A mismatch causes an `invalid_redirect_uri` error from Google.

### 2.2 Optional variables

#### 2.2.1 `TURNSTILE_ENABLED`

| | |
| --- | --- |
| **Required** | No |
| **Default** | `"false"` (string in `wrangler.toml`) |
| **Description** | Set to the string `"true"` to enable Cloudflare Turnstile verification on the register, login, and password-reset endpoints. When enabled, every auth request must include a `turnstileToken` field that the Worker validates against the Turnstile siteverify API. |
| **Example** | `TURNSTILE_ENABLED = "true"` |
| **Where to set** | `[vars]` block in `wrangler.toml`. |

> Wrangler `[vars]` are always strings. `TURNSTILE_ENABLED = "false"` (with quotes) is correct; `TURNSTILE_ENABLED = false` (no quotes) will be coerced to the string `"false"` and the Worker treats that as disabled.

#### 2.2.2 `TURNSTILE_SECRET_KEY`

| | |
| --- | --- |
| **Required** | Only if `TURNSTILE_ENABLED = "true"` |
| **Default** | _(none)_ |
| **Description** | Cloudflare Turnstile secret key (starts with `0x`). Used to verify captcha tokens server-side via the siteverify API. |
| **Example** | `TURNSTILE_SECRET_KEY=0xAAAAAAA...` |
| **Where to set** | **Secret**: `npx wrangler secret put TURNSTILE_SECRET_KEY`, or `.dev.vars` for local dev. |

You must **also** publish the corresponding site key in `osler.config.json` → `cloud.turnstileSiteKey` so the frontend can render the widget. See [§4.5](#45-cloud).

#### 2.2.3 `RESEND_API_KEY`

| | |
| --- | --- |
| **Required** | Only to enable password-reset emails |
| **Default** | _(none)_ |
| **Description** | Resend.com API key (starts with `re_`). Used to send transactional password-reset emails via Resend's REST API. When unset, the `/v1/auth/reset/request` endpoint still returns `{ok:true}` (to prevent email enumeration) but no email is actually sent. |
| **Example** | `RESEND_API_KEY=re_abc123...` |
| **Where to set** | **Secret**: `npx wrangler secret put RESEND_API_KEY`, or `.dev.vars` for local dev. |

> **Resend free tier:** 100 emails/day, 3000/month. Adequate for password resets at a small school. For higher volume, upgrade or swap in a different provider (you'll need to fork the Worker — see `sendResetEmail()` in `src/index.ts`).

#### 2.2.4 `EMAIL_FROM`

| | |
| --- | --- |
| **Required** | Only if `RESEND_API_KEY` is set |
| **Default** | `Osler <noreply@example.com>` (in `.env.example` — must change for production) |
| **Description** | `From:` header for password-reset emails. Must be an address on a domain you've verified with Resend, or `onboarding@resend.dev` (the Resend onboarding address, which can only send to your own account email). |
| **Example** | `EMAIL_FROM=Osler <noreply@your-domain.com>` |
| **Where to set** | `[vars]` block in `wrangler.toml`. |

#### 2.2.5 `APP_ORIGIN`

| | |
| --- | --- |
| **Required** | Only if `RESEND_API_KEY` is set |
| **Default** | `http://localhost:3000` (in `.env.example` — must change for production) |
| **Description** | Public URL of the Osler web app, used to construct password-reset links. The reset email contains a link of the form `<APP_ORIGIN>/reset?token=...`. Must be the URL users will actually visit (typically the same as `ALLOWED_ORIGIN`). |
| **Example** | `APP_ORIGIN = "https://your-app.pages.dev"` |
| **Where to set** | `[vars]` block in `wrangler.toml`. |

#### 2.2.6 `GOOGLE_CLIENT_ID`

| | |
| --- | --- |
| **Required** | Only to enable Google Sign-In |
| **Default** | _(none)_ |
| **Description** | Google OAuth 2.0 Client ID (Web Application type, from Google Cloud Console → APIs & Services → Credentials). Used to verify the ID token returned by Google after the OAuth callback. |
| **Example** | `GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com` |
| **Where to set** | **Secret**: `npx wrangler secret put GOOGLE_CLIENT_ID`, or `.dev.vars` for local dev. |

In Google Cloud Console, configure:
- Application type: **Web application**
- Authorized JavaScript origins: `ALLOWED_ORIGIN`
- Authorized redirect URIs: `<WORKER_URL>/v1/auth/google/callback`

#### 2.2.7 `GOOGLE_CLIENT_SECRET`

| | |
| --- | --- |
| **Required** | Only to enable Google Sign-In |
| **Default** | _(none)_ |
| **Description** | Google OAuth 2.0 Client Secret (paired with `GOOGLE_CLIENT_ID`). Used to exchange the OAuth code for tokens during the server-side callback. |
| **Example** | `GOOGLE_CLIENT_SECRET=GOCSPX-abc123...` |
| **Where to set** | **Secret**: `npx wrangler secret put GOOGLE_CLIENT_SECRET`, or `.dev.vars` for local dev. |

> **Security:** Never commit the secret to git. Never put it in `wrangler.toml`. Use `wrangler secret put` exclusively.

### 2.3 Quick reference — all Worker variables

| Variable | Required | Set via | Default in `wrangler.toml` / `.env.example` |
| --- | --- | --- | --- |
| `JWT_SECRET` | Yes | Secret | _(none — must generate)_ |
| `ALLOWED_ORIGIN` | Yes | `[vars]` | `http://localhost:3000` |
| `WORKER_URL` | Yes (for Google OAuth) | `[vars]` | `http://localhost:8787` |
| `TURNSTILE_ENABLED` | No | `[vars]` | `"false"` |
| `TURNSTILE_SECRET_KEY` | If Turnstile on | Secret | _(none)_ |
| `RESEND_API_KEY` | For password reset | Secret | _(none)_ |
| `EMAIL_FROM` | For password reset | `[vars]` | `Osler <noreply@example.com>` |
| `APP_ORIGIN` | For password reset | `[vars]` | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | For Google Sign-In | Secret | _(none)_ |
| `GOOGLE_CLIENT_SECRET` | For Google Sign-In | Secret | _(none)_ |

---

## 3. Tauri admin environment variables

The Tauri admin app is a Rust desktop binary with a webview frontend. It reads build-time configuration from `tauri-admin/.env.example`. The two values it consumes are **build-time only** — they're baked into the binary at compile time via `tauri-admin/build.rs`.

### 3.1 `GH_OAUTH_CLIENT_ID`

| | |
| --- | --- |
| **Required** | No (users can enter their own client_id in-app) |
| **Default** | _(empty)_ |
| **Description** | GitHub OAuth App client ID for the admin's built-in GitHub sign-in feature. Used to clone/push repos from inside the admin without entering credentials repeatedly. **Public value** — safe to commit and ship in the binary. |
| **Example** | `GH_OAUTH_CLIENT_ID=Iv1.abc123...` |
| **Where to set** | `tauri-admin/.env` (gitignored). Rebuild the binary (`cargo build` or `npm run tauri:build`) after changing. |

To register a GitHub OAuth App:
1. Go to <https://github.com/settings/developers> → OAuth Apps → New OAuth App.
2. Authorization callback URL: `http://localhost:7878/callback`.
3. Copy the client ID into `tauri-admin/.env`.

### 3.2 `GH_OAUTH_CLIENT_SECRET`

| | |
| --- | --- |
| **Required** | Only if your OAuth App is registered as **Confidential** |
| **Default** | _(empty)_ |
| **Description** | GitHub OAuth App client secret. **Only needed for confidential OAuth Apps.** For public binary releases, register the OAuth App as a **public** client (no secret required) — anyone with the binary can use the public client ID. |
| **Example** | `GH_OAUTH_CLIENT_SECRET=abc123...` |
| **Where to set** | `tauri-admin/.env` (gitignored). NEVER commit. |

> If both `GH_OAUTH_CLIENT_ID` and `GH_OAUTH_CLIENT_SECRET` are blank at build time, users will be prompted to enter their own client ID in the app (Settings → GitHub, or the setup wizard's GitHub step).

### 3.3 Tauri runtime configuration

The Tauri admin's runtime config (window size, devtools, updater endpoint) is defined in `tauri-admin/tauri.conf.json`. It is **not** an environment variable file. Notable fields:

| Field | Default | Purpose |
| --- | --- | --- |
| `build.devUrl` | `http://localhost:1420` | Vite dev server URL during development. |
| `build.frontendDist` | `../dist` | Built frontend assets path. |
| `app.windows[0].title` | `Osler Admin` | Window title. |
| `app.windows[0].width` / `height` | `1280` / `800` | Initial window size. |
| `app.security.csp` | _(strict CSP)_ | Content Security Policy for the webview. |

---

## 4. `osler.config.json` schema reference

The runtime config file at `public/osler.config.json` is the central knob for white-labelling Osler. It's fetched by the frontend on boot, merged over the hard-coded `DEFAULT_CONFIG` in `src/lib/osler/config.ts`, and cached in `localStorage` for synchronous reads on subsequent boots.

> **Source of truth:** `src/lib/osler/config.ts`. The TypeScript interfaces there (`OslerConfig`, `SiteConfig`, `CloudConfig`, etc.) are the schema. This document is a human-readable mirror.

**Design rules** (from `config.ts`):

- Every field is **optional**. Missing keys fall back to `DEFAULT_CONFIG`.
- The loader **never throws**. A fetch failure or JSON parse error returns the default config so the app always boots.
- Arrays in `themes.custom` are **replaced**, not merged, when present in the user's config.
- Engine entries are **per-engine** merged: missing engines default to `{ enabled: true }`.

The full top-level shape:

```ts
interface OslerConfig {
  schemaVersion: number;
  site: SiteConfig;
  engines: Partial<Record<EngineType, EnginePluginConfig>>;
  themes: { default: string; custom: CustomThemeConfig[] };
  defaults: {
    view: DefaultView;
    language: LanguageDefaultsConfig;
    quiz: QuizDefaultsConfig;
    ai: AiDefaultsConfig;
    sync: SyncDefaultsConfig;
  };
  cloud: CloudConfig;
  wizard: WizardConfig;
}
```

### 4.1 `schemaVersion`

| | |
| --- | --- |
| **Type** | `number` |
| **Required** | No (defaults to `1`) |
| **Description** | Schema version of the config file itself. Used for forward migrations if the schema ever changes incompatibly. Currently always `1`. |

### 4.2 `site`

Site identity block. Drives `<title>`, OG/Twitter metadata, PWA manifest `name`, the in-app brand mark, the About section, the admin sidebar repo link, and the support email link.

```jsonc
"site": {
  "name": "Osler",
  "shortName": "Osler",
  "tagline": "Medical Study Platform",
  "githubRepo": "https://github.com/eyad-elghareeb/osler",
  "organisation": "Osler Team",
  "supportEmail": ""
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | `string` | No | `"Osler"` | Full site name shown in the header and login screen. |
| `shortName` | `string` | No | `"Osler"` | Short name shown on mobile home screens / PWA install. |
| `tagline` | `string` | No | `"Medical Study Platform"` | Tagline shown under the brand mark. |
| `githubRepo` | `string` | No | `"https://github.com/eyad-elghareeb/osler"` | Canonical GitHub repo URL. Always surfaced in admin sidebar + About. |
| `organisation` | `string` | No | `"Osler Team"` | Organisation / author name. |
| `supportEmail` | `string` | No | `""` | Support / contact email. If empty, the support link is hidden. |

### 4.3 `engines`

Engine plugin block. Each of the 7 engine types (`quiz`, `bank`, `written`, `flashcard`, `osce`, `library`, `video`) can be enabled/disabled and have its label/singular/color/icon overridden for white-labelling.

```jsonc
"engines": {
  "quiz":      { "enabled": true, "label": "Quiz", "singular": "Quiz", "color": "oklch(0.62 0.16 250)", "icon": "clipboard" },
  "bank":      { "enabled": true, "label": "Question Bank", "singular": "Bank", "color": "oklch(0.58 0.14 245)", "icon": "book" },
  "written":   { "enabled": true, "label": "Written", "singular": "Set", "color": "oklch(0.78 0.16 80)", "icon": "pen-tool" },
  "flashcard": { "enabled": true, "label": "Flashcards", "singular": "Deck", "color": "oklch(0.7 0.18 145)", "icon": "layers" },
  "osce":      { "enabled": true, "label": "OSCE", "singular": "OSCE", "color": "oklch(0.7 0.2 16)", "icon": "activity" },
  "library":   { "enabled": true, "label": "Library", "singular": "Article", "color": "oklch(0.65 0.15 280)", "icon": "book-open" },
  "video":     { "enabled": true, "label": "Videos", "singular": "Video", "color": "oklch(0.68 0.18 195)", "icon": "video" }
}
```

| Field (per engine) | Type | Required | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | No (default `true`) | If `false`, the engine is hidden from the UI and its content is never loaded. Content files on disk are preserved. |
| `label` | `string` | No | Display label (e.g. "Question Bank" instead of "Bank"). Falls back to `ENGINE_META[type].label`. |
| `singular` | `string` | No | Singular label (e.g. "Bank" → "Bank"). |
| `color` | `string` | No | oklch color string for the engine's accent color. |
| `icon` | `string` | No | lucide-react icon name (e.g. `"clipboard"`, `"book"`). Invalid names render as empty. |

> **Minimal form:** Each engine can be just `{ "enabled": true }` to use all defaults.

### 4.4 `themes`

Theme block. Defines the default theme id (must be `"dark"`, `"light"`, or a custom theme id) and a list of custom palettes.

```jsonc
"themes": {
  "default": "dark",
  "custom": [ /* ... CustomThemeConfig[] ... */ ]
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `default` | `string` | No | `"dark"` | Default theme id on first load. Must be `"dark"`, `"light"`, or a `custom[].id`. The user's choice persists in `localStorage` (`osler-theme`) after first load. |
| `custom` | `CustomThemeConfig[]` | No | _(8 pre-shipped themes)_ | Custom theme palettes. **Replaces** the default list when present — include all desired themes in your custom list. |

Each `CustomThemeConfig` entry:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Stable id used in the `data-theme` attribute and theme switcher. Must be unique. |
| `name` | `string` | Yes | Display name in the theme switcher. |
| `variant` | `"dark" \| "light"` | Yes | Base variant — controls default `--background` / `--foreground` if not overridden. |
| `primary` | `string` | No | Primary accent color (oklch). |
| `primaryForeground` | `string` | No | Foreground on primary surfaces (oklch). |
| `accent` | `string` | No | Secondary accent color (oklch). |
| `background` | `string` | No | Page background (oklch). |
| `foreground` | `string` | No | Default text color (oklch). |
| `card` | `string` | No | Card background (oklch). |
| `cardForeground` | `string` | No | Card text (oklch). |
| `popover` | `string` | No | Popover background (oklch). |
| `popoverForeground` | `string` | No | Popover text (oklch). |
| `secondary` | `string` | No | Secondary background (oklch). |
| `secondaryForeground` | `string` | No | Secondary text (oklch). |
| `muted` | `string` | No | Muted background (oklch). |
| `mutedForeground` | `string` | No | Muted text (oklch). |
| `destructive` | `string` | No | Destructive action color (oklch). |
| `border` | `string` | No | Border color (oklch). |
| `input` | `string` | No | Input border color (oklch). |
| `ring` | `string` | No | Focus ring color (oklch). |
| `sidebar` | `string` | No | Sidebar background (oklch). |
| `sidebarForeground` | `string` | No | Sidebar text (oklch). |
| `sidebarPrimary` | `string` | No | Sidebar primary accent (oklch). |
| `sidebarPrimaryForeground` | `string` | No | Sidebar primary text (oklch). |
| `sidebarAccent` | `string` | No | Sidebar accent (oklch). |
| `sidebarAccentForeground` | `string` | No | Sidebar accent text (oklch). |
| `sidebarBorder` | `string` | No | Sidebar border (oklch). |
| `sidebarRing` | `string` | No | Sidebar focus ring (oklch). |

> The theme provider injects one CSS rule per custom theme, scoped to `.theme-<id>`. All values must be valid CSS `oklch()` strings, e.g. `oklch(0.58 0.14 245)` or `oklch(1 0 0 / 8%)` (with alpha).

The 8 pre-shipped themes (in the default config) are:
- `navy-clinic` / `navy-clinic-light` — blue clinical
- `forest-rounds` / `forest-rounds-light` — green
- `cream-journal` / `cream-journal-dark` — warm neutral
- `crimson-ed` / `crimson-ed-light` — red emergency

### 4.5 `cloud`

Optional Cloudflare Worker account + progress-sync service.

```jsonc
"cloud": {
  "enabled": false,
  "apiUrl": "",
  "turnstileSiteKey": "",
  "syncQbank": true,
  "syncFlashcards": true
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `enabled` | `boolean` | No | `false` | If `false`, the app runs as a local-only guest session (IndexedDB only). No accounts, no sync, no admin. |
| `apiUrl` | `string` | No | `""` | Absolute Worker URL, e.g. `https://osler-cloud.example.workers.dev`. Required when `enabled = true`. |
| `turnstileSiteKey` | `string` | No | _(none)_ | Public Cloudflare Turnstile site key (starts with `0x`). Required only if `TURNSTILE_ENABLED = "true"` on the Worker. |
| `syncQbank` | `boolean` | No | `true` | Whether QBank progress is synced to the cloud. |
| `syncFlashcards` | `boolean` | No | `true` | Whether flashcard reviews are synced to the cloud. |

> **Precedence:** `cloud.apiUrl` overrides `NEXT_PUBLIC_CLOUD_API_URL` if both are set (see [§8](#8-configuration-precedence)). The recommended setup is to set only `cloud.apiUrl` and leave the env var unset.

### 4.6 `defaults`

Default options applied on first use of each feature. The user's runtime choices (theme, language, etc.) persist in `localStorage` and override these defaults after first launch.

```jsonc
"defaults": {
  "view": "dashboard",
  "language": { "ui": "en", "content": "all" },
  "quiz": { "questionCount": 10, "secondsPerQuestion": 60, "tutorMode": false, "shuffle": true },
  "ai": { "model": "gemini-3.5-flash-lite", "enabled": true, "temperature": 0.4 },
  "sync": { "method": "network", "defaultRoom": "osler-default" }
}
```

#### 4.6.1 `defaults.view`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `view` | `string` | `"dashboard"` | Default landing view after login. One of: `dashboard`, `learn`, `library`, `qbank`, `flashcards`, `osce`, `videos`, `profile`, `settings`. |

#### 4.6.2 `defaults.language`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `ui` | `"en" \| "ar"` | `"en"` | Default UI language. Must exist in the `LANGUAGES` map in `src/lib/osler/i18n/languages.ts`. |
| `content` | `"all" \| "en" \| "ar"` | `"all"` | Default content-language filter. Decoupled from UI language so a user can read English content with an Arabic UI. |

#### 4.6.3 `defaults.quiz`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `questionCount` | `number` | `10` | Default number of questions per quiz. |
| `secondsPerQuestion` | `number` | `60` | Default time per question in seconds. `0` = untimed. |
| `tutorMode` | `boolean` | `false` | Default tutor mode (show explanation after each question). |
| `shuffle` | `boolean` | `true` | Default shuffle-questions toggle. |

#### 4.6.4 `defaults.ai`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | `string` | `"gemini-3.5-flash-lite"` | Default Gemini model id. The user enters their own API key in Settings → AI Assistant. |
| `enabled` | `boolean` | `true` | Whether the AI assistant panel is visible by default. |
| `temperature` | `number` | `0.4` | Default temperature (0..1). Lower = more deterministic. |

#### 4.6.5 `defaults.sync`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `method` | `"network" \| "qr" \| "file"` | `"network"` | Default P2P sync transport (not cloud sync — cloud sync is controlled by `cloud.*`). |
| `defaultRoom` | `string` | `"osler-default"` | Default room name for PeerJS network sync. Change to avoid colliding with other Osler instances on the public broker. |

### 4.7 `wizard`

First-time wizard state. Written by either the Tauri admin's setup wizard or the in-app first-run wizard.

```jsonc
"wizard": {
  "completed": false,
  "completedAt": "2024-01-15T10:30:00.000Z",  // optional
  "version": 1
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `completed` | `boolean` | No | `false` | Whether the wizard has been completed (in admin or in-app). When `false`, the wizard auto-launches on next boot. |
| `completedAt` | `string` | No | _(none)_ | ISO 8601 timestamp of completion. |
| `version` | `number` | No | `1` | Schema version for forward migrations. |

### 4.8 Loading & caching behavior

The config is loaded by `loadConfig()` in `src/lib/osler/config.ts`:

1. On boot, `fetch("/osler.config.json", { cache: "no-store" })`.
2. The result is deep-merged over `DEFAULT_CONFIG` (per-engine and per-section).
3. The merged config is cached in-memory for the page lifetime and persisted to `localStorage` (`osler-config-cache`).
4. On next boot, the synchronous `getConfig()` reads from `localStorage` first to avoid a flash of default config before the fetch resolves.
5. On any error (network failure, JSON parse), the loader falls back to the `localStorage` cache if present, otherwise `DEFAULT_CONFIG`. The app **always boots**.

To force a fresh fetch (e.g. after editing the file in dev): `localStorage.removeItem("osler-config-cache")` and reload.

---

## 5. `wrangler.toml` configuration reference

The Cloudflare Worker manifest lives at `cloudflare/worker/wrangler.toml`. It declares the Worker name, entry point, compatibility date, bindings (D1, R2), runtime variables (`[vars]`), and cron triggers.

The full template:

```toml
name = "osler-cloud"
main = "src/index.ts"
compatibility_date = "2026-07-23"
workers_dev = true

[[d1_databases]]
binding = "DB"
database_name = "osler-cloud"
database_id = "REPLACE_WITH_D1_DATABASE_ID"

# Optional: R2 bucket for web-admin content storage.
[[r2_buckets]]
binding = "CONTENT"
bucket_name = "osler-content"

[triggers]
crons = ["0 * * * *"]

[vars]
ALLOWED_ORIGIN = "http://localhost:3000"
TURNSTILE_ENABLED = "false"
WORKER_URL = "http://localhost:8787"
```

### 5.1 Top-level fields

| Field | Default | Description |
| --- | --- | --- |
| `name` | `"osler-cloud"` | Worker name. Determines the default URL (`https://osler-cloud.<your-subdomain>.workers.dev`). |
| `main` | `"src/index.ts"` | Entry point. Must export `default { fetch, scheduled }`. |
| `compatibility_date` | `"2026-07-23"` | Workers runtime compatibility date. Pin to the date the Worker was last tested against — newer dates enable newer APIs but may change behavior. |
| `workers_dev` | `true` | Whether the `*.workers.dev` subdomain URL is enabled. Set to `false` if you only want to expose the Worker via a custom route. |

### 5.2 `[[d1_databases]]` — D1 binding

```toml
[[d1_databases]]
binding = "DB"
database_name = "osler-cloud"
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

| Field | Description |
| --- | --- |
| `binding` | The name exposed on `env` inside the Worker. Osler's Worker code reads `env.DB`. **Don't change this** without forking the Worker. |
| `database_name` | Human-readable name. Must match the name you used in `wrangler d1 create`. |
| `database_id` | UUID returned by `wrangler d1 create osler-cloud`. Replace `REPLACE_WITH_D1_DATABASE_ID` with the real value. |

To create a D1 database and get the ID:

```bash
npx wrangler d1 create osler-cloud
# Output includes: database_id = "abcd-1234-..."
```

### 5.3 `[[r2_buckets]]` — R2 binding

```toml
[[r2_buckets]]
binding = "CONTENT"
bucket_name = "osler-content"
```

| Field | Description |
| --- | --- |
| `binding` | The name exposed on `env` inside the Worker. Osler's Worker code reads `env.CONTENT`. **Don't change this** without forking. |
| `bucket_name` | R2 bucket name. Create with `npx wrangler r2 bucket create osler-content`. |

> **Optional but recommended:** Without R2, the admin content-management routes (`/v1/admin/content/*`) return 500. Comment out this block only if you intentionally disable the admin content workflow.

### 5.4 `[triggers]` — Cron triggers

```toml
[triggers]
crons = ["0 * * * *"]
```

A list of standard cron expressions. The Worker's `scheduled` handler runs on each trigger. The free tier allows up to 5 crons per account.

The default `"0 * * * *"` runs at the top of every hour and triggers the cleanup job, which:

1. Deletes expired `oauth_states`, `auth_handoffs`, `password_reset_tokens`.
2. Deletes expired or revoked `sessions`.
3. Deletes `admin_audit` entries older than 1 year (`AUDIT_RETENTION_MS`).

To verify cron is firing, check Cloudflare Dashboard → Workers → your Worker → Triggers → Cron Triggers.

### 5.5 `[vars]` — Runtime variables

Non-secret runtime config. Always strings (Wrangler coerces non-string values). Committed to git.

```toml
[vars]
ALLOWED_ORIGIN = "http://localhost:3000"
TURNSTILE_ENABLED = "false"
WORKER_URL = "http://localhost:8787"
```

The Worker reads these as `env.ALLOWED_ORIGIN`, `env.TURNSTILE_ENABLED`, `env.WORKER_URL`. See [§2](#2-cloudflare-worker-environment-variables--secrets) for what each one does.

> **`APP_ORIGIN` and `EMAIL_FROM`:** These can be set as `[vars]` too (for password-reset email). They're not in the default `wrangler.toml` because they're only relevant when `RESEND_API_KEY` is configured. Add them when you enable email.

### 5.6 `[env.production]` / `[env.staging]` — Environment overrides

Wrangler supports per-environment overrides. A common pattern:

```toml
[env.production.vars]
ALLOWED_ORIGIN = "https://app.example.com"
WORKER_URL = "https://api.example.com"

[env.staging.vars]
ALLOWED_ORIGIN = "https://staging.example.com"
WORKER_URL = "https://osler-cloud-staging.example.workers.dev"
```

Deploy with `--env production` or `--env staging`. Note that **secrets are not environment-scoped** — they apply to the Worker across all environments. For separate secrets per environment, deploy two separate Workers (e.g. `osler-cloud` and `osler-cloud-staging`).

---

## 6. Hardcoded constants in the Worker

These constants live in `cloudflare/worker/src/index.ts` and are **not** configurable via env vars or `wrangler.toml`. To change them, fork the Worker and redeploy.

### 6.1 Password hashing

| Constant | Value | Description |
| --- | --- | --- |
| `PASSWORD_ITERATIONS` | `100_000` | PBKDF2-SHA-256 iteration count. Limited to 100,000 by Cloudflare Workers Web Crypto API. |
| Salt size | 16 bytes | Random per-user salt, base64url-encoded in `password_salt`. |

> **Changing `PASSWORD_ITERATIONS`:** Existing hashes are stored with the iteration count they were hashed at — the verify path uses `PASSWORD_ITERATIONS` as the iteration count, so changing it would break verification of all existing passwords. To migrate, you'd need to store the iteration count alongside each hash and fork the verify function.

### 6.2 Session & token lifetimes

| Constant | Value | Description |
| --- | --- | --- |
| `SESSION_TTL_MS` | `7 * 24 * 60 * 60 * 1000` (7 days) | How long a session token is valid. Sessions are pruned by the hourly cron after they expire. |
| `RESET_TTL_MS` | `30 * 60 * 1000` (30 minutes) | Password-reset token validity window. Tokens are single-use. |
| `OAUTH_TTL_MS` | `10 * 60 * 1000` (10 minutes) | OAuth state token validity (Google Sign-In round-trip window). |
| `HANDOFF_TTL_MS` | `5 * 60 * 1000` (5 minutes) | Single-use handoff ticket validity (the `/v1/auth/google/consume` step). |

### 6.3 Document size & session caps

| Constant | Value | Description |
| --- | --- | --- |
| `MAX_DOCUMENT_BYTES` | `900_000` (~900 KB) | Per-user, per-document UTF-8 byte size cap on progress sync documents (`qbank` and `flashcards`). Computed via `new TextEncoder().encode(doc).length` — not string character count, so non-ASCII content counts correctly. |
| `MAX_SESSIONS_PER_USER` | `12` | Max concurrent active sessions per user. When the 13th session is issued, the oldest is auto-revoked. |

### 6.4 Audit log retention

| Constant | Value | Description |
| --- | --- | --- |
| `AUDIT_RETENTION_MS` | `365 * 24 * 60 * 60 * 1000` (365 days) | How long `admin_audit` entries are kept. The hourly cron prunes entries older than this. |

> **Compliance note:** If your jurisdiction requires a longer retention window (e.g. HIPAA-style 6-year retention for access logs), increase this value and ensure your D1 storage can hold the additional rows (estimate ~200 bytes/row × actions/year).

### 6.5 Rate limit values

The Worker uses per-isolate in-memory LRU buckets for rate limiting. **Per-isolate means these are best-effort** — Cloudflare may recycle isolates, resetting the buckets. For hard guarantees, front the Worker with Cloudflare's Rate Limiting Rules in the dashboard.

| Constant | Value | Description |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `60_000` (1 minute) | Sliding window size for all rate-limited buckets. |
| `RATE_LIMIT_MAX["auth:login"]` | `12` | Max login attempts per IP per window. |
| `RATE_LIMIT_MAX["auth:register"]` | `6` | Max registration attempts per IP per window. |
| `RATE_LIMIT_MAX["auth:reset"]` | `6` | Max password-reset requests per IP per window. |
| `RATE_LIMIT_MAX["auth:google:consume"]` | `12` | Max Google handoff-consume attempts per IP per window. |
| `RATE_LIMIT_MAX["admin"]` | `600` | Max admin content-management requests per IP per window (admin-role endpoints only). |
| `RATE_LIMIT_MAX["ip:global"]` | `600` | Hard cap per IP across **all** rate-limited routes per window. |
| LRU eviction threshold | `2000` entries | When the bucket map exceeds 2000 entries, the 100 oldest are evicted. |

When any limit is exceeded, the Worker returns `429 Too Many Requests` with `Cache-Control: no-store`.

### 6.6 Security headers

The Worker sets the following security headers on every JSON response (see `SECURITY_HEADERS` in `src/index.ts`):

| Header | Value |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `Cache-Control` | `no-store` (on authenticated responses) |

> **HSTS preload note:** The default `max-age=31536000` (1 year) is below the 2-year minimum required by <https://hstspreload.org/>. If you want to submit your domain for preload, override the header at the edge (Cloudflare Transform Rules, Caddy, etc.) to `max-age=63072000`. See [`troubleshooting.md` §10.4](./troubleshooting.md#104-hsts-preload-submission-rejected).

### 6.7 CORS behavior

- Browser requests must include `Origin: <ALLOWED_ORIGIN>` (exact match).
- Empty `Origin` (server-to-server, curl) is **allowed** so the Worker can be tested locally.
- Successful responses include `Access-Control-Allow-Origin: <request-origin>`, `Access-Control-Allow-Credentials: true`, and `Vary: Origin`.
- Preflight `OPTIONS` requests are answered with `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS` and `Access-Control-Allow-Headers: Authorization, Content-Type`.

---

## 7. How to set secrets

Secrets are encrypted at rest by Cloudflare and never appear in `wrangler.toml`, source code, or git. There are three ways to set them, depending on environment.

### 7.1 Production — `wrangler secret put`

```bash
cd cloudflare/worker
npx wrangler secret put JWT_SECRET
# → prompts for the value; paste it and press Enter
```

To verify a secret is set:

```bash
npx wrangler secret list
# Should list: JWT_SECRET, GOOGLE_CLIENT_ID, etc.
```

To delete a secret:

```bash
npx wrangler secret delete JWT_SECRET
```

Secrets take effect immediately for the next request — no redeploy needed.

> **Multiple Workers:** If you use `[env.production]` and `[env.staging]`, secrets are **not** environment-scoped. They apply to all environments of the same Worker name. To have separate secrets per environment, deploy two separate Workers (e.g. `osler-cloud` and `osler-cloud-staging`).

### 7.2 Production — Cloudflare dashboard

For operators who prefer a UI:

1. Cloudflare Dashboard → Workers & Pages → your Worker (`osler-cloud`) → Settings → Variables and Secrets.
2. Click **Add variable** under **Secrets**.
3. Enter the variable name (e.g. `JWT_SECRET`) and paste the value.
4. Click **Deploy**. The secret is encrypted and applied immediately.

This is equivalent to `wrangler secret put` — the same secret store.

### 7.3 Local development — `.dev.vars`

For `wrangler dev` only, Wrangler auto-loads secrets from a `.dev.vars` file in the Worker directory. This file is **gitignored** and never deployed.

```bash
cd cloudflare/worker
cp .dev.vars.example .dev.vars
# Edit .dev.vars and fill in real values (any long random string works for JWT_SECRET locally)
```

`.dev.vars` format (one `KEY=value` per line):

```ini
JWT_SECRET=local-dev-secret-not-for-production
ALLOWED_ORIGIN=http://localhost:3000
WORKER_URL=http://localhost:8787
TURNSTILE_SECRET_KEY=
RESEND_API_KEY=
EMAIL_FROM=Osler <noreply@example.com>
APP_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Restart `wrangler dev` after editing `.dev.vars`.

> **Why both `.env.example` and `.dev.vars.example`?** `.env.example` is a documentation reference (it's just a flat list of variables with comments). `.dev.vars.example` is the actual template for local development. Copy `.dev.vars.example` → `.dev.vars` for `wrangler dev`; never commit `.dev.vars`.

### 7.4 Tauri admin secrets

The Tauri admin uses `tauri-admin/.env` for build-time GitHub OAuth. These values are baked into the binary at compile time via `tauri-admin/build.rs`:

```bash
cd tauri-admin
cp .env.example .env
# Edit .env: fill in GH_OAUTH_CLIENT_ID (and GH_OAUTH_CLIENT_SECRET if needed)
cargo build
# or
npm run tauri:build
```

Rebuild every time you change `.env`.

### 7.5 Rotating secrets

To rotate `JWT_SECRET` (e.g. after a suspected leak):

1. Generate a new value: `openssl rand -base64 48`.
2. `npx wrangler secret put JWT_SECRET` → paste the new value.
3. All active sessions become unverifiable — users will be signed out on their next request and need to log in again.

For `GOOGLE_CLIENT_SECRET`:
1. In Google Cloud Console → Credentials → your OAuth Client → reset the secret.
2. `npx wrangler secret put GOOGLE_CLIENT_SECRET` → paste the new secret.
3. No user impact for already-issued session tokens (only the OAuth flow uses the secret).

For `RESEND_API_KEY`:
1. Resend dashboard → API Keys → revoke the old key, create a new one.
2. `npx wrangler secret put RESEND_API_KEY` → paste the new key.
3. Password-reset emails continue working immediately.

---

## 8. Configuration precedence

When the same logical setting is configured in multiple places, Osler has a deterministic precedence. From highest to lowest:

### 8.1 Cloud API URL

The Worker URL can be set in two places:

1. **`osler.config.json` → `cloud.apiUrl`** ← **wins** (if non-empty)
2. **`NEXT_PUBLIC_CLOUD_API_URL`** env var (build-time)
3. **`DEFAULT_CONFIG.cloud.apiUrl`** = `""` (empty)

> Recommendation: set only `cloud.apiUrl` in `osler.config.json`. It can be changed post-build via the Tauri admin without a rebuild, and is the only knob the admin UI surfaces.

### 8.2 Theme

1. **`localStorage["osler-theme"]`** (user's runtime choice) ← **wins** after first load
2. **`osler.config.json` → `themes.default`**
3. **`DEFAULT_CONFIG.themes.default`** = `"dark"`

On first-ever boot (no `localStorage`), `themes.default` is used and immediately persisted.

### 8.3 Engine enabled state

1. **`osler.config.json` → `engines.<id>.enabled`** ← **wins** if present
2. **`DEFAULT_CONFIG.engines.<id>.enabled`** = `true`

Per-engine: missing engines default to enabled. The merge is per-engine, not all-or-nothing — you can disable `osce` while leaving `quiz` enabled.

### 8.4 Default language, view, quiz options, AI model, sync method

1. **User's runtime choice in `localStorage`** (set after first launch) ← **wins**
2. **`osler.config.json` → `defaults.*`** (merged field-by-field over defaults)
3. **`DEFAULT_CONFIG.defaults.*`**

### 8.5 Custom themes

1. **`osler.config.json` → `themes.custom`** ← **replaces** the default list when present
2. **`DEFAULT_CONFIG.themes.custom`** (8 pre-shipped themes)

If you set `themes.custom` to `[]`, you'll have **no** custom themes (just `dark` and `light`). The default list is only used when `themes.custom` is absent.

### 8.6 Cloud sync toggles (`syncQbank`, `syncFlashcards`)

1. **`osler.config.json` → `cloud.syncQbank` / `cloud.syncFlashcards`** ← **wins**
2. **`DEFAULT_CONFIG.cloud.syncQbank`** = `true` / **`syncFlashcards`** = `true`

### 8.7 Worker `ALLOWED_ORIGIN` vs. `osler.config.json`

These are **independent** — `ALLOWED_ORIGIN` is the Worker-side CORS check (what the Worker accepts), and `osler.config.json` → `cloud.apiUrl` is the client-side target (what the frontend calls). They must point at each other:

- Frontend origin must match Worker's `ALLOWED_ORIGIN`.
- `cloud.apiUrl` must point at the Worker.

A mismatch produces CORS errors (see [`troubleshooting.md` §2.4](./troubleshooting.md#24-frontend-gets-cors-error-access-to-fetch-at--from-origin--has-been-blocked-by-cors-policy)).

### 8.8 Precedence summary table

| Setting | Highest precedence | → | Lowest precedence |
| --- | --- | --- | --- |
| Cloud API URL | `osler.config.json` → `cloud.apiUrl` | → | `NEXT_PUBLIC_CLOUD_API_URL` env → default `""` |
| Theme (after first load) | `localStorage["osler-theme"]` | → | `osler.config.json` → `themes.default` → default `"dark"` |
| Engine enabled | `osler.config.json` → `engines.<id>.enabled` | → | default `true` |
| Custom themes | `osler.config.json` → `themes.custom` (replaces) | → | 8 pre-shipped themes |
| UI language | User's `localStorage` choice | → | `osler.config.json` → `defaults.language.ui` → default `"en"` |
| Quiz defaults | User's `localStorage` choice | → | `osler.config.json` → `defaults.quiz.*` → hardcoded defaults |
| Cloud sync toggles | `osler.config.json` → `cloud.syncQbank` / `syncFlashcards` | → | default `true` |

---

## 9. Validation rules

The Worker enforces several validation rules on user input. These are hardcoded in `src/index.ts` and apply to **every** code path that touches the relevant field (registration, login, password change, password reset, admin reset).

### 9.1 Username

```js
function validUsername(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(value);
}
```

| Rule | Value |
| --- | --- |
| Allowed characters | `a-z`, `A-Z`, `0-9`, `_`, `.`, `-` |
| Length | 3–32 characters |
| Case sensitivity | Stored as-is; **lookups are case-insensitive** (`COLLATE NOCASE` in SQLite) — `John` and `john` collide |

Examples:
- ✅ `john`, `jane_doe`, `student.2024`, `med-student`
- ❌ `jo` (too short), `a-very-long-username-that-exceeds-32-chars` (too long), `john!` (invalid char), `john doe` (space not allowed)

### 9.2 Email

```js
function validEmail(value) {
  return !value || (typeof value === "string"
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    && value.length <= 254);
}
```

| Rule | Value |
| --- | --- |
| Regex | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (must contain `@`, no spaces, at least one `.` in the domain part) |
| Max length | 254 characters (RFC 5321) |
| Case sensitivity | Stored lowercased; lookups are case-insensitive |

> This is a **permissive** regex — it accepts some technically-invalid emails and rejects some technically-valid ones. The trade-off is intentional: strict RFC 5322 validation is complex and error-prone, and email verification (via password-reset email) is the real validation step.

### 9.3 Password

```js
function validPassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 200) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]
    .filter((re) => re.test(value)).length;
  return classes >= 2;
}
```

| Rule | Value |
| --- | --- |
| Min length | 10 characters |
| Max length | 200 characters |
| Character classes required | **At least 2** of: lowercase (`a-z`), uppercase (`A-Z`), digit (`0-9`), symbol (anything else) |
| Applied to | Registration, password change, password reset, admin-initiated reset |

> **Note:** The inline comment in `src/index.ts` mentions "3 character classes" but the actual code enforces `>= 2`. The public docs (and this guide) describe the actual behavior: **2 of 4 classes**.

Examples:
- ✅ `correctHorse9` (lowercase + uppercase + digit = 3 classes)
- ✅ `password!A` (lowercase + uppercase + symbol = 3 classes)
- ✅ `Abcdefghij` (lowercase + uppercase = 2 classes — minimum)
- ❌ `password` (1 class — lowercase only)
- ❌ `1234567890` (1 class — digit only)
- ❌ `abcdefghi` (1 class, also too short at 9 chars)

### 9.4 Display name

| Rule | Value |
| --- | --- |
| Max length | 80 characters (enforced via `.slice(0, 80)` — silently truncated, not rejected) |
| Allowed characters | Any (UTF-8) |

### 9.5 Content body (admin content management)

| Rule | Value |
| --- | --- |
| Draft body max size | 1 MB (`1_000_000` bytes) — enforced on `PUT /v1/admin/content/:id/draft` |
| Content type | Must be one of: `quiz`, `bank`, `written`, `mixed`, `flashcard`, `osce`, `library`, `video` |

### 9.6 Sync document size

| Rule | Value |
| --- | --- |
| Per-document max | `MAX_DOCUMENT_BYTES` = 900,000 UTF-8 bytes (~900 KB) |
| Computed via | `new TextEncoder().encode(JSON.stringify(doc)).length` (not string character count) |

> Non-ASCII content (Arabic, emoji, etc.) takes 2–4 bytes per character in UTF-8. A 900 KB document of pure Arabic text is roughly 300,000 characters; the same size in pure ASCII is 900,000 characters.

### 9.7 Username search (admin)

The admin user-search endpoint (`GET /v1/admin/users?q=...`) escapes SQL LIKE wildcards:

```js
function escapeLike(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
```

This means `%` and `_` in the search query are matched **literally**, not as glob characters. Searching for `100%` matches the literal string `100%`, not `100` followed by anything.

### 9.8 Google ID token verification

When a user signs in via Google, the Worker verifies the returned ID token with these checks:

| Check | Required value |
| --- | --- |
| Signature | Valid against Google's published JWKS |
| Audience (`aud`) | Must include `env.GOOGLE_CLIENT_ID` |
| Issuer (`iss`) | `accounts.google.com` or `https://accounts.google.com` |
| Expiry (`exp`) | Must be in the future |
| Nonce (`nonce`) | Must match the nonce stored in `oauth_states` for the matching state token |
| `email_verified` | Must be `true` |
| `sub` | Must be present (non-empty) |
| `email` | Must pass `validEmail()` |

Any check failing returns `400 invalid_token` and consumes the single-use state token.

---

## 10. Quick-reference cheat sheet

### 10.1 All environment variables at a glance

| Variable | Scope | Required | Set via | Default |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_INVIDIOUS_HOST` | Frontend | No | `.env.local` / Pages env | `invidious.tiekoetter.com` |
| `NEXT_PUBLIC_CLOUD_API_URL` | Frontend | If cloud on | `.env.local` / Pages env | _(empty — overridden by `osler.config.json`)_ |
| `JWT_SECRET` | Worker | **Yes** | `wrangler secret put` | _(none)_ |
| `ALLOWED_ORIGIN` | Worker | **Yes** | `[vars]` in `wrangler.toml` | `http://localhost:3000` |
| `WORKER_URL` | Worker | Yes (for OAuth) | `[vars]` in `wrangler.toml` | `http://localhost:8787` |
| `TURNSTILE_ENABLED` | Worker | No | `[vars]` in `wrangler.toml` | `"false"` |
| `TURNSTILE_SECRET_KEY` | Worker | If Turnstile on | `wrangler secret put` | _(none)_ |
| `RESEND_API_KEY` | Worker | For pw reset | `wrangler secret put` | _(none)_ |
| `EMAIL_FROM` | Worker | For pw reset | `[vars]` in `wrangler.toml` | `Osler <noreply@example.com>` |
| `APP_ORIGIN` | Worker | For pw reset | `[vars]` in `wrangler.toml` | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | Worker | For Google SSO | `wrangler secret put` | _(none)_ |
| `GOOGLE_CLIENT_SECRET` | Worker | For Google SSO | `wrangler secret put` | _(none)_ |
| `GH_OAUTH_CLIENT_ID` | Tauri admin | No | `tauri-admin/.env` (build-time) | _(empty)_ |
| `GH_OAUTH_CLIENT_SECRET` | Tauri admin | If confidential app | `tauri-admin/.env` (build-time) | _(empty)_ |

### 10.2 All hardcoded Worker constants at a glance

| Constant | Value | Purpose |
| --- | --- | --- |
| `PASSWORD_ITERATIONS` | 100,000 | PBKDF2 iterations |
| `SESSION_TTL_MS` | 7 days | Session token lifetime |
| `RESET_TTL_MS` | 30 minutes | Password-reset token lifetime |
| `OAUTH_TTL_MS` | 10 minutes | OAuth state token lifetime |
| `HANDOFF_TTL_MS` | 5 minutes | Single-use handoff ticket lifetime |
| `MAX_DOCUMENT_BYTES` | 900,000 | Sync document byte cap |
| `MAX_SESSIONS_PER_USER` | 12 | Concurrent session cap |
| `AUDIT_RETENTION_MS` | 365 days | Audit-log retention |
| `RATE_LIMIT_WINDOW_MS` | 60,000 ms (1 min) | Rate-limit sliding window |
| `RATE_LIMIT_MAX["auth:login"]` | 12 | Logins per IP per window |
| `RATE_LIMIT_MAX["auth:register"]` | 6 | Registrations per IP per window |
| `RATE_LIMIT_MAX["auth:reset"]` | 6 | Resets per IP per window |
| `RATE_LIMIT_MAX["auth:google:consume"]` | 12 | Google consume per IP per window |
| `RATE_LIMIT_MAX["admin"]` | 600 | Admin content-management requests per IP per window |
| `RATE_LIMIT_MAX["ip:global"]` | 600 | Hard per-IP cap across all limited routes |

### 10.3 All `osler.config.json` sections at a glance

| Section | Fields | Purpose |
| --- | --- | --- |
| `schemaVersion` | `number` | Config schema version (currently `1`) |
| `site` | `name`, `shortName`, `tagline`, `githubRepo`, `organisation`, `supportEmail` | Brand identity |
| `engines` | per-engine `{ enabled, label?, singular?, color?, icon? }` | Engine plugin toggles |
| `themes.default` | `string` | Default theme id |
| `themes.custom` | array of theme palettes | Custom theme definitions |
| `defaults.view` | `string` | Default landing view |
| `defaults.language` | `{ ui, content }` | Default UI + content languages |
| `defaults.quiz` | `{ questionCount, secondsPerQuestion, tutorMode, shuffle }` | Default quiz options |
| `defaults.ai` | `{ model, enabled, temperature }` | Default AI options |
| `defaults.sync` | `{ method, defaultRoom }` | Default P2P sync options |
| `cloud` | `{ enabled, apiUrl, turnstileSiteKey?, syncQbank, syncFlashcards }` | Cloud backend config |
| `wizard` | `{ completed, completedAt?, version }` | First-run wizard state |

### 10.4 All `wrangler.toml` sections at a glance

| Section | Purpose |
| --- | --- |
| `name`, `main`, `compatibility_date`, `workers_dev` | Worker identity |
| `[[d1_databases]]` | D1 binding (`env.DB`) |
| `[[r2_buckets]]` | R2 binding (`env.CONTENT`) |
| `[triggers] crons` | Cron schedule for `scheduled` handler |
| `[vars]` | Non-secret runtime variables (strings) |
| `[env.<name>.vars]` | Per-environment variable overrides |

### 10.5 Where to set each kind of value

| Kind of value | Where to set |
| --- | --- |
| Public, build-time, frontend-only | Root `.env.local` (local) or Pages/Vercel env vars (prod) — `NEXT_PUBLIC_*` prefix |
| Public, runtime, frontend-only | `public/osler.config.json` |
| Non-secret Worker config | `[vars]` block in `cloudflare/worker/wrangler.toml` |
| Secret Worker config | `wrangler secret put` (prod) or `.dev.vars` (local `wrangler dev`) |
| Tauri admin build-time config | `tauri-admin/.env` (gitignored) |
| Tauri admin runtime config | `tauri-admin/tauri.conf.json` |

---

> **Found an omission?** This document is hand-maintained against `cloudflare/worker/src/index.ts`, `src/lib/osler/config.ts`, `cloudflare/worker/wrangler.toml`, and the various `.env.example` files. If you add a new env var or config field, update both the code and this doc. Open a PR at <https://github.com/eyad-elghareeb/osler>.
