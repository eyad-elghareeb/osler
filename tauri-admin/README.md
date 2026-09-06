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
4. **Automated deploy** — scaffolds the instance, then runs the full Cloudflare pipeline (`scripts/cloudflare-init.js`): creates D1 + R2, patches `wrangler.toml` (origin, worker URL), applies migrations, generates + writes `JWT_SECRET`, deploys the Worker and Pages, and wires `cloud.apiUrl` into the generated `osler.config.json`.
5. **Finish setup** — backend health check, Google Sign-In secrets (if not collected in step 3, with the exact Authorized redirect URI to register in Google Cloud Console), and first-admin promotion (register in the app, then enter the username here — admin is never granted at registration).

## Commands (Rust → frontend)

### Project / instance

| Command | Args | Returns |
| --- | --- | --- |
| `ping` | — | `"osler-admin"` |
| `set_project_root` | `{ root }` | `{ root, hasPackageJson, hasContentDir }` |
| `project_state` | — | `{ root, hasPackageJson, hasContentDir, gitRemote, gitBranch }` |
| `list_files` | — | `{ items: [...] }` (recursive tree) |
| `load_file` / `save_file` / `create_file` / `create_folder` / `delete_path` / `move_path` / `rename_path` | — | File CRUD |
| `run_build` / `run_start` / `stop_runner` / `runner_status` | — | Build/start runner |
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
