use std::path::{Path, PathBuf};
use std::fs;
use std::thread;
use std::sync::Arc;
use std::io::Cursor;
use std::time::Duration;
use regex::Regex;

pub struct QuizServer {
    pub port: u16,
}

struct ServerState {
    root: PathBuf,
    re_base: Regex,
}

// ── MIME type helpers ──────────────────────────────────────────────────────────

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs"  => "application/javascript; charset=utf-8",
        "css"         => "text/css; charset=utf-8",
        "json"        => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "svg"         => "image/svg+xml",
        "png"         => "image/png",
        "jpg" | "jpeg"=> "image/jpeg",
        "gif"         => "image/gif",
        "ico"         => "image/x-icon",
        "woff" | "woff2" => "font/woff2",
        "ttf"         => "font/ttf",
        "webp"        => "image/webp",
        _             => "application/octet-stream",
    }
}

fn ext_from_path(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
}

// ── Embedded engine lookup ─────────────────────────────────────────────────────

macro_rules! engine_bytes {
    ($name:expr) => {
        include_bytes!(concat!(env!("OUT_DIR"), "/engines/", $name))
    };
}

/// Try to find an embedded asset by exact filename (no path prefix).
fn lookup_embedded(filename: &str) -> Option<(&'static [u8], &'static str)> {
    match filename {
        "quiz-engine.js"       => Some((engine_bytes!("quiz-engine.js"),       "application/javascript; charset=utf-8")),
        "bank-engine.js"       => Some((engine_bytes!("bank-engine.js"),       "application/javascript; charset=utf-8")),
        "flashcard-engine.js"  => Some((engine_bytes!("flashcard-engine.js"),  "application/javascript; charset=utf-8")),
        "written-engine.js"    => Some((engine_bytes!("written-engine.js"),    "application/javascript; charset=utf-8")),
        "ai-assistant-engine.js" => Some((engine_bytes!("ai-assistant-engine.js"), "application/javascript; charset=utf-8")),
        "osce-engine.js"       => Some((engine_bytes!("osce-engine.js"),       "application/javascript; charset=utf-8")),
        "index-engine.js"      => Some((engine_bytes!("index-engine.js"),      "application/javascript; charset=utf-8")),
        "search-engine.js"     => Some((engine_bytes!("search-engine.js"),     "application/javascript; charset=utf-8")),
        "index-engine.css"     => Some((engine_bytes!("index-engine.css"),     "text/css; charset=utf-8")),
        "sync-engine.js"       => Some((engine_bytes!("sync-engine.js"),       "application/javascript; charset=utf-8")),
        "favicon.svg"          => Some((engine_bytes!("favicon.svg"),          "image/svg+xml")),
        "favicon.ico"          => Some((engine_bytes!("favicon.svg"),          "image/svg+xml")),
        "sw.js"                => Some((engine_bytes!("sw.js"),                "application/javascript; charset=utf-8")),
        "engine-shared.js"     => Some((engine_bytes!("engine-shared.js"),     "application/javascript; charset=utf-8")),
        "engine-shared.css"    => Some((engine_bytes!("engine-shared.css"),    "text/css; charset=utf-8")),
        "engine-tracker.js"    => Some((engine_bytes!("engine-tracker.js"),    "application/javascript; charset=utf-8")),
        "manifest.webmanifest" => Some((engine_bytes!("manifest.webmanifest"), "application/manifest+json; charset=utf-8")),
        "pdf-exporter.html"    => Some((engine_bytes!("pdf-exporter.html"),    "text/html; charset=utf-8")),
        _ => None,
    }
}

// ── Request handler ────────────────────────────────────────────────────────────

fn handle_request(state: &Arc<ServerState>, req: &tiny_http::Request) -> tiny_http::Response<Cursor<Vec<u8>>> {
    let url = req.url().to_string();

    // Normalize path: strip leading "/" and query strings
    let path_raw = url.trim_start_matches('/').split('?').next().unwrap_or("");
    let path_str = path_raw.replace('\\', "/");

    // --- CORS preflight ---------------------------------------------------
    if req.method() == &tiny_http::Method::Options {
        return cors_response(204, "text/plain", b"".to_vec());
    }

    // --- Root index -------------------------------------------------------
    if path_str.is_empty() || path_str == "index.html" {
        if let Some((bytes, mime)) = try_serve(state, PathBuf::from("index.html")) {
            return cors_response(200, mime, bytes);
        }
    }

    // --- Try to serve the requested path ----------------------------------
    let req_path = PathBuf::from(&path_str);
    if let Some((bytes, mime)) = try_serve(state, req_path) {
        return cors_response(200, mime, bytes);
    }

    // --- 404 --------------------------------------------------------------
    cors_response(404, "text/plain; charset=utf-8", b"404 Not Found".to_vec())
}

