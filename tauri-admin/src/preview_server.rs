// =============================================================================
// preview_server.rs  —  V2 (Phase 13)
// -----------------------------------------------------------------------------
// Local preview HTTP server for the generator wizard. Extracts the generated
// bundle zip to a temp directory, serves it on localhost, opens the browser.
//
// V1 has server.rs (used for content preview during authoring). This module
// is the V2 counterpart — used for previewing a complete generated site
// before deploy.
//
// Uses tiny_http (already in V1's Cargo.toml) for the HTTP server.
// =============================================================================

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use tiny_http::{Server, Response, Header};
use std::io::Cursor;

// =============================================================================
// State
// =============================================================================

static PREVIEW_RUNNING: AtomicBool = AtomicBool::new(false);
static PREVIEW_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

// =============================================================================
// Public API
// =============================================================================

/// Start a preview server for a generated bundle.
///
/// Extracts the zip to a temp directory, starts an HTTP server on the given
/// port (or the next free port if 5500 is taken), and returns the URL.
///
/// The server runs on a background thread. Call `stop_preview()` to stop it.
pub fn start_preview(bundle_zip: &Path, preferred_port: u16) -> Result<PreviewInfo, PreviewError> {
    if PREVIEW_RUNNING.load(Ordering::SeqCst) {
        return Err(PreviewError::AlreadyRunning);
    }

    // 1. Extract the bundle to a temp directory
    let temp_dir = tempfile::tempdir()
        .map_err(PreviewError::Io)?;
    let extract_dir = temp_dir.path().to_path_buf();

    extract_zip(bundle_zip, &extract_dir)?;

    // Save the temp dir path (so stop_preview can clean it up)
    *PREVIEW_DIR.lock().unwrap() = Some(extract_dir.clone());
    // Keep the TempDir alive by forgetting it — we'll clean up manually on stop
    std::mem::forget(temp_dir);

    // 2. Find a free port (try preferred, then preferred+1...up to +10)
    let port = find_free_port(preferred_port)
        .ok_or(PreviewError::NoFreePort(preferred_port))?;

    let server_root = extract_dir.clone();
    let server = Server::http(format!("127.0.0.1:{}", port))
        .map_err(|e| PreviewError::ServerStart(e.to_string()))?;

    let server = Arc::new(server);
    let server_clone = Arc::clone(&server);

    PREVIEW_RUNNING.store(true, Ordering::SeqCst);

    // 3. Start the server on a background thread
    thread::spawn(move || {
        while PREVIEW_RUNNING.load(Ordering::SeqCst) {
            // Accept one request at a time (good enough for preview)
            let request = match server_clone.recv() {
                Ok(r) => r,
                Err(_) => break,  // server closed
            };

            let url = request.url().to_string();
            let root = server_root.clone();
            let _ = request.respond(handle_request(&url, &root));
        }
    });

    let url = format!("http://127.0.0.1:{}/", port);

    // 4. Open the browser (best effort — don't fail if it doesn't open)
    let _ = open::that(&url);

    Ok(PreviewInfo {
        url,
        port,
        bundle_path: bundle_zip.to_string_lossy().to_string(),
    })
}

/// Stop the running preview server.
pub fn stop_preview() -> Result<(), PreviewError> {
    if !PREVIEW_RUNNING.load(Ordering::SeqCst) {
        return Ok(());  // not running — not an error
    }

    PREVIEW_RUNNING.store(false, Ordering::SeqCst);

    // Clean up the temp directory
    if let Some(dir) = PREVIEW_DIR.lock().unwrap().take() {
        // Best effort — ignore errors (the OS will clean up eventually)
        let _ = std::fs::remove_dir_all(&dir);
    }

    Ok(())
}

/// Check whether the preview server is currently running.
pub fn is_preview_running() -> bool {
    PREVIEW_RUNNING.load(Ordering::SeqCst)
}

// =============================================================================
// Result types
// =============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct PreviewInfo {
    pub url: String,
    pub port: u16,
    pub bundle_path: String,
}

