# Osler Instance Manager (v0.4)

A standalone Tauri 2 desktop app that takes an Osler instance from zero to fully deployed and configured — strictly an **instance generator and manager**, step by step, A to Z:

- **Assisted full setup** — prerequisites diagnostics + auto-installer, site identity & engine plugins, Cloudflare full-stack provisioning (D1 database, R2 bucket, Worker backend, Pages frontend, migrations, `JWT_SECRET`), Google Sign-In setup (OAuth client guidance + secrets written to the Worker), first-admin promotion, and a backend health check.
- **Direct 1-click deploys** — `npm run deploy:pages` / `npm run deploy:worker` from the dashboard.
- **Instance code updater** — pulls updates from main Osler with pre-update snapshots (`.osler-backup/`) while strictly preserving your content, branding, and secrets.

Content authoring happens in the web app's admin or your editor of choice — this app does not edit content.

## Layout

```
tauri-admin/
├── Cargo.toml              — Tauri 2 deps
├── tauri.conf.json         — App config (frontendDist: "frontend", CSP)
├── capabilities/
│   └── default.json        — Tauri 2 permissions (dialog, fs, shell, process)
├── src/
│   ├── main.rs             — Tauri boot + command registration
│   ├── lib.rs              — Module root
│   ├── commands.rs         — #[tauri::command] handlers (project, file CRUD, build/start, git)
│   ├── config.rs           — osler.config.json read/write + instance scaffolding
│   ├── setup.rs            — Assisted post-deploy setup (secrets, first admin, health check)
│   ├── deploy.rs           — Provider deploy pipelines (Vercel / GitHub Pages
│   │                         / Cloudflare Pages / Netlify) + Cloudflare full-stack runner
│   ├── github.rs           — GitHub OAuth sign-in, repos, fork, PR workflow
│   ├── instance_updater.rs — Update diffing, backups, patch apply/rollback
│   ├── prereq.rs           — Prerequisites check (Node, Git, Wrangler, CF login)
│   └── runner.rs           — Build/start runner (state in commands.rs)
└── frontend/
    ├── index.html             — App shell + pre-hydration script
    ├── instance-manager.html  — Dedicated Instance Manager entrypoint
    ├── styles.css             — Design tokens + components + RTL
    ├── i18n.js                — English + Arabic dictionary
    ├── main.js                — Tauri bridge + router + toasts + preview-mode mock
    └── views/
        ├── instance.js        — 5-step A-to-Z generator (prereqs → identity →
        │                        Cloudflare → deploy pipeline → finish setup)
        ├── instance-updater.js— Instance code update & rollback engine
        ├── wizard.js          — First-run setup wizard
        ├── config.js          — Structured config editor (5 tabs)
        ├── configure.js       — Config editor & instance generator hub
        ├── dashboard.js       — Project overview + quick actions
        ├── prereq.js          — Prerequisites check & 1-click installer
        ├── build.js           — Run build/start, stream logs
        ├── start.js           — Server runner (npm run start with live logs)
        ├── run-publish.js     — Combined build, start, git & deploy hub
        ├── git.js             — Status, stage, commit, push, pull
        ├── github.js          — GitHub OAuth sign-in, fork, repo sync
        ├── deploy.js          — Connect Provider & Deploy page
        └── settings.js        — UI language, theme, project root
```

## Assisted setup flow (A to Z)

The **Instance Generator** view walks through the same steps as [SELF-HOSTING.md](../SELF-HOSTING.md) §4:

1. **Prerequisites** — Node.js, Git, Wrangler, Cloudflare login (1-click installers for missing tools).
2. **Site identity & engines** — name, tagline, GitHub repo, engine plugins, theme, language, sample content.
3. **Cloudflare stack** — Worker/Pages/D1/R2 names, frontend origin, and optional Google Sign-In credentials (Client ID + Secret; the exact redirect URI is confirmed after deploy).
4. **Automated deploy** — scaffolds the complete runnable instance, creates D1 + R2, preserves the canonical Worker bindings (including realtime Durable Object and cron), applies migrations to the selected D1 database, generates + writes `JWT_SECRET`, deploys the Worker twice so its callback URL is live, records the discovered Worker URL in `osler.config.json`, then builds and deploys Pages.
5. **Finish setup** — the wizard only unlocks this step after a successful deployment and a saved Worker URL. Verify backend health, register the exact Google callback URI in Google Cloud Console before saving both OAuth credentials, then register and promote the first admin account.

### Google Sign-In setup for a non-technical administrator

The safe order is important because Google’s callback URL uses the Worker URL, which is only known after deployment:

1. In the wizard, expand **Google Sign-In** but leave the Client ID and Client Secret empty until the Worker has deployed.
2. On the **Ready** step, click **Open Google Cloud Console** and select or create a Google Cloud project.
3. Open **APIs & Services → OAuth consent screen**, choose **External** (or **Internal** for a Google Workspace organisation), complete the app details, and add the `openid`, `email`, and `profile` scopes. If the External app remains in testing, add the intended administrators as test users.
4. Open **Credentials → Create credentials → OAuth client ID**, choose **Web application**, and add the exact callback shown by Osler under **Authorized redirect URIs**. It must be the Worker URL ending in `/v1/auth/google/callback`; do not use the Pages URL, add a trailing slash, or add query parameters.
5. Copy the generated Client ID and Client Secret into Osler and click **Save Google secrets**. The values are sent directly to Worker secrets and are not stored in the generated project.

