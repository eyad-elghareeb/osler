// main.rs — Tauri admin dashboard entry point
// Project root = directory containing this EXE (portable .exe in project root)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Phase 5 reconciliation (B9 fix): declare new stub modules here.
// lib.rs re-exports them for integration tests.
mod commands;
mod deploy;
mod git;
mod parser;
mod pdf;
mod server;
mod templates;
// Phase 5 stubs (B9 fix):
mod analytics;
mod auth;
mod mcp_server;
mod validation;
// Phase 8 modules:
mod bundle_engines;
mod push_update;
mod updater;
// V2 modules (Phase 13/15):
mod providers;
mod keyring_store;
mod deploy_orchestrator;
mod generator_bundle;
mod preview_server;
mod commands_v2;
// Merged Generator modules:
mod generator_zip;
mod api_helpers;
mod engine_assets;

use commands::ProjectRoot;
use notify::{EventKind, RecursiveMode, Watcher};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    http::{Request, Response},
    Emitter,
};
use server::QuizServer;

// ── Embedded frontend ─────────────────────────────────────────────────────────
const FRONTEND_HTML: &str = include_str!("../frontend/index.html");

fn serve_embedded(content: &[u8], mime: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(200)
        .header("Content-Type", mime)
        .body(content.to_vec())
        .unwrap()
}

fn get_project_root() -> PathBuf {
    // 1. Check if we are running via 'cargo run'
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let path = PathBuf::from(manifest_dir);
        if path.ends_with("tauri-admin") {
            return path.parent().unwrap_or(&path).to_path_buf();
        }
        return path;
    }

    // 2. Portable mode: walk up from EXE directory looking for markers
    if let Ok(p) = std::env::current_exe() {
        if let Some(exe_dir) = p.parent() {
            let mut curr = exe_dir.to_path_buf();
            // Try up to 5 levels up
            for _ in 0..5 {
                if curr.join("engines").join("index-engine.js").exists() || curr.join("manifest.webmanifest").exists() || curr.join("engines").join("quiz-engine.js").exists() {
                    return curr;
                }
                // If we are in a 'target' folder, keep walking up
                let s = curr.to_string_lossy().replace('\\', "/");
                if s.ends_with("/target/debug") || s.ends_with("/target/release") || s.contains("/target/x86_64") {
                    // continue walking
                } else if curr.ends_with("scripts") || curr.ends_with("bin") || (curr.join("Cargo.toml").exists() && !curr.join("index-engine.js").exists()) {
                    // We are in the tauri-admin source folder, root is parent
                    return curr.parent().unwrap_or(&curr).to_path_buf();
                }

                if let Some(parent) = curr.parent() {
                    curr = parent.to_path_buf();
                } else {
                    break;
                }
            }
            // If no marker found, default to EXE directory
            return exe_dir.to_path_buf();
        }
    }

    // 3. Fallback to CWD
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn canonicalize_path(p: PathBuf) -> PathBuf {
    let p = p.canonicalize().unwrap_or(p);
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        PathBuf::from(&s[4..])
    } else {
        p
    }
}

// ── URI scheme: osler-admin:// → serves the SPA ───────────────────────────
fn handle_admin_request(req: Request<Vec<u8>>, port: u16) -> Response<Vec<u8>> {
    let uri = req.uri().to_string();
    if uri.contains("/admin/pdf-exporter") {
        return serve_embedded(include_bytes!(concat!(env!("OUT_DIR"), "/engines/pdf-exporter.html")), "text/html; charset=utf-8");
    }

    // Serve the standalone generator wizard for the iframe
    if uri.contains("/generator.html") {
        return serve_embedded(include_str!("../frontend/generator.html").as_bytes(), "text/html; charset=utf-8");
    }

    // Inject the server port into the HTML
    let script = format!("<script>window.__QUIZ_SERVER_PORT = {};</script>", port);
    let mut html = FRONTEND_HTML.to_string();
    if let Some(pos) = html.find("<head>") {
        html.insert_str(pos + 6, &script);
    }

    Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .body(html.as_bytes().to_vec())
        .unwrap()
}

