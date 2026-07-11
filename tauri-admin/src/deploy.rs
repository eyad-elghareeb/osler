// deploy.rs — Provider deploy pipelines for the Osler admin dashboard.
//
// Supports four providers, all driven by Personal Access Tokens (or equivalent
// deploy tokens) supplied by the user and stored in a per-project config file:
//
//   • Vercel           — trigger a production redeploy from the connected Git
//                        repo via the Vercel REST API.
//   • GitHub Pages     — push the local build output (or `public/` when no
//                        static export is present) to the configured branch
//                        using the GitHub Git Data API (blobs → tree → commit
//                        → ref update).
//   • Cloudflare Pages — trigger a redeploy from the connected Git branch via
//                        the Cloudflare Pages API.
//   • Netlify          — trigger a manual deploy of the connected site via
//                        the Netlify API.
//
// All network requests are issued from Rust (ureq + native-tls) so the webview
// CSP does not need to allow provider endpoints. PATs are persisted under
// `<project_root>/.osler-admin/deploy.json` with mode 0600 on Unix.

use crate::commands::ProjectRoot;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tauri::State;

/* ═══════════════════════════════════════════════════════════════════════
   Shared deploy state — single slot, polled by the frontend
   ═══════════════════════════════════════════════════════════════════════ */

#[derive(Clone, serde::Serialize)]
pub struct DeployLogLine {
    pub stream: String, // "info" | "warn" | "error" | "success" | "exit"
    pub text: String,
    pub ts: u64,
}

#[derive(Default, Clone)]
pub struct DeployInner {
    pub provider: String,        // "" when idle
    pub running: bool,
    pub success: bool,
    pub started_at: u64,
    pub ended_at: u64,
    pub logs: Vec<DeployLogLine>,
    pub result_url: String,      // deployment URL when available
    pub error: String,
    pub stop_requested: bool,
}

fn shared_deploy() -> &'static Arc<std::sync::Mutex<DeployInner>> {
    static SHARED: OnceLock<Arc<std::sync::Mutex<DeployInner>>> = OnceLock::new();
    SHARED.get_or_init(|| Arc::new(std::sync::Mutex::new(DeployInner::default())))
}

fn now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn log(line: &str, kind: &str) {
    let mut g = shared_deploy().lock().unwrap();
    g.logs.push(DeployLogLine {
        stream: kind.to_string(),
        text: line.to_string(),
        ts: now_millis(),
    });
}

fn log_info(line: impl Into<String>)  { log(&line.into(), "info"); }
fn log_warn(line: impl Into<String>)  { log(&line.into(), "warn"); }
fn log_err(line: impl Into<String>)   { log(&line.into(), "error"); }
fn log_ok(line: impl Into<String>)    { log(&line.into(), "success"); }

/* ─── Header-shorthand macros (ureq v2 hides RequestBuilder type) ──── */

macro_rules! gh_get { ($a:expr, $u:expr, $t:expr) => { $a.get($u)
    .set("Authorization", &format!("token {}", $t))
    .set("Accept", "application/vnd.github+json")
    .set("X-GitHub-Api-Version", "2022-11-28")
    .set("User-Agent", "osler-admin-tauri")
    .call() } }

macro_rules! gh_post { ($a:expr, $u:expr, $t:expr) => { $a.post($u)
    .set("Authorization", &format!("token {}", $t))
    .set("Accept", "application/vnd.github+json")
    .set("X-GitHub-Api-Version", "2022-11-28")
    .set("User-Agent", "osler-admin-tauri") } }

macro_rules! gh_patch { ($a:expr, $u:expr, $t:expr) => { $a.patch($u)
    .set("Authorization", &format!("token {}", $t))
    .set("Accept", "application/vnd.github+json")
    .set("X-GitHub-Api-Version", "2022-11-28")
    .set("User-Agent", "osler-admin-tauri") } }

macro_rules! bearer_get { ($a:expr, $u:expr, $t:expr) => { $a.get($u)
    .set("Authorization", &format!("Bearer {}", $t)) } }

macro_rules! bearer_post { ($a:expr, $u:expr, $t:expr) => { $a.post($u)
    .set("Authorization", &format!("Bearer {}", $t)) } }

/* ═══════════════════════════════════════════════════════════════════════
   Config storage — `.osler-admin/deploy.json` under the project root
   ═══════════════════════════════════════════════════════════════════════ */

const ADMIN_DIR: &str = ".osler-admin";
const DEPLOY_CONFIG_FILE: &str = "deploy.json";

