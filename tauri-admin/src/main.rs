// main.rs — Tauri admin dashboard entry point
// Project root = directory containing this EXE (portable .exe in project root)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod deploy;
mod git;
mod parser;
mod pdf;
mod server;
mod templates;

use commands::ProjectRoot;
use notify::{EventKind, RecursiveMode, Watcher};
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

// ── URI scheme: quiztool-admin:// → serves the SPA ───────────────────────────
fn handle_admin_request(req: Request<Vec<u8>>, port: u16) -> Response<Vec<u8>> {
    let uri = req.uri().to_string();
    if uri.contains("/admin/pdf-exporter") {
        return serve_embedded(include_bytes!(concat!(env!("OUT_DIR"), "/engines/pdf-exporter.html")), "text/html; charset=utf-8");
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
        .name("quiztool-watcher".into())
        .spawn(move || {
            let skip_dirs = [".git", "node_modules", "target", "__pycache__", ".quiztool", "tauri-admin", "tauri", "gen"];

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

// ── Main ──────────────────────────────────────────────────────────────────────
fn main() {
    let project_root = canonicalize_path(get_project_root());
    let server = QuizServer::start(project_root.clone());
    let port = server.port;

    tauri::Builder::default()
        .manage(ProjectRoot(Mutex::new(project_root.clone())))
        .manage(server)
        .register_uri_scheme_protocol("quiztool-admin", move |_app, req| {
            handle_admin_request(req, port)
        })
        .setup(move |app| {
            // Start file watcher to replace frontend polling
            start_file_watcher(app.handle().clone(), project_root.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuizTool Admin");
}
