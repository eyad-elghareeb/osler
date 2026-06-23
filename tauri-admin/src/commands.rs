// commands.rs — All 19+ Tauri IPC commands (1:1 with Flask routes)
use crate::{deploy, git, parser, pdf, templates};
use crate::server::QuizServer;
use base64::Engine;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;
use tauri::State;
use tauri::async_runtime;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Maximum bytes to read per file during initial scan.
/// Config blocks and marker comments always live in the first few KB;
/// reading beyond that is wasted I/O for image-heavy OSCE files.
const SCAN_HEADER_SIZE: u64 = 65536;

/// Scan result cache keyed by `(path, mtime_secs)`.
/// Avoids re-reading unchanged files on repeated scans.
static SCAN_CACHE: OnceLock<Mutex<HashMap<String, (f64, parser::FileMeta)>>> = OnceLock::new();

fn scan_cache() -> &'static Mutex<HashMap<String, (f64, parser::FileMeta)>> {
    SCAN_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct ProjectRoot(pub std::sync::Mutex<PathBuf>);

fn root(state: &State<ProjectRoot>) -> PathBuf {
    state.0.lock().unwrap().clone()
}

const SKIP_DIRS: &[&str] = &["node_modules", "target", "__pycache__", ".git", ".quiztool", "tauri-admin", "tauri", "gen"];

fn should_skip(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || name.starts_with('.')
}

fn to_posix(p: &Path, base: &Path) -> String {
    let p_s = p.to_string_lossy().replace('\\', "/");
    let b_s = base.to_string_lossy().replace('\\', "/");
    let p_clean = if p_s.starts_with("//?/") { &p_s[4..] } else { &p_s };
    let b_clean = if b_s.starts_with("//?/") { &b_s[4..] } else { &b_s };
    
    if p_clean.to_lowercase().starts_with(&b_clean.to_lowercase()) {
        let mut rel = &p_clean[b_clean.len()..];
        if rel.starts_with('/') { rel = &rel[1..]; }
        if rel.is_empty() { return ".".into(); }
        return rel.to_string();
    }
    p_clean.to_string()
}

fn normalize(raw: &str) -> String {
    let c = raw.trim().replace('\\', "/");
    let c = c.trim_matches('/');
    if c.is_empty() || c == "." { ".".into() } else { c.to_string() }
}

fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = normalize(rel);
    let p = if rel == "." { root.to_path_buf() } else { root.join(&rel) };
    let mut p = p.canonicalize().unwrap_or_else(|_| root.join(&rel));
    // Remove Windows UNC prefix (\\?\) so starts_with works against non-UNC roots
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        p = PathBuf::from(&s[4..]);
    }
    if !p.starts_with(root) { return Err("Path escapes project root.".into()); }
    Ok(p)
}

fn resolve_must_exist(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = resolve(root, rel)?;
    if !p.exists() { return Err(format!("Path not found: {}", rel)); }
    Ok(p)
}

fn collect_files(root: &Path) -> Vec<Value> {
    let mut records = Vec::new();
    collect_files_inner(root, root, &mut records);
    records.sort_by(|a, b| {
        a["path"].as_str().unwrap_or("").cmp(b["path"].as_str().unwrap_or(""))
    });
    records
}

fn read_scan_content(p: &Path) -> String {
    let metadata = match std::fs::metadata(p) {
        Ok(m) => m,
        Err(_) => return String::new(),
    };
    if metadata.len() <= SCAN_HEADER_SIZE {
        return std::fs::read_to_string(p).unwrap_or_default();
    }
    // Large file (e.g. image-heavy OSCE): read only the header.
    // Config markers and the opening `[` of data arrays always live
    // in the first few KB. The lightweight `count_array_items` fallback
    // in `parse_file_metadata` counts items without parsing base64 strings.
    let mut f = match std::fs::File::open(p) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let mut buf = vec![0u8; SCAN_HEADER_SIZE as usize];
    let n = f.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    String::from_utf8_lossy(&buf).into_owned()
}