fn admin_dir(root: &Path) -> PathBuf {
    root.join(ADMIN_DIR)
}

fn deploy_config_path(root: &Path) -> PathBuf {
    admin_dir(root).join(DEPLOY_CONFIG_FILE)
}

fn read_deploy_config(root: &Path) -> Value {
    let p = deploy_config_path(root);
    if !p.is_file() {
        return json!({});
    }
    match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({})),
        Err(_) => json!({}),
    }
}

fn write_deploy_config(root: &Path, cfg: &Value) -> Result<(), String> {
    let dir = admin_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let p = deploy_config_path(root);
    std::fs::write(&p, body).map_err(|e| e.to_string())?;

    // Restrict file permissions on Unix — the file contains PATs.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&p) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&p, perms);
        }
    }

    // Best-effort: ensure .gitignore includes .osler-admin/
    let gitignore = root.join(".gitignore");
    let mut existing = String::new();
    if let Ok(s) = std::fs::read_to_string(&gitignore) {
        existing = s;
    }
    if !existing.lines().any(|l| l.trim() == ".osler-admin/") {
        let addition = if existing.is_empty() {
            ".osler-admin/\n".to_string()
        } else if !existing.ends_with('\n') {
            format!("\n.osler-admin/\n")
        } else {
            ".osler-admin/\n".to_string()
        };
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&gitignore)
            .and_then(|mut f| std::io::Write::write_all(&mut f, addition.as_bytes()));
    }

    Ok(())
}

/* ═══════════════════════════════════════════════════════════════════════
   Public Tauri commands — read/write config, test, deploy, status
   ═══════════════════════════════════════════════════════════════════════ */

#[tauri::command]
pub fn get_deploy_config(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    let cfg = read_deploy_config(&root);
    Ok(redact_config(cfg))
}

#[tauri::command]
pub fn set_deploy_config(
    config: Value,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    // Merge incoming config over the existing one — incoming fields overwrite,
    // but we preserve existing fields that the frontend doesn't send (e.g.
    // tokens when the UI sends empty strings to mean "keep").
    let mut current = read_deploy_config(&root);
    merge_config(&mut current, &config);
    write_deploy_config(&root, &current)?;
    Ok(redact_config(current))
}

#[tauri::command]
pub fn clear_deploy_provider(
    provider: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    let mut cfg = read_deploy_config(&root);
    if let Some(obj) = cfg.as_object_mut() {
        obj.remove(&provider);
    }
    write_deploy_config(&root, &cfg)?;
    Ok(redact_config(cfg))
}

#[tauri::command]
pub fn test_deploy_connection(
    provider: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    let cfg = read_deploy_config(&root);
    let result = match provider.as_str() {
        "vercel" => test_vercel(&cfg),
        "github_pages" => test_github_pages(&cfg),
        "cloudflare_pages" => test_cloudflare_pages(&cfg),
        "netlify" => test_netlify(&cfg),
        other => Err(format!("Unknown provider: {}", other)),
    };
    match result {
        Ok(payload) => Ok(json!({ "ok": true, "details": payload })),
        Err(e) => Ok(json!({ "ok": false, "error": e })),
    }
}

#[tauri::command]
pub fn deploy(
    provider: String,
    skip_build: Option<bool>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = crate::commands::root_or_err_pub(&state)?;
    let cfg = read_deploy_config(&root);

    // Reset shared state.
    {
        let mut g = shared_deploy().lock().unwrap();
        g.provider = provider.clone();
        g.running = true;
        g.success = false;
        g.started_at = now_millis();
        g.ended_at = 0;
        g.logs.clear();
        g.result_url = String::new();
        g.error = String::new();
        g.stop_requested = false;
    }

    // The actual deploy runs in a background thread so the frontend
    // can poll `deploy_status` for streaming logs. Uses a plain
    // std::thread + reqwest::blocking to avoid interacting with
    // Tauri's own tokio runtime.
    let skip = skip_build.unwrap_or(true);
    let provider_for_task = provider.clone();
    log_info(format!("Spawning deploy thread for provider '{}' (skip_build={})", provider, skip));
    std::thread::spawn(move || {
        log_info("Deploy thread started");
        let result = run_deploy(&provider_for_task, &root, &cfg, skip);
        let mut g = shared_deploy().lock().unwrap();
        g.running = false;
        g.ended_at = now_millis();
        match result {
            Ok(url) => {
                g.success = true;
                g.result_url = url.clone();
                if !url.is_empty() {
                    log_ok(format!("Deployment live at: {}", url));
                } else {
                    log_ok("Deployment triggered successfully.");
                }
            }
            Err(e) => {
                g.success = false;
                g.error = e.clone();
                log_err(format!("Deploy failed: {}", e));
            }
        }
    });

    Ok(json!({ "started": true, "provider": provider }))
}

