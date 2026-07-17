// manifest.rs — Rust port of scripts/generate-content-manifests.js.
//
// Walks `public/osler-content/` category folders (flashcard, qbank, osce,
// library, videos) and writes a `manifest.json` in each category root
// describing the folder tree.
//
// Folder → EngineType mapping:
//   flashcard/ → "flashcard"
//   osce/      → "osce"
//   library/   → "library"
//   videos/    → "video"
//   qbank/     → auto-detected from data file keys

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MANIFEST_NAME: &str = "manifest.json";

/// Folders that hold binary assets (images, audio) next to a pack's JSON.
/// They contain no content data files and must not be scanned as content nodes.
const ASSET_FOLDERS: &[&str] = &["images", "assets"];

const FOLDER_TYPE_MAP: &[(&str, &str)] = &[
    ("flashcard", "flashcard"),
    ("osce", "osce"),
    ("library", "library"),
    ("videos", "video"),
];

/// Infer engine type from a data JSON file's top-level keys.
fn infer_type_from_data(file_path: &Path) -> Option<&'static str> {
    let raw = std::fs::read_to_string(file_path).ok()?;
    let data: Value = serde_json::from_str(&raw).ok()?;
    for (key, ty) in [
        ("stations", "osce"),
        ("passages", "bank"),
        ("prompts", "written"),
        ("questions", "quiz"),
        ("cards", "flashcard"),
        ("videos", "video"),
    ] {
        if data.get(key).and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false) {
            return Some(ty);
        }
    }
    None
}

fn infer_type_from_folder(dir_path: &Path) -> Option<&'static str> {
    let entries = std::fs::read_dir(dir_path).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".json") && name != MANIFEST_NAME {
            if let Some(t) = infer_type_from_data(&entry.path()) {
                return Some(t);
            }
        }
    }
    None
}

fn sanitize(name: &str) -> String {
    let s = name.replace(|c: char| c.is_whitespace(), "-");
    let s: String = s
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .to_lowercase();
    if s.is_empty() {
        name.to_string()
    } else {
        s
    }
}

fn build_uid(ty: &str, segments: &[&str]) -> String {
    let mut parts = vec![ty.to_string()];
    parts.extend(segments.iter().map(|s| sanitize(s)));
    parts.join("-")
}

fn title_from_segment(seg: &str) -> String {
    seg.replace('-', " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn get_data_file_names(dir_path: &Path) -> Vec<String> {
    let entries = match std::fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            (n.ends_with(".json") || n.ends_with(".md")) && n != MANIFEST_NAME
        })
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

