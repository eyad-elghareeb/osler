// prereq.rs — System prerequisites verification and automated installer for Osler Admin.
//
// Checks for:
//   1. Node.js (version >= 18)
//   2. Git CLI
//   3. Cloudflare Wrangler CLI (global or project-local)
//   4. Cloudflare Authentication status (via wrangler whoami / env token)
//
// Windows: always passes CREATE_NO_WINDOW so no cmd popup flashes.
// All checks are async so the Tauri UI never freezes.

use serde_json::{json, Value};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows flag: DETACHED_PROCESS | CREATE_NO_WINDOW
#[cfg(target_os = "windows")]
const NO_WINDOW: u32 = 0x08000000;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrereqStatus {
    pub name: String,
    pub label: String,
    pub installed: bool,
    pub version: String,
    pub required_version: String,
    pub satisfied: bool,
    pub details: String,
    pub fixable: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrereqsReport {
    pub all_satisfied: bool,
    pub items: Vec<PrereqStatus>,
}

/// Run a command silently (no CMD popup on Windows) and return its stdout/stderr.
fn run_cmd(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(NO_WINDOW);

    let output = cmd.output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Some(if !stdout.is_empty() { stdout } else { stderr })
    } else if !stderr.is_empty() {
        Some(stderr)
    } else {
        None
    }
}

/// On Windows, run a command via `cmd /C` so PATH expansion works for
/// commands that are `.cmd` / `.bat` wrappers (e.g. `npx.cmd`, `wrangler.cmd`).
fn run_cmd_shell(args: &[&str]) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C");
        cmd.args(args);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(NO_WINDOW);
        let output = cmd.output().ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() {
            Some(if !stdout.is_empty() { stdout } else { stderr })
        } else if !stderr.is_empty() {
            Some(stderr)
        } else {
            None
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        run_cmd(args[0], &args[1..])
    }
}

