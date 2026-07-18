// commands.rs — All Tauri IPC commands for the Osler admin dashboard.
//
// The app binds to a project root (an Osler Next.js project folder) on launch.
// All commands operate relative to that root:
//   - File CRUD on `public/osler-content/`
//   - Manifest generation (port of scripts/generate-content-manifests.js)
//   - Run `npm`/`bun` build and start, with streamed stdout/stderr
//   - Git add/commit/push/pull against the project's git remote
//
// The frontend polls `runner_status` for build/start log lines.

use crate::{manifest, validate};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tauri::{State, Window};

/// Shared project-root state. `None` until the user picks a folder.
pub struct ProjectRoot(pub Arc<std::sync::Mutex<Option<PathBuf>>>);

/// One captured line of stdout/stderr from a running build/start process.
#[derive(Clone, serde::Serialize)]
pub struct LogLine {
    pub stream: String, // "stdout" | "stderr" | "exit"
    pub text: String,
    pub ts: u64, // epoch millis
}

#[derive(Default, Clone)]
struct RunnerInner {
    /// "build" | "start" | "" (idle)
    pub kind: String,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: u64,
    pub logs: Vec<LogLine>,
    pub stop_requested: bool,
}

impl RunnerInner {
    fn reset(&mut self, kind: &str) {
        self.kind = kind.to_string();
        self.running = true;
        self.exit_code = None;
        self.started_at = now_millis();
        self.ended_at = 0;
        self.logs.clear();
        self.stop_requested = false;
    }
}

/// A single shared runner-state slot. The latest spawn fills it; the previous
/// spawn's threads keep writing but their writes are ignored once a new
/// spawn resets the slot.
fn shared_runner() -> &'static Arc<std::sync::Mutex<RunnerInner>> {
    static SHARED: OnceLock<Arc<std::sync::Mutex<RunnerInner>>> = OnceLock::new();
    SHARED.get_or_init(|| Arc::new(std::sync::Mutex::new(RunnerInner::default())))
}

/// Tauri-managed state — empty marker so we can inject the dialog plugin's
/// Window into commands that need it. The actual runner state lives in the
/// shared static above.
#[derive(Default)]
pub struct RunnerState;

fn now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn root_or_err(state: &State<ProjectRoot>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No project root selected. Pick a folder first.".to_string())
}

/// Public re-export so `deploy.rs` can resolve the project root in its own
/// command handlers (Tauri injects `State<ProjectRoot>` per command, but
/// not all internal helpers take it).
pub fn root_or_err_pub(state: &State<ProjectRoot>) -> Result<PathBuf, String> {
    root_or_err(state)
}

/// Resolve a relative path against the project root. Verifies the result is
/// still inside the root to prevent path traversal.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim().replace('\\', "/");
    let rel = rel.trim_matches('/');
    let p = if rel.is_empty() || rel == "." {
        root.to_path_buf()
    } else {
        root.join(&rel)
    };
    let p_str = p.to_string_lossy().replace('\\', "/");
    let root_str = root.to_string_lossy().replace('\\', "/");
    let root_str = root_str.trim_end_matches('/');
    if !p_str.starts_with(root_str) {
        return Err(format!("Path escapes project root: {}", rel));
    }
    Ok(p)
}

/// Resolve a content-relative path (relative to `public/osler-content/`).
/// Verifies the result stays inside the content root (path traversal check).
fn resolve_content(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let base = content_root(root);
    let rel = rel.trim().replace('\\', "/");
    let rel = rel.trim_matches('/');
    if rel.is_empty() {
        return Err("Empty content path".to_string());
    }
    let p = base.join(&rel);
    let p_str = p.to_string_lossy().replace('\\', "/");
    let base_str = base.to_string_lossy().replace('\\', "/");
    if !p_str.starts_with(&base_str) {
        return Err(format!("Path escapes content root: {}", rel));
    }
    Ok(p)
}

/* ═══════════════════════════════════════════════════════════════════════
   Project picker + state
   ═══════════════════════════════════════════════════════════════════════ */

#[tauri::command]
pub fn ping() -> String {
    "osler-admin".to_string()
}