#[tauri::command]
pub fn deploy_status() -> Value {
    let g = shared_deploy().lock().unwrap();
    json!({
        "provider": g.provider,
        "running": g.running,
        "success": g.success,
        "startedAt": g.started_at,
        "endedAt": g.ended_at,
        "logs": g.logs.clone(),
        "resultUrl": g.result_url,
        "error": g.error,
        "stopRequested": g.stop_requested,
    })
}

#[tauri::command]
pub fn deploy_stop() -> Value {
    let mut g = shared_deploy().lock().unwrap();
    g.stop_requested = true;
    g.running = false;
    g.ended_at = now_millis();
    g.success = false;
    g.error = "Cancelled by user".to_string();
    json!({ "stopped": true })
}

#[tauri::command]
pub fn clear_deploy_logs() -> Value {
    let mut g = shared_deploy().lock().unwrap();
    g.logs.clear();
    json!({ "cleared": true })
}

/// Check if the deploy has been requested to stop. Call between steps so the
/// user's cancellation takes effect promptly.
fn stop_if_requested() -> Result<(), String> {
    let g = shared_deploy().lock().unwrap();
    if g.stop_requested {
        return Err("Deploy cancelled by user".to_string());
    }
    Ok(())
}

/* ═══════════════════════════════════════════════════════════════════════
   Helpers — config merge, redaction
   ═══════════════════════════════════════════════════════════════════════ */

fn merge_config(into: &mut Value, from: &Value) {
    if !into.is_object() {
        *into = from.clone();
        return;
    }
    if !from.is_object() {
        return;
    }
    let into_obj = into.as_object_mut().unwrap();
    for (k, v) in from.as_object().unwrap() {
        if let Some(existing) = into_obj.get(k).cloned() {
            // Per-provider merge: empty token strings preserve the saved one.
            if existing.is_object() && v.is_object() {
                let mut merged = existing.clone();
                merge_provider(&mut merged, v);
                into_obj.insert(k.clone(), merged);
            } else {
                into_obj.insert(k.clone(), v.clone());
            }
        } else {
            into_obj.insert(k.clone(), v.clone());
        }
    }
}

fn merge_provider(into: &mut Value, from: &Value) {
    if !into.is_object() || !from.is_object() {
        return;
    }
    let into_obj = into.as_object_mut().unwrap();
    for (k, v) in from.as_object().unwrap() {
        // Treat empty string or redacted sentinel as "don't overwrite"
        // for token-shaped fields. The frontend reads back redacted
        // values ("••••••••") and re-sends them on every save, so if we
        // don't skip them here the real token gets overwritten with the
        // sentinel whenever the user clicks Deploy or Test.
        let is_secret = k.contains("token") || k.contains("pat") || k == "password" || k == "api_key";
        if is_secret && v.is_string() {
            let s = v.as_str().unwrap_or("");
            if s.is_empty() || s == "••••••••" {
                continue;
            }
        }
        into_obj.insert(k.clone(), v.clone());
    }
}

/// Return the config with all token-like fields replaced with `••••••••` so
/// the frontend can render saved providers without ever exposing the PAT.
fn redact_config(mut cfg: Value) -> Value {
    redact_object(&mut cfg);
    cfg
}

fn redact_object(v: &mut Value) {
    if let Some(obj) = v.as_object_mut() {
        for (k, val) in obj.iter_mut() {
            if val.is_string()
                && (k.contains("token")
                    || k.contains("pat")
                    || k == "password"
                    || k == "api_key")
            {
                let s = val.as_str().unwrap_or("");
                if !s.is_empty() && s != "••••••••" {
                    *val = json!("••••••••");
                }
            } else if val.is_object() {
                redact_object(val);
            }
        }
    }
}

fn config_get<'a>(cfg: &'a Value, provider: &str) -> Option<&'a Value> {
    cfg.get(provider)
}

fn read_field(cfg: &Value, provider: &str, field: &str) -> Option<String> {
    let v = config_get(cfg, provider)?;
    let raw = v.get(field)?;
    let s = raw.as_str()?;
    if s.is_empty() || s == "••••••••" {
        None
    } else {
        Some(s.to_string())
    }
}

