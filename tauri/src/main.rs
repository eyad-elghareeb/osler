// QuizTool Generator — Fully Standalone Tauri v2 Desktop App
// ============================================================
// All generator logic is embedded in Rust. No Python, no Flask,
// no sidecar, no external process dependencies. This single EXE
// serves the wizard frontend, generates project ZIPs, and calls
// GitHub/Netlify/Vercel APIs directly.
//
// Build: cargo build --release (from tauri/ directory)
// Output: tauri/target/release/quiztool-tauri.exe

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engines;
mod generator;
mod api_helpers;

use std::sync::Mutex;
use serde_json::Value;

// ── App state ────────────────────────────────────────────────────────────────

struct AppState {
    last_project_dir: Mutex<Option<String>>,
}

// ══════════════════════════════════════════════════════════════════════════════
//  ZIP GENERATION COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
fn generate_zip(config: generator::ProjectConfig) -> Result<Vec<u8>, String> {
    generator::build_project_zip(&config)
}

// ══════════════════════════════════════════════════════════════════════════════
//  GITHUB COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
fn github_verify(token: String) -> api_helpers::GithubUserInfo {
    api_helpers::github_verify(&token)
}

#[tauri::command]
fn github_publish(token: String, config: Value, visibility: String) -> Result<Value, String> {
    api_helpers::github_publish(&token, &config, &visibility)
}

// ══════════════════════════════════════════════════════════════════════════════
//  NETLIFY COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
fn netlify_verify(token: String) -> api_helpers::NetlifyUserInfo {
    api_helpers::netlify_verify(&token)
}

#[tauri::command]
fn netlify_publish(token: String, config: Value) -> Result<Value, String> {
    api_helpers::netlify_publish(&token, &config)
}

// ══════════════════════════════════════════════════════════════════════════════
//  VERCEL COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
fn vercel_verify(token: String) -> api_helpers::VercelUserInfo {
    api_helpers::vercel_verify(&token)
}

#[tauri::command]
fn vercel_publish(token: String, config: Value) -> Result<Value, String> {
    api_helpers::vercel_publish(&token, &config)
}

// ══════════════════════════════════════════════════════════════════════════════
//  LOCAL DOWNLOAD
// ══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
fn download_local(
    config: generator::ProjectConfig,
    state: tauri::State<AppState>,
) -> Result<Value, String> {
    let zip_bytes = generator::build_project_zip(&config)?;
    let project_name = if config.project_name.is_empty() {
        "quiz-project".to_string()
    } else {
        config.project_name.clone()
    };
    let safe_name = api_helpers::safe_project_slug(&project_name);

    // Persist to sibling directory of QuizTool root, not temp dir
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

    // Extract ZIP — overwrite in-place, preserve user-added content
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
fn get_last_project_dir(state: tauri::State<AppState>) -> Option<String> {
    state.last_project_dir.lock().unwrap().clone()
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════════════════

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("quiztool", move |_app, request| {
            let path = request.uri().path().trim_start_matches('/');
            if path.is_empty() || path == "index.html" {
                tauri::http::Response::builder()
                    .header("Content-Type", "text/html; charset=utf-8")
                    .status(200)
                    .body(engines::FRONTEND_HTML.as_bytes().to_vec())
                    .unwrap()
            } else {
                tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap()
            }
        })
        .manage(AppState {
            last_project_dir: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
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
        .expect("Failed to run QuizTool application");
}