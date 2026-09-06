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

/// Generic platform command — npm/npx are .cmd shims on Windows, so those go
/// through cmd /C there (same convention as deploy.rs).
fn platform_command(program: &str, args: &[&str], cwd: &Path) -> Command {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", program]);
        for a in args {
            c.arg(a);
        }
        c
    } else {
        let mut c = Command::new(program);
        c.args(args);
        c
    };
    cmd.current_dir(cwd);
    cmd
}

/// `npx wrangler …` Command — npx is a .cmd shim on Windows, so go through
/// cmd /C there (same convention as deploy.rs).
fn npx_command(args: &[&str], cwd: &Path) -> Command {
    platform_command("npx", args, cwd)
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

#[derive(serde::Deserialize)]
pub struct EmailWorkerSetup {
    pub gmail_user: String,
    pub gmail_app_password: String,
    /// Optional — generated internally when omitted, so the frontend never
    /// handles the token.
    pub email_token: Option<String>,
    pub from_name: Option<String>,
}

/// Deploy the standalone Gmail relay worker (cloudflare/email-worker) inside
/// a generated instance and wire it to that instance's main Worker:
///   1. writes GMAIL_USER / GMAIL_APP_PASSWORD / EMAIL_TOKEN (+ FROM_NAME)
///      as relay secrets
///   2. runs `npx wrangler deploy` in cloudflare/email-worker and parses the
///      workers.dev URL from the output
///   3. writes EMAIL_WORKER_URL + EMAIL_WORKER_TOKEN as main-Worker secrets
/// Secret values are piped over stdin and never logged.
#[tauri::command]
pub async fn deploy_email_worker(
    target_dir: Option<String>,
    setup: EmailWorkerSetup,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = if let Some(td) = target_dir {
        PathBuf::from(td)
    } else {
        root_or_err_pub(&state)?
    };
    let email_dir = root.join("cloudflare").join("email-worker");
    let main_dir = root.join("cloudflare").join("worker");
    if !email_dir.is_dir() {
        return Err("cloudflare/email-worker not found in this instance — update the instance to pull in the email relay worker".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        // 0. Dependencies for the relay worker (skipped when already present).
        if !email_dir.join("node_modules").is_dir() {
            let (code, out) = run_captured(platform_command("npm", &["install"], &email_dir), None, 600)?;
            if code != 0 {
                return Err(format!("npm install failed in email-worker: {}", last_line(&out)));
            }
        }

        // Shared token: generated here when the frontend doesn't pass one,
        // so the token never transits the UI.
        let email_token = match setup.email_token.as_deref() {
            Some(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => {
                let (code, out) = run_captured(
                    platform_command("node", &["-e", "console.log(require('crypto').randomBytes(32).toString('hex'))"], &root),
                    None,
                    30,
                )?;
                if code != 0 {
                    return Err("Could not generate the EMAIL_TOKEN — is Node.js installed?".to_string());
                }
                out.lines().last().unwrap_or("").trim().to_string()
            }
        };

        // 1. Relay secrets.
        let mut secrets: Vec<(String, String)> = vec![
            ("GMAIL_USER".into(), setup.gmail_user.clone()),
            ("GMAIL_APP_PASSWORD".into(), setup.gmail_app_password.clone()),
            ("EMAIL_TOKEN".into(), email_token.clone()),
        ];
        if let Some(name) = setup.from_name.as_deref() {
            if !name.trim().is_empty() {
                secrets.push(("FROM_NAME".into(), name.trim().to_string()));
            }
        }
        for (name, value) in &secrets {
            let (code, out) = run_captured(
                npx_command(&["wrangler", "secret", "put", name], &email_dir),
                Some(value),
                120,
            )?;
            if code != 0 {
                return Err(format!("Failed to set {name}: {}", last_line(&out)));
            }
        }

        // 2. Deploy the relay worker and read its public URL.
        let (code, out) = run_captured(npx_command(&["wrangler", "deploy"], &email_dir), None, 300)?;
        if code != 0 {
            return Err(format!("Relay worker deploy failed: {}", last_line(&out)));
        }
        let url = out
            .split_whitespace()
            .find(|token| token.starts_with("https://") && token.contains(".workers.dev"))
            .map(|token| token.trim_matches(|c: char| ",;\"".contains(c)).to_string())
            .ok_or_else(|| "Deploy succeeded but no workers.dev URL was found in the output".to_string())?;

        // 3. Wire the main Worker to the relay.
        for (name, value) in [("EMAIL_WORKER_URL", url.clone()), ("EMAIL_WORKER_TOKEN", email_token)] {
            let (code, out) = run_captured(
                npx_command(&["wrangler", "secret", "put", &name], &main_dir),
                Some(&value),
                120,
            )?;
            if code != 0 {
                return Err(format!("Failed to set {name} on the main Worker: {}", last_line(&out)));
            }
        }

        Ok(json!({ "url": url, "secrets": secrets.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>() }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn last_line(out: &str) -> String {
    out.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("unknown error").to_string()
}