fn read_field_or_err(cfg: &Value, provider: &str, field: &str, label: &str) -> Result<String, String> {
    read_field(cfg, provider, field).ok_or_else(|| format!("Missing {} for {}", label, provider))
}

/* ═══════════════════════════════════════════════════════════════════════
   Top-level orchestrator — builds first (unless skipped), then dispatches
   ═══════════════════════════════════════════════════════════════════════ */

fn run_deploy(
    provider: &str,
    root: &Path,
    cfg: &Value,
    skip_build: bool,
) -> Result<String, String> {
    log_info(format!("Starting {} deploy", provider));
    stop_if_requested()?;

    // Step 1 — build (unless skipped). For Vercel / Cloudflare / Netlify, the
    // provider's own build infra handles the actual Next.js build from the
    // pushed Git source, so we only need a local build for GitHub Pages.
    if !skip_build && provider == "github_pages" {
        log_info("Building the project locally for GitHub Pages…");
        stop_if_requested()?;
        match run_local_build(root) {
            Ok(()) => log_ok("Local build complete."),
            Err(e) => return Err(format!("Local build failed: {}", e)),
        }
    } else if !skip_build && (provider == "cloudflare_pages_direct" || provider == "netlify_direct") {
        // Reserved for future direct-upload modes — not currently triggered.
        log_info("Building the project locally…");
        stop_if_requested()?;
        match run_local_build(root) {
            Ok(()) => log_ok("Local build complete."),
            Err(e) => return Err(format!("Local build failed: {}", e)),
        }
    }

    // Step 2 — push to Git first (so the provider's rebuild picks up changes).
    if provider != "github_pages" {
        log_info("Pushing current branch to remote… (capped at 30s)");
        stop_if_requested()?;
        match git_push_quiet(root) {
            Ok(()) => log_ok("Git push complete."),
            Err(e) => log_warn(format!("Git push failed (continuing anyway): {}", e)),
        }
    }

    // Step 3 — dispatch to provider.
    log_info(format!("Phase: dispatching to provider '{}'", provider));
    stop_if_requested()?;
    let url = match provider {
        "vercel" => {
            log_info("Checkpoint: calling deploy_vercel…");
            let r = deploy_vercel(root, cfg)?;
            log_info("Checkpoint: deploy_vercel returned");
            r
        }
        "github_pages" => {
            log_info("Checkpoint: calling deploy_github_pages…");
            let r = deploy_github_pages(root, cfg)?;
            log_info("Checkpoint: deploy_github_pages returned");
            r
        }
        "cloudflare_pages" => {
            log_info("Checkpoint: calling deploy_cloudflare_pages…");
            let r = deploy_cloudflare_pages(root, cfg)?;
            log_info("Checkpoint: deploy_cloudflare_pages returned");
            r
        }
        "netlify" => {
            log_info("Checkpoint: calling deploy_netlify…");
            let r = deploy_netlify(cfg)?;
            log_info("Checkpoint: deploy_netlify returned");
            r
        }
        other => return Err(format!("Unknown provider: {}", other)),
    };

    Ok(url)
}

