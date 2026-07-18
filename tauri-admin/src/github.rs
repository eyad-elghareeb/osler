// github.rs — GitHub OAuth sign-in, repo browsing, fork, clone, and the
// branch → PR → merge workflow that powers the multi-user content management
// story for the Osler admin dashboard.
//
// The user signs in via the OAuth Web Flow:
//   1. `gh_sign_in` generates a random state, spawns a one-shot HTTP server on
//      127.0.0.1:7878, and returns the GitHub authorize URL.
//   2. The frontend opens that URL in the system browser via `open_external`.
//   3. The user authorises on github.com; GitHub redirects to
//      http://localhost:7878/callback?code=…&state=…
//   4. The local server validates the state, exchanges the code for an access
//      token via POST https://github.com/login/oauth/access_token, stores the
//      token (project-local first, global fallback), and returns a success
//      HTML page to the browser.
//   5. The frontend polls `gh_auth_status` to pick up the token.
//
// All network calls go through `ureq` from Rust so the webview CSP doesn't
// need to grow extra `connect-src` entries for github.com.
//
// Tokens are stored under:
//   • Project-local: <project_root>/.osler-admin/github.json   (mode 0600)
//   • Global:        <HOME>/.config/osler-admin/github.json     (mode 0600)
// The project-local token takes precedence; if absent, the global token is
// used. `gh_sign_out` clears both.

use crate::commands::ProjectRoot;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, Window};

/* ═══════════════════════════════════════════════════════════════════════
   Constants — OAuth endpoints + client_id placeholder
   ═══════════════════════════════════════════════════════════════════════ */

/// OAuth client_id. **Replace with your own** by registering an OAuth App at
/// https://github.com/settings/developers (set the redirect URI to
/// `http://localhost:7878/callback`). Can be overridden at runtime via
/// `gh_set_oauth_config`.
const DEFAULT_GH_CLIENT_ID: &str = "";

/// OAuth redirect URI. Must match what's registered for the OAuth App on
/// GitHub. The local HTTP server binds this exact port.
const REDIRECT_URI: &str = "http://localhost:7878/callback";
const LOCAL_CALLBACK_PORT: u16 = 7878;

/// OAuth scopes requested. `repo` covers read/write to public + private repos
/// (needed for fork + push + PR + merge). `user` gives us the user's identity
/// for the sign-in card.
const OAUTH_SCOPES: &str = "repo user";

const GH_API_BASE: &str = "https://api.github.com";
const GH_OAUTH_AUTHORIZE: &str = "https://github.com/login/oauth/authorize";
const GH_OAUTH_TOKEN: &str = "https://github.com/login/oauth/access_token";

/* ═══════════════════════════════════════════════════════════════════════
   Shared state — OAuth pending + cached auth + OAuth config
   ═══════════════════════════════════════════════════════════════════════ */

#[derive(Default, Clone, serde::Serialize)]
pub struct GitHubAuthState {
    pub authenticated: bool,
    pub login: String,
    pub name: String,
    pub avatarUrl: String,
    pub scopes: Vec<String>,
    /// Where the active token came from: "project" | "global" | ""
    pub tokenSource: String,
    /// Whether an OAuth flow is currently pending (server listening).
    pub oauthPending: bool,
    /// Last OAuth error, if any.
    pub oauthError: String,
}

#[derive(Default, Clone)]
struct OAuthPending {
    pub state: String,
    pub pending: bool,
    pub error: String,
    pub token: String,
}

/// Runtime OAuth config (client_id, optional client_secret for confidential
/// apps). Persisted at the global config path so users set it once per machine.
#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct OAuthConfig {
    #[serde(default)]
    pub clientId: String,
    #[serde(default)]
    pub clientSecret: String,
}

fn shared_oauth() -> &'static Arc<Mutex<OAuthPending>> {
    static SHARED: OnceLock<Arc<Mutex<OAuthPending>>> = OnceLock::new();
    SHARED.get_or_init(|| Arc::new(Mutex::new(OAuthPending::default())))
}

fn shared_auth() -> &'static Arc<Mutex<GitHubAuthState>> {
    static SHARED: OnceLock<Arc<Mutex<GitHubAuthState>>> = OnceLock::new();
    SHARED.get_or_init(|| Arc::new(Mutex::new(GitHubAuthState::default())))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/* ═══════════════════════════════════════════════════════════════════════
   URL encode/decode — minimal percent-encoding helpers
   ═══════════════════════════════════════════════════════════════════════ */

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