/// Check system prerequisites: Node.js, Git, Wrangler, and Cloudflare auth.
/// Marked async so Tauri dispatches it on the async runtime thread pool,
/// keeping the frontend responsive while checks execute.
#[tauri::command]
pub async fn check_prerequisites() -> Result<PrereqsReport, String> {
    // Spawn blocking I/O on the blocking thread pool so we don't block
    // the async executor or the Tauri message loop.
    tauri::async_runtime::spawn_blocking(check_prerequisites_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn check_prerequisites_sync() -> Result<PrereqsReport, String> {
    let mut items = Vec::new();

    // 1. Node.js
    let node_out = run_cmd("node", &["-v"]);
    let (node_installed, node_ver, node_sat, node_det) = match node_out {
        Some(v) if v.starts_with('v') => {
            let major = v
                .trim_start_matches('v')
                .split('.')
                .next()
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0);
            let sat = major >= 18;
            let det = if sat {
                format!("Node.js {} is ready", v)
            } else {
                format!("Node.js {} is too old (requires >= v18.0.0)", v)
            };
            (true, v, sat, det)
        }
        _ => (
            false,
            "None".into(),
            false,
            "Node.js is not installed or not in PATH".into(),
        ),
    };
    items.push(PrereqStatus {
        name: "node".into(),
        label: "Node.js (Runtime)".into(),
        installed: node_installed,
        version: node_ver,
        required_version: ">= 18.0.0".into(),
        satisfied: node_sat,
        details: node_det,
        fixable: false,
    });

    // 2. Git
    let git_out = run_cmd("git", &["--version"]);
    let (git_installed, git_ver, git_sat, git_det) = match git_out {
        Some(v) if v.to_lowercase().contains("git version") => {
            (true, v.clone(), true, format!("Git detected: {}", v))
        }
        _ => (
            false,
            "None".into(),
            false,
            "Git is not installed or not in PATH".into(),
        ),
    };
    items.push(PrereqStatus {
        name: "git".into(),
        label: "Git (Version Control)".into(),
        installed: git_installed,
        version: git_ver,
        required_version: ">= 2.0".into(),
        satisfied: git_sat,
        details: git_det,
        fixable: false,
    });

    // 3. Wrangler CLI — prefer global `wrangler`, fall back to `npx wrangler`
    let wrangler_out = run_cmd("wrangler", &["--version"])
        .or_else(|| run_cmd_shell(&["npx", "--no-install", "wrangler", "--version"]));
    let (wrangler_installed, wrangler_ver, wrangler_sat, wrangler_det) = match wrangler_out {
        Some(v) if v.contains('.') && !v.to_lowercase().contains("could not determine") => {
            let ver = v.lines().next().unwrap_or("").trim().to_string();
            (
                true,
                ver.clone(),
                true,
                format!("Cloudflare Wrangler CLI detected ({})", ver),
            )
        }
        _ => (
            false,
            "None".into(),
            false,
            "Wrangler CLI is not installed (can be auto-installed via npm)".into(),
        ),
    };
    items.push(PrereqStatus {
        name: "wrangler".into(),
        label: "Cloudflare Wrangler CLI".into(),
        installed: wrangler_installed,
        version: wrangler_ver,
        required_version: ">= 3.0.0".into(),
        satisfied: wrangler_sat,
        details: wrangler_det,
        fixable: true,
    });

    // 4. Cloudflare Authentication
    let whoami_out = run_cmd_shell(&["npx", "wrangler", "whoami"]);
    let (cf_auth_sat, cf_auth_ver, cf_auth_det) = match whoami_out {
        Some(v)
            if !v.to_lowercase().contains("not authenticated")
                && !v.to_lowercase().contains("you are not logged in")
                && (v.contains('@')
                    || v.to_lowercase().contains("account")
                    || v.to_lowercase().contains("logged in")) =>
        {
            let line = v
                .lines()
                .find(|l| l.contains('@') || l.contains("Account"))
                .unwrap_or("Authenticated");
            (
                true,
                "Logged In".into(),
                format!("Authenticated: {}", line.trim()),
            )
        }
        _ => (
            false,
            "Unauthenticated".into(),
            "Not logged into Cloudflare. Click Install / Fix to open browser login.".into(),
        ),
    };
    items.push(PrereqStatus {
        name: "cloudflare_auth".into(),
        label: "Cloudflare Account Login".into(),
        installed: cf_auth_sat,
        version: cf_auth_ver,
        required_version: "Active session".into(),
        satisfied: cf_auth_sat,
        details: cf_auth_det,
        fixable: true,
    });

    let all_satisfied = items.iter().all(|i| i.satisfied);
    Ok(PrereqsReport {
        all_satisfied,
        items,
    })
}

/// Automated installation or login trigger for a prerequisite.
#[tauri::command]
pub async fn install_prerequisite(name: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || install_prerequisite_sync(&name))
        .await
        .map_err(|e| e.to_string())?
}

fn install_prerequisite_sync(name: &str) -> Result<Value, String> {
    match name {
        "wrangler" => {
            let res = run_cmd_shell(&["npm", "install", "-g", "wrangler"]);
            match res {
                Some(out) => Ok(json!({
                    "success": true,
                    "message": format!("Wrangler CLI installed: {}", out.lines().last().unwrap_or(""))
                })),
                None => Err("Failed to install Wrangler CLI via npm".into()),
            }
        }
        "cloudflare_auth" => {
            // Open browser-based OAuth login without blocking or showing a window
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("cmd")
                    .args(["/C", "start", "", "cmd", "/C", "npx wrangler login"])
                    .creation_flags(NO_WINDOW)
                    .spawn();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("sh")
                    .args(["-c", "npx wrangler login"])
                    .spawn();
            }
            Ok(json!({
                "success": true,
                "message": "Opened browser for Cloudflare login. Please approve in your browser, then click Check Again."
            }))
        }
        _ => Err(format!("No automated installer for: {}", name)),
    }
}
