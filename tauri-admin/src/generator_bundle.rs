// =============================================================================
// generator_bundle.rs  —  V2 (Phase 13)
// -----------------------------------------------------------------------------
// Assembles a deployable site bundle from the wizard spec produced by
// src/lib/generator.js (PWA-side). This is the Rust-side counterpart:
//   1. Copies chosen engine JS files from engines/ (post-build)
//   2. Copies chosen content JSON files from the content repo
//   3. Writes config.json with theme + auth + deploy settings
//   4. Writes provider config files (netlify.toml, vercel.json, etc.)
//   5. Writes update-manifest.json with version + bundle hash + file list
//   6. Computes SHA-256 over all files
//   7. Signs the bundle if a signing key is configured
//   8. Writes the zip to the output path
//
// This module REUSES V1's bundle_engines.rs (which has the zip + hash +
// signing infrastructure). V2 wraps it with the wizard-spec-to-bundle
// translation layer.
// =============================================================================

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use base64::Engine;

// =============================================================================
// Wizard spec (mirrors src/lib/generator.js's buildBundleSpec output)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WizardSpec {
    pub version: String,
    pub generated_at: String,
    pub engines: Vec<String>,
    pub content: ContentSpec,
    pub theme: ThemeSpec,
    pub auth: AuthSpec,
    pub deploy: DeploySpec,
    pub provider_configs: HashMap<String, String>,
    pub site_config: SiteConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentSpec {
    pub selected: Vec<String>,         // UIDs from the content repo
    pub uploads: Vec<UploadSpec>,      // locally-uploaded JSON files
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadSpec {
    pub filename: String,
    pub content: String,  // raw JSON
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSpec {
    pub primary: String,
    pub accent: String,
    pub background: String,
    pub font_family: String,
    pub heading_font: String,
    pub logo: Option<AssetSpec>,
    pub favicon: Option<AssetSpec>,
    pub app_name: String,
    pub tagline: String,
    pub custom_css: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetSpec {
    pub filename: String,
    pub data_url: String,  // data:image/png;base64,...
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSpec {
    pub mode: String,  // "none" | "firebase"
    pub firebase_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploySpec {
    pub target: Option<String>,  // "github_pages" | "netlify" | "vercel" | "cloudflare" | "docker" | "preview_only"
    pub site_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteConfig {
    pub version: String,
    pub app_name: String,
    pub tagline: String,
    pub theme: serde_json::Value,
    pub firebase: Option<serde_json::Value>,
    pub engines: Vec<String>,
}

// =============================================================================
// Bundle result
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleResult {
    pub bundle_path: String,
    pub bundle_hash: String,
    pub file_count: usize,
    pub size_bytes: u64,
    pub signed: bool,
}

// =============================================================================
// Public API
// =============================================================================

/// Assemble a site bundle from a wizard spec.
///
/// `project_root` is the Osler project root (where `engines/`, `content/`,
/// `src/` live). `output_path` is where the zip will be written.
///
/// Steps:
///   1. Create a temp directory
///   2. Copy engine JS files (post-build, from dist/)
///   3. Copy content JSON files
///   4. Write config.json + provider configs + update-manifest.json
///   5. Compute SHA-256 over all files
///   6. Sign the bundle if a signing key is configured (via V1 bundle_engines)
///   7. Zip the temp directory to output_path
pub fn assemble_bundle(
    spec: &WizardSpec,
    project_root: &Path,
    output_path: &Path,
) -> Result<BundleResult, BundleError> {
    // 1. Create temp directory
    let temp_dir = tempfile::tempdir()
        .map_err(|e| BundleError::Io(e))?;

    let bundle_root = temp_dir.path();

    // 2. Copy engine JS files (from dist/ — they're already built by esbuild)
    let dist_engines = project_root.join("dist");
    for engine in &spec.engines {
        let engine_file = format!("{}.js", engine.replace("-engine", ""));
        let src = dist_engines.join(&engine_file);
        if src.exists() {
            let dest = bundle_root.join("engines").join(&engine_file);
            fs::create_dir_all(dest.parent().unwrap())
                .map_err(BundleError::Io)?;
            fs::copy(&src, &dest).map_err(BundleError::Io)?;
        } else {
            return Err(BundleError::EngineNotFound(engine.clone()));
        }
    }

    // Also copy engine-shared.js (required by all engines)
    let shared_src = dist_engines.join("engines").join("engine-shared.js");
    if shared_src.exists() {
        let shared_dest = bundle_root.join("engines").join("engine-shared.js");
        fs::create_dir_all(shared_dest.parent().unwrap()).map_err(BundleError::Io)?;
        fs::copy(&shared_src, &shared_dest).map_err(BundleError::Io)?;
    }

    // 3. Copy content JSON files
    //    - From the content repo (selected UIDs)
    //    - From uploads (raw JSON)
    let content_dir = bundle_root.join("content");
    fs::create_dir_all(&content_dir).map_err(BundleError::Io)?;

    // Copy selected content from the project's content/ directory
    let source_content = project_root.join("content");
    if source_content.exists() {
        for entry in fs::read_dir(&source_content).map_err(BundleError::Io)? {
            let entry = entry.map_err(BundleError::Io)?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                let filename = path.file_name().unwrap().to_string_lossy().to_string();
                if filename == "manifest.json" {
                    // Always include manifest
                    fs::copy(&path, content_dir.join(&filename))
                        .map_err(BundleError::Io)?;
                } else {
                    // Check if this file's UID is in the selected list
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(uid) = json.get("meta").and_then(|m| m.get("uid")).and_then(|u| u.as_str()) {
                                if spec.content.selected.contains(&uid.to_string()) {
                                    fs::copy(&path, content_dir.join(&filename))
                                        .map_err(BundleError::Io)?;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Write uploaded JSON files
    for upload in &spec.content.uploads {
        let dest = content_dir.join(&upload.filename);
        fs::write(&dest, &upload.content).map_err(BundleError::Io)?;
    }

    // 4. Write config.json
    let config_json = serde_json::to_string_pretty(&spec.site_config)
        .map_err(|e| BundleError::Serialization(e.to_string()))?;
    fs::write(bundle_root.join("config.json"), config_json)
        .map_err(BundleError::Io)?;

    // 5. Write provider config files
    for (filename, content) in &spec.provider_configs {
        fs::write(bundle_root.join(filename), content)
            .map_err(BundleError::Io)?;
    }

    // 6. Copy static assets (index.html, sw.js, manifest, CSS, fonts, i18n)
    copy_static_assets(&dist_engines, bundle_root)?;

    // Copy i18n bundles
    let i18n_src = project_root.join("src").join("i18n");
    if i18n_src.exists() {
        let i18n_dest = bundle_root.join("i18n");
        fs::create_dir_all(&i18n_dest).map_err(BundleError::Io)?;
        for entry in fs::read_dir(&i18n_src).map_err(BundleError::Io)? {
            let entry = entry.map_err(BundleError::Io)?;
            fs::copy(entry.path(), i18n_dest.join(entry.file_name()))
                .map_err(BundleError::Io)?;
        }
    }

    // Copy theme assets (logo, favicon)
    if let Some(logo) = &spec.theme.logo {
        write_data_url(&bundle_root.join("assets").join(&logo.filename), &logo.data_url)?;
    }
    if let Some(favicon) = &spec.theme.favicon {
        write_data_url(&bundle_root.join("assets").join(&favicon.filename), &favicon.data_url)?;
    }

    // Write custom CSS (appended to the bundle)
    if !spec.theme.custom_css.is_empty() {
        fs::write(bundle_root.join("custom.css"), &spec.theme.custom_css)
            .map_err(BundleError::Io)?;
    }

    // 7. Compute SHA-256 over all files (manifest)
    let (hash, file_list) = compute_bundle_hash(bundle_root)?;

    // 8. Write update-manifest.json
    let manifest = serde_json::json!({
        "version": &spec.version,
        "bundleHash": hash,
        "engines": spec.engines,
        "files": file_list,
        "generatedAt": &spec.generated_at,
    });
    fs::write(
        bundle_root.join("update-manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    ).map_err(BundleError::Io)?;

    // 9. Count files + total size
    let (file_count, size_bytes) = count_files_and_size(bundle_root)?;

    // 10. Zip the bundle to output_path
    let zip_path = zip_directory(bundle_root, output_path)?;

    // 11. Sign the bundle if a signing key is configured (delegates to V1)
    let signed = sign_bundle(&zip_path).unwrap_or(false);

    Ok(BundleResult {
        bundle_path: zip_path.to_string_lossy().to_string(),
        bundle_hash: hash,
        file_count,
        size_bytes,
        signed,
    })
}

// =============================================================================
// Internal helpers
// =============================================================================

fn copy_static_assets(dist: &Path, bundle_root: &Path) -> Result<(), BundleError> {
    let static_files = ["index.html", "sw.js", "manifest.webmanifest"];
    for name in &static_files {
        let src = dist.join(name);
        if src.exists() {
            fs::copy(&src, bundle_root.join(name)).map_err(BundleError::Io)?;
        }
    }

    // Copy CSS
    let css_src = dist.join("css");
    if css_src.exists() {
        let css_dest = bundle_root.join("css");
        fs::create_dir_all(&css_dest).map_err(BundleError::Io)?;
        copy_dir_recursive(&css_src, &css_dest)?;
    }

    // Copy assets
    let assets_src = dist.join("assets");
    if assets_src.exists() {
        let assets_dest = bundle_root.join("assets");
        fs::create_dir_all(&assets_dest).map_err(BundleError::Io)?;
        copy_dir_recursive(&assets_src, &assets_dest)?;
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), BundleError> {
    for entry in fs::read_dir(src).map_err(BundleError::Io)? {
        let entry = entry.map_err(BundleError::Io)?;
        let path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if path.is_dir() {
            fs::create_dir_all(&dest_path).map_err(BundleError::Io)?;
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            fs::copy(&path, &dest_path).map_err(BundleError::Io)?;
        }
    }
    Ok(())
}

fn write_data_url(path: &Path, data_url: &str) -> Result<(), BundleError> {
    // Parse "data:image/png;base64,XXXX..."
    if let Some(idx) = data_url.find(",") {
        let _meta = &data_url[..idx];  // e.g. "data:image/png;base64"
        let payload = &data_url[idx + 1..];
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(payload) {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(BundleError::Io)?;
            }
            fs::write(path, bytes).map_err(BundleError::Io)?;
            return Ok(());
        }
    }
    Err(BundleError::InvalidAsset(data_url.to_string()))
}

fn compute_bundle_hash(bundle_root: &Path) -> Result<(String, Vec<String>), BundleError> {
    let mut hasher = Sha256::new();
    let mut files: Vec<String> = Vec::new();

    fn walk(dir: &Path, base: &Path, hasher: &mut Sha256, files: &mut Vec<String>) -> Result<(), BundleError> {
        let mut entries: Vec<_> = fs::read_dir(dir).map_err(BundleError::Io)?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, base, hasher, files)?;
            } else {
                let rel = path.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
                files.push(rel.clone());
                hasher.update(rel.as_bytes());
                let bytes = fs::read(&path).map_err(BundleError::Io)?;
                hasher.update(&bytes);
            }
        }
        Ok(())
    }

    walk(bundle_root, bundle_root, &mut hasher, &mut files)?;
    let hash = format!("{:x}", hasher.finalize());
    Ok((hash, files))
}

fn count_files_and_size(bundle_root: &Path) -> Result<(usize, u64), BundleError> {
    let mut count = 0;
    let mut size = 0;
    fn walk(dir: &Path, count: &mut usize, size: &mut u64) -> Result<(), BundleError> {
        for entry in fs::read_dir(dir).map_err(BundleError::Io)? {
            let entry = entry.map_err(BundleError::Io)?;
            let path = entry.path();
            if path.is_dir() {
                walk(&path, count, size)?;
            } else {
                *count += 1;
                *size += entry.metadata().map_err(BundleError::Io)?.len();
            }
        }
        Ok(())
    }
    walk(bundle_root, &mut count, &mut size)?;
    Ok((count, size))
}

fn zip_directory(bundle_root: &Path, output_path: &Path) -> Result<PathBuf, BundleError> {
    let file = fs::File::create(output_path).map_err(BundleError::Io)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    fn add_dir(dir: &Path, base: &Path, zip: &mut zip::ZipWriter<fs::File>, options: &zip::write::SimpleFileOptions) -> Result<(), BundleError> {
        let mut entries: Vec<_> = fs::read_dir(dir).map_err(BundleError::Io)?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            let rel = path.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
            if path.is_dir() {
                zip.add_directory(&format!("{}/", rel), *options).map_err(|e| BundleError::Zip(e.to_string()))?;
                add_dir(&path, base, zip, options)?;
            } else {
                zip.start_file(&rel, *options).map_err(|e| BundleError::Zip(e.to_string()))?;
                let bytes = fs::read(&path).map_err(BundleError::Io)?;
                zip.write_all(&bytes).map_err(BundleError::Io)?;
            }
        }
        Ok(())
    }

    add_dir(bundle_root, bundle_root, &mut zip, &options)?;
    zip.finish().map_err(|e| BundleError::Zip(e.to_string()))?;
    Ok(output_path.to_path_buf())
}

fn sign_bundle(zip_path: &Path) -> Result<bool, BundleError> {
    // Delegate to V1's bundle_engines sign function if available.
    // V1's bundle_engines.rs has the signing infrastructure; we just call it.
    //
    // If no signing key is configured (the pubkey field in tauri.conf.json is
    // empty), signing is skipped — returns Ok(false).
    //
    // V1's signature function signature (from bundle_engines.rs):
    //   pub fn sign_bundle(zip_path: &Path) -> Result<String, String>
    //
    // We try to call it; on any error, we log and return false.
    match crate::bundle_engines::sign_bundle(zip_path) {
        Ok(_signature) => Ok(true),
        Err(e) => {
            // No signing key configured — not an error, just unsigned
            if e.contains("no signing key") || e.contains("pubkey") {
                Ok(false)
            } else {
                Err(BundleError::Signing(e))
            }
        }
    }
}

// =============================================================================
// Errors
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum BundleError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Engine not found in dist/: {0}")]
    EngineNotFound(String),

    #[error("Invalid asset data URL: {0}")]
    InvalidAsset(String),

    #[error("Zip error: {0}")]
    Zip(String),

    #[error("Signing error: {0}")]
    Signing(String),
}