fn url_decode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_val(bytes[i + 1]);
            let lo = hex_val(bytes[i + 2]);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Generate an unguessable OAuth state string. Combines nanosecond timestamp,
/// process id, and a per-process atomic counter, then hex-encodes the mix.
/// Sufficient entropy for CSRF protection — we don't need cryptographic
/// randomness here, just unguessability within a single sign-in session.
fn random_state() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let n = COUNTER.fetch_add(1, Ordering::SeqCst) as u128;
    let mixed = nanos ^ (pid << 64) ^ (n << 32);
    format!("{:032x}", mixed)
}

/* ═══════════════════════════════════════════════════════════════════════
   Token storage — project-local + global
   ═══════════════════════════════════════════════════════════════════════ */

const ADMIN_DIR: &str = ".osler-admin";
const GH_TOKEN_FILE: &str = "github.json";
const GH_OAUTH_CONFIG_FILE: &str = "oauth-config.json";

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct StoredToken {
    token: String,
    login: String,
    name: String,
    avatarUrl: String,
    scopes: Vec<String>,
    savedAt: u64,
}

fn project_token_path(root: &Path) -> PathBuf {
    root.join(ADMIN_DIR).join(GH_TOKEN_FILE)
}

/// Global config dir: $HOME/.config/osler-admin on Linux, %APPDATA%/osler-admin
/// on Windows, ~/Library/Application Support/osler-admin on macOS. We don't
/// pull in the `dirs` crate for this — a simple env-based resolver keeps the
/// dependency list lean.
fn global_config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return Some(PathBuf::from(appdata).join("osler-admin"));
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            return Some(PathBuf::from(home).join("AppData").join("Roaming").join("osler-admin"));
        }
        return None;
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("osler-admin"));
        }
        return None;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg.is_empty() {
                return Some(PathBuf::from(xdg).join("osler-admin"));
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return Some(PathBuf::from(home).join(".config").join("osler-admin"));
        }
        None
    }
}

fn global_token_path() -> Option<PathBuf> {
    global_config_dir().map(|d| d.join(GH_TOKEN_FILE))
}

fn global_oauth_config_path() -> Option<PathBuf> {
    global_config_dir().map(|d| d.join(GH_OAUTH_CONFIG_FILE))
}

fn read_oauth_config() -> OAuthConfig {
    let p = match global_oauth_config_path() {
        Some(p) => p,
        None => return OAuthConfig::default(),
    };
    if !p.is_file() {
        return OAuthConfig::default();
    }
    match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => OAuthConfig::default(),
    }
}

fn write_oauth_config(cfg: &OAuthConfig) -> Result<(), String> {
    let p = global_oauth_config_path().ok_or_else(|| "Could not resolve global config dir".to_string())?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&p, body).map_err(|e| e.to_string())?;
    restrict_perms(&p);
    Ok(())
}

fn restrict_perms(p: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(p) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(p, perms);
        }
    }
}

/// Read the stored token. Project-local takes precedence; if absent, falls
/// back to the global token. Returns `None` if neither exists.
fn read_stored_token(project_root: Option<&Path>) -> Option<(StoredToken, String)> {
    if let Some(root) = project_root {
        let p = project_token_path(root);
        if p.is_file() {
            if let Ok(s) = std::fs::read_to_string(&p) {
                if let Ok(t) = serde_json::from_str::<StoredToken>(&s) {
                    return Some((t, "project".to_string()));
                }
            }
        }
    }
    if let Some(p) = global_token_path() {
        if p.is_file() {
            if let Ok(s) = std::fs::read_to_string(&p) {
                if let Ok(t) = serde_json::from_str::<StoredToken>(&s) {
                    return Some((t, "global".to_string()));
                }
            }
        }
    }
    None
}

fn write_stored_token(project_root: Option<&Path>, t: &StoredToken) -> Result<(), String> {
    let body = serde_json::to_string_pretty(t).map_err(|e| e.to_string())?;
    // Prefer project-local; fall back to global.
    if let Some(root) = project_root {
        let p = project_token_path(root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&p, &body).map_err(|e| e.to_string())?;
        restrict_perms(&p);
        ensure_gitignore(root);
        return Ok(());
    }
    let p = global_token_path().ok_or_else(|| "Could not resolve global config dir".to_string())?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, &body).map_err(|e| e.to_string())?;
    restrict_perms(&p);
    Ok(())
}