#[tauri::command]
pub fn set_project_root(root: String, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err("Not a valid directory".to_string());
    }

    let has_pkg = path.join("package.json").exists();
    let has_content = path.join("public/osler-content").is_dir();

    *state.0.lock().unwrap() = Some(path.clone());

    Ok(json!({
        "root": path.to_string_lossy(),
        "hasPackageJson": has_pkg,
        "hasContentDir": has_content,
    }))
}

#[tauri::command]
pub fn project_state(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = state.0.lock().unwrap().clone();
    match root {
        Some(p) => {
            let has_pkg = p.join("package.json").exists();
            let has_content = p.join("public/osler-content").is_dir();
            Ok(json!({
                "root": p.to_string_lossy(),
                "hasPackageJson": has_pkg,
                "hasContentDir": has_content,
                "gitRemote": git_remote_string(&p).ok(),
                "gitBranch": git_branch_string(&p).ok(),
            }))
        }
        None => Ok(json!({ "root": null })),
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   File CRUD — operate under `public/osler-content/`
   ═══════════════════════════════════════════════════════════════════════ */

const CONTENT_BASE: &str = "public/osler-content";

fn content_root(root: &Path) -> PathBuf {
    root.join(CONTENT_BASE)
}

#[tauri::command]
pub fn list_files(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let base = content_root(&root);
    if !base.is_dir() {
        return Ok(json!({ "items": [] }));
    }
    let tree = walk_dir(&base, &base)?;
    Ok(json!({ "items": tree }))
}

fn walk_dir(dir: &Path, base: &Path) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    let mut rd = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut entries: Vec<_> = rd.by_ref().flatten().collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "manifest.json" {
            continue;
        }
        let p = entry.path();
        let rel = p
            .strip_prefix(base)
            .ok()
            .map(|x| x.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| name.clone());

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if meta.is_dir() {
            let children = walk_dir(&p, base)?;
            out.push(json!({
                "type": "folder",
                "name": name,
                "path": rel + "/",
                "items": children,
            }));
        } else if meta.is_file() {
            let size = meta.len();
            let ext = p
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(json!({
                "type": "file",
                "name": name,
                "path": rel,
                "ext": ext,
                "size": size,
            }));
        }
    }
    Ok(out)
}

/// Upload a binary asset (image) next to a content file. The asset is written
/// into an `images/` subfolder beside the referenced content file (or folder),
/// keeping the same convention QBank/Flashcard/Library use for resolving
/// relative image references. `content_path` is the content-relative path of
/// the owning file (e.g. `library/cardiology/stemi.md`); `file_name` is the
/// desired asset name (e.g. `ecg.png`); `data` is the file bytes (base64).
#[tauri::command]
pub fn upload_content_asset(
  content_path: String,
  file_name: String,
  data: String,
  state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
  let root = root_or_err(&state)?;

  // Determine the owning directory inside content root.
  let base = content_root(&root);
  let rel_dir = if content_path.ends_with(".md")
    || content_path.ends_with(".json")
    || content_path.ends_with(".html")
    || content_path.ends_with(".pdf")
  {
    let idx = content_path.rfind('/').unwrap_or(0);
    content_path[..idx].to_string()
  } else {
    content_path.trim_end_matches('/').to_string()
  };

  let images_dir = if rel_dir.is_empty() {
    base.join("images")
  } else {
    base.join(&rel_dir).join("images")
  };
  std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

  // Sanitize the file name (no path separators / traversal).
  let clean_name = file_name
    .rsplit('/')
    .next()
    .unwrap_or(&file_name)
    .to_string();
  if clean_name.is_empty() || clean_name.contains("..") {
    return Err("Invalid asset file name".to_string());
  }

  let asset_path = images_dir.join(&clean_name);
  let bytes = base64_decode(&data)?;
  std::fs::write(&asset_path, bytes).map_err(|e| e.to_string())?;

  // Reference the asset the way the renderer expects: `images/<name>` when
  // the image lives in the same folder as the content file.
  let reference = format!("images/{}", clean_name);
  Ok(json!({ "saved": true, "reference": reference }))
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
  use base64::{engine::general_purpose::STANDARD, Engine};
  STANDARD
    .decode(s.trim())
    .map_err(|e| format!("Invalid base64 asset data: {}", e))
}