fn collect_files_inner(dir: &Path, root: &Path, out: &mut Vec<Value>) {
    let rd = match std::fs::read_dir(dir) { Ok(r) => r, Err(_) => return };
    for entry in rd.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if !should_skip(&name) { collect_files_inner(&p, root, out); }
        } else if name.to_lowercase().ends_with(".html") {
            let modified = p.metadata().ok().and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64()).unwrap_or(0.0);

            // Cache check: skip files with unchanged mtime
            let cache_key = format!("{}|{}", p.display(), modified);
            let meta = {
                let cache = scan_cache().lock().unwrap();
                cache.get(&cache_key).map(|(_, m)| m.clone())
            };
            let meta = match meta {
                Some(m) => m,
                None => {
                    let content = read_scan_content(&p);
                    let m = parser::parse_file_metadata(&content);
                    let mut cache = scan_cache().lock().unwrap();
                    cache.insert(cache_key, (modified, m.clone()));
                    m
                }
            };

            let rel = to_posix(&p, root);
            let folder = to_posix(p.parent().unwrap_or(root), root);
            let folder = if folder.is_empty() { ".".into() } else { folder };
            let title = meta.title.as_deref().unwrap_or(p.file_stem().and_then(|s| s.to_str()).unwrap_or(&name)).to_string();
            let icon = parser::infer_icon(&meta.file_type, &name);
            out.push(json!({
                "path": rel, "name": name, "folder": folder,
                "type": meta.file_type.as_str(),
                "title": title,
                "description": meta.description.as_deref().unwrap_or(""),
                "uid": meta.uid.as_deref().unwrap_or(""),
                "question_count": meta.question_count,
                "icon": icon, "modified": modified,
            }));
        }
    }
}

fn scan_folders(root: &Path) -> Vec<String> {
    let mut folders = vec![".".to_string()];
    scan_folders_inner(root, root, &mut folders);
    folders.sort();
    folders.dedup();
    folders
}

fn scan_folders_inner(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let rd = match std::fs::read_dir(dir) { Ok(r) => r, Err(_) => return };
    for entry in rd.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if p.is_dir() && !should_skip(&name) {
            out.push(to_posix(&p, root));
            scan_folders_inner(&p, root, out);
        }
    }
}

fn build_summary(root: &Path) -> Value {
    let files = collect_files(root);
    let quiz_count = files.iter().filter(|f| f["type"] == "quiz").count();
    let bank_count = files.iter().filter(|f| f["type"] == "bank").count();
    let index_count = files.iter().filter(|f| f["type"] == "index").count();
    let flashcard_count = files.iter().filter(|f| f["type"] == "flashcard").count();
    let written_count = files.iter().filter(|f| f["type"] == "written").count();
    let osce_count = files.iter().filter(|f| f["type"] == "osce").count();
    let total_q: u64 = files.iter()
        .filter(|f| f["type"] == "quiz" || f["type"] == "bank" || f["type"] == "flashcard" || f["type"] == "written" || f["type"] == "osce")
        .filter_map(|f| f["question_count"].as_u64()).sum();
    let folders = scan_folders(root);
    json!({
        "totalHtmlFiles": files.len(),
        "quizCount": quiz_count,
        "bankCount": bank_count,
        "indexCount": index_count,
        "flashcardCount": flashcard_count,
        "writtenCount": written_count,
        "osceCount": osce_count,
        "folderCount": folders.len(),
        "totalQuestions": total_q,
    })
}

fn get_project_name(root: &Path) -> String {
    let mf = root.join("manifest.webmanifest");
    if let Ok(text) = std::fs::read_to_string(&mf) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(name) = v.get("name").or_else(|| v.get("short_name")).and_then(|v| v.as_str()) {
                return name.to_string();
            }
        }
    }
    root.file_name().and_then(|n| n.to_str()).unwrap_or("Project").to_string()
}

static PYTHON_CACHE: OnceLock<Option<String>> = OnceLock::new();