fn clear_stored_tokens(project_root: Option<&Path>) {
    if let Some(root) = project_root {
        let p = project_token_path(root);
        let _ = std::fs::remove_file(&p);
    }
    if let Some(p) = global_token_path() {
        let _ = std::fs::remove_file(&p);
    }
}

/// Best-effort: ensure .gitignore includes .osler-admin/ so the project-local
/// token never gets committed by accident.
fn ensure_gitignore(root: &Path) {
    let gitignore = root.join(".gitignore");
    let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
    if !existing.lines().any(|l| l.trim() == ".osler-admin/") {
        let addition = if existing.is_empty() {
            ".osler-admin/\n".to_string()
        } else if !existing.ends_with('\n') {
            "\n.osler-admin/\n".to_string()
        } else {
            ".osler-admin/\n".to_string()
        };
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&gitignore)
            .and_then(|mut f| f.write_all(addition.as_bytes()));
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   GitHub API helpers — ureq wrappers with proper headers
   ═══════════════════════════════════════════════════════════════════════ */

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .build()
}

fn authed_get(url: &str, token: &str) -> Result<ureq::Response, String> {
    agent()
        .get(url)
        .set("Authorization", &format!("token {}", token))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .set("User-Agent", "osler-admin-tauri")
        .call()
        .map_err(|e| format!("GitHub GET failed: {}", e))
}

fn authed_post(url: &str, token: &str, body: &Value) -> Result<ureq::Response, String> {
    agent()
        .post(url)
        .set("Authorization", &format!("token {}", token))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .set("User-Agent", "osler-admin-tauri")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("GitHub POST failed: {}", e))
}

fn authed_put(url: &str, token: &str, body: &Value) -> Result<ureq::Response, String> {
    agent()
        .put(url)
        .set("Authorization", &format!("token {}", token))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .set("User-Agent", "osler-admin-tauri")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("GitHub PUT failed: {}", e))
}

fn authed_patch(url: &str, token: &str, body: &Value) -> Result<ureq::Response, String> {
    agent()
        .patch(url)
        .set("Authorization", &format!("token {}", token))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .set("User-Agent", "osler-admin-tauri")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("GitHub PATCH failed: {}", e))
}

fn response_to_json(resp: ureq::Response) -> Result<Value, String> {
    resp.into_json::<Value>().map_err(|e| format!("Failed to parse GitHub response: {}", e))
}

fn require_token(project_root: Option<&Path>) -> Result<(String, String), String> {
    let (stored, source) = read_stored_token(project_root).ok_or_else(|| {
        "Not signed in to GitHub. Open the GitHub view and click Sign in.".to_string()
    })?;
    Ok((stored.token, source))
}

/// Best-effort: try to resolve the project root from the Tauri state. Returns
/// None if no project is picked (which is fine — we'll use the global token).
fn root_from_state(state: &State<ProjectRoot>) -> Option<PathBuf> {
    state.0.lock().unwrap().clone()
}

/* ═══════════════════════════════════════════════════════════════════════
   OAuth callback HTTP server — one-shot, listens on 127.0.0.1:7878
   ═══════════════════════════════════════════════════════════════════════ */

