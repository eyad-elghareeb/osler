// config.rs — Tauri IPC commands for reading / writing osler.config.json
// and generating a new Osler instance from a template.
//
// The config file lives at `<project_root>/public/osler.config.json`. The
// frontend (admin dashboard) reads it via `read_config` and writes it via
// `write_config`. The `generate_instance` command scaffolds a brand-new
// Osler project into a user-chosen directory by copying the template
// bundled with the admin app and patching in the user's site name, GitHub
// repo, and selected engines.

use crate::commands::ProjectRoot;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

/// Path to the config file inside the project root.
const CONFIG_REL: &str = "public/osler.config.json";

/// Default config skeleton used when generating a new instance. Mirrors the
/// `DEFAULT_CONFIG` in `src/lib/osler/config.ts` so a fresh project boots
/// without surprises. Kept inline (not read from disk) so the admin app
/// doesn't need to ship a template file alongside the Rust binary.
const DEFAULT_CONFIG_TEMPLATE: &str = include_str!("../default-osler-config.json");
const CLOUDFLARE_WORKER_SOURCE: &str = include_str!("../../cloudflare/worker/src/index.mjs");
const CLOUDFLARE_MIGRATION: &str = include_str!("../../cloudflare/worker/migrations/0001_initial.sql");
const CLOUDFLARE_PACKAGE: &str = include_str!("../../cloudflare/worker/package.json");
const CLOUDFLARE_DEV_VARS: &str = include_str!("../../cloudflare/worker/.dev.vars.example");
const CLOUDFLARE_README: &str = include_str!("../../cloudflare/worker/README.md");
const CLOUDFLARE_BACKEND_GUIDE: &str = include_str!("../../docs/cloudflare-backend.md");

/// Resolve the config file path inside the project root.
fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_REL)
}

/* ═══════════════════════════════════════════════════════════════════════
   read_config / write_config
   ═══════════════════════════════════════════════════════════════════════ */

/// Read the project's `osler.config.json`. Returns the parsed JSON object.
/// Returns a 404-style error if the file doesn't exist so the frontend can
/// prompt the user to run the first-time wizard.
#[tauri::command]
pub fn read_config(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    let p = config_path(&root);
    if !p.is_file() {
        return Err("Config file not found. Run the first-time wizard to create one.".into());
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(parsed)
}

/// Write a new config object to `osler.config.json`. Creates the file (and
/// the `public/` parent) if missing. Pretty-prints with 2-space indentation.
#[tauri::command]
pub fn write_config(config: Value, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    let p = config_path(&root);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&p, body).map_err(|e| e.to_string())?;
    Ok(json!({ "written": true, "path": CONFIG_REL }))
}

/// Check whether the project has a config file. Used by the frontend to
/// decide whether to launch the first-time wizard automatically.
#[tauri::command]
pub fn config_exists(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    let p = config_path(&root);
    Ok(json!({ "exists": p.is_file(), "path": CONFIG_REL }))
}

/* ═══════════════════════════════════════════════════════════════════════
   generate_instance — scaffold a brand-new Osler project
   ═══════════════════════════════════════════════════════════════════════ */

/// Options passed to `generate_instance`. All fields are required; the
/// frontend wizard collects them before calling this command.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceOptions {
    /// Absolute path of the new project directory. Must not exist or must
    /// be empty. The caller (frontend) picks this via the Tauri dialog.
    pub target_dir: String,
    /// Site name (e.g. "My Medical School").
    pub site_name: String,
    /// Short name for PWA / mobile home screen (e.g. "MMS").
    pub short_name: String,
    /// Tagline shown under the brand mark.
    pub tagline: String,
    /// Canonical GitHub repo URL.
    pub github_repo: String,
    /// Organisation / author name.
    pub organisation: String,
    /// Engine plugin ids to enable. The rest are disabled.
    pub enabled_engines: Vec<String>,
    /// Default theme id ("dark", "light", or a custom theme id).
    pub default_theme: String,
    /// Default UI language ("en" or "ar").
    pub default_lang: String,
    /// If true, copy the bundled template content (sample articles + a small
    /// quiz pack) into the new instance so it isn't empty. If false, only
    /// the framework + empty content folders are scaffolded.
    pub include_sample_content: bool,
    /// Optional Cloudflare Worker/D1 account and cloud-sync scaffold.
    pub cloud: Option<InstanceCloudOptions>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceCloudOptions {
    pub enabled: bool,
    pub worker_url: String,
    pub worker_name: String,
    pub allowed_origin: String,
    pub turnstile_site_key: String,
}

