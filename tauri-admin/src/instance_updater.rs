// instance_updater.rs — Instance update and patch engine for Osler instances.
//
// Allows generated Osler instances to receive core framework and engine updates
// (especially `src/`, `scripts/`, `cloudflare/worker/src/`, and `migrations/`)
// while strictly protecting and preserving:
//   • `public/osler-content/` (all question packs, flashcards, articles, images)
//   • `public/osler.config.json` custom site identity and branding
//   • `.env`, `.env.local`, `.dev.vars` (credentials and secrets)
//   • `.git/` (instance git history)
//
// Includes pre-update safety snapshots and 1-click rollback capability.

use crate::commands::ProjectRoot;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use walkdir::WalkDir;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDiffItem {
    pub path: String,
    pub status: String, // "modified" | "added" | "identical"
    pub size_diff: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckReport {
    pub can_update: bool,
    pub source_root: String,
    pub target_root: String,
    pub has_updates: bool,
    pub changed_count: usize,
    pub added_count: usize,
    pub files: Vec<UpdateDiffItem>,
    pub preserved_paths: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub timestamp: u64,
    pub formatted_date: String,
    pub path: String,
    pub file_count: usize,
}

/// Locate the main Osler source root (typically parent of `tauri-admin` or current workspace).
fn resolve_source_root() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        // Look up directories from the executable or current working directory
        let mut curr = exe.parent();
        while let Some(p) = curr {
            if p.join("src/app").is_dir() && p.join("package.json").is_file() {
                return Some(p.to_path_buf());
            }
            curr = p.parent();
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut curr = Some(cwd.as_path());
        while let Some(p) = curr {
            if p.join("src/app").is_dir() && p.join("package.json").is_file() {
                return Some(p.to_path_buf());
            }
            curr = p.parent();
        }
    }
    None
}

/// Check if a relative path is part of the core framework that gets updated.
fn is_core_update_path(rel: &str) -> bool {
    let r = rel.replace('\\', "/");
    let r = r.trim_start_matches('/');

    // Paths that ARE updated:
    if r.starts_with("src/")
        || r.starts_with("scripts/")
        || r.starts_with("cloudflare/worker/src/")
        || r.starts_with("cloudflare/worker/migrations/")
    {
        return true;
    }

    matches!(
        r,
        "next.config.ts"
            | "next.config.mjs"
            | "next.config.js"
            | "tailwind.config.ts"
            | "tailwind.config.js"
            | "postcss.config.mjs"
            | "postcss.config.js"
            | "tsconfig.json"
            | "components.json"
            | "cloudflare/worker/package.json"
            | "cloudflare/worker/tsconfig.json"
    )
}

/// Check if a path is strictly protected and never overwritten.
fn is_protected_path(rel: &str) -> bool {
    let r = rel.replace('\\', "/");
    let r = r.trim_start_matches('/');

    r.starts_with("public/osler-content")
        || r.starts_with(".git")
        || r.starts_with(".osler-backup")
        || r.starts_with("tauri-admin")
        || r.starts_with(".osler-admin")
        || r.starts_with("target")
        || r.starts_with("node_modules")
        || r.starts_with(".next")
        || r.starts_with("out")
        || r.starts_with("dist")
        || r == "public/osler.config.json"
        || r == "cloudflare/worker/wrangler.toml"
        || r == ".env"
        || r == ".env.local"
        || r.starts_with(".env.")
        || r == "cloudflare/worker/.dev.vars"
}

/// Check an instance for available code updates by comparing against source Osler.
#[tauri::command]
pub fn check_instance_update(
    target_path: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<UpdateCheckReport, String> {
    let target_root = if let Some(tp) = target_path {
        PathBuf::from(tp)
    } else {
        crate::commands::root_or_err_pub(&state)?
    };

    if !target_root.is_dir() {
        return Err("Target path is not a valid directory".into());
    }

    let source_root = resolve_source_root()
        .ok_or_else(|| "Could not locate main Osler source directory to pull updates from".to_string())?;

    let mut files = Vec::new();
    let mut changed_count = 0;
    let mut added_count = 0;

    // Scan source core files
    for entry in WalkDir::new(&source_root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        if let Ok(rel) = path.strip_prefix(&source_root) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if is_core_update_path(&rel_str) && !is_protected_path(&rel_str) {
                let target_file = target_root.join(rel);
                if target_file.is_file() {
                    let src_bytes = fs::read(path).unwrap_or_default();
                    let tgt_bytes = fs::read(&target_file).unwrap_or_default();
                    if src_bytes != tgt_bytes {
                        let size_diff = src_bytes.len() as i64 - tgt_bytes.len() as i64;
                        changed_count += 1;
                        files.push(UpdateDiffItem {
                            path: rel_str,
                            status: "modified".into(),
                            size_diff,
                        });
                    }
                } else {
                    let src_len = fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
                    added_count += 1;
                    files.push(UpdateDiffItem {
                        path: rel_str,
                        status: "added".into(),
                        size_diff: src_len,
                    });
                }
            }
        }
    }

    let preserved_paths = vec![
        "public/osler-content/ (All question banks, flashcards, articles, images)".into(),
        "public/osler.config.json (Branding, site name, enabled engines)".into(),
        "cloudflare/worker/wrangler.toml (Database IDs & bindings)".into(),
        ".env / .env.local / .dev.vars (All secrets & credentials)".into(),
        ".git/ (Instance git history)".into(),
    ];

    let has_updates = changed_count > 0 || added_count > 0;

    Ok(UpdateCheckReport {
        can_update: true,
        source_root: source_root.to_string_lossy().into(),
        target_root: target_root.to_string_lossy().into(),
        has_updates,
        changed_count,
        added_count,
        files,
        preserved_paths,
    })
}