fn write_response_html(stream: &mut std::net::TcpStream, status: u16, body: &str) {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Internal Server Error",
    };
    let resp = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        status_text,
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn start_callback_server(expected_state: String, client_id: String, client_secret: String) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", LOCAL_CALLBACK_PORT)) {
            Ok(l) => l,
            Err(e) => {
                let mut p = shared_oauth().lock().unwrap();
                p.error = format!("Failed to bind callback server on port {}: {}", LOCAL_CALLBACK_PORT, e);
                p.pending = false;
                return;
            }
        };

        // Set the listener to non-blocking and poll with a 5-minute total
        // timeout. If the user never finishes the OAuth flow, we give up and
        // clear the pending flag so subsequent sign-in attempts work.
        if listener.set_nonblocking(true).is_err() {
            let mut p = shared_oauth().lock().unwrap();
            p.error = "Failed to set listener to non-blocking".into();
            p.pending = false;
            return;
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);

        let (mut stream, _) = loop {
            // Bail out if the OAuth flow was cancelled or expired.
            {
                let p = shared_oauth().lock().unwrap();
                if !p.pending {
                    return;
                }
            }
            match listener.accept() {
                Ok(s) => break s,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() >= deadline {
                        let mut p = shared_oauth().lock().unwrap();
                        p.error = "OAuth flow timed out — no callback received within 5 minutes".into();
                        p.pending = false;
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(150));
                }
                Err(e) => {
                    let mut p = shared_oauth().lock().unwrap();
                    p.error = format!("Failed to accept callback connection: {}", e);
                    p.pending = false;
                    return;
                }
            }
        };

        // Restore blocking mode for the stream so we can read the request.
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));

        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);

        let first_line = req.lines().next().unwrap_or("");
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() < 2 {
            write_response_html(&mut stream, 400, "<h2>Bad request</h2>");
            let mut p = shared_oauth().lock().unwrap();
            p.error = "Bad OAuth callback request".into();
            p.pending = false;
            return;
        }

        let path = parts[1];
        let query = path.split('?').nth(1).unwrap_or("");
        let mut code = String::new();
        let mut state = String::new();
        let mut error = String::new();
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            let k = kv.next().unwrap_or("");
            let v = kv.next().unwrap_or("");
            let v_decoded = url_decode(v);
            match k {
                "code" => code = v_decoded,
                "state" => state = v_decoded,
                "error" => error = v_decoded,
                _ => {}
            }
        }

        if !error.is_empty() {
            write_response_html(
                &mut stream,
                400,
                &format!("<h2>✗ Authorization denied</h2><p>{}</p>", error),
            );
            let mut p = shared_oauth().lock().unwrap();
            p.error = format!("Authorization denied: {}", error);
            p.pending = false;
            return;
        }

        if state != expected_state {
            write_response_html(
                &mut stream,
                400,
                "<h2>✗ State mismatch</h2><p>CSRF check failed — please try signing in again.</p>",
            );
            let mut p = shared_oauth().lock().unwrap();
            p.error = "State mismatch — possible CSRF attack".into();
            p.pending = false;
            return;
        }

        match exchange_code_for_token(&code, &client_id, &client_secret) {
            Ok(token) => {
                write_response_html(
                    &mut stream,
                    200,
                    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Osler Admin — Signed in</title></head><body style=\"font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 3rem; background: #0f172a; color: #e2e8f0;\"><div style=\"max-width: 480px; margin: 0 auto;\"><div style=\"width: 64px; height: 64px; margin: 0 auto 1rem; border-radius: 50%; background: #22c55e; display: flex; align-items: center; justify-content: center; font-size: 32px;\">✓</div><h2 style=\"margin: 0 0 0.5rem;\">Signed in to GitHub</h2><p style=\"color: #94a3b8; margin: 0;\">You can close this tab and return to the Osler Admin app.</p></div></body></html>",
                );
                let mut p = shared_oauth().lock().unwrap();
                p.token = token;
                p.error = String::new();
                p.pending = false;
            }
            Err(e) => {
                write_response_html(
                    &mut stream,
                    400,
                    &format!("<h2>✗ Authentication failed</h2><p>{}</p>", e),
                );
                let mut p = shared_oauth().lock().unwrap();
                p.error = e;
                p.pending = false;
            }
        }
    });
}

/// Exchange the OAuth code for an access token. Calls
/// POST https://github.com/login/oauth/access_token with `Accept: application/json`
/// so the response is parseable JSON (default is URL-encoded form).
fn exchange_code_for_token(code: &str, client_id: &str, client_secret: &str) -> Result<String, String> {
    let mut body = json!({
        "client_id": client_id,
        "code": code,
        "redirect_uri": REDIRECT_URI,
    });
    if !client_secret.is_empty() {
        body["client_secret"] = json!(client_secret);
    }

    let resp = agent()
        .post(GH_OAUTH_TOKEN)
        .set("Accept", "application/json")
        .set("User-Agent", "osler-admin-tauri")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    let parsed: Value = resp
        .into_json()
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
        let desc = parsed
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        return Err(format!("{}: {}", err, desc));
    }

    let token = parsed
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No access_token in response".to_string())?
        .to_string();

    Ok(token)
}

/* ═══════════════════════════════════════════════════════════════════════
   Public Tauri commands
   ═══════════════════════════════════════════════════════════════════════ */

