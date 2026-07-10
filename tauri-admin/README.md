# Osler Admin — Tauri Project Dashboard

A standalone Tauri 2 desktop app that manages an Osler Next.js project from the
project root: edit content files, regenerate manifests, run `npm`/`bun` build
and start with live-streamed logs, and commit/push/pull to git.

The frontend is plain HTML/CSS/JS that ports the design language of the Osler
web app — same dark navy + amber palette, Geist + Cairo fonts (Cairo covers
Latin + Arabic so the same family can render both UI languages), RTL-aware
CSS with the `osler-ar` class hook, and an English + Arabic i18n dictionary
with a no-flash pre-hydration script. UI language and content language are
fully decoupled, just like the web app.

## Layout

```
tauri-admin/
├── Cargo.toml              — Tauri 2 deps
├── tauri.conf.json         — App config (frontendDist: "frontend")
├── build.rs                — Tauri build script
├── capabilities/
│   └── default.json        — Tauri 2 permissions (dialog, fs, shell, process)
├── src/
│   ├── main.rs             — Tauri boot + command registration
│   ├── lib.rs              — Module root
│   ├── commands.rs         — All #[tauri::command] handlers
│   ├── manifest.rs         — Manifest generator (Rust port of
│   │                         scripts/generate-content-manifests.js)
│   ├── validate.rs         — Content JSON schema validation
│   └── runner.rs           — Build/start runner (state in commands.rs)
└── frontend/
    ├── index.html          — App shell + pre-hydration script
    ├── styles.css          — Design tokens + components + RTL rules
    ├── i18n.js             — English + Arabic dictionary
    ├── main.js             — Tauri bridge + router + toasts
    └── views/
        ├── dashboard.js    — Project overview + quick actions
        ├── content.js      — File tree + JSON/markdown editor
        ├── manifest.js     — View + regenerate manifest.json per category
        ├── build.js        — Run build/start, stream logs
        ├── git.js          — Status, stage, commit, push, pull
        └── settings.js     — UI language, theme, project root
```

## Commands (Rust → frontend)

| Command             | Args                                              | Returns                                        |
| ------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `ping`              | —                                                 | `"osler-admin"`                                |
| `pick_project_root` | — (uses dialog plugin)                            | `{ picked, root, hasPackageJson, hasContentDir }` |
| `project_state`     | —                                                 | `{ root, hasPackageJson, hasContentDir, gitRemote, gitBranch }` |
| `list_files`        | —                                                 | `{ items: [...] }` (recursive tree)            |
| `load_file`         | `{ path }`                                        | `{ path, content }`                            |
| `save_file`         | `{ path, content }`                               | `{ saved, path }`                              |
| `create_file`       | `{ path, content? }`                              | `{ created, path }` (auto-scaffolds empty JSON)|
| `create_folder`     | `{ path }`                                        | `{ created, path }`                            |
| `delete_path`       | `{ path }`                                        | `{ deleted, path }`                            |
| `move_path`         | `{ from, to_folder }`                             | `{ moved, from, to }`                          |
| `rename_path`       | `{ path, new_name }`                              | `{ renamed, from, to }`                        |
| `generate_manifest` | —                                                 | `{ generated: [{ category, leafCount, type }] }` |
| `read_manifest`     | `{ category }`                                    | `manifest.json` parsed object                  |
| `write_manifest`    | `{ category, json }`                              | `{ written, category }`                        |
| `validate_content`  | `{ contentType, contentJson }`                    | `{ valid, errors: [] }`                        |
| `run_build`         | —                                                 | `{ started, kind: "build" }`                   |
| `run_start`         | —                                                 | `{ started, kind: "start" }`                   |
| `stop_runner`       | —                                                 | `{ stopped }`                                  |
| `runner_status`     | —                                                 | `{ kind, running, exitCode, startedAt, endedAt, stopRequested, logs: [...] }` |
| `git_status`        | —                                                 | `{ entries: [{ status, path }] }`              |
| `git_add`           | `{ paths: [] }`                                   | `{ added }`                                    |
| `git_commit`        | `{ message }`                                     | `{ committed, message }`                       |
| `git_push`          | —                                                 | `{ pushed, output }`                           |
| `git_pull`          | —                                                 | `{ pulled, output }`                           |
| `git_remote`        | —                                                 | `{ remote, branch }`                           |
| `open_external`     | `{ url }`                                         | `()`                                           |

## Build & run

### Prerequisites

- Rust 1.77+ (`rustup`)
- Tauri 2 system dependencies — see <https://tauri.app/start/prerequisites/>
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk-4.1`, `libgtk-3`, `libayatana-appindicator3`, etc.
  - **Windows**: WebView2 runtime (preinstalled on Win 11)

### Dev mode

```bash
cd tauri-admin
cargo tauri dev
```

The first run compiles all dependencies (~3 min). The app window opens, shows
the picker overlay, and prompts you to pick the Osler project root.

### Production build

```bash
cd tauri-admin
cargo tauri build
```

Output: a platform-specific installer in `tauri-admin/target/release/bundle/`.

### Browser preview (no Tauri)

The frontend is plain HTML/CSS/JS with no build step. To preview the UI
without compiling Tauri:

```bash
cd tauri-admin/frontend
python3 -m http.server 1420
# open http://localhost:1420 in a browser
```

In this mode, all Tauri `invoke()` calls fall back to a no-op mock that
returns empty data — the UI renders but no files are actually read or
written.

## How it fits into the Osler project

Place the `tauri-admin/` folder at the root of an Osler Next.js project:

```
osler-project/
├── package.json
├── public/
│   └── osler-content/
│       ├── flashcard/
│       ├── library/
│       ├── osce/
│       └── qbank/
├── src/
└── tauri-admin/           ← this folder
```

The Tauri app's "project root" picker should point at `osler-project/`. All
file CRUD commands are sandboxed under `public/osler-content/` to prevent
accidental edits to `src/` or `node_modules/`. Git and build commands run
at the project root.

## RTL + Arabic support

The frontend ports the same i18n + RTL layer as the Osler web app:

- **Pre-hydration script** in `index.html` reads `localStorage["osler-admin-lang"]`
  and sets `<html lang dir>` + `osler-ar` class before paint, so users who
  picked Arabic don't see an LTR flash.
- **i18n dictionary** in `frontend/i18n.js` covers every UI string in
  English + Arabic, with `{name}` placeholder interpolation.
- **RTL CSS** in `styles.css` uses `osler-ar` class hook + logical properties
  (`margin-inline-start`, `inset-inline-end`, etc.) so the same DOM flips
  correctly under RTL.
- **Cairo font** (loaded from Google Fonts) covers Latin + Arabic; Geist
  stays as the Latin default.
- **Toggle button** in the top bar switches UI language instantly; the
  current view re-renders so list-valued strings refresh too.

Content packs authored in Arabic render RTL regardless of UI language —
the same decoupling as the web app.

## License

Same as the parent Osler project.