/// Apply code updates to the target instance with automatic pre-update backup snapshot.
#[tauri::command]
pub fn apply_instance_patch(
    target_path: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let target_root = if let Some(tp) = target_path {
        PathBuf::from(tp)
    } else {
        crate::commands::root_or_err_pub(&state)?
    };

    if !target_root.is_dir() {
        return Err("Target path is not a valid directory".into());
    }

    let source_root = resolve_source_root()
        .ok_or_else(|| "Could not locate main Osler source directory to pull updates from".to_string())?;

    // 1. Create a safety backup in `<target_root>/.osler-backup/backup-<timestamp>`
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_dir = target_root.join(".osler-backup").join(format!("backup-{}", now));
    fs::create_dir_all(&backup_dir).map_err(|e| format!("Failed to create backup dir: {}", e))?;

    let mut backed_up_count = 0;
    let mut updated_files: Vec<String> = Vec::new();

    // 2. Backup existing core files and copy updated files from source
    for entry in WalkDir::new(&source_root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let src_file = entry.path();
        if let Ok(rel) = src_file.strip_prefix(&source_root) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if is_core_update_path(&rel_str) && !is_protected_path(&rel_str) {
                let tgt_file = target_root.join(rel);

                // If target file exists, back it up first
                if tgt_file.is_file() {
                    let backup_file = backup_dir.join(rel);
                    if let Some(parent) = backup_file.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::copy(&tgt_file, &backup_file).is_ok() {
                        backed_up_count += 1;
                    }
                }

                // Copy source file to target
                if let Some(parent) = tgt_file.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::copy(src_file, &tgt_file).map_err(|e| format!("Failed to copy {}: {}", rel_str, e))?;
                updated_files.push(rel_str);
            }
        }
    }

    // 3. Intelligently merge `package.json` dependencies
    let src_pkg_path = source_root.join("package.json");
    let tgt_pkg_path = target_root.join("package.json");
    if src_pkg_path.is_file() && tgt_pkg_path.is_file() {
        if let (Ok(src_raw), Ok(tgt_raw)) = (fs::read_to_string(&src_pkg_path), fs::read_to_string(&tgt_pkg_path)) {
            if let (Ok(src_val), Ok(mut tgt_val)) = (
                serde_json::from_str::<Value>(&src_raw),
                serde_json::from_str::<Value>(&tgt_raw),
            ) {
                // Merge dependencies and devDependencies
                for dep_key in ["dependencies", "devDependencies"] {
                    if let (Some(src_deps), Some(tgt_deps)) = (
                        src_val.get(dep_key).and_then(|v| v.as_object()),
                        tgt_val.get_mut(dep_key).and_then(|v| v.as_object_mut()),
                    ) {
                        for (k, v) in src_deps {
                            tgt_deps.insert(k.clone(), v.clone());
                        }
                    }
                }
                if let Ok(merged) = serde_json::to_string_pretty(&tgt_val) {
                    let _ = fs::write(&tgt_pkg_path, merged);
                }
            }
        }
    }

    Ok(json!({
        "success": true,
        "updatedCount": updated_files.len(),
        "backedUpCount": backed_up_count,
        "backupDir": backup_dir.to_string_lossy(),
        "updatedFiles": updated_files,
    }))
}

/// Rollback the target instance to a previous backup snapshot.
#[tauri::command]
pub fn rollback_instance_patch(
    backup_id: String,
    target_path: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<Value, String> {
    let target_root = if let Some(tp) = target_path {
        PathBuf::from(tp)
    } else {
        crate::commands::root_or_err_pub(&state)?
    };

    let backup_dir = target_root.join(".osler-backup").join(&backup_id);
    if !backup_dir.is_dir() {
        return Err(format!("Backup not found: {}", backup_id));
    }

    let mut restored_count = 0;
    for entry in WalkDir::new(&backup_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let bkp_file = entry.path();
        if let Ok(rel) = bkp_file.strip_prefix(&backup_dir) {
            let tgt_file = target_root.join(rel);
            if let Some(parent) = tgt_file.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if fs::copy(bkp_file, &tgt_file).is_ok() {
                restored_count += 1;
            }
        }
    }

    Ok(json!({
        "success": true,
        "restoredCount": restored_count,
        "backupId": backup_id,
    }))
}

/// List available backup snapshots for an instance.
#[tauri::command]
pub fn list_instance_backups(
    target_path: Option<String>,
    state: State<'_, ProjectRoot>,
) -> Result<Vec<BackupEntry>, String> {
    let target_root = if let Some(tp) = target_path {
        PathBuf::from(tp)
    } else {
        crate::commands::root_or_err_pub(&state)?
    };

    let backups_root = target_root.join(".osler-backup");
    if !backups_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    if let Ok(entries) = fs::read_dir(backups_root) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("backup-") {
                    let ts_str = name.trim_start_matches("backup-");
                    let ts = ts_str.parse::<u64>().unwrap_or(0);
                    let file_count = WalkDir::new(&path)
                        .into_iter()
                        .filter_map(|e| e.ok())
                        .filter(|e| e.file_type().is_file())
                        .count();
                    results.push(BackupEntry {
                        id: name,
                        timestamp: ts,
                        formatted_date: format_epoch(ts),
                        path: path.to_string_lossy().into(),
                        file_count,
                    });
                }
            }
        }
    }

    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(results)
}

fn format_epoch(secs: u64) -> String {
    if secs == 0 {
        return "Unknown".into();
    }
    // Simple readable format
    format!("Backup @ {}s", secs)
}
