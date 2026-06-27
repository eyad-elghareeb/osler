use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::ZipWriter;

pub const ENGINE_FILES: &[&str] = &[
    "engine-shared.js",
    "engine-tracker.js",
    "index-engine.js",
    "quiz-engine.js",
    "bank-engine.js",
    "flashcard-engine.js",
    "written-engine.js",
    "osce-engine.js",
    "uworld-engine.js",
    "ai-assistant-engine.js",
    "search-engine.js",
];

pub const CSS_FILES: &[&str] = &[
    "shared.css",
    "index-engine.css",
    "quiz-engine.css",
    "bank-engine.css",
    "flashcard-engine.css",
    "written-engine.css",
    "osce-engine.css",
    "uworld-engine.css",
    "ai-assistant-engine.css",
    "search-engine.css",
];

pub const ASSET_FILES: &[&str] = &[
    "icon-48.png",
    "icon-72.png",
    "icon-96.png",
    "icon-144.png",
    "icon-192.png",
    "icon-512.png",
    "favicon.svg",
];

pub const ROOT_FILES: &[&str] = &["sw.js", "manifest.webmanifest", "update-manifest.json", "tracker-map.json"];

fn collect_bundle_items(root: &Path) -> Vec<(PathBuf, String)> {
    let mut items = Vec::new();

    for f in ENGINE_FILES {
        let p = root.join("engines").join(f);
        if p.exists() {
            items.push((p, format!("engines/{}", f)));
        }
    }

    for f in CSS_FILES {
        let p = root.join("dist").join(f);
        if p.exists() {
            items.push((p, format!("assets/css/{}", f)));
        }
    }

    for f in ASSET_FILES {
        let p = root.join("assets").join(f);
        if p.exists() {
            items.push((p, format!("assets/{}", f)));
        }
    }

    for f in ROOT_FILES {
        let p = root.join(f);
        if p.exists() {
            items.push((p, f.to_string()));
        }
    }

    items
}

pub fn generate_update_manifest(root: &Path, version: &str, changelog: &str) -> Result<Value, String> {
    let items = collect_bundle_items(root);
    let mut hasher = Sha256::new();
    let mut engine_list = Vec::new();
    let mut asset_list = Vec::new();

    for (path, rel_path) in &items {
        let data = std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", rel_path, e))?;
        hasher.update(&data);
        if rel_path.starts_with("engines/") {
            engine_list.push(rel_path.trim_start_matches("engines/").to_string());
        } else if rel_path.starts_with("assets/") && !rel_path.starts_with("assets/css/") {
            asset_list.push(rel_path.trim_start_matches("assets/").to_string());
        }
    }

    let bundle_hash = format!("{:x}", hasher.finalize());

    Ok(json!({
        "version": version,
        "build": chrono::Utc::now().to_rfc3339(),
        "description": changelog,
        "bundleHash": bundle_hash,
        "requiredVersion": env!("CARGO_PKG_VERSION"),
        "changelog": changelog,
        "engines": engine_list,
        "assets": asset_list,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
    }))
}

pub fn create_update_bundle(root: &Path, version: &str, changelog: &str) -> Result<Vec<u8>, String> {
    let items = collect_bundle_items(root);
    if items.is_empty() {
        return Err("No bundle items found. Are you in the project root?".into());
    }

    let manifest = generate_update_manifest(root, version, changelog)?;
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

    let mut buffer = Vec::new();
    let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buffer));

    for (path, rel_path) in &items {
        let data = std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", rel_path, e))?;
        if rel_path == &"update-manifest.json".to_string() {
            continue;
        }
        let options: FileOptions<'_, ()> = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        zip.start_file(rel_path, options)
            .map_err(|e| format!("Failed to start file {} in zip: {}", rel_path, e))?;
        zip.write_all(&data)
            .map_err(|e| format!("Failed to write {} to zip: {}", rel_path, e))?;
    }

    let options: FileOptions<'_, ()> = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    zip.start_file("update-manifest.json", options)
        .map_err(|e| format!("Failed to start update-manifest.json in zip: {}", e))?;
    zip.write_all(&manifest_bytes)
        .map_err(|e| format!("Failed to write update-manifest.json to zip: {}", e))?;

    zip.finish().map_err(|e| format!("Failed to finalize zip: {}", e))?;

    Ok(buffer)
}

pub fn verify_bundle(bundle_data: &[u8]) -> Result<(String, Value), String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bundle_data))
            .map_err(|e| format!("Invalid zip archive: {}", e))?;

    let manifest_idx = archive.index_for_name("update-manifest.json")
        .ok_or("update-manifest.json not found in bundle")?;
    let (expected_hash, manifest) = {
        let mut manifest_file = archive.by_index(manifest_idx)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        let mut manifest_bytes = Vec::new();
        manifest_file.read_to_end(&mut manifest_bytes)
            .map_err(|e| format!("Failed to read manifest bytes: {}", e))?;
        let manifest: Value = serde_json::from_slice(&manifest_bytes)
            .map_err(|e| format!("Invalid manifest JSON: {}", e))?;
        let expected_hash = manifest["bundleHash"]
            .as_str()
            .ok_or("bundleHash missing from manifest")?
            .to_string();
        Ok::<_, String>((expected_hash, manifest))
    }?;

    let mut hasher = Sha256::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read zip entry {}: {}", i, e))?;
        if file.name() == "update-manifest.json" {
            continue;
        }
        let mut data = Vec::new();
        file.read_to_end(&mut data)
            .map_err(|e| format!("Failed to read {}: {}", file.name(), e))?;
        hasher.update(&data);
    }

    let computed_hash = format!("{:x}", hasher.finalize());

    if computed_hash != expected_hash {
        return Err(format!(
            "Bundle hash mismatch: expected {}, computed {}",
            expected_hash, computed_hash
        ));
    }

    Ok((expected_hash, manifest))
}

/// Sign a bundle zip with the configured signing key.
/// Returns the signature hex string on success.
///
/// If no signing key is configured (the pubkey field in tauri.conf.json is
/// empty), returns an error containing "no signing key", which callers should
/// handle gracefully.
pub fn sign_bundle(_zip_path: &Path) -> Result<String, String> {
    // No signing key configured — return an error that callers handle
    // (they check for "no signing key" text and treat it as unsigned).
    Err("no signing key configured".into())
}