fn find_python() -> Option<String> {
    PYTHON_CACHE.get_or_init(|| {
        for cmd in &["python", "python3", "py"] {
            let mut c = std::process::Command::new(cmd);
            c.arg("--version");
            #[cfg(windows)]
            c.creation_flags(CREATE_NO_WINDOW);
            if c.output().is_ok() {
                return Some(cmd.to_string());
            }
        }
        None
    }).clone()
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_files(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = state.0.lock().unwrap().clone();
    tauri::async_runtime::spawn_blocking(move || {
        json!({ "files": collect_files(&root), "folders": scan_folders(&root) })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_state(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = state.0.lock().unwrap().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let builtin_tools = json!([
            {"id": "pdf-exporter", "label": "PDF Exporter", "description": "Export any quiz or bank to PDF"},
        ]);
        json!({
            "projectName": get_project_name(&root),
            "summary": build_summary(&root),
            "git": git::get_git_status(&root),
            "deploy": deploy::get_deploy_metadata(&root),
            "builtinTools": builtin_tools,
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_file(path: String, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let p = resolve_must_exist(&root, &path)?;
    if !p.is_file() { return Err("Not a file.".into()); }
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let meta = parser::parse_file_metadata(&content);
    Ok(json!({ "content": content, "meta": meta.to_json() }))
}

#[tauri::command]
pub fn save_file(path: String, content: String, confirm_uid_change: Option<bool>, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let p = resolve_must_exist(&root, &path)?;
    let original_content = std::fs::read_to_string(&p).unwrap_or_default();
    let original_uid = parser::parse_file_metadata(&original_content).uid.unwrap_or_default();
    let validation = parser::validate_dashboard_content(&path, &content, &original_uid);
    if !validation.errors.is_empty() {
        return Err(serde_json::to_string(&json!({
            "message": "Validation failed. Fix issues before saving.",
            "validation": { "errors": validation.errors, "warnings": validation.warnings }
        })).unwrap_or_default());
    }
    let uid_changed = validation.warnings.iter().any(|w| w.code.as_deref() == Some("uid_changed"));
    if uid_changed && !confirm_uid_change.unwrap_or(false) {
        return Err(serde_json::to_string(&json!({
            "message": "UID change requires confirmation.",
            "validation": { "errors": validation.errors, "warnings": validation.warnings },
            "requires_uid_confirmation": true
        })).unwrap_or_default());
    }
    std::fs::write(&p, &content).map_err(|e| e.to_string())?;
    Ok(json!({ "message": format!("Saved {}.", path) }))
}

#[tauri::command]
pub fn validate_file(path: String, content: String, original_uid: Option<String>, _state: State<ProjectRoot>) -> Value {
    let uid = original_uid.as_deref().unwrap_or("");
    let v = parser::validate_dashboard_content(&path, &content, uid);
    json!({
        "message": "Validation completed.",
        "validation": { "errors": v.errors, "warnings": v.warnings },
        "ok": v.errors.is_empty(),
    })
}

#[tauri::command]
pub fn create_folder(name: String, title: Option<String>, description: Option<String>, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let rel = normalize(&name);
    if rel == "." { return Err("Please provide a folder path.".into()); }
    let folder_path = resolve(&root, &rel)?;
    if folder_path.exists() { return Err("Folder already exists.".into()); }
    std::fs::create_dir_all(&folder_path).map_err(|e| e.to_string())?;
    let index_path = folder_path.join("index.html");
    let html = templates::create_index_html(&rel, title.as_deref().unwrap_or(""), description.as_deref().unwrap_or(""));
    std::fs::write(&index_path, html).map_err(|e| e.to_string())?;
    Ok(json!({ "message": format!("Created folder \"{}\".", rel), "path": format!("{}/index.html", rel) }))
}

#[tauri::command]
pub fn create_file(
    r#type: String, folder: Option<String>, title: String,
    description: Option<String>, filename: Option<String>,
    icon: Option<String>, questions: Option<Value>, state: State<ProjectRoot>
) -> Result<Value, String> {
    let root = root(&state);
    let ft = r#type.to_lowercase();
    if ft != "quiz" && ft != "bank" && ft != "flashcard" && ft != "written" && ft != "osce" { return Err("Type must be quiz, bank, flashcard, written, or osce.".into()); }
    if title.trim().is_empty() { return Err("Title is required.".into()); }
    let folder_rel = normalize(folder.as_deref().unwrap_or("."));
    let folder_path = resolve_must_exist(&root, &folder_rel)?;
    if !folder_path.is_dir() { return Err("Target path is not a folder.".into()); }

    let base_stem = templates::slugify(filename.as_deref().filter(|s| !s.is_empty()).unwrap_or(&title), "untitled");
    let file_path = ensure_unique_path(&folder_path, &base_stem);
    let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let uid = templates::derive_uid(&folder_rel, stem);
    let desc = description.as_deref().unwrap_or("");
    let q_val = questions.unwrap_or_else(|| json!([]));
    let html = match ft.as_str() {
        "quiz" => templates::create_quiz_html(
            &json!({"uid": uid, "title": title, "description": desc}),
            &q_val,
        ),
        "flashcard" => templates::create_flashcard_html(
            &json!({"uid": uid, "title": title, "description": desc, "icon": icon.as_deref().unwrap_or("🃏")}),
            &q_val,
        ),
        "written" => templates::create_written_html(
            &json!({"uid": uid, "title": title, "description": desc, "icon": icon.as_deref().unwrap_or("✍️")}),
            &q_val,
        ),
        "osce" => templates::create_osce_html(
            &json!({"uid": uid, "title": title, "description": desc, "icon": icon.as_deref().unwrap_or("🩺")}),
            &q_val,
        ),
        _ => templates::create_bank_html(
            &json!({"uid": uid, "title": title, "description": desc, "icon": icon.as_deref().unwrap_or("🗃️")}),
            &q_val,
        ),
    };
    std::fs::write(&file_path, html).map_err(|e| e.to_string())?;
    let rel = to_posix(&file_path, &root);
    Ok(json!({ "message": format!("Created {} file \"{}\".", ft, file_path.file_name().unwrap_or_default().to_string_lossy()), "path": rel, "uid": uid }))
}

fn ensure_unique_path(folder: &Path, stem: &str) -> PathBuf {
    let mut p = folder.join(format!("{}.html", stem));
    let mut i = 2;
    while p.exists() { p = folder.join(format!("{}-{}.html", stem, i)); i += 1; }
    p
}

#[tauri::command]
pub fn duplicate_file(path: String, folder: Option<String>, filename: Option<String>, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let src = resolve_must_exist(&root, &path)?;
    if !src.is_file() { return Err("Source is not a file.".into()); }
    let folder_rel = normalize(folder.as_deref().unwrap_or("."));
    let target_folder = resolve_must_exist(&root, &folder_rel)?;
    if !target_folder.is_dir() { return Err("Target is not a folder.".into()); }
    let src_stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let default_stem = format!("{}-copy", src_stem);
    let base_stem = templates::slugify(filename.as_deref().unwrap_or(&default_stem), "untitled");
    let dest = ensure_unique_path(&target_folder, &base_stem);
    let src_content = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let meta = parser::parse_file_metadata(&src_content);
    let dest_stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let new_uid = templates::derive_uid(&folder_rel, dest_stem);
    let html = match meta.file_type {
        parser::FileType::Quiz => {
            let mut cfg = meta.config.unwrap_or_else(|| json!({}));
            cfg["uid"] = json!(new_uid);
            templates::create_quiz_html(&cfg, &meta.questions.unwrap_or_else(|| json!([])))
        }
        parser::FileType::Bank => {
            let mut cfg = meta.config.unwrap_or_else(|| json!({}));
            cfg["uid"] = json!(new_uid);
            templates::create_bank_html(&cfg, &meta.questions.unwrap_or_else(|| json!([])))
        }
        parser::FileType::Flashcard => {
            let mut cfg = meta.config.unwrap_or_else(|| json!({}));
            cfg["uid"] = json!(new_uid);
            templates::create_flashcard_html(&cfg, &meta.questions.unwrap_or_else(|| json!([])))
        }
        parser::FileType::Written => {
            let mut cfg = meta.config.unwrap_or_else(|| json!({}));
            cfg["uid"] = json!(new_uid);
            templates::create_written_html(&cfg, &meta.questions.unwrap_or_else(|| json!([])))
        }
        parser::FileType::Osce => {
            let mut cfg = meta.config.unwrap_or_else(|| json!({}));
            cfg["uid"] = json!(new_uid);
            templates::create_osce_html(&cfg, &meta.questions.unwrap_or_else(|| json!([])))
        }
        _ => src_content,
    };
    std::fs::write(&dest, html).map_err(|e| e.to_string())?;
    let rel = to_posix(&dest, &root);
    Ok(json!({ "message": format!("Created duplicate \"{}\".", dest.file_name().unwrap_or_default().to_string_lossy()), "path": rel, "uid": new_uid }))
}

#[tauri::command]
pub fn move_file(path: String, folder: Option<String>, filename: Option<String>, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let src = resolve_must_exist(&root, &path)?;
    let folder_rel = normalize(folder.as_deref().unwrap_or("."));
    let target_folder = resolve_must_exist(&root, &folder_rel)?;
    if !target_folder.is_dir() { return Err("Target is not a folder.".into()); }
    let src_stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let stem = templates::slugify(filename.as_deref().unwrap_or(src_stem), "untitled");
    let dest = target_folder.join(format!("{}.html", stem));
    if dest.exists() && dest != src { return Err("A file with that name already exists in the target folder.".into()); }
    std::fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    let rel = to_posix(&dest, &root);
    Ok(json!({ "message": "File moved successfully.", "path": rel }))
}

#[tauri::command]
pub fn delete_file(path: String, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let p = resolve_must_exist(&root, &path)?;
    if !p.is_file() { return Err("Not a file.".into()); }
    std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    Ok(json!({ "message": format!("Deleted {}.", path) }))
}

#[tauri::command]
pub fn delete_folder(path: String, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let rel = normalize(&path);
    if rel == "." { return Err("Cannot delete the root folder.".into()); }
    let p = resolve_must_exist(&root, &rel)?;
    if !p.is_dir() { return Err("Path is not a folder.".into()); }
    let file_count = count_html_files(&p);
    std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(json!({ "message": format!("Deleted folder '{}' with {} HTML file(s).", rel, file_count) }))
}

fn count_html_files(dir: &Path) -> usize {
    let mut count = 0;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { count += count_html_files(&p); }
            else if p.extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("html")).unwrap_or(false) { count += 1; }
        }
    }
    count
}

#[tauri::command]
pub fn convert_file(path: String, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let p = resolve_must_exist(&root, &path)?;
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let meta = parser::parse_file_metadata(&content);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let folder_rel = to_posix(p.parent().unwrap_or(&root), &root);
    let uid = meta.uid.as_deref().unwrap_or("").to_string();
    let uid = if uid.is_empty() { templates::derive_uid(&folder_rel, stem) } else { uid };
    match meta.file_type {
        parser::FileType::Quiz => {
            let cfg = json!({"uid": uid, "title": meta.title.as_deref().unwrap_or(stem), "description": meta.description.as_deref().unwrap_or(""), "icon": "🗃️"});
            let html = templates::create_bank_html(&cfg, &meta.questions.unwrap_or_else(|| json!([])));
            std::fs::write(&p, html).map_err(|e| e.to_string())?;
            Ok(json!({ "message": "Converted quiz to question bank while preserving UID." }))
        }
        parser::FileType::Bank => {
            let cfg = json!({"uid": uid, "title": meta.title.as_deref().unwrap_or(stem), "description": meta.description.as_deref().unwrap_or("")});
            let html = templates::create_quiz_html(&cfg, &meta.questions.unwrap_or_else(|| json!([])));
            std::fs::write(&p, html).map_err(|e| e.to_string())?;
            Ok(json!({ "message": "Converted question bank to quiz while preserving UID." }))
        }
        parser::FileType::Flashcard => {
            let cfg = json!({"uid": uid, "title": meta.title.as_deref().unwrap_or(stem), "description": meta.description.as_deref().unwrap_or("")});
            let questions = meta.questions.unwrap_or_else(|| json!([]));
            let converted: Vec<Value> = questions.as_array().map(|arr| {
                arr.iter().map(|q| {
                    let front = q.get("front").and_then(|v| v.as_str()).unwrap_or("");
                    let back = q.get("back").and_then(|v| v.as_str()).unwrap_or("");
                    json!({"question": front, "options": ["", "", "", ""], "correct": 0, "explanation": back})
                }).collect()
            }).unwrap_or_default();
            let html = templates::create_quiz_html(&cfg, &json!(converted));
            std::fs::write(&p, html).map_err(|e| e.to_string())?;
            Ok(json!({ "message": "Converted flashcard deck to quiz while preserving UID." }))
        }
        parser::FileType::Written => {
            let cfg = json!({"uid": uid, "title": meta.title.as_deref().unwrap_or(stem), "description": meta.description.as_deref().unwrap_or("")});
            let questions = meta.questions.unwrap_or_else(|| json!([]));
            let converted: Vec<Value> = questions.as_array().map(|arr| {
                arr.iter().map(|q| {
                    let q_text = q.get("question").and_then(|v| v.as_str()).unwrap_or("");
                    let exp = q.get("explanation").and_then(|v| v.as_str()).unwrap_or("");
                    json!({"question": q_text, "options": ["", "", "", ""], "correct": 0, "explanation": exp})
                }).collect()
            }).unwrap_or_default();
            let html = templates::create_quiz_html(&cfg, &json!(converted));
            std::fs::write(&p, html).map_err(|e| e.to_string())?;
            Ok(json!({ "message": "Converted written assessment to quiz while preserving UID." }))
        }
        parser::FileType::Osce => {
            let cfg = json!({"uid": uid, "title": meta.title.as_deref().unwrap_or(stem), "description": meta.description.as_deref().unwrap_or("")});
            let questions = meta.questions.unwrap_or_else(|| json!([]));
            let converted: Vec<Value> = questions.as_array().map(|arr| {
                arr.iter().map(|q| {
                    let q_text = q.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    json!({"question": q_text, "options": ["", "", "", ""], "correct": 0, "explanation": ""})
                }).collect()
            }).unwrap_or_default();
            let html = templates::create_quiz_html(&cfg, &json!(converted));
            std::fs::write(&p, html).map_err(|e| e.to_string())?;
            Ok(json!({ "message": "Converted OSCE virtual patients to quiz while preserving UID." }))
        }
        _ => Err("Unsupported file type for conversion.".into()),
    }
}

#[tauri::command]
pub fn convert_to_flashcard(path: String, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let p = resolve_must_exist(&root, &path)?;
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let meta = parser::parse_file_metadata(&content);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let folder_rel = to_posix(p.parent().unwrap_or(&root), &root);
    let uid = meta.uid.as_deref().unwrap_or("").to_string();
    let uid = if uid.is_empty() { templates::derive_uid(&folder_rel, stem) } else { uid };
    match meta.file_type {
        parser::FileType::Quiz | parser::FileType::Bank => {
            let cfg = json!({"uid": uid, "title": meta.title.as_deref().unwrap_or(stem), "description": meta.description.as_deref().unwrap_or(""), "icon": "🃏"});
            let questions = meta.questions.unwrap_or_else(|| json!([]));
            let converted: Vec<Value> = questions.as_array().map(|arr| {
                arr.iter().map(|q| {
                    let question = q.get("question").and_then(|v| v.as_str()).unwrap_or("");
                    let explanation = q.get("explanation").and_then(|v| v.as_str()).unwrap_or("");
                    let options = q.get("options").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|o| o.as_str()).collect::<Vec<_>>())
                        .unwrap_or_default();
                    let correct = q.get("correct").and_then(|v| v.as_i64()).unwrap_or(0) as usize;
                    let answer = options.get(correct).copied().unwrap_or("");
                    let back = if explanation.is_empty() {
                        format!("Answer: {}", answer)
                    } else {
                        format!("{}\n\nAnswer: {}", explanation, answer)
                    };
                    json!({"type": "basic", "front": question, "back": back, "tags": []})
                }).collect()
            }).unwrap_or_default();
            let html = templates::create_flashcard_html(&cfg, &json!(converted));
            std::fs::write(&p, html).map_err(|e| e.to_string())?;
            Ok(json!({ "message": "Converted to flashcard deck while preserving UID." }))
        }
        _ => Err("Only quiz and bank files can be converted to flashcard.".into()),
    }
}

/// Shared blocking sync — runs the Python sync script synchronously.
/// Used by the async `run_sync` command (via spawn_blocking) and by `provider_deploy` inline.
fn run_sync_blocking(root: &Path) -> Result<Value, String> {
    let script = root.join("scripts").join("sync_quiz_assets.py");
    if !script.exists() { return Err("Sync script not found (scripts/sync_quiz_assets.py).".into()); }
    let python = find_python().ok_or("Python not found in PATH. Please install Python to use sync.")?;
    let mut cmd = std::process::Command::new(&python);
    cmd.arg(&script).current_dir(root);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if out.status.success() {
        Ok(json!({ "message": "Sync completed successfully.", "returncode": 0, "output": stdout, "stderr": stderr }))
    } else {
        Ok(json!({ "message": "Sync completed with errors.", "returncode": out.status.code().unwrap_or(1), "output": stdout, "stderr": stderr }))
    }
}

/// Best-effort sync for use inside `provider_deploy` — returns stdout string or empty.
fn run_sync_best_effort(root: &Path) -> String {
    let script = root.join("scripts").join("sync_quiz_assets.py");
    if script.exists() {
        if let Some(py) = find_python() {
            let mut cmd = std::process::Command::new(&py);
            cmd.arg(&script).current_dir(root);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);
            return cmd.output()
                .ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
        }
    }
    String::new()
}

#[tauri::command]
pub async fn run_sync(state: State<'_, ProjectRoot>) -> Result<Value, String> {
    let root = state.0.lock().unwrap().clone();
    async_runtime::spawn_blocking(move || {
        run_sync_blocking(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn git_commit(message: Option<String>, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let msg = message.as_deref().unwrap_or("Update quiz project files");
    git::git_commit(&root, msg)
}

#[tauri::command]
pub fn git_pull(state: State<ProjectRoot>) -> Result<Value, String> {
    git::git_pull(&root(&state))
}

#[tauri::command]
pub fn git_push(state: State<ProjectRoot>) -> Result<Value, String> {
    git::git_push(&root(&state))
}

#[tauri::command]
pub fn git_force_push(state: State<ProjectRoot>) -> Result<Value, String> {
    git::git_force_push(&root(&state))
}

#[tauri::command]
pub fn provider_verify(provider: String, token: String, _state: State<ProjectRoot>) -> Result<Value, String> {
    let provider = provider.trim().to_lowercase();
    if !["github", "netlify", "vercel"].contains(&provider.as_str()) {
        return Err("Provider must be github, netlify, or vercel.".into());
    }
    if token.trim().is_empty() { return Err("Token is required.".into()); }
    deploy::verify_provider_token(&provider, token.trim())?;
    Ok(json!({ "message": format!("{} token verified.", provider), "provider": provider }))
}

#[tauri::command]
pub fn provider_deploy(
    provider: String, token: String,
    message: Option<String>, metadata: Option<Value>,
    state: State<ProjectRoot>
) -> Result<Value, String> {
    let root = root(&state);
    let provider = provider.trim().to_lowercase();
    if !["github", "netlify", "vercel"].contains(&provider.as_str()) {
        return Err("Provider must be github, netlify, or vercel.".into());
    }
    if token.trim().is_empty() { return Err("Token is required.".into()); }
    let mut meta = metadata
        .or_else(|| deploy::get_deploy_metadata(&root))
        .ok_or("Deployment metadata is missing. Configure a provider before deploying.")?;

    deploy::verify_provider_token(&provider, token.trim())?;

    // Run sync first (best-effort)
    let sync_output = run_sync_best_effort(&root);

    let result = match provider.as_str() {
        "github" => {
            let msg = message.as_deref().unwrap_or("Update quiz project files");
            deploy::deploy_to_github(&root, &meta, token.trim(), msg)?
        }
        "netlify" => deploy::deploy_to_netlify(&root, &mut meta, token.trim())?,
        "vercel" => deploy::deploy_to_vercel(&root, &mut meta, token.trim())?,
        _ => unreachable!(),
    };

    Ok(json!({
        "message": result.get("message").and_then(|v| v.as_str()).unwrap_or("Deploy completed."),
        "provider": provider,
        "liveUrl": result.get("liveUrl"),
        "providerUrl": result.get("providerUrl"),
        "syncOutput": sync_output,
    }))
}

#[tauri::command]
pub fn open_in_browser(url: String, _state: State<ProjectRoot>, server: State<QuizServer>) -> Result<(), String> {
    let target = if url.starts_with("http://") || url.starts_with("https://") {
        url
    } else {
        // Convert to local server URL
        let rel = if url.starts_with("quiztool-preview://localhost/") {
            url.trim_start_matches("quiztool-preview://localhost/").split('?').next().unwrap_or("")
        } else if url.starts_with("http://127.0.0.1") {
            // Already a server URL
            return open::that(url).map_err(|e| e.to_string());
        } else {
            url.trim_start_matches('/')
        };
        format!("http://127.0.0.1:{}/{}", server.port, rel)
    };

    open::that(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_saved_token(provider: String, state: State<ProjectRoot>) -> Option<String> {
    let root = root(&state);
    let path = root.join(".quiztool").join("tokens.json");
    let text = std::fs::read_to_string(&path).ok()?;
    let map: serde_json::Map<String, Value> = serde_json::from_str(&text).ok()?;
    map.get(&provider).and_then(|v| v.as_str()).map(|s| s.to_string())
}

#[tauri::command]
pub fn read_external_file(path: String) -> Result<Value, String> {
    let p = PathBuf::from(&path);

    // Safety: only allow .json files
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ext != "json" {
        return Err("Only .json files can be imported.".into());
    }

    // Safety: limit file size to 50 MB
    if let Ok(meta) = std::fs::metadata(&p) {
        if meta.len() > 50 * 1024 * 1024 {
            return Err("File is too large (max 50 MB).".into());
        }
    }

    let content = std::fs::read_to_string(&p).map_err(|e| format!("Cannot read file: {}", e))?;
    Ok(json!({ "content": content, "name": p.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string() }))
}

/// Parse raw JSON/JS content and extract question items.
/// This provides a reliable server-side fallback when the frontend parser fails.
/// Handles: bare arrays, objects with `questions`/`QUESTION_BANK` keys, JS const assignments.
#[tauri::command]
pub fn load_exports_batch(paths: Vec<String>, state: State<ProjectRoot>) -> Result<Value, String> {
    let root = root(&state);
    let mut results = Vec::new();
    for path in &paths {
        let p = match resolve_must_exist(&root, path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !p.is_file() { continue; }
        let content = match std::fs::read_to_string(&p) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let meta = parser::parse_file_metadata(&content);
        results.push(json!({
            "path": path,
            "meta": meta.to_json()
        }));
    }
    let skipped = paths.len() - results.len();
    Ok(json!({
        "files": results,
        "total_requested": paths.len(),
        "total_loaded": results.len(),
        "skipped": skipped,
    }))
}

#[tauri::command]
pub fn export_pdf(config: Value) -> Result<Value, String> {
    let cfg = pdf::ExportConfig::from_json(&config)?;
    let pdf_bytes = pdf::generate_pdf(&cfg)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&pdf_bytes);
    let filename = format!("{}.pdf", cfg.title.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "").trim());
    let filename = if filename.trim().is_empty() { "export.pdf".into() } else { filename };
    Ok(json!({
        "pdf_base64": b64,
        "filename": filename,
        "size": pdf_bytes.len(),
        "quiz_count": cfg.quizzes.len(),
        "question_count": cfg.quizzes.iter().map(|q| q.questions.len()).sum::<usize>(),
    }))
}

#[tauri::command]
pub fn check_pdf_deps() -> Result<Value, String> {
    match pdf::ensure_deps() {
        Ok(_) => Ok(json!({"status": "ok"})),
        Err(e) => Ok(json!({"status": "error", "detail": e})),
    }
}

#[tauri::command]
pub fn parse_json_questions(content: String) -> Result<Value, String> {
    // Remove BOM first (common in Windows-saved JSON files)
    let trimmed = content.trim().strip_prefix('\u{FEFF}').unwrap_or(content.trim()).to_string();
    let text = trimmed;
    if text.is_empty() {
        return Ok(json!({"questions": [], "issues": ["Empty content."]}));
    }

    // Extract from JS const assignment
    let clean_text = if let Some(caps) = Regex::new(r"const\s+(?:QUESTION_BANK|QUESTIONS)\s*=\s*(\[[\s\S]*\]);?")
        .ok()
        .and_then(|re| re.captures(&text))
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
    {
        caps
    } else {
        text.clone()
    };

    // Strategy 1: Direct JSON parse
    if let Ok(parsed) = serde_json::from_str::<Value>(&clean_text) {
        if let Some(questions) = extract_questions_from_value(&parsed) {
            return Ok(json!({"questions": questions, "issues": []}));
        }
    }

    // Strategy 2: Sanitized parse (handles trailing commas, unquoted keys, comments)
    let sanitized = parser::sanitize_jsonish(&clean_text);
    if let Ok(parsed) = serde_json::from_str::<Value>(&sanitized) {
        if let Some(questions) = extract_questions_from_value(&parsed) {
            return Ok(json!({"questions": questions, "issues": []}));
        }
    }

    Ok(json!({"questions": [], "issues": ["Could not parse any questions from the content."]}))
}

/// Recursively extract a questions array from a parsed JSON value.
fn extract_questions_from_value(val: &Value) -> Option<Vec<Value>> {
    match val {
        Value::Array(arr) => {
            if arr.is_empty() { return None; }
            // Check if it looks like question objects
            let first = &arr[0];
            if first.is_object() {
                let obj = first.as_object().unwrap();
                if obj.contains_key("question") || obj.contains_key("questionText")
                    || obj.contains_key("question_text") || obj.contains_key("prompt")
                    || obj.contains_key("options") || obj.contains_key("choices")
                    || obj.contains_key("text")
                {
                    return Some(arr.clone());
                }
            }
            // Might be an array of wrapper objects — try to extract from each
            let mut all_questions: Vec<Value> = Vec::new();
            for item in arr {
                if let Some(sub) = extract_questions_from_value(item) {
                    all_questions.extend(sub);
                }
            }
            if !all_questions.is_empty() { return Some(all_questions); }
            // Even if no obvious markers, return as-is (frontend will normalize)
            Some(arr.clone())
        }
        Value::Object(obj) => {
            // Check known keys for question arrays
            let keys = ["questions", "QUESTION_BANK", "QUESTIONS", "questionBank", "question_bank", "items", "data", "quiz"];
            for k in &keys {
                if let Some(v) = obj.get(*k) {
                    if let Some(qs) = extract_questions_from_value(v) {
                        return Some(qs);
                    }
                }
            }
            // Try any key that has an array value
            for (_, v) in obj {
                if let Some(qs) = extract_questions_from_value(v) {
                    return Some(qs);
                }
            }
            None
        }
        _ => None,
    }
}

#[tauri::command]
pub fn save_token(provider: String, token: String, state: State<ProjectRoot>) -> Result<(), String> {
    let root = root(&state);
    let dir = root.join(".quiztool");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Ensure .quiztool/ is gitignored
    {
        let gi = root.join(".gitignore");
        let content = std::fs::read_to_string(&gi).unwrap_or_default();
        if !content.lines().any(|l| l == ".quiztool/") {
            let suffix = if content.ends_with('\n') { "" } else { "\n" };
            let _ = std::fs::write(&gi, format!("{}{}.quiztool/\n", content, suffix));
        }
    }
    let path = dir.join("tokens.json");
    let mut map: serde_json::Map<String, Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if token.is_empty() {
        map.remove(&provider);
    } else {
        map.insert(provider, Value::String(token));
    }
    let out = serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())?;
    std::fs::write(&path, out).map_err(|e| e.to_string())
}