/// Get/set the OAuth client config (client_id + optional client_secret).
/// Frontend uses `gh_get_oauth_config` to show whether a client_id is set.
#[tauri::command]
pub fn gh_get_oauth_config() -> Result<Value, String> {
    let cfg = read_oauth_config();
    Ok(json!({
        "clientId": cfg.clientId,
        "clientSecretSet": !cfg.clientSecret.is_empty(),
        "redirectUri": REDIRECT_URI,
        "scopes": OAUTH_SCOPES,
        "defaultClientId": DEFAULT_GH_CLIENT_ID,
    }))
}

#[tauri::command]
pub fn gh_set_oauth_config(client_id: String, client_secret: Option<String>) -> Result<Value, String> {
    let mut cfg = read_oauth_config();
    cfg.clientId = client_id.trim().to_string();
    if let Some(secret) = client_secret {
        // Empty string clears the secret; non-empty replaces it.
        cfg.clientSecret = secret.trim().to_string();
    }
    write_oauth_config(&cfg)?;
    Ok(json!({ "saved": true }))
}

/// Start the OAuth Web Flow. Generates a state, spawns the local callback
/// server, and returns the authorize URL. The frontend opens it via
/// `open_external`. The frontend then polls `gh_auth_status` until
/// `oauthPending` flips to false and `authenticated` flips to true.
#[tauri::command]
pub fn gh_sign_in(window: Window) -> Result<Value, String> {
    let cfg = read_oauth_config();
    let client_id = if !cfg.clientId.is_empty() {
        cfg.clientId.clone()
    } else if !DEFAULT_GH_CLIENT_ID.is_empty() {
        DEFAULT_GH_CLIENT_ID.to_string()
    } else {
        return Err(
            "No GitHub OAuth client_id configured. Open Settings → GitHub and set your client_id (register one at https://github.com/settings/developers with redirect URI http://localhost:7878/callback)."
                .to_string(),
        );
    };

    // If a flow is already pending, refuse to start another — the port is busy.
    {
        let p = shared_oauth().lock().unwrap();
        if p.pending {
            return Err("An OAuth flow is already in progress. Wait for it to complete or restart the app.".into());
        }
    }

    let state = random_state();
    {
        let mut p = shared_oauth().lock().unwrap();
        p.state = state.clone();
        p.pending = true;
        p.error = String::new();
        p.token = String::new();
    }

    start_callback_server(state.clone(), client_id.clone(), cfg.clientSecret.clone());

    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&scope={}&state={}",
        GH_OAUTH_AUTHORIZE,
        url_encode(&client_id),
        url_encode(REDIRECT_URI),
        url_encode(OAUTH_SCOPES),
        url_encode(&state),
    );

    // Open in the system browser.
    use tauri_plugin_opener::OpenerExt;
    window
        .opener()
        .open_url(auth_url.clone(), None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    Ok(json!({ "started": true, "authUrl": auth_url, "state": state }))
}

/// Sign out: clear the in-memory auth state + delete both stored token files.
#[tauri::command]
pub fn gh_sign_out(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_from_state(&state);
    clear_stored_tokens(root.as_deref());
    let mut g = shared_auth().lock().unwrap();
    *g = GitHubAuthState::default();
    Ok(json!({ "signedOut": true }))
}