/// Read an arbitrary file (typically an image selected via the OS dialog) and
/// return its bytes as base64 so the frontend can forward them to
/// `upload_content_asset`. The path must stay inside the project root.
#[tauri::command]
pub fn read_file_base64(path: String, state: State<'_, ProjectRoot>) -> Result<Value, String> {
  let root = root_or_err(&state)?;
  let p = resolve(&root, &path)?;
  if !p.is_file() {
    return Err(format!("Not a file: {}", path));
  }
  let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
  use base64::{engine::general_purpose::STANDARD, Engine};
  let encoded = STANDARD.encode(&bytes);
  let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("asset").to_string();
  Ok(json!({ "data": encoded, "name": name }))
}

#[tauri::command]
pub fn load_file(path: String, state: State<'_, ProjectRoot>) -> Result<Value, String> {
  let root = root_or_err(&state)?;
  let p = resolve_content(&root, &path)?;
  if !p.is_file() {
    return Err(format!("Not a file: {}", path));
  }
  let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
  Ok(json!({ "path": path, "content": content }))
}

#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let p = resolve_content(&root, &path)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, content).map_err(|e| e.to_string())?;
    Ok(json!({ "saved": true, "path": path }))
}

#[tauri::command]
pub fn create_file(
    path: String,
    content: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let rel = path.trim_start_matches('/');
    let full_rel = if rel.starts_with(CONTENT_BASE) {
        rel.to_string()
    } else {
        format!("{}/{}", CONTENT_BASE, rel)
    };
    let p = resolve(&root, &full_rel)?;
    if p.exists() {
        return Err(format!("Already exists: {}", path));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = content.unwrap_or_default();
    let body = if body.is_empty() && p.extension().and_then(|e| e.to_str()) == Some("json") {
        match p.file_name().and_then(|n| n.to_str()) {
            Some("questions.json") => r#"{"questions":[]}"#.to_string(),
            Some("cards.json") => r#"{"cards":[]}"#.to_string(),
            Some("passages.json") => r#"{"passages":[]}"#.to_string(),
            Some("prompts.json") => r#"{"prompts":[]}"#.to_string(),
            Some("stations.json") => r#"{"stations":[]}"#.to_string(),
            Some("videos.json") => r#"{"videos":[]}"#.to_string(),
            _ => "{}".to_string(),
        }
    } else {
        body
    };
    std::fs::write(&p, body).map_err(|e| e.to_string())?;
    Ok(json!({ "created": true, "path": full_rel }))
}

#[tauri::command]
pub fn create_folder(path: String, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let rel = path.trim_start_matches('/');
    let full_rel = if rel.starts_with(CONTENT_BASE) {
        rel.to_string()
    } else {
        format!("{}/{}", CONTENT_BASE, rel)
    };
    let p = resolve(&root, &full_rel)?;
    if p.exists() {
        return Err(format!("Already exists: {}", path));
    }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(json!({ "created": true, "path": full_rel }))
}

#[tauri::command]
pub fn delete_path(path: String, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let p = resolve_content(&root, &path)?;
    if !p.exists() {
        return Err(format!("Not found: {}", path));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "deleted": true, "path": path }))
}

#[tauri::command]
pub fn move_path(
    from: String,
    to_folder: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let src = resolve(&root, &from)?;
    let dst_dir = resolve(&root, &to_folder)?;
    if !dst_dir.is_dir() {
        return Err(format!("Destination folder not found: {}", to_folder));
    }
    let filename = src
        .file_name()
        .ok_or_else(|| "No file name".to_string())?
        .to_string_lossy()
        .to_string();
    let dst = dst_dir.join(&filename);
    if dst.exists() {
        return Err(format!("Destination already exists: {}", filename));
    }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(json!({ "moved": true, "from": from, "to": to_folder + "/" + &filename }))
}