// =============================================================================
// Internal: request handling
// =============================================================================

fn handle_request(url: &str, root: &Path) -> Response<Cursor<Vec<u8>>> {
    // Parse the URL — strip query string
    let path = url.split('?').next().unwrap_or(url);

    // SPA routing: serve index.html for unknown paths (but not for assets)
    let file_path = if path == "/" || path.is_empty() {
        root.join("index.html")
    } else {
        let relative = path.trim_start_matches('/');
        let candidate = root.join(relative);
        if candidate.exists() && candidate.is_file() {
            candidate
        } else if relative.ends_with(".js") || relative.ends_with(".css")
               || relative.ends_with(".json") || relative.ends_with(".png")
               || relative.ends_with(".svg") || relative.ends_with(".woff2") {
            // Asset not found — return 404
            return Response::from_data(Vec::new()).with_status_code(tiny_http::StatusCode(404));
        } else {
            // SPA route — serve index.html
            root.join("index.html")
        }
    };

    if !file_path.exists() {
        return Response::from_data(Vec::new()).with_status_code(tiny_http::StatusCode(404));
    }

    let bytes = match std::fs::read(&file_path) {
        Ok(b) => b,
        Err(_) => return Response::from_data(Vec::new()).with_status_code(tiny_http::StatusCode(500)),
    };

    let content_type = mime_type(&file_path);
    let mut response = Response::from_data(bytes);

    // Set Content-Type
    if let Ok(header) = Header::from_bytes(b"Content-Type", content_type.as_bytes()) {
        response = response.with_header(header);
    }

    // Cache headers — match the production config
    if file_path.file_name().and_then(|n| n.to_str()) == Some("sw.js")
        || file_path.file_name().and_then(|n| n.to_str()) == Some("update-manifest.json") {
        if let Ok(header) = Header::from_bytes(b"Cache-Control", b"no-cache") {
            response = response.with_header(header);
        }
    } else if path.starts_with("/engines/") || path.starts_with("/content/") {
        if let Ok(header) = Header::from_bytes(
            b"Cache-Control",
            b"public, max-age=31536000, immutable",
        ) {
            response = response.with_header(header);
        }
    }

    response
}

fn mime_type(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8".to_string(),
        Some("js") => "application/javascript; charset=utf-8".to_string(),
        Some("css") => "text/css; charset=utf-8".to_string(),
        Some("json") => "application/json; charset=utf-8".to_string(),
        Some("png") => "image/png".to_string(),
        Some("jpg") | Some("jpeg") => "image/jpeg".to_string(),
        Some("svg") => "image/svg+xml".to_string(),
        Some("woff") => "font/woff".to_string(),
        Some("woff2") => "font/woff2".to_string(),
        Some("ico") => "image/x-icon".to_string(),
        Some("webmanifest") => "application/manifest+json".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn find_free_port(preferred: u16) -> Option<u16> {
    for offset in 0..10 {
        let port = preferred.saturating_add(offset);
        if portpicker::is_free(port) {
            return Some(port);
        }
    }
    None
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), PreviewError> {
    let file = std::fs::File::open(zip_path).map_err(PreviewError::Io)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| PreviewError::Zip(e.to_string()))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| PreviewError::Zip(e.to_string()))?;

        let name = entry.name().to_string();
        let dest_path = dest.join(&name);

        if entry.is_dir() {
            std::fs::create_dir_all(&dest_path).map_err(PreviewError::Io)?;
        } else {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent).map_err(PreviewError::Io)?;
            }
            let mut file = std::fs::File::create(&dest_path).map_err(PreviewError::Io)?;
            std::io::copy(&mut entry, &mut file).map_err(PreviewError::Io)?;
        }
    }
    Ok(())
}

// =============================================================================
// Errors
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum PreviewError {
    #[error("Preview server is already running. Stop it first.")]
    AlreadyRunning,

    #[error("No free port found near {0}")]
    NoFreePort(u16),

    #[error("Failed to start HTTP server: {0}")]
    ServerStart(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Zip error: {0}")]
    Zip(String),
}