If Google reports `redirect_uri_mismatch`, compare the URI character-for-character with the Ready-step value, then save the secrets again after correcting it.

## Maintaining an existing instance

After selecting an instance directory, use **Cloud services** in the sidebar for a guided maintenance checklist:

1. **Verify Worker health** using the URL stored in `osler.config.json`.
2. **Configure or rotate Google Sign-In** credentials. The app shows the exact callback URI and writes credentials directly to Worker secrets; they are never persisted locally.
3. **Apply D1 migrations** after an Osler update. Use the D1 name recorded during instance creation (the UI pre-fills it).
4. **Deploy or rotate the Gmail relay** with a Gmail address, app password, sender name, and the public Pages/custom-domain origin. The manager installs relay dependencies, deploys it, writes the shared secrets, wires the same-account service binding, redeploys the main Worker, and applies the email-log migration.

Use **Instance updater** to compare an instance with the upstream source. It preserves branding, content, secrets, deployed resource configuration, and Git history while also bringing in email-relay source updates. After an update, apply any pending D1 migrations in **Cloud services**, then deploy the Worker and Pages from **Run & Publish**.

## Commands (Rust → frontend)

### Project / instance

| Command | Args | Returns |
| --- | --- | --- |
| `ping` | — | `"osler-admin"` |
| `set_project_root` | `{ root }` | `{ root, hasPackageJson, hasContentDir }` |
| `project_state` | — | `{ root, hasPackageJson, hasContentDir, gitRemote, gitBranch }` |
| `list_files` | — | `{ items: [...] }` (recursive tree) |
| `load_file` / `save_file` / `create_file` / `create_folder` / `delete_path` / `move_path` / `rename_path` | — | File CRUD |
| `install_project_dependencies` / `run_build` / `run_start` / `stop_runner` / `runner_status` | `{ targetDir? }` for install | Install a fresh instance, then build/start runner |
| `git_*` | — | Status, stage, commit, push, pull, branches, clone |
| `read_config` / `write_config` / `config_exists` | — | `osler.config.json` |
| `generate_instance` | `{ opts }` | Scaffolds a new instance |
| `check_instance_update` / `apply_instance_patch` / `rollback_instance_patch` / `list_instance_backups` | — | Instance updater |
| `check_prerequisites` / `install_prerequisite` | — | Prereq diagnostics + installers |
| `gh_*` | — | GitHub OAuth sign-in, repos, fork, PRs |
| `setup_generate_secret` | — | `{ secret }` — cryptographically random (Node crypto) |
| `setup_write_secrets` | `{ targetDir?, secrets: [{ name, value }] }` | Writes Worker secrets via `wrangler secret put`; values are never logged |
| `setup_promote_admin` | `{ targetDir?, d1Name?, username }` | Promotes a registered user to admin in D1 |
| `setup_check_health` | `{ workerUrl }` | `{ ok, status, body }` — `GET /v1/health` from Rust (the webview CSP blocks cross-origin fetch) |
| `get_deploy_config` / `set_deploy_config` / `clear_deploy_provider` / `test_deploy_connection` / `deploy` / `deploy_status` / `deploy_stop` / `clear_deploy_logs` / `deploy_pages_cli` / `deploy_worker_cli` / `deploy_cloudflare_full_stack` | — | Deploy pipelines |

## PAT storage & security

Provider credentials (PATs) are stored under `<project_root>/.osler-admin/deploy.json`:

- Created with mode `0600` on Unix; `.osler-admin/` is auto-appended to `.gitignore`.
- `get_deploy_config` redacts token-shaped fields before returning them.
- Empty token fields preserve previously saved values.
- `clear_deploy_provider` removes one provider's fields for credential rotation.
- Worker secrets (JWT, Google OAuth) are never written to disk — they go straight from the input field to `wrangler secret put`.

## Build & run

```bash
cd tauri-admin
cargo tauri dev      # development (first compile ~3–5 min)
cargo tauri build    # platform installer in target/release/bundle/
```

Prerequisites: Rust 1.77+, Tauri 2 system dependencies (<https://tauri.app/start/prerequisites/>).

### Browser preview (no Tauri)

```bash
cd tauri-admin/frontend
python3 -m http.server 1420
# open http://localhost:1420 — add ?preview=1 for the mock backend
```

In mock mode, `invoke()` calls fall back to no-op mocks; deploy commands return success-shaped responses so the flow can be exercised end-to-end.

## How it fits into the Osler project

Place `tauri-admin/` at the root of an Osler project (or run it from the main repo) and point the project picker at the instance folder. The Instance Generator creates ready-to-run instances at any target directory.

## RTL + Arabic support

The frontend ports the same i18n + RTL layer as the Osler web app: pre-hydration `lang/dir` script, full English + Arabic dictionary with `{name}` interpolation, logical-property CSS, and the Cairo font. The top-bar toggle switches language instantly.

## License

Same as the parent Osler project.