/// Poll the current auth state. If the OAuth flow just completed (token in
/// `shared_oauth`), this command picks it up, fetches the user's identity
/// from /user, persists the token, and returns the populated state.
#[tauri::command]
pub fn gh_auth_status(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    // First, check if the OAuth flow just delivered a token.
    let pending_token = {
        let p = shared_oauth().lock().unwrap();
        if p.token.is_empty() { None } else { Some(p.token.clone()) }
    };
    if let Some(token) = pending_token {
        // Fetch the user identity.
        match fetch_user(&token) {
            Ok(user) => {
                let stored = StoredToken {
                    token: token.clone(),
                    login: user
                        .get("login")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: user
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    avatarUrl: user
                        .get("avatar_url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    scopes: user
                        .get("scope")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect(),
                    savedAt: now_millis(),
                };
                let root = root_from_state(&state);
                let _ = write_stored_token(root.as_deref(), &stored);
                // Clear the pending token so we don't re-store it on next poll.
                {
                    let mut p = shared_oauth().lock().unwrap();
                    p.token = String::new();
                }
                let mut g = shared_auth().lock().unwrap();
                g.authenticated = true;
                g.login = stored.login.clone();
                g.name = stored.name.clone();
                g.avatarUrl = stored.avatarUrl.clone();
                g.scopes = stored.scopes.clone();
                g.tokenSource = if root.is_some() { "project" } else { "global" }.to_string();
                g.oauthPending = false;
                g.oauthError = String::new();
                return Ok(serde_json::to_value(&*g).map_err(|e| e.to_string())?);
            }
            Err(e) => {
                let mut p = shared_oauth().lock().unwrap();
                p.token = String::new();
                p.error = format!("Signed in but failed to fetch user: {}", e);
                p.pending = false;
            }
        }
    }

    // Check if the OAuth flow produced an error.
    let (oauth_err, oauth_pending) = {
        let p = shared_oauth().lock().unwrap();
        (p.error.clone(), p.pending)
    };
    if !oauth_err.is_empty() && !oauth_pending {
        let mut g = shared_auth().lock().unwrap();
        g.oauthPending = false;
        g.oauthError = oauth_err.clone();
        return Ok(serde_json::to_value(&*g).map_err(|e| e.to_string())?);
    }

    // No pending flow — return whatever's in the stored token (if any).
    let root = root_from_state(&state);
    if let Some((stored, source)) = read_stored_token(root.as_deref()) {
        let mut g = shared_auth().lock().unwrap();
        g.authenticated = true;
        g.login = stored.login;
        g.name = stored.name;
        g.avatarUrl = stored.avatarUrl;
        g.scopes = stored.scopes;
        g.tokenSource = source;
        g.oauthPending = shared_oauth().lock().unwrap().pending;
        g.oauthError = shared_oauth().lock().unwrap().error.clone();
        return Ok(serde_json::to_value(&*g).map_err(|e| e.to_string())?);
    }

    // Not authenticated.
    let mut g = shared_auth().lock().unwrap();
    *g = GitHubAuthState::default();
    g.oauthPending = shared_oauth().lock().unwrap().pending;
    g.oauthError = shared_oauth().lock().unwrap().error.clone();
    Ok(serde_json::to_value(&*g).map_err(|e| e.to_string())?)
}

/// Fetch the authenticated user's identity from GET /user.
fn fetch_user(token: &str) -> Result<Value, String> {
    let resp = authed_get(&format!("{}/user", GH_API_BASE), token)?;
    response_to_json(resp)
}

/// List the authenticated user's repositories (most recently updated first).
/// Returns a compact subset per repo: id, full_name, owner.login, description,
/// private, fork, permissions, default_branch, html_url, updated_at.
#[tauri::command]
pub fn gh_list_user_repos(
    per_page: Option<u64>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_from_state(&state);
    let (token, _src) = require_token(root.as_deref())?;
    let per_page = per_page.unwrap_or(50).min(100);
    let url = format!(
        "{}/user/repos?sort=updated&per_page={}",
        GH_API_BASE, per_page
    );
    let resp = authed_get(&url, &token)?;
    let v: Value = response_to_json(resp)?;
    let arr = v.as_array().ok_or_else(|| "GitHub API did not return a repository array".to_string())?;
    let compact: Vec<Value> = arr
        .iter()
        .map(|r| {
            json!({
                "id": r.get("id").cloned().unwrap_or(json!(null)),
                "fullName": r.get("full_name").cloned().unwrap_or(json!("")),
                "owner": r.get("owner").and_then(|o| o.get("login")).cloned().unwrap_or(json!("")),
                "description": r.get("description").cloned().unwrap_or(json!("")),
                "private": r.get("private").cloned().unwrap_or(json!(false)),
                "fork": r.get("fork").cloned().unwrap_or(json!(false)),
                "defaultBranch": r.get("default_branch").cloned().unwrap_or(json!("main")),
                "htmlUrl": r.get("html_url").cloned().unwrap_or(json!("")),
                "cloneUrl": r.get("clone_url").cloned().unwrap_or(json!("")),
                "updatedAt": r.get("updated_at").cloned().unwrap_or(json!("")),
                "permissions": r.get("permissions").cloned().unwrap_or(json!({})),
            })
        })
        .collect();
    Ok(json!({ "repos": compact }))
}

/// Fetch full info about a single repo: GET /repos/{owner}/{repo}. Used to
/// check the user's permissions (admin/push/pull) before forking or opening
/// a PR, and to resolve the default branch.
#[tauri::command]
pub fn gh_get_repo_info(
    owner: String,
    repo: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_from_state(&state);
    let (token, _src) = require_token(root.as_deref())?;
    let url = format!("{}/repos/{}/{}", GH_API_BASE, owner, repo);
    let resp = authed_get(&url, &token)?;
    let r: Value = response_to_json(resp)?;
    Ok(json!({
        "id": r.get("id").cloned().unwrap_or(json!(null)),
        "fullName": r.get("full_name").cloned().unwrap_or(json!("")),
        "owner": r.get("owner").and_then(|o| o.get("login")).cloned().unwrap_or(json!("")),
        "description": r.get("description").cloned().unwrap_or(json!("")),
        "private": r.get("private").cloned().unwrap_or(json!(false)),
        "fork": r.get("fork").cloned().unwrap_or(json!(false)),
        "defaultBranch": r.get("default_branch").cloned().unwrap_or(json!("main")),
        "htmlUrl": r.get("html_url").cloned().unwrap_or(json!("")),
        "cloneUrl": r.get("clone_url").cloned().unwrap_or(json!("")),
        "permissions": r.get("permissions").cloned().unwrap_or(json!({})),
        "parent": r.get("parent").and_then(|p| p.get("full_name")).cloned().unwrap_or(json!(null)),
    }))
}

/// Fork a repo: POST /repos/{owner}/{repo}/forks. Returns the fork's full
/// info once GitHub has finished creating it (we poll GET /repos/{user}/{repo}
/// a few times because forks are async).
#[tauri::command]
pub fn gh_fork_repo(
    owner: String,
    repo: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_from_state(&state);
    let (token, _src) = require_token(root.as_deref())?;
    let url = format!("{}/repos/{}/{}", GH_API_BASE, owner, repo);
    let _resp = authed_post(&format!("{}/forks", url), &token, &json!({}))?;
    // GitHub forks are created async. Poll for up to ~30s.
    let user_resp = authed_get(&format!("{}/user", GH_API_BASE), &token)?;
    let user: Value = response_to_json(user_resp)?;
    let user_login = user
        .get("login")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Could not resolve current user login".to_string())?;
    let fork_url = format!("{}/repos/{}/{}", GH_API_BASE, user_login, repo);
    for _ in 0..15 {
        std::thread::sleep(std::time::Duration::from_millis(2000));
        if let Ok(resp) = authed_get(&fork_url, &token) {
            if resp.status() == 200 {
                let r: Value = response_to_json(resp)?;
                return Ok(json!({
                    "forked": true,
                    "fullName": r.get("full_name").cloned().unwrap_or(json!("")),
                    "cloneUrl": r.get("clone_url").cloned().unwrap_or(json!("")),
                    "htmlUrl": r.get("html_url").cloned().unwrap_or(json!("")),
                    "defaultBranch": r.get("default_branch").cloned().unwrap_or(json!("main")),
                }));
            }
        }
    }
    // Fork was queued but not yet ready. Tell the caller it's pending.
    Ok(json!({
        "forked": true,
        "pending": true,
        "fullName": format!("{}/{}", user_login, repo),
        "message": "Fork is being created on GitHub. Check back in a few seconds.",
    }))
}

/// Create a PR via POST /repos/{owner}/{repo}/pulls. `head` is the branch
/// with the changes (e.g. "myuser:add-cardiology-quiz" for a cross-repo PR
/// from a fork), `base` is the target branch on the upstream repo.
#[tauri::command]
pub fn gh_create_pr(
    owner: String,
    repo: String,
    title: String,
    head: String,
    base: String,
    body: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_from_state(&state);
    let (token, _src) = require_token(root.as_deref())?;
    let url = format!("{}/repos/{}/{}", GH_API_BASE, owner, repo);
    let mut payload = json!({
        "title": title,
        "head": head,
        "base": base,
    });
    if let Some(b) = body {
        if !b.is_empty() {
            payload["body"] = json!(b);
        }
    }
    let resp = authed_post(&format!("{}/pulls", url), &token, &payload)?;
    let pr: Value = response_to_json(resp)?;
    Ok(json!({
        "created": true,
        "number": pr.get("number").cloned().unwrap_or(json!(null)),
        "htmlUrl": pr.get("html_url").cloned().unwrap_or(json!("")),
        "state": pr.get("state").cloned().unwrap_or(json!("open")),
        "title": pr.get("title").cloned().unwrap_or(json!(title)),
    }))
}

/// List PRs on a repo via GET /repos/{owner}/{repo}/pulls?state=. Returns a
/// compact subset per PR: number, title, state, user, head ref, base ref,
/// html_url, draft, mergeable, body.
#[tauri::command]
pub fn gh_list_prs(
    owner: String,
    repo: String,
    pr_state: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_from_state(&state);
    let (token, _src) = require_token(root.as_deref())?;
    let s = pr_state.unwrap_or_else(|| "open".to_string());
    let url = format!(
        "{}/repos/{}/{}/pulls?state={}&per_page=50",
        GH_API_BASE, owner, repo, s
    );
    let resp = authed_get(&url, &token)?;
    let v: Value = response_to_json(resp)?;
    let arr = v.as_array().ok_or_else(|| "GitHub API did not return a pulls array".to_string())?;
    let compact: Vec<Value> = arr
        .iter()
        .map(|pr| {
            json!({
                "number": pr.get("number").cloned().unwrap_or(json!(null)),
                "title": pr.get("title").cloned().unwrap_or(json!("")),
                "state": pr.get("state").cloned().unwrap_or(json!("")),
                "draft": pr.get("draft").cloned().unwrap_or(json!(false)),
                "htmlUrl": pr.get("html_url").cloned().unwrap_or(json!("")),
                "user": pr.get("user").and_then(|u| u.get("login")).cloned().unwrap_or(json!("")),
                "head": pr.get("head").and_then(|h| h.get("ref")).cloned().unwrap_or(json!("")),
                "headRepo": pr.get("head").and_then(|h| h.get("repo")).and_then(|r| r.get("full_name")).cloned().unwrap_or(json!("")),
                "base": pr.get("base").and_then(|b| b.get("ref")).cloned().unwrap_or(json!("")),
                "baseRepo": pr.get("base").and_then(|b| b.get("repo")).and_then(|r| r.get("full_name")).cloned().unwrap_or(json!("")),
                "mergeable": pr.get("mergeable").cloned().unwrap_or(json!(null)),
                "body": pr.get("body").cloned().unwrap_or(json!("")),
                "updatedAt": pr.get("updated_at").cloned().unwrap_or(json!("")),
            })
        })
        .collect();
    Ok(json!({ "prs": compact }))
}

/// Merge a PR via PUT /repos/{owner}/{repo}/pulls/{number}/merge. `method`
/// is one of "merge" | "squash" | "rebase".
#[tauri::command]
pub fn gh_merge_pr(
    owner: String,
    repo: String,
    pr_number: i64,
    method: String,
    commit_message: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_from_state(&state);
    let (token, _src) = require_token(root.as_deref())?;
    let m = match method.as_str() {
        "merge" | "squash" | "rebase" => method.clone(),
        _ => return Err(format!("Invalid merge method: {} (use merge|squash|rebase)", method)),
    };
    let url = format!(
        "{}/repos/{}/{}/pulls/{}/merge",
        GH_API_BASE, owner, repo, pr_number
    );
    let mut payload = json!({ "merge_method": m });
    if let Some(msg) = commit_message {
        if !msg.is_empty() {
            payload["commit_message"] = json!(msg);
        }
    }
    let resp = authed_put(&url, &token, &payload)?;
    let result: Value = response_to_json(resp)?;
    Ok(json!({
        "merged": result.get("merged").cloned().unwrap_or(json!(true)),
        "sha": result.get("sha").cloned().unwrap_or(json!("")),
        "message": result.get("message").cloned().unwrap_or(json!("")),
    }))
}

/// Close a PR (without merging) via PATCH /repos/{owner}/{repo}/pulls/{number}
/// with `{"state": "closed"}`.
#[tauri::command]
pub fn gh_close_pr(
    owner: String,
    repo: String,
    pr_number: i64,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_from_state(&state);
    let (token, _src) = require_token(root.as_deref())?;
    let url = format!(
        "{}/repos/{}/{}/pulls/{}",
        GH_API_BASE, owner, repo, pr_number
    );
    let _resp = authed_patch(&url, &token, &json!({ "state": "closed" }))?;
    Ok(json!({ "closed": true, "number": pr_number }))
}