// ── File watcher ────────────────────────────────────────────────────
// Replaces the 3-second frontend polling with push-based notifications.

fn start_file_watcher(app_handle: tauri::AppHandle, root: PathBuf) {
    std::thread::Builder::new()
        .name("osler-watcher".into())
        .spawn(move || {
            let skip_dirs = [".git", "node_modules", "target", "__pycache__", ".osler", "tauri-admin", "tauri", "gen"];

            let (tx, rx) = std::sync::mpsc::channel();
            let mut watcher = match notify::recommended_watcher(move |res| {
                let _ = tx.send(res);
            }) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("[Watcher] Failed to start: {}", e);
                    return;
                }
            };

            // Track last event time for debouncing
            use std::time::Instant;
            let debounce = Duration::from_millis(500);
            let mut last_event: Option<Instant> = None;

            // Watch the project root
            if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
                eprintln!("[Watcher] Failed to watch root directory");
                return;
            }

            // Process events in a loop
            while let Ok(Ok(event)) = rx.recv() {
                // Skip non-modify events (e.g. metadata changes, access)
                let is_modify = matches!(event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                );
                if !is_modify { continue; }

                // Skip ignored directories
                let should_skip = event.paths.iter().any(|p| {
                    skip_dirs.iter().any(|skip| {
                        p.components().any(|c| c.as_os_str() == std::ffi::OsStr::new(skip))
                    })
                });
                if should_skip { continue; }

                // Debounce: only emit if 500ms has passed since last event
                let now = Instant::now();
                if let Some(last) = last_event {
                    if now.duration_since(last) < debounce { continue; }
                }
                last_event = Some(now);

                // Run sync in a best-effort manner
                let _ = app_handle.emit("files-changed", ());
            }
        })
        .ok();
}

// ══════════════════════════════════════════════════════════════════════════════
//  MERGED GENERATOR COMMANDS (from tauri/src/main.rs)
// ══════════════════════════════════════════════════════════════════════════════

struct GeneratorState {
    last_project_dir: Mutex<Option<String>>,
}

#[tauri::command]
fn generate_zip(config: generator_zip::ProjectConfig) -> Result<Vec<u8>, String> {
    generator_zip::build_project_zip(&config)
}

#[tauri::command]
fn github_verify(token: String) -> api_helpers::GithubUserInfo {
    api_helpers::github_verify(&token)
}

#[tauri::command]
fn github_publish(token: String, config: Value, visibility: String) -> Result<Value, String> {
    api_helpers::github_publish(&token, &config, &visibility)
}

#[tauri::command]
fn netlify_verify(token: String) -> api_helpers::NetlifyUserInfo {
    api_helpers::netlify_verify(&token)
}

#[tauri::command]
fn netlify_publish(token: String, config: Value) -> Result<Value, String> {
    api_helpers::netlify_publish(&token, &config)
}

#[tauri::command]
fn vercel_verify(token: String) -> api_helpers::VercelUserInfo {
    api_helpers::vercel_verify(&token)
}

#[tauri::command]
fn vercel_publish(token: String, config: Value) -> Result<Value, String> {
    api_helpers::vercel_publish(&token, &config)
}

#[tauri::command]
fn download_local(
    config: generator_zip::ProjectConfig,
    state: tauri::State<GeneratorState>,
) -> Result<Value, String> {
    let zip_bytes = generator_zip::build_project_zip(&config)?;
    let project_name = if config.project_name.is_empty() {
        "quiz-project".to_string()
    } else {
        config.project_name.clone()
    };
    let safe_name = api_helpers::safe_project_slug(&project_name);

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let projects_dir = if exe_dir.join("engines").join("index-engine.js").exists() || exe_dir.join("manifest.webmanifest").exists() {
        exe_dir.parent().unwrap_or(&exe_dir).to_path_buf()
    } else {
        exe_dir
    };
    let project_dir = projects_dir.join(&safe_name);
    std::fs::create_dir_all(&project_dir).map_err(|e| format!("Failed to create dir: {}", e))?;

    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read ZIP: {}", e))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        let outpath = project_dir.join(file.name());
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract: {}", e))?;
        }
    }

    let dir_str = project_dir.to_string_lossy().to_string();
    *state.last_project_dir.lock().unwrap() = Some(dir_str.clone());

    Ok(serde_json::json!({
        "ok": true,
        "project_dir": dir_str,
        "project_name": safe_name
    }))
}