#[tauri::command]
pub fn rename_path(
    path: String,
    new_name: String,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let src = resolve(&root, &path)?;
    if !src.exists() {
        return Err(format!("Not found: {}", path));
    }
    let parent = src.parent().ok_or_else(|| "Cannot rename root".to_string())?;
    let dst = parent.join(new_name.trim_end_matches('/'));
    if dst.exists() {
        return Err(format!("Target already exists: {}", new_name));
    }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    let new_rel = dst
        .strip_prefix(&root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or(new_name);
    Ok(json!({ "renamed": true, "from": path, "to": new_rel }))
}

/* ═══════════════════════════════════════════════════════════════════════
   Manifest
   ═══════════════════════════════════════════════════════════════════════ */

#[tauri::command]
pub fn generate_manifest(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let results = manifest::generate_all(&root)?;
    Ok(json!({ "generated": results }))
}

#[tauri::command]
pub fn read_manifest(category: String, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let p = root.join(CONTENT_BASE).join(&category).join("manifest.json");
    if !p.is_file() {
        return Err(format!("No manifest for category: {}", category));
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(parsed)
}

#[tauri::command]
pub fn write_manifest(
    category: String,
    json: Value,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let p = root.join(CONTENT_BASE).join(&category).join("manifest.json");
    let body = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&p, body).map_err(|e| e.to_string())?;
    Ok(json!({ "written": true, "category": category }))
}

/* ═══════════════════════════════════════════════════════════════════════
   Validate content JSON
   ═══════════════════════════════════════════════════════════════════════ */

#[tauri::command]
pub fn validate_content(content_type: String, content_json: Value) -> Value {
    let errors = validate::validate(&content_type, &content_json);
    json!({ "valid": errors.is_empty(), "errors": errors })
}

/* ═══════════════════════════════════════════════════════════════════════
   Build / Start runner — spawn npm/bun, stream logs into shared state
   ═══════════════════════════════════════════════════════════════════════ */

#[tauri::command]
pub fn run_build(
    _state: State<'_, ProjectRoot>,
    _runner: State<'_, RunnerState>,
) -> Result<Value, String> {
    let root = root_or_err(&_state)?;
    spawn_runner("build", &root)?;
    Ok(json!({ "started": true, "kind": "build" }))
}

#[tauri::command]
pub fn run_start(
    _state: State<'_, ProjectRoot>,
    _runner: State<'_, RunnerState>,
) -> Result<Value, String> {
    let root = root_or_err(&_state)?;
    spawn_runner("start", &root)?;
    Ok(json!({ "started": true, "kind": "start" }))
}

#[tauri::command]
pub fn stop_runner(_runner: State<'_, RunnerState>) -> Result<Value, String> {
    {
        let mut g = shared_runner().lock().unwrap();
        g.stop_requested = true;
        g.running = false;
        g.ended_at = now_millis();
        g.logs.push(LogLine {
            stream: "exit".into(),
            text: "Stopped by user".into(),
            ts: now_millis(),
        });
    }
    Ok(json!({ "stopped": true }))
}

#[tauri::command]
pub fn runner_status(_runner: State<'_, RunnerState>) -> Value {
    let g = shared_runner().lock().unwrap();
    json!({
        "kind": g.kind,
        "running": g.running,
        "exitCode": g.exit_code,
        "startedAt": g.started_at,
        "endedAt": g.ended_at,
        "stopRequested": g.stop_requested,
        "logs": g.logs.clone(),
    })
}

fn spawn_runner(kind: &str, root: &Path) -> Result<(), String> {
    use std::process::Stdio;

    // Pick the package manager: prefer `bun` if available, fall back to `npm`.
    // Keep the resolved absolute path from `which` so Command::new can find it
    // reliably on Windows (where PATH resolution differs between interactive
    // and non-interactive processes, e.g. nvm-windows).
    let (pm_path, pm_name) = which::which("bun")
        .map(|p| (p, "bun"))
        .or_else(|_| which::which("npm").map(|p| (p, "npm")))
        .map_err(|_| "Neither bun nor npm found on PATH".to_string())?;

    let args: Vec<&str> = match (pm_name, kind) {
        ("bun", "build") => vec!["run", "build"],
        ("bun", "start") => vec!["run", "start"],
        ("npm", "build") => vec!["run", "build"],
        ("npm", "start") => vec!["run", "start"],
        _ => return Err(format!("Unknown runner kind: {}", kind)),
    };

    // Reset shared state
    {
        let mut g = shared_runner().lock().unwrap();
        g.reset(kind);
    }

    let mut cmd = std::process::Command::new(pm_path);
    cmd.args(&args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout {
        let shared = shared_runner().clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(out);
            for line in reader.lines().flatten() {
                let mut g = shared.lock().unwrap();
                g.logs.push(LogLine {
                    stream: "stdout".into(),
                    text: line,
                    ts: now_millis(),
                });
            }
        });
    }
    if let Some(err) = stderr {
        let shared = shared_runner().clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(err);
            for line in reader.lines().flatten() {
                let mut g = shared.lock().unwrap();
                g.logs.push(LogLine {
                    stream: "stderr".into(),
                    text: line,
                    ts: now_millis(),
                });
            }
        });
    }

    // Waiter thread — updates running/exitCode when the process exits.
    let shared = shared_runner().clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let mut g = shared.lock().unwrap();
        // Don't clobber a stop-requested state.
        if g.stop_requested {
            return;
        }
        g.running = false;
        g.ended_at = now_millis();
        match status {
            Ok(s) => {
                g.exit_code = s.code();
                g.logs.push(LogLine {
                    stream: "exit".into(),
                    text: format!("Exited with code {:?}", s.code()),
                    ts: now_millis(),
                });
            }
            Err(e) => {
                g.exit_code = Some(-1);
                g.logs.push(LogLine {
                    stream: "exit".into(),
                    text: format!("Failed to wait: {}", e),
                    ts: now_millis(),
                });
            }
        }
    });

    Ok(())
}

