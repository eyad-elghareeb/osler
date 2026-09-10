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
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

/// Path to the config file inside the project root.
const CONFIG_REL: &str = "public/osler.config.json";

/// Default config skeleton used when generating a new instance. Mirrors the
/// `DEFAULT_CONFIG` in `src/lib/osler/config.ts` so a fresh project boots
/// without surprises. Kept inline (not read from disk) so the admin app
/// doesn't need to ship a template file alongside the Rust binary.
const DEFAULT_CONFIG_TEMPLATE: &str = include_str!("../default-osler-config.json");
const CLOUDFLARE_WRANGLER: &str = include_str!("../../cloudflare/worker/wrangler.toml");

/// Resolve the config file path inside the project root.
fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_REL)
}

/// Top-level trees that must NEVER land in a generated instance, no matter how
/// the folder walk in `generate_instance_sync` is broadened later.
/// `tauri-admin/` is maintainer tooling (the desktop generator app's Rust
/// source + build tree) — an instance runs on Node.js alone and never needs
/// it. The rest are caches, VCS state, or previous admin/backup sidecars.
/// Path components that must never be copied into a generated instance when
/// they appear anywhere inside a copied template folder (dependency trees,
/// tool state, build output). Mirrors the top-level `is_generator_excluded`
/// intent for nested paths — e.g. `cloudflare/worker/dist` must not land in
/// a fresh instance just because its first component is `cloudflare`.
fn is_copy_skipped_component(name: &str) -> bool {
    matches!(name, "node_modules" | ".wrangler" | "target" | "dist")
}

/// Secret-bearing local files that must never land in a generated instance.
/// `cloudflare/worker/.dev.vars` holds the maintainer's live JWT / API keys;
/// its `.dev.vars.example` / `.env.example` siblings are safe templates and
/// are still copied.
fn is_copy_skipped_file(name: &str) -> bool {
    matches!(name, ".dev.vars")
}

fn is_generator_excluded(rel: &str) -> bool {
    let rel = rel.replace('\\', "/");
    let rel = rel.trim_start_matches('/');
    let first = rel.split('/').next().unwrap_or("");
    matches!(
        first,
        "tauri-admin"
            | ".git"
            | "node_modules"
            | "target"
            | ".next"
            | "out"
            | "dist"
            | ".wrangler"
            | ".osler-backup"
            | ".osler-admin"
    )
}

/// Prefer the complete instance template packaged with a production app. The
/// source-tree lookup remains solely for `cargo tauri dev`, where resources
/// are not installed next to a distributable app bundle.
fn resolve_template_root(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_template = resource_dir.join("template");
        if bundled_template.join("src/app").is_dir()
            && bundled_template.join("package.json").is_file()
        {
            return Some(bundled_template);
        }
    }

    resolve_template_root_from_source()
}

fn resolve_template_root_from_source() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let mut curr = exe.parent();
        while let Some(p) = curr {
            if p.join("src/app").is_dir() && p.join("package.json").is_file() {
                return Some(p.to_path_buf());
            }
            curr = p.parent();
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut curr = Some(cwd.as_path());
        while let Some(p) = curr {
            if p.join("src/app").is_dir() && p.join("package.json").is_file() {
                return Some(p.to_path_buf());
            }
            curr = p.parent();
        }
    }
    None
}

/* ═══════════════════════════════════════════════════════════════════════
read_config / write_config
═══════════════════════════════════════════════════════════════════════ */