fn run_local_build(root: &Path) -> Result<(), String> {
    let pm = which::which("bun")
        .map(|_| "bun")
        .or_else(|_| which::which("npm").map(|_| "npm"))
        .map_err(|_| "Neither bun nor npm found on PATH".to_string())?;

    let mut cmd = std::process::Command::new(pm);
    cmd.args(["run", "build"]).current_dir(root);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = run_cmd_timeout(cmd, 300).map_err(|e| format!("Build timed out or failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_push_quiet(root: &Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(["push"]).current_dir(root);
    // Suppress credential prompts so git push fails fast instead of hanging
    // on GCM or SSH passphrase dialogs.
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = run_cmd_timeout(cmd, 30).map_err(|e| format!("Git push failed: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

/// Run a command with a timeout (in seconds). Kills the process if it does not
/// complete within the limit, preventing orphaned processes that would otherwise
/// accumulate when `git push` hangs on credential prompts.
pub(crate) fn run_cmd_timeout(mut cmd: std::process::Command, secs: u64) -> Result<std::process::Output, String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    let start = Instant::now();
    let timeout = Duration::from_secs(secs);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                let _ = child.stdout.as_mut().map(|s| s.read_to_end(&mut stdout));
                let _ = child.stderr.as_mut().map(|s| s.read_to_end(&mut stderr));
                return Ok(std::process::Output { status, stdout, stderr });
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Command timed out after {}s", secs));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Process error: {}", e));
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Vercel — POST /v13/deployments to trigger a production redeploy
   ═══════════════════════════════════════════════════════════════════════ */

fn build_vercel_client() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .user_agent("osler-admin/0.2 (tauri)")
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
}

fn test_vercel(cfg: &Value) -> Result<Value, String> {
    let token = read_field_or_err(cfg, "vercel", "token", "Personal Access Token")?;
    let client = ureq::AgentBuilder::new()
        .user_agent("osler-admin/0.2 (tauri)")
        .timeout(std::time::Duration::from_secs(15))
        .timeout_connect(std::time::Duration::from_secs(10))
        .build();
    log_info("Vercel test: GET https://api.vercel.com/v2/user …");
    let resp = client
        .get("https://api.vercel.com/v2/user")
        .set("Authorization", &format!("Bearer {}", token))
        .call()
        
        .map_err(|e| format!("Vercel connection test failed: {}", e))?;
    log_info("Vercel test: response received");
    let status = resp.status();
    if status < 200 || status >= 300 {
        let body = resp.into_string().unwrap_or_default();
        return Err(format!("Vercel rejected the token ({}): {}", status, body));
    }
    let json: Value = resp.into_json().map_err(|e| e.to_string())?;
    let user = json.get("user").and_then(|u| u.get("username")).and_then(|s| s.as_str()).unwrap_or("(unknown)");
    Ok(json!({ "user": user }))
}

fn deploy_vercel(root: &Path, cfg: &Value) -> Result<String, String> {
    let token = read_field_or_err(cfg, "vercel", "token", "Personal Access Token")?;
    let project = read_field_or_err(cfg, "vercel", "project_name", "Project name")?;
    let branch = read_field(cfg, "vercel", "branch").unwrap_or_else(|| crate::commands::git_branch_string(root).unwrap_or_else(|_| "main".to_string()));

    log_info(format!("Triggering Vercel production deploy for project '{}' (branch {})…", project, branch));

    let client = build_vercel_client();
    let body = json!({
        "name": project,
        "target": "production",
        "gitSource": {
            "type": "github",
            "ref": branch,
        },
    });

    let vercel_url = "https://api.vercel.com/v13/deployments?forceNew=1";
    log_info(format!("Vercel deploy: POST {} (30s timeout)…", vercel_url));
    let resp = client
        .post(vercel_url)
        .set("Authorization", &format!("Bearer {}", token))
        .send_json(&body)
        .map_err(|e| e.to_string())?;
    log_info("Vercel deploy: response received");

    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    if status < 200 || status >= 300 {
        return Err(format!("Vercel API {}: {}", status, text));
    }
    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let id = json.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let url = json
        .get("url")
        .and_then(|v| v.as_str())
        .map(|s| format!("https://{}", s))
        .unwrap_or_else(|| format!("https://vercel.com/dashboard/deployments/{}", id));
    log_ok(format!("Vercel deployment created (id: {})", id));
    Ok(url)
}

/* ═══════════════════════════════════════════════════════════════════════
   GitHub Pages — push build output to the configured branch via the Git Data API
   ═══════════════════════════════════════════════════════════════════════ */

fn build_github_client() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
}

fn test_github_pages(cfg: &Value) -> Result<Value, String> {
    let token = read_field_or_err(cfg, "github_pages", "token", "Personal Access Token")?;
    let owner = read_field_or_err(cfg, "github_pages", "owner", "Owner")?;
    let repo  = read_field_or_err(cfg, "github_pages", "repo", "Repository")?;
    let client = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(15))
        .timeout_connect(std::time::Duration::from_secs(10))
        .build();

    let url = format!("https://api.github.com/repos/{}/{}", owner, repo);
    log_info(format!("GitHub test: GET {}", &url[..url.len().min(80)]));
    let resp = gh_get!(client, &url, token).map_err(|e| format!("GitHub connection test failed: {}", e))?;
    log_info("GitHub test: response received");
    let status = resp.status();
    if status < 200 || status >= 300 {
        let body = resp.into_string().unwrap_or_default();
        return Err(format!("GitHub API {}: {}", status, body));
    }
    let json: Value = resp.into_json().map_err(|e| e.to_string())?;
    let full = json.get("full_name").and_then(|s| s.as_str()).unwrap_or("");
    let default_branch = json.get("default_branch").and_then(|s| s.as_str()).unwrap_or("");
    Ok(json!({ "repo": full, "default_branch": default_branch }))
}