/* ═══════════════════════════════════════════════════════════════════════
   Git — thin wrappers around `git` CLI
   ═══════════════════════════════════════════════════════════════════════ */

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(args).current_dir(root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn git_remote_string(root: &Path) -> Result<String, String> {
    let s = git(root, &["config", "--get", "remote.origin.url"])?;
    Ok(s.trim().to_string())
}

pub fn git_branch_string(root: &Path) -> Result<String, String> {
    let s = git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(s.trim().to_string())
}

#[tauri::command]
pub fn git_status(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let s = git(&root, &["status", "--porcelain=v1"])?;
    let lines: Vec<Value> = s
        .lines()
        .map(|l| {
            let l = l.trim();
            if l.len() < 3 {
                return json!({ "raw": l });
            }
            let xy = &l[..2];
            let path = l[3..].to_string();
            json!({ "status": xy, "path": path, "raw": l })
        })
        .collect();
    Ok(json!({ "entries": lines }))
}

#[tauri::command]
pub fn git_add(paths: Vec<String>, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let mut args = vec!["add".to_string()];
    args.extend(paths.iter().cloned());
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    git(&root, &args_ref)?;
    Ok(json!({ "added": paths.len() }))
}

#[tauri::command]
pub fn git_commit(message: String, state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    // Stage everything under public/osler-content + manifests, then commit.
    git(&root, &["add", "public/osler-content"])?;
    git(&root, &["add", "package.json"])?;
    git(&root, &["add", "src/"])?;
    let msg = if message.trim().is_empty() {
        "Content update via Osler Admin".to_string()
    } else {
        message
    };
    git(&root, &["commit", "-m", &msg])?;
    Ok(json!({ "committed": true, "message": msg }))
}

#[tauri::command]
pub fn git_push(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let mut cmd = std::process::Command::new("git");
    cmd.args(["push"]).current_dir(&root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = crate::deploy::run_cmd_timeout(cmd, 60)
        .map_err(|e| format!("Git push timed out or failed: {}", e))?;
    let s = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(json!({ "pushed": true, "output": s }))
}

#[tauri::command]
pub fn git_pull(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let mut cmd = std::process::Command::new("git");
    cmd.args(["pull"]).current_dir(&root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = crate::deploy::run_cmd_timeout(cmd, 60)
        .map_err(|e| format!("Git pull timed out or failed: {}", e))?;
    let s = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(json!({ "pulled": true, "output": s }))
}

#[tauri::command]
pub fn git_remote(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = root_or_err(&state)?;
    let remote = git_remote_string(&root)?;
    let branch = git_branch_string(&root)?;
    Ok(json!({ "remote": remote, "branch": branch }))
}

/* ═══════════════════════════════════════════════════════════════════════
   Misc
   ═══════════════════════════════════════════════════════════════════════ */

#[tauri::command]
pub fn open_external(url: String, window: Window) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    window.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