/// Read the project's `osler.config.json`. Returns the parsed JSON object.
#[tauri::command]
pub async fn read_config(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let p = config_path(&root);
        if !p.is_file() {
            return Err("Config file not found. Run the first-time wizard to create one.".into());
        }
        let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
        let parsed: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        Ok(parsed)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write a new config object to `osler.config.json`. Creates the file (and
/// the `public/` parent) if missing. Pretty-prints with 2-space indentation.
#[tauri::command]
pub async fn write_config(config: Value, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let p = config_path(&root);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let body = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(&p, body).map_err(|e| e.to_string())?;
        Ok(json!({ "written": true, "path": CONFIG_REL }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Check whether the project has a config file. Used by the frontend to
/// decide whether to launch the first-time wizard automatically.
#[tauri::command]
pub async fn config_exists(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let p = config_path(&root);
        Ok(json!({ "exists": p.is_file(), "path": CONFIG_REL }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ═══════════════════════════════════════════════════════════════════════
generate_instance — scaffold a brand-new Osler project
═══════════════════════════════════════════════════════════════════════ */

/// Options passed to `generate_instance`. All fields are required; the
/// frontend wizard collects them before calling this command.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceOptions {
    pub target_dir: String,
    pub site_name: String,
    pub short_name: String,
    pub tagline: String,
    pub github_repo: String,
    pub organisation: String,
    pub enabled_engines: Vec<String>,
    pub default_theme: String,
    pub default_lang: String,
    pub include_sample_content: bool,
    pub cloud: Option<InstanceCloudOptions>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceCloudOptions {
    pub enabled: bool,
    pub worker_url: String,
    pub worker_name: String,
    pub project_name: String,
    pub d1_name: String,
    pub r2_name: String,
    pub allowed_origin: String,
    pub turnstile_site_key: String,
}

/// Generate a new Osler instance into `target_dir`. Creates the directory
/// structure, copies core framework files, writes a starter `osler.config.json`,
/// `package.json`, and content folders. Returns a summary of what was created.
#[tauri::command]
pub async fn generate_instance(opts: InstanceOptions, app: AppHandle) -> Result<Value, String> {
    let template_root = resolve_template_root(&app);
    tauri::async_runtime::spawn_blocking(move || generate_instance_sync(opts, template_root))
        .await
        .map_err(|e| e.to_string())?
}

fn generate_instance_sync(opts: InstanceOptions, template_root: Option<PathBuf>) -> Result<Value, String> {
    let source_root = template_root.or_else(|| resolve_template_root_from_source()).ok_or_else(|| {
        "Could not locate the bundled Osler instance template. Reinstall the Osler Instance Manager or run it from an Osler source checkout during development.".to_string()
    })?;
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
            return Err(format!(
                "Target path is not a directory: {}",
                target.display()
            ));
        }
    } else {
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    }

    let mut created_files: Vec<String> = Vec::new();
    let mut created_dirs: Vec<String> = Vec::new();

    let cloud_enabled = opts.cloud.as_ref().is_some_and(|cloud| cloud.enabled);

    // ── 1. Copy the complete runnable framework template ──────────────
    // `public/` is required for PWA assets, fonts, and static metadata.
    // `functions/` holds the Pages RSC-rewrite Function — without it a
    // Pages-deployed instance serves 404s on client prefetch payloads. The
    // instance-specific config and content tree are created below instead.
    for folder in ["src", "scripts", "cloudflare", "public", "functions"] {
        let src_folder = source_root.join(folder);
        if !src_folder.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&src_folder).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.components().any(|c| {
                is_copy_skipped_component(c.as_os_str().to_string_lossy().as_ref())
            }) {
                continue;
            }
            if entry.file_type().is_file()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(is_copy_skipped_file)
            {
                continue;
            }
            if let Ok(rel) = path.strip_prefix(&source_root) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if is_generator_excluded(&rel_str)
                    || rel_str == "public/osler.config.json"
                    || rel_str.starts_with("public/osler-content/")
                {
                    continue;
                }
                let target_path = target.join(rel);
                if entry.file_type().is_dir() {
                    fs::create_dir_all(&target_path).map_err(|e| e.to_string())?;
                } else if entry.file_type().is_file() {
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::copy(path, &target_path).map_err(|e| e.to_string())?;
                    created_files.push(rel_str);
                }
            }
        }
    }

    for root_file in [
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "next.config.ts",
        "tailwind.config.ts",
        "postcss.config.mjs",
        "components.json",
        "eslint.config.mjs",
        // Documents the NEXT_PUBLIC_* overrides and the production session
        // secret so a fresh instance owner finds them without the upstream repo.
        ".env.example",
    ] {
        let sf = source_root.join(root_file);
        let tf = target.join(root_file);
        if sf.is_file() {
            fs::copy(&sf, &tf).map_err(|e| e.to_string())?;
            created_files.push(root_file.into());
        }
    }

    if let Some(cloud) = opts.cloud.as_ref().filter(|cloud| cloud.enabled) {
        let package_path = target.join("package.json");
        let raw = fs::read_to_string(&package_path).map_err(|e| e.to_string())?;
        let mut package: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let scripts = package
            .get_mut("scripts")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "Instance template package.json has no scripts object".to_string())?;
        scripts.insert(
            "deploy:pages".into(),
            json!(format!(
                "npx wrangler pages deploy out --project-name {}",
                cloud.project_name
            )),
        );
        fs::write(
            &package_path,
            serde_json::to_string_pretty(&package).map_err(|e| e.to_string())? + "\n",
        )
        .map_err(|e| e.to_string())?;
    }

    // ── 2. Content structure ──────────────────────────────────────────
    let content_root = target.join("public/osler-content");
    {
        for sub in ["qbank", "flashcard", "osce", "library", "videos"] {
            let p = content_root.join(sub);
            fs::create_dir_all(&p).map_err(|e| e.to_string())?;
            created_dirs.push(format!("public/osler-content/{}", sub));

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
    }

    // ── 3. osler.config.json ───────────────────────────────────────────
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

    if let Some(cloud) = opts.cloud.as_ref().filter(|cloud| cloud.enabled) {
        if let Some(root) = cfg.as_object_mut() {
            root.insert(
                "cloud".into(),
                json!({
                    "enabled": true,
                    "apiUrl": cloud.worker_url.trim_end_matches('/'),
                    "turnstileSiteKey": cloud.turnstile_site_key,
                    "syncQbank": true,
                    "syncFlashcards": true,
                    "syncContent": true,
                    "resources": {
                        "workerName": sanitize_worker_name(&cloud.worker_name, &opts.short_name),
                        "pagesProject": cloud.project_name,
                        "d1Name": cloud.d1_name,
                        "r2Name": cloud.r2_name,
                    },
                }),
            );
        }
    }

    if let Some(wizard) = cfg.get_mut("wizard").and_then(|v| v.as_object_mut()) {
        wizard.insert("completed".into(), json!(!cloud_enabled));
        if !cloud_enabled {
            wizard.insert("completedAt".into(), json!(chrono_now_iso()));
        }
    }

    let cfg_path = target.join("public/osler.config.json");
    if let Some(parent) = cfg_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    created_files.push("public/osler.config.json".into());

    // ── 4. Optional Cloudflare Worker configuration ───────────────────
    if let Some(cloud) = opts.cloud.as_ref().filter(|cloud| cloud.enabled) {
        let worker_name = sanitize_worker_name(&cloud.worker_name, &opts.short_name);
        let worker_config = configure_worker_toml(
            CLOUDFLARE_WRANGLER,
            &worker_name,
            &cloud.d1_name,
            &cloud.r2_name,
            &cloud.allowed_origin,
        );
        let worker_toml = target.join("cloudflare/worker/wrangler.toml");
        fs::write(worker_toml, worker_config).map_err(|e| e.to_string())?;

        // Unique relay Worker name: every generated instance in the same
        // Cloudflare account deploys its own email relay, so the fixed
        // "osler-email" template name would make instances overwrite each
        // other's relay. setup.rs reads this name when wiring the binding.
        let email_toml_path = target.join("cloudflare/email-worker/wrangler.toml");
        if email_toml_path.is_file() {
            // "-email" suffix must fit Cloudflare's 63-char Worker name limit.
            let base: String = worker_name.chars().take(57).collect();
            let relay_name = format!("{base}-email").trim_end_matches('-').to_string();
            let email_toml = fs::read_to_string(&email_toml_path).map_err(|e| e.to_string())?;
            fs::write(
                &email_toml_path,
                email_toml.replacen("name = \"osler-email\"", &format!("name = \"{relay_name}\""), 1),
            )
            .map_err(|e| e.to_string())?;
            created_files.push("cloudflare/email-worker/wrangler.toml".into());
        }
    }

    // ── 5. README.md & .gitignore ───────────────────────────────────
    let readme = format!(
        "# {name}\n\n{tagline}\n\nThis instance was scaffolded by the Osler Admin instance generator.\n\nIt needs only Node.js — the `tauri-admin/` desktop tooling from upstream is maintainer-only and intentionally not included.\n\n- **GitHub repo:** {repo}\n- **Organisation:** {org}\n- **Default theme:** {theme}\n- **Default language:** {lang}\n- **Enabled engines:** {engines}\n- **Cloud accounts and sync:** {cloud}\n\n## Getting started\n\n```bash\nnpm install\nnpm run generate-manifests\nnpm run dev\n```\n\n## Cloud Deploy commands\n\n```bash\nnpm run deploy:pages   # Deploy static web app to Cloudflare Pages\nnpm run deploy:worker  # Deploy backend Worker to Cloudflare Workers\n```\n\nSee `public/osler.config.json` to customise the site name, engines, themes, and cloud mode.\n",
        name = opts.site_name,
        tagline = opts.tagline,
        repo = opts.github_repo,
        org = opts.organisation,
        theme = opts.default_theme,
        lang = opts.default_lang,
        engines = opts.enabled_engines.join(", "),
        cloud = if cloud_enabled { "enabled (Cloudflare Worker + D1 + R2)" } else { "local-only" },
    );
    let readme_path = target.join("README.md");
    fs::write(&readme_path, readme).map_err(|e| e.to_string())?;
    created_files.push("README.md".into());

    let gitignore = "# Dependencies\nnode_modules/\n\n# Build output\n.next/\nout/\ndist/\n\n# Environment\n.env\n.env.local\n.env*.local\ncloudflare/worker/.dev.vars\n\n# Backups\n.osler-backup/\n\n# Editor\n.vscode/\n.idea/\n*.swp\n.DS_Store\n\n# Logs\n*.log\nnpm-debug.log*\n";
    fs::write(target.join(".gitignore"), gitignore).map_err(|e| e.to_string())?;
    created_files.push(".gitignore".into());

    // ── 6. Optional sample content ─────────────────────────────────────
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
        if let Some(parent) = qpath.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&qpath, serde_json::to_string_pretty(&sample_quiz).unwrap())
            .map_err(|e| e.to_string())?;
        created_files.push("public/osler-content/qbank/welcome/questions.json".into());

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
        fs::write(
            &qm_path,
            serde_json::to_string_pretty(&qbank_manifest).unwrap(),
        )
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

fn configure_worker_toml(
    template: &str,
    worker_name: &str,
    d1_name: &str,
    r2_name: &str,
    origin: &str,
) -> String {
    let origin = origin.trim_end_matches('/').replace('"', "");
    let origin = if origin.is_empty() {
        "http://localhost:3000".to_string()
    } else {
        origin
    };
    let mut configured_d1 = false;
    let mut configured_r2 = false;

    template
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("name = ") {
                format!("name = \"{worker_name}\"")
            } else if trimmed.starts_with("database_name = ") && !configured_d1 {
                configured_d1 = true;
                format!("database_name = \"{d1_name}\"")
            } else if trimmed.starts_with("bucket_name = ") && !configured_r2 {
                configured_r2 = true;
                format!("bucket_name = \"{r2_name}\"")
            } else if trimmed.starts_with("ALLOWED_ORIGIN = ") {
                format!("ALLOWED_ORIGIN = \"{origin}\"")
            } else if trimmed.starts_with("# APP_ORIGIN = ") {
                format!("APP_ORIGIN = \"{origin}\"")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn sanitize_worker_name(value: &str, fallback: &str) -> String {
    let candidate: String = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let candidate = candidate.trim_matches('-');
    if candidate.is_empty() {
        format!("{}-cloud", fallback.to_ascii_lowercase().replace(' ', "-"))
    } else {
        candidate.chars().take(63).collect()
    }
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("<epoch:{}>", secs)
}

#[cfg(test)]
mod tests {
    use super::{configure_worker_toml, is_generator_excluded};

    #[test]
    fn generated_worker_config_keeps_canonical_bindings() {
        let toml = configure_worker_toml(
            "name = \"osler-cloud\"\nmain = \"src/index.ts\"\n[[d1_databases]]\ndatabase_name = \"osler-cloud\"\n[[r2_buckets]]\nbinding = \"CONTENT\"\nbucket_name = \"osler-content\"\n[durable_objects]\nbindings = []\n[vars]\nALLOWED_ORIGIN = \"http://localhost:3000\"\n# APP_ORIGIN = \"https://your-app.pages.dev\"\n",
            "school-cloud",
            "school-db",
            "school-content",
            "https://school.pages.dev",
        );
        assert!(toml.contains("name = \"school-cloud\""));
        assert!(toml.contains("main = \"src/index.ts\""));
        assert!(toml.contains("database_name = \"school-db\""));
        assert!(toml.contains("binding = \"CONTENT\""));
        assert!(toml.contains("bucket_name = \"school-content\""));
        assert!(toml.contains("[durable_objects]"));
        assert!(toml.contains("APP_ORIGIN = \"https://school.pages.dev\""));
    }

    #[test]
    fn tauri_admin_never_lands_in_instances() {
        for p in [
            "tauri-admin",
            "tauri-admin/src/main.rs",
            "tauri-admin/src/config.rs",
            "tauri-admin/frontend/views/instance.js",
            "tauri-admin/Cargo.toml",
            "tauri-admin/Cargo.lock",
            "tauri-admin/target/debug/osler-admin",
            "tauri-admin\\.gen\\schemas\\x.json",
        ] {
            assert!(is_generator_excluded(p), "should exclude: {}", p);
        }
    }

    #[test]
    fn instance_paths_still_pass_through() {
        for p in [
            "src/app/page.tsx",
            "src/lib/osler/config.ts",
            "scripts/generate-content-manifests.js",
            "cloudflare/worker/src/index.ts",
            "cloudflare/worker/migrations/0001_schema.sql",
            "package.json",
            "public/osler.config.json",
            "functions/[[path]].js",
            ".env.example",
            // Prefix lookalike — a different top-level dir, must pass.
            "tauri-admin-notes/todo.md",
        ] {
            assert!(!is_generator_excluded(p), "should pass: {}", p);
        }
    }

    #[test]
    fn nested_build_output_and_secrets_stay_out() {
        use super::{is_copy_skipped_component, is_copy_skipped_file};
        for p in ["node_modules", ".wrangler", "target", "dist"] {
            assert!(is_copy_skipped_component(p), "should skip: {}", p);
        }
        for p in ["src", "migrations", "functions", "images"] {
            assert!(!is_copy_skipped_component(p), "should pass: {}", p);
        }
        assert!(is_copy_skipped_file(".dev.vars"));
        for p in [".dev.vars.example", ".env.example", "wrangler.toml", "package.json"] {
            assert!(!is_copy_skipped_file(p), "should pass: {}", p);
        }
    }

    #[test]
    fn caches_and_sidecars_stay_out() {
        for p in [
            ".git/HEAD",
            "node_modules/next/dist/x.js",
            "target/debug/app",
            ".next/static/x.js",
            "out/index.html",
            "dist/bundle.js",
            ".wrangler/state/x.json",
            ".osler-backup/backup-1/src/y.ts",
            ".osler-admin/deploy.json",
        ] {
            assert!(is_generator_excluded(p), "should exclude: {}", p);
        }
    }
}