fn deploy_github_pages(root: &Path, cfg: &Value) -> Result<String, String> {
    let token = read_field_or_err(cfg, "github_pages", "token", "Personal Access Token")?;
    let owner = read_field_or_err(cfg, "github_pages", "owner", "Owner")?;
    let repo  = read_field_or_err(cfg, "github_pages", "repo", "Repository")?;
    let branch = read_field(cfg, "github_pages", "branch").unwrap_or_else(|| crate::commands::git_branch_string(root).unwrap_or_else(|_| "gh-pages".to_string()));
    let source_dir_name = read_field(cfg, "github_pages", "source_dir").unwrap_or_else(|| "auto".to_string());

    // Pick the source directory: explicit config > out/ if it exists > public/ as fallback.
    let source_dir = if source_dir_name == "auto" {
        let out = root.join("out");
        if out.is_dir() {
            out
        } else {
            log_warn("`out/` not found — falling back to `public/`. Configure a static export (`output: \"export\"`) for proper GitHub Pages deploys.");
            root.join("public")
        }
    } else {
        root.join(&source_dir_name)
    };

    if !source_dir.is_dir() {
        return Err(format!("Source directory not found: {}", source_dir.display()));
    }

    log_info(format!("Pushing contents of {} to {}/{} (branch {})…", source_dir.display(), owner, repo, branch));

    let client = build_github_client();
    let api = format!("https://api.github.com/repos/{}/{}", owner, repo);

    // 1. Collect files (relative path → bytes).
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    collect_files(&source_dir, &source_dir, &mut files)?;
    log_info(format!("Found {} files to upload", files.len()));

    // 2. Get the current SHA of the target branch (or create the branch).
    let ref_url = format!("{}/git/refs/heads/{}", api, branch);
    log_info(format!("GH: GET refs/heads/{} …", branch));
    let head_sha: Option<String> = match gh_get!(client, &ref_url, token) {
        Ok(resp) if resp.status() >= 200 && resp.status() < 300 => {
            let json: Value = resp.into_json().map_err(|e| e.to_string())?;
            json.get("object").and_then(|o| o.get("sha")).and_then(|s| s.as_str()).map(|s| s.to_string())
        }
        _ => None,
    };
    log_info(format!("GH: head_sha = {:?}", head_sha.as_ref().map(|s| &s[..7.min(s.len())])));

    // 3. Get the tree SHA of the current head (if any).
    let mut base_tree: Option<String> = None;
    if let Some(sha) = &head_sha {
        let commit_url = format!("{}/git/commits/{}", api, sha);
        log_info(format!("GH: GET commit {} …", &sha[..7]));
        if let Ok(resp) = gh_get!(client, &commit_url, token) {
            if resp.status() >= 200 && resp.status() < 300 {
                if let Ok(json) = resp.into_json::<Value>() {
                    base_tree = json.get("tree").and_then(|t| t.get("sha")).and_then(|s| s.as_str()).map(|s| s.to_string());
                }
            }
        }
        log_info(format!("GH: base_tree = {:?}", base_tree.as_ref().map(|s| &s[..7.min(s.len())])));
    }

    // 4. Create a blob for each file.
    let mut tree_entries: Vec<Value> = Vec::new();
    let total = files.len();
    for (i, (path, bytes)) in files.iter().enumerate() {
        let blob_url = format!("{}/git/blobs", api);
        let body = json!({
            "content": B64.encode(bytes),
            "encoding": "base64",
        });
        log_info(format!("GH: blob {}/{} — {}", i + 1, total, path));
        let resp = gh_post!(client, &blob_url, token).send_json(&body).map_err(|e| e.to_string())?;
        if resp.status() < 200 || resp.status() >= 300 {
            let text = resp.into_string().unwrap_or_default();
            return Err(format!("Failed to create blob for {}: {}", path, text));
        }
        let blob_json: Value = resp.into_json().map_err(|e| e.to_string())?;
        let blob_sha = blob_json.get("sha").and_then(|s| s.as_str()).ok_or("Missing blob sha")?;
        tree_entries.push(json!({
            "path": path,
            "mode": "100644",
            "type": "blob",
            "sha": blob_sha,
        }));
    }
    log_info(format!("Created {} blobs", tree_entries.len()));

    // 5. Create a new tree.
    let tree_body = json!({
        "base_tree": base_tree,
        "tree": tree_entries,
    });
    let tree_url = format!("{}/git/trees", api);
    log_info("GH: POST tree …");
    let resp = gh_post!(client, &tree_url, token).send_json(&tree_body).map_err(|e| e.to_string())?;
    log_info("GH: tree response received");
    if resp.status() < 200 || resp.status() >= 300 {
        let text = resp.into_string().unwrap_or_default();
        return Err(format!("Failed to create tree: {}", text));
    }
    let tree_json: Value = resp.into_json().map_err(|e| e.to_string())?;
    let tree_sha = tree_json.get("sha").and_then(|s| s.as_str()).ok_or("Missing tree sha")?;
    log_info(format!("Created tree {}", &tree_sha[..7]));

    // 6. Create the commit.
    let mut commit_body = json!({
        "message": format!("Deploy to {} pages via Osler Admin", branch),
        "tree": tree_sha,
    });
    if let Some(sha) = &head_sha {
        commit_body["parents"] = json!([sha]);
    } else {
        commit_body["parents"] = json!([]);
    }
    let commit_url = format!("{}/git/commits", api);
    log_info("GH: POST commit …");
    let resp = gh_post!(client, &commit_url, token).send_json(&commit_body).map_err(|e| e.to_string())?;
    log_info("GH: commit response received");
    if resp.status() < 200 || resp.status() >= 300 {
        let text = resp.into_string().unwrap_or_default();
        return Err(format!("Failed to create commit: {}", text));
    }
    let commit_json: Value = resp.into_json().map_err(|e| e.to_string())?;
    let commit_sha = commit_json.get("sha").and_then(|s| s.as_str()).ok_or("Missing commit sha")?;
    log_ok(format!("Created commit {}", &commit_sha[..7]));

    // 7. Update the ref (create the branch if it doesn't exist).
    let ref_body = json!({ "sha": commit_sha, "force": true });
    let ref_resp = if head_sha.is_some() {
        log_info("GH: PATCH ref …");
        gh_patch!(client, &ref_url, token).send_json(&ref_body)
    } else {
        log_info("GH: POST ref (create branch) …");
        let create_url = format!("{}/git/refs", api);
        let create_body = json!({ "sha": commit_sha, "ref": format!("refs/heads/{}", branch) });
        gh_post!(client, &create_url, token).send_json(&create_body)
    };
    let resp = ref_resp.map_err(|e| e.to_string())?;
    log_info("GH: ref update response received");
    if resp.status() < 200 || resp.status() >= 300 {
        let text = resp.into_string().unwrap_or_default();
        return Err(format!("Failed to update ref: {}", text));
    }
    log_ok(format!("Updated {}/{} → {}", branch, repo, &commit_sha[..7]));

    let pages_url = format!("https://{}.github.io/{}/", owner, repo);
    Ok(pages_url)
}