/// Generate a new Osler instance into `target_dir`. Creates the directory
/// structure, writes a starter `osler.config.json`, `package.json`, and
/// stub content folders. Returns a summary of what was created.
#[tauri::command]
pub fn generate_instance(opts: InstanceOptions) -> Result<Value, String> {
    let target = PathBuf::from(&opts.target_dir);

    // Validate the target directory.
    if target.exists() {
        if target.is_dir() {
            let mut entries = fs::read_dir(&target).map_err(|e| e.to_string())?;
            if entries.next().is_some() {
                return Err(format!(
                    "Target directory is not empty: {}",
                    target.display()
                ));
            }
        } else {
            return Err(format!("Target path is not a directory: {}", target.display()));
        }
    } else {
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    }

    let mut created_files: Vec<String> = Vec::new();
    let mut created_dirs: Vec<String> = Vec::new();

    // ── public/osler-content/ stub folders ──────────────────────────
    let content_root = target.join("public/osler-content");
    for sub in ["qbank", "flashcard", "osce", "library", "videos"] {
        let p = content_root.join(sub);
        fs::create_dir_all(&p).map_err(|e| e.to_string())?;
        created_dirs.push(format!("public/osler-content/{}", sub));

        // Per-category manifest.json so the app boots cleanly.
        let manifest = json!({
            "type": match sub {
                "qbank" => "quiz",
                "flashcard" => "flashcard",
                "osce" => "osce",
                "library" => "library",
                "videos" => "video",
                _ => "quiz",
            },
            "items": []
        });
        let mp = p.join("manifest.json");
        fs::write(&mp, serde_json::to_string_pretty(&manifest).unwrap())
            .map_err(|e| e.to_string())?;
        created_files.push(format!("public/osler-content/{}/manifest.json", sub));
    }

    // ── osler.config.json ───────────────────────────────────────────
    // Start from the bundled default template, then patch in the user's
    // choices. We parse → mutate → re-serialize so the resulting file is
    // always valid JSON even if the template drifts.
    let mut cfg: Value = serde_json::from_str(DEFAULT_CONFIG_TEMPLATE)
        .map_err(|e| format!("Internal template parse error: {}", e))?;

    if let Some(site) = cfg.get_mut("site").and_then(|v| v.as_object_mut()) {
        site.insert("name".into(), json!(opts.site_name));
        site.insert("shortName".into(), json!(opts.short_name));
        site.insert("tagline".into(), json!(opts.tagline));
        site.insert("githubRepo".into(), json!(opts.github_repo));
        site.insert("organisation".into(), json!(opts.organisation));
    }

    if let Some(engines) = cfg.get_mut("engines").and_then(|v| v.as_object_mut()) {
        // Disable every engine, then enable only the ones the user picked.
        for (_id, entry) in engines.iter_mut() {
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("enabled".into(), json!(false));
            }
        }
        for id in &opts.enabled_engines {
            if let Some(entry) = engines.get_mut(id).and_then(|v| v.as_object_mut()) {
                entry.insert("enabled".into(), json!(true));
            }
        }
    }

    if let Some(themes) = cfg.get_mut("themes").and_then(|v| v.as_object_mut()) {
        themes.insert("default".into(), json!(opts.default_theme));
    }

    if let Some(defaults) = cfg.get_mut("defaults").and_then(|v| v.as_object_mut()) {
        if let Some(lang) = defaults.get_mut("language").and_then(|v| v.as_object_mut()) {
            lang.insert("ui".into(), json!(opts.default_lang));
        }
    }

    let cloud_enabled = opts.cloud.as_ref().is_some_and(|cloud| cloud.enabled);
    if let Some(cloud) = opts.cloud.as_ref().filter(|cloud| cloud.enabled) {
        if let Some(root) = cfg.as_object_mut() {
            root.insert("cloud".into(), json!({
                "enabled": true,
                "apiUrl": cloud.worker_url.trim_end_matches('/'),
                "turnstileSiteKey": cloud.turnstile_site_key,
                "syncQbank": true,
                "syncFlashcards": true,
            }));
        }
    }

    if let Some(wizard) = cfg.get_mut("wizard").and_then(|v| v.as_object_mut()) {
        wizard.insert("completed".into(), json!(true));
        let now = chrono_now_iso();
        wizard.insert("completedAt".into(), json!(now));
    }

    let cfg_path = target.join("public/osler.config.json");
    fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap())
        .map_err(|e| e.to_string())?;
    created_files.push("public/osler.config.json".into());

    // ── Optional Cloudflare Worker + D1 backend ─────────────────────
    if let Some(cloud) = opts.cloud.as_ref().filter(|cloud| cloud.enabled) {
        let worker_root = target.join("cloudflare/worker");
        let worker_src = worker_root.join("src");
        let migration_dir = worker_root.join("migrations");
        fs::create_dir_all(&worker_src).map_err(|e| e.to_string())?;
        fs::create_dir_all(&migration_dir).map_err(|e| e.to_string())?;
        created_dirs.extend([
            "cloudflare".into(),
            "cloudflare/worker".into(),
            "cloudflare/worker/src".into(),
            "cloudflare/worker/migrations".into(),
        ]);

        let mut worker_config = format!(
            "name = \"{}\"\nmain = \"src/index.mjs\"\ncompatibility_date = \"2026-07-23\"\nworkers_dev = true\n\n[[d1_databases]]\nbinding = \"DB\"\ndatabase_name = \"{}\"\ndatabase_id = \"REPLACE_WITH_D1_DATABASE_ID\"\n\n[vars]\nALLOWED_ORIGIN = \"{}\"\nTURNSTILE_ENABLED = \"false\"\n",
            sanitize_worker_name(&cloud.worker_name, &opts.short_name),
            sanitize_worker_name(&cloud.worker_name, &opts.short_name),
            cloud.allowed_origin.trim_end_matches('/').replace('"', ""),
        );
        if worker_config.contains("ALLOWED_ORIGIN = \"\"") {
            worker_config = worker_config.replace("ALLOWED_ORIGIN = \"\"", "ALLOWED_ORIGIN = \"http://localhost:3000\"");
        }
        let files = [
            (worker_src.join("index.mjs"), CLOUDFLARE_WORKER_SOURCE, "cloudflare/worker/src/index.mjs"),
            (migration_dir.join("0001_initial.sql"), CLOUDFLARE_MIGRATION, "cloudflare/worker/migrations/0001_initial.sql"),
            (worker_root.join("package.json"), CLOUDFLARE_PACKAGE, "cloudflare/worker/package.json"),
            (worker_root.join(".dev.vars.example"), CLOUDFLARE_DEV_VARS, "cloudflare/worker/.dev.vars.example"),
            (worker_root.join("README.md"), CLOUDFLARE_README, "cloudflare/worker/README.md"),
        ];
        for (path, contents, relative) in files {
            fs::write(path, contents).map_err(|e| e.to_string())?;
            created_files.push(relative.into());
        }
        fs::write(worker_root.join("wrangler.toml"), worker_config).map_err(|e| e.to_string())?;
        created_files.push("cloudflare/worker/wrangler.toml".into());
        let docs_dir = target.join("docs");
        fs::create_dir_all(&docs_dir).map_err(|e| e.to_string())?;
        fs::write(docs_dir.join("cloudflare-backend.md"), CLOUDFLARE_BACKEND_GUIDE)
            .map_err(|e| e.to_string())?;
        created_dirs.push("docs".into());
        created_files.push("docs/cloudflare-backend.md".into());
    }

    // ── README.md ───────────────────────────────────────────────────
    let readme = format!(
        "# {name}\n\n{tagline}\n\nThis instance was scaffolded by the Osler Admin instance generator.\n\n- **GitHub repo:** {repo}\n- **Organisation:** {org}\n- **Default theme:** {theme}\n- **Default language:** {lang}\n- **Enabled engines:** {engines}\n- **Cloud accounts and sync:** {cloud}\n\n## Getting started\n\n```bash\nnpm install\nnpm run generate-manifests\nnpm run dev\n```\n\nSee `public/osler.config.json` to customise the site name, engines, themes, and cloud mode.\n\n{cloud_steps}",
        name = opts.site_name,
        tagline = opts.tagline,
        repo = opts.github_repo,
        org = opts.organisation,
        theme = opts.default_theme,
        lang = opts.default_lang,
        engines = opts.enabled_engines.join(", "),
        cloud = if cloud_enabled { "enabled (Cloudflare Worker + D1)" } else { "local-only" },
        cloud_steps = if cloud_enabled {
            "## Deploy cloud accounts and sync\n\nThe generated Worker lives in `cloudflare/worker/`. Follow the [full cloud backend guide](docs/cloudflare-backend.md) before switching the frontend to production. The instance includes a full Worker source file, D1 migration, `wrangler.toml`, and a secrets template; no credentials are written into this repository.\n"
        } else { "" },
    );
    let readme_path = target.join("README.md");
    fs::write(&readme_path, readme).map_err(|e| e.to_string())?;
    created_files.push("README.md".into());

    // ── .gitignore ──────────────────────────────────────────────────
    let gitignore = "# Dependencies\nnode_modules/\n\n# Build output\n.next/\nout/\ndist/\n\n# Environment\n.env\n.env.local\n.env*.local\ncloudflare/worker/.dev.vars\n\n# Editor\n.vscode/\n.idea/\n*.swp\n.DS_Store\n\n# Logs\n*.log\nnpm-debug.log*\n";
    fs::write(target.join(".gitignore"), gitignore).map_err(|e| e.to_string())?;
    created_files.push(".gitignore".into());

    // ── Optional sample content ─────────────────────────────────────
    if opts.include_sample_content {
        let sample_quiz = json!({
            "questions": [
                {
                    "id": "q1",
                    "question": format!("Welcome to {}! What is the body's largest organ?", opts.site_name),
                    "options": ["Liver", "Skin", "Brain", "Heart", "Lung"],
                    "correct": 1,
                    "explanation": "The skin is the body's largest organ by surface area and weight.",
                    "tags": ["anatomy", "intro"],
                    "difficulty": 1
                }
            ]
        });
        let qpath = content_root.join("qbank/welcome/questions.json");
        fs::create_dir_all(qpath.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&qpath, serde_json::to_string_pretty(&sample_quiz).unwrap())
            .map_err(|e| e.to_string())?;
        created_files.push("public/osler-content/qbank/welcome/questions.json".into());

        // Re-generate the qbank manifest to include the welcome pack.
        let qbank_manifest = json!({
            "type": "quiz",
            "items": [
                {
                    "uid": "welcome",
                    "title": "Welcome",
                    "type": "quiz",
                    "path": "qbank/welcome/",
                    "files": ["questions.json"],
                    "items": []
                }
            ]
        });
        let qm_path = content_root.join("qbank/manifest.json");
        fs::write(&qm_path, serde_json::to_string_pretty(&qbank_manifest).unwrap())
            .map_err(|e| e.to_string())?;
    }

    Ok(json!({
        "created": true,
        "targetDir": target.to_string_lossy(),
        "files": created_files,
        "dirs": created_dirs,
        "config": cfg,
    }))
}

fn sanitize_worker_name(value: &str, fallback: &str) -> String {
    let candidate: String = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' { ch } else { '-' })
        .collect();
    let candidate = candidate.trim_matches('-');
    if candidate.is_empty() {
        format!("{}-cloud", fallback.to_ascii_lowercase().replace(' ', "-"))
    } else {
        candidate.chars().take(63).collect()
    }
}

/// Best-effort ISO-8601 timestamp of "now". Used to stamp `wizard.completedAt`.
fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Simple ISO format without bringing in chrono. Sufficient for a timestamp
    // marker — consumers don't parse this back.
    format!("<epoch:{}>", secs)
}