#[tauri::command]
fn get_last_project_dir(state: tauri::State<GeneratorState>) -> Option<String> {
    state.last_project_dir.lock().unwrap().clone()
}

// ── Main ──────────────────────────────────────────────────────────────────────
fn main() {
    let project_root = canonicalize_path(get_project_root());
    let server = QuizServer::start(project_root.clone());
    let port = server.port;

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        // Phase 6.5 fix #13: register tauri-plugin-dialog for file pickers
        // (Anki CSV import, JSON file open/save in the ContentEditor).
        .plugin(tauri_plugin_dialog::init())
        .manage(ProjectRoot(Mutex::new(project_root.clone())))
        .manage(GeneratorState {
            last_project_dir: Mutex::new(None),
        })
        .manage(server)
        .register_uri_scheme_protocol("osler-admin", move |_app, req| {
            handle_admin_request(req, port)
        })
        .setup(move |app| {
            // Start file watcher to replace frontend polling
            start_file_watcher(app.handle().clone(), project_root.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::list_files,
            commands::project_state,
            commands::load_file,
            commands::save_file,
            commands::validate_file,
            commands::create_folder,
            commands::create_file,
            commands::duplicate_file,
            commands::move_file,
            commands::delete_file,
            commands::delete_folder,
            commands::convert_file,
            commands::convert_to_flashcard,
            commands::run_sync,
            commands::git_commit,
            commands::git_pull,
            commands::git_push,
            commands::git_force_push,
            commands::git_clone,
            commands::create_pr,
            commands::merge_pr,
            commands::list_prs,
            commands::provider_verify,
            commands::provider_deploy,
            commands::open_in_browser,
            commands::read_saved_token,
            commands::save_token,
            commands::read_external_file,
            commands::parse_json_questions,
            commands::load_exports_batch,
            commands::export_pdf,
            commands::check_pdf_deps,
            // Phase 5 stub commands (B9 fix — registered now so cargo build verifies
            // they compile; Phase 5 sessions will implement them).
            auth::auth_login_github,
            auth::auth_poll_github,
            auth::auth_get_token,
            auth::auth_clear_token,
            auth::auth_user_info,
            mcp_server::mcp_start_server,
            mcp_server::mcp_stop_server,
            mcp_server::mcp_list_tools,
            validation::validate_content,
            commands::generate_content,
            // Phase 6.5 fix #18: real Firestore-backed analytics query.
            analytics::query_analytics,
            // Phase 8 commands:
            commands::bundle_update,
            commands::bundle_verify,
            commands::check_update,
            commands::get_update_status,
            commands::apply_update,
            commands::push_update,
            commands::check_instance_versions,
            commands::get_push_status,
            commands::save_instance,
            commands::delete_instance,
            commands::load_instances,
            // V2 commands (Phase 13/15):
            commands_v2::generator_assemble_bundle,
            commands_v2::generator_start_preview,
            commands_v2::generator_stop_preview,
            commands_v2::generator_preview_status,
            commands_v2::deploy_v2,
            commands_v2::deploy_v2_rollback,
            commands_v2::deploy_v2_history,
            commands_v2::keyring_set,
            commands_v2::keyring_get,
            commands_v2::keyring_delete,
            commands_v2::keyring_test,
            // Merged Generator commands:
            generate_zip,
            github_verify,
            github_publish,
            netlify_verify,
            netlify_publish,
            vercel_verify,
            vercel_publish,
            download_local,
            get_last_project_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Osler Admin");
}