fn collect_files(base: &Path, current: &Path, out: &mut Vec<(String, Vec<u8>)>) -> Result<(), String> {
    if !current.is_dir() {
        return Ok(());
    }
    let entries = std::fs::read_dir(current).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if p.is_dir() {
            collect_files(base, &p, out)?;
        } else if p.is_file() {
            let rel = p.strip_prefix(base).map_err(|e| e.to_string())?;
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
            out.push((rel_str, bytes));
        }
    }
    Ok(())
}

/* ═══════════════════════════════════════════════════════════════════════
   Cloudflare Pages — POST /accounts/.../projects/.../deployments to trigger
   a redeploy from the connected Git branch.
   ═══════════════════════════════════════════════════════════════════════ */

fn build_cloudflare_client() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
}

fn test_cloudflare_pages(cfg: &Value) -> Result<Value, String> {
    let token = read_field_or_err(cfg, "cloudflare_pages", "api_token", "API token")?;
    let account_id = read_field_or_err(cfg, "cloudflare_pages", "account_id", "Account ID")?;
    let project = read_field_or_err(cfg, "cloudflare_pages", "project_name", "Project name")?;
    let client = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(15))
        .timeout_connect(std::time::Duration::from_secs(10))
        .build();

    let url = format!("https://api.cloudflare.com/client/v4/accounts/{}/pages/projects/{}", account_id, project);
    log_info("Cloudflare test: GET project …");
    let resp = bearer_get!(client, &url, token).call().map_err(|e| format!("Cloudflare connection test failed: {}", e))?;
    log_info("Cloudflare test: response received");
    let status = resp.status();
    if status < 200 || status >= 300 {
        let body = resp.into_string().unwrap_or_default();
        return Err(format!("Cloudflare API {}: {}", status, body));
    }
    let json: Value = resp.into_json().map_err(|e| e.to_string())?;
    let name = json.pointer("/result/name").and_then(|s| s.as_str()).unwrap_or("");
    let subdomain = json.pointer("/result/subdomain").and_then(|s| s.as_str()).unwrap_or("");
    Ok(json!({ "project": name, "subdomain": subdomain }))
}

