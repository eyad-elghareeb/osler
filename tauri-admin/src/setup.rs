// setup.rs — Post-deploy assisted setup commands for the instance generator.
//
// The deployment pipeline (scripts/cloudflare-init.js) provisions D1/R2/
// Worker/Pages, applies migrations, and sets JWT_SECRET. Everything that can
// only happen AFTER the Worker is live lives here:
//   * writing optional Worker secrets (Google OAuth credentials)
//   * promoting the first admin user
//   * verifying the deployment with a health check
//
// The wizard's "Ready" step drives these so a fresh instance goes from zero
// to fully configured without touching a terminal.

use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::State;

use crate::commands::{root_or_err_pub, ProjectRoot};

fn worker_dir(root: &Path) -> PathBuf {
    root.join("cloudflare").join("worker")
}

/// `npx wrangler …` Command — npx is a .cmd shim on Windows, so go through
/// cmd /C there (same convention as deploy.rs).
fn npx_command(args: &[&str], cwd: &Path) -> Command {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", "npx"]);
        for a in args {
            c.arg(a);
        }
        c
    } else {
        let mut c = Command::new("npx");
        c.args(args);
        c
    };
    cmd.current_dir(cwd);
    cmd
}

/// Spawn with piped stdio (optionally feeding stdin), wait up to `secs`,
/// return (exit_code, combined_output).
fn run_captured(
    mut cmd: Command,
    stdin_data: Option<&str>,
    secs: u64,
) -> Result<(i32, String), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(if stdin_data.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
    if let (Some(mut sin), Some(data)) = (child.stdin.take(), stdin_data) {
        let _ = sin.write_all(data.as_bytes());
        let _ = sin.write_all(b"\n");
    }
    drop(child.stdin.take()); // signal EOF so wrangler doesn't wait for more input

    let start = Instant::now();
    let timeout = Duration::from_secs(secs);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut s) = child.stdout.take() {
                    let _ = std::io::Read::read_to_string(&mut s, &mut out);
                }
                if let Some(mut s) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut s, &mut out);
                }
                return Ok((status.code().unwrap_or(-1), out));
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

/// Generate a cryptographically random secret via Node's crypto (Node is a
/// hard prerequisite of the toolchain, so no extra Rust dependency).
#[tauri::command]
pub async fn setup_generate_secret() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (code, out) = run_captured(
            {
                let mut c = Command::new("node");
                c.arg("-e")
                    .arg("console.log(require('crypto').randomBytes(32).toString('hex'))");
                c
            },
            None,
            30,
        )?;
        let secret = out.lines().last().unwrap_or("").trim().to_string();
        if code != 0 || secret.is_empty() {
            return Err("Could not generate a secret — is Node.js installed?".to_string());
        }
        Ok(json!({ "secret": secret }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write Worker secrets (`npx wrangler secret put <name>`) in the bound
/// instance. Values are never logged. Returns per-secret results.
#[tauri::command]
pub async fn setup_write_secrets(
    target_dir: Option<String>,
    secrets: Vec<SecretInput>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = if let Some(td) = target_dir {
        PathBuf::from(td)
    } else {
        root_or_err_pub(&state)?
    };
    let dir = worker_dir(&root);
    if !dir.is_dir() {
        return Err(format!("Worker directory not found: {}", dir.display()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        for secret in secrets {
            let (code, out) = run_captured(
                npx_command(&["wrangler", "secret", "put", &secret.name], &dir),
                Some(&secret.value),
                120,
            )?;
            results.push(json!({
                "name": secret.name,
                "ok": code == 0,
            }));
            if code != 0 {
                return Err(format!(
                    "Failed to set secret {}: {}",
                    secret.name,
                    out.lines().last().unwrap_or("unknown error")
                ));
            }
        }
        Ok(json!({ "written": results }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
pub struct SecretInput {
    pub name: String,
    pub value: String,
}

/// Promote a registered user to admin in the instance's D1 database.
/// Admin is never granted at registration — this is the assisted equivalent
/// of the manual SQL step in SELF-HOSTING.md §4 step 8.
#[tauri::command]
pub async fn setup_promote_admin(
    target_dir: Option<String>,
    d1_name: Option<String>,
    username: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = if let Some(td) = target_dir {
        PathBuf::from(td)
    } else {
        root_or_err_pub(&state)?
    };
    let dir = worker_dir(&root);
    if !dir.is_dir() {
        return Err(format!("Worker directory not found: {}", dir.display()));
    }
    let user = username.trim().to_string();
    if user.is_empty() || user.len() > 32 || user.contains('\'') || user.contains(';') || user.contains("--") {
        return Err("Invalid username".to_string());
    }
    let db = d1_name.unwrap_or_else(|| "osler-cloud".to_string());
    let sql = format!(
        "UPDATE users SET role = 'admin' WHERE username = '{}' COLLATE NOCASE;",
        user.replace('\'', "''")
    );
    tauri::async_runtime::spawn_blocking(move || {
        let (code, out) = run_captured(
            npx_command(
                &["wrangler", "d1", "execute", &db, "--remote", "--command", &sql],
                &dir,
            ),
            None,
            120,
        )?;
        if code != 0 {
            return Err(format!(
                "Failed to promote admin: {}",
                out.lines().last().unwrap_or("unknown error")
            ));
        }
        Ok(json!({ "promoted": true, "username": user }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Health check against the deployed Worker (`GET /v1/health`). The Tauri
/// webview CSP blocks cross-origin fetches, so this runs on the Rust side.
#[tauri::command]
pub async fn setup_check_health(worker_url: String) -> Result<Value, String> {
    let url = worker_url.trim().trim_end_matches('/').to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout_read(Duration::from_secs(8)).timeout(Duration::from_secs(10)).build();
        let res = agent
            .get(&format!("{}/v1/health", url))
            .call()
            .map_err(|e| format!("Health check failed: {}", e))?;
        let status = res.status();
        let body = res.into_string().unwrap_or_default();
        let ok = status == 200 && body.contains("\"ok\":true");
        Ok(json!({ "ok": ok, "status": status, "body": body.chars().take(300).collect::<String>() }))
    })
    .await
    .map_err(|e| e.to_string())?
}