/// Core serving logic: same priority order as the Rocket version.
fn try_serve(state: &Arc<ServerState>, path: PathBuf) -> Option<(Vec<u8>, &'static str)> {
    let path_str = path.to_string_lossy().to_string().replace('\\', "/");
    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let is_root = !path_str.contains('/');

    // 1. Try disk first (project's own copy takes priority)
    let candidate = state.root.join(&path);
    if candidate.is_file() {
        let ext = ext_from_path(&candidate);
        if ext == "html" || ext == "htm" {
            if let Ok(data) = fs::read(&candidate) {
                let content = String::from_utf8_lossy(&data);
                let depth = {
                    let rel = candidate.strip_prefix(&state.root).unwrap_or(&candidate);
                    rel.components().count().saturating_sub(1)
                };
                let prefix = "../".repeat(depth);
                // Rewrite window.__QUIZ_ENGINE_BASE or __FLASHCARD_ENGINE_BASE for proper engine resolution
                let rewritten = state.re_base.replace(&content, |caps: &regex::Captures| {
                    format!("window.__{}_ENGINE_BASE='{}';", &caps[1], prefix)
                }).into_owned();
                return Some((rewritten.into_bytes(), "text/html; charset=utf-8"));
            }
        } else {
            let mime = mime_for_ext(&ext);
            if let Ok(data) = fs::read(&candidate) {
                return Some((data, mime));
            }
        }
    }

    // 2. Fall back to embedded engine (always an exact filename match)
    if let Some((bytes, mime)) = lookup_embedded(&path_str) {
        return Some((bytes.to_vec(), mime));
    }

    // 3. For subfolder paths, also try the bare filename in embedded
    if !is_root {
        if let Some((bytes, mime)) = lookup_embedded(&filename) {
            return Some((bytes.to_vec(), mime));
        }
    }

    // 4. Fallback for user assets in project root (e.g. icon-*.png)
    if !is_root {
        let root_candidate = state.root.join(&filename);
        if root_candidate.is_file() {
            let ext = ext_from_path(&root_candidate);
            if let Ok(data) = fs::read(&root_candidate) {
                return Some((data, mime_for_ext(&ext)));
            }
        }
    }

    None
}

/// Build a response with CORS headers.
fn cors_response(status: u16, content_type: &str, body: Vec<u8>) -> tiny_http::Response<Cursor<Vec<u8>>> {
    tiny_http::Response::new(
        tiny_http::StatusCode(status),
        vec![
            tiny_http::Header::from_bytes("Content-Type", content_type).unwrap(),
            tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
            tiny_http::Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
            tiny_http::Header::from_bytes("Access-Control-Allow-Headers", "*").unwrap(),
            tiny_http::Header::from_bytes("Cross-Origin-Resource-Policy", "cross-origin").unwrap(),
        ],
        Cursor::new(body),
        None,
        None,
    )
}

// ── Server start ───────────────────────────────────────────────────────────────

impl QuizServer {
    pub fn start(project_root: PathBuf) -> Self {
        let port = portpicker::pick_unused_port().expect("No free ports available");
        let root = project_root.clone();

        thread::spawn(move || {
            // Regex to rewrite engine base paths for correct depth
            let re_base = Regex::new(
                r#"(?s)window\.__(QUIZ|FLASHCARD|WRITTEN|OSCE)_ENGINE_BASE\s*=\s*[^;]*;"#
            ).unwrap();

            let state = Arc::new(ServerState { root, re_base });

            let addr = format!("127.0.0.1:{}", port);
            let server = match tiny_http::Server::http(&addr) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[QuizServer] FATAL: Could not bind to {}: {}", addr, e);
                    return;
                }
            };

            println!("[QuizServer] Listening on http://127.0.0.1:{}", port);

            for req in server.incoming_requests() {
                let resp = handle_request(&state, &req);
                let _ = req.respond(resp);
            }
        });

        thread::sleep(Duration::from_millis(100));
        Self { port }
    }
}