fn scan_directory(dir_path: &Path, relative_path: &str, parent_type: Option<&str>) -> Vec<Value> {
    let entries = match std::fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut entries: Vec<_> = entries
        .flatten()
        .filter(|e| {
            let n = e.file_name();
            !n.to_string_lossy().starts_with('.') && n.to_string_lossy() != MANIFEST_NAME
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut subdirs: Vec<_> = entries
        .iter()
        .filter(|e| {
            e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && !ASSET_FOLDERS.contains(&e.file_name().to_string_lossy().as_ref())
        })
        .collect();
    let data_files: Vec<_> = entries
        .iter()
        .filter(|e| {
            e.file_type().map(|t| t.is_file()).unwrap_or(false)
                && {
                    let n = e.file_name().to_string_lossy().to_string();
                    n.ends_with(".json") || n.ends_with(".md")
                }
        })
        .collect();

    let mut nodes = Vec::new();

    for dir in subdirs.drain(..) {
        let child_path = dir.path();
        let child_relative = if relative_path.is_empty() {
            dir.file_name().to_string_lossy().to_string()
        } else {
            format!("{}/{}", relative_path, dir.file_name().to_string_lossy())
        };

        let child_entries = match std::fs::read_dir(&child_path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let grand_subdirs = child_entries
            .flatten()
            .filter(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && !e.file_name().to_string_lossy().starts_with('.')
                    && e.file_name().to_string_lossy() != MANIFEST_NAME
            })
            .count();

        let seg_str = dir.file_name().to_string_lossy().to_string();
        let segments: Vec<&str> = child_relative.split('/').collect();

        if grand_subdirs > 0 {
            let children = scan_directory(&child_path, &child_relative, parent_type);
            let ty = parent_type
                .or_else(|| infer_type_from_folder(&child_path))
                .unwrap_or("quiz");
            let uid = build_uid(ty, &segments);
            nodes.push(json!({
                "uid": uid,
                "title": title_from_segment(&seg_str),
                "type": ty,
                "path": child_relative + "/",
                "files": get_data_file_names(&child_path),
                "items": children,
            }));
        } else {
            let ty = parent_type
                .or_else(|| infer_type_from_folder(&child_path))
                .unwrap_or("quiz");
            let uid = build_uid(ty, &segments);
            nodes.push(json!({
                "uid": uid,
                "title": title_from_segment(&seg_str),
                "type": ty,
                "path": child_relative + "/",
                "files": get_data_file_names(&child_path),
                "items": [],
            }));
        }
    }

    if subdirs.is_empty() && !data_files.is_empty() && !relative_path.is_empty() {
        let ty = parent_type
            .or_else(|| infer_type_from_folder(dir_path))
            .unwrap_or("quiz");
        let segments: Vec<&str> = relative_path.split('/').collect();
        let uid = build_uid(ty, &segments);
        let title = dir_path
            .file_name()
            .map(|n| title_from_segment(&n.to_string_lossy()))
            .unwrap_or_default();
        let file_names: Vec<String> = data_files
            .iter()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        return vec![json!({
            "uid": uid,
            "title": title,
            "type": ty,
            "path": relative_path.to_string() + "/",
            "files": file_names,
            "items": [],
        })];
    }

    nodes
}

fn count_leaves(items: &[Value]) -> usize {
    let mut count = 0;
    for item in items {
        let children = item.get("items").and_then(|v| v.as_array());
        match children {
            Some(arr) if !arr.is_empty() => count += count_leaves(arr),
            _ => count += 1,
        }
    }
    count
}

fn walk(items: &[Value], counts: &mut std::collections::HashMap<String, usize>) {
    for item in items {
        let children = item.get("items").and_then(|v| v.as_array());
        match children {
            Some(arr) if !arr.is_empty() => walk(arr, counts),
            _ => {
                if let Some(t) = item.get("type").and_then(|v| v.as_str()) {
                    *counts.entry(t.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
}

fn dominant_type(items: &[Value]) -> &'static str {
    let mut counts = std::collections::HashMap::new();
    walk(items, &mut counts);
    match counts.into_iter().max_by_key(|(_, n)| *n).map(|(t, _)| t) {
        Some(t) => match t.as_str() {
            "quiz" => "quiz",
            "bank" => "bank",
            "flashcard" => "flashcard",
            "written" => "written",
            "osce" => "osce",
            "video" => "video",
            _ => "quiz",
        },
        None => "quiz",
    }
}

/// Generate manifest.json for every category folder under `public/osler-content/`.
/// Returns a list of `{ category, leafCount }` objects.
pub fn generate_all(root: &Path) -> Result<Vec<Value>, String> {
    let content_dir: PathBuf = root.join("public").join("osler-content");
    if !content_dir.is_dir() {
        return Err("public/osler-content/ not found in project root".to_string());
    }

    let mut results = Vec::new();
    let categories = std::fs::read_dir(&content_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| {
            e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && !e.file_name().to_string_lossy().starts_with('.')
        })
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect::<Vec<_>>();

    for category in categories {
        let category_path = content_dir.join(&category);
        let parent_type = FOLDER_TYPE_MAP
            .iter()
            .find(|(k, _)| *k == category)
            .map(|(_, v)| *v);

        let items = scan_directory(&category_path, "", parent_type);
        let manifest_type = parent_type.unwrap_or_else(|| dominant_type(&items));
        let leaves = count_leaves(&items);

        let manifest = json!({
            "type": manifest_type,
            "items": items,
        });

        let manifest_path = category_path.join(MANIFEST_NAME);
        let body = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(&manifest_path, body).map_err(|e| e.to_string())?;

        results.push(json!({
            "category": category,
            "leafCount": leaves,
            "type": manifest_type,
        }));
    }

    Ok(results)
}