fn deploy_cloudflare_pages(root: &Path, cfg: &Value) -> Result<String, String> {
    let token = read_field_or_err(cfg, "cloudflare_pages", "api_token", "API token")?;
    let account_id = read_field_or_err(cfg, "cloudflare_pages", "account_id", "Account ID")?;
    let project = read_field_or_err(cfg, "cloudflare_pages", "project_name", "Project name")?;
    let branch = read_field(cfg, "cloudflare_pages", "branch").unwrap_or_else(|| crate::commands::git_branch_string(root).unwrap_or_else(|_| "main".to_string()));

    log_info(format!("Triggering Cloudflare Pages deploy for '{}' (branch {})…", project, branch));

    let client = build_cloudflare_client();
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/pages/projects/{}/deployments",
        account_id, project
    );
    let body = json!({ "branch": branch });
    log_info("Cloudflare deploy: POST deployment (300s timeout)…");
    let resp = bearer_post!(client, &url, token)
        .send_json(&body)
        .map_err(|e| e.to_string())?;
    log_info("Cloudflare deploy: response received");

    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    if status < 200 || status >= 300 {
        return Err(format!("Cloudflare API {}: {}", status, text));
    }
    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let id = json.pointer("/result/id").and_then(|s| s.as_str()).unwrap_or("");
    let url_out = json
        .pointer("/result/url")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://dash.cloudflare.com/{}/pages/view/{}", account_id, project));
    log_ok(format!("Cloudflare deployment created (id: {})", id));
    Ok(url_out)
}

/* ═══════════════════════════════════════════════════════════════════════
   Netlify — POST /sites/{site_id}/deploys to trigger a manual build from Git
   ═══════════════════════════════════════════════════════════════════════ */

fn build_netlify_client() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
}

fn test_netlify(cfg: &Value) -> Result<Value, String> {
    let token = read_field_or_err(cfg, "netlify", "token", "Personal Access Token")?;
    let site_id = read_field_or_err(cfg, "netlify", "site_id", "Site ID")?;
    let client = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(15))
        .timeout_connect(std::time::Duration::from_secs(10))
        .build();

    let url = format!("https://api.netlify.com/api/v1/sites/{}", site_id);
    log_info("Netlify test: GET site …");
    let resp = bearer_get!(client, &url, token).call().map_err(|e| format!("Netlify connection test failed: {}", e))?;
    log_info("Netlify test: response received");
    let status = resp.status();
    if status < 200 || status >= 300 {
        let body = resp.into_string().unwrap_or_default();
        return Err(format!("Netlify API {}: {}", status, body));
    }
    let json: Value = resp.into_json().map_err(|e| e.to_string())?;
    let name = json.get("name").and_then(|s| s.as_str()).unwrap_or("");
    let ssl_url = json.get("ssl_url").and_then(|s| s.as_str()).unwrap_or("");
    Ok(json!({ "name": name, "url": ssl_url }))
}

fn deploy_netlify(cfg: &Value) -> Result<String, String> {
    let token = read_field_or_err(cfg, "netlify", "token", "Personal Access Token")?;
    let site_id = read_field_or_err(cfg, "netlify", "site_id", "Site ID")?;
    let title = read_field(cfg, "netlify", "deploy_title").unwrap_or_else(|| "Osler Admin deploy".to_string());

    log_info(format!("Triggering Netlify deploy for site '{}'…", site_id));

    let client = build_netlify_client();
    let url = format!("https://api.netlify.com/api/v1/sites/{}/deploys", site_id);
    let body = json!({
        "trigger": "manual-deploy",
        "title": title,
    });
    log_info("Netlify deploy: POST deploy (300s timeout)…");
    let resp = bearer_post!(client, &url, token)
        .send_json(&body)
        .map_err(|e| e.to_string())?;
    log_info("Netlify deploy: response received");

    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    if status < 200 || status >= 300 {
        return Err(format!("Netlify API {}: {}", status, text));
    }
    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let id = json.get("id").and_then(|s| s.as_str()).unwrap_or("");
    let ssl_url = json.get("ssl_url").and_then(|s| s.as_str()).map(|s| s.to_string());
    log_ok(format!("Netlify deploy triggered (id: {})", id));
    Ok(ssl_url.unwrap_or_else(|| format!("https://app.netlify.com/sites/{}/deploys/{}", site_id, id)))
}

// (hash helpers removed — no longer needed without Git Data API uploads)
