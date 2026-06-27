// =============================================================================
// commands_v2.rs  —  V2 (Phase 13/15)
// -----------------------------------------------------------------------------
// Tauri command handlers for V2 features. These are the IPC bridge between
// the frontend wizard (wizard.js) and the Rust backend (generator_bundle,
// deploy_orchestrator, keyring_store, preview_server).
//
// Register these in lib.rs (or main.rs) via:
//
//   .invoke_handler(tauri::generate_handler![
//       commands_v2::generator_assemble_bundle,
//       commands_v2::generator_start_preview,
//       commands_v2::generator_stop_preview,
//       commands_v2::deploy_v2,
//       commands_v2::deploy_v2_rollback,
//       commands_v2::deploy_v2_history,
//       commands_v2::keyring_set,
//       commands_v2::keyring_get,
//       commands_v2::keyring_delete,
//       commands_v2::keyring_test,
//   ])
//
// All commands return Result<T, String> — Tauri serializes the error variant
// as a string for the frontend.
// =============================================================================

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::deploy_orchestrator;
use crate::generator_bundle::{self, WizardSpec, BundleResult};
use crate::keyring_store;
use crate::preview_server;
use crate::providers::{Credentials, Provider};

// =============================================================================
// Generator commands (Phase 13)
// =============================================================================

/// Assemble a site bundle from a wizard spec.
///
/// Frontend call:
///   await window.__TAURI__.invoke('generator_assemble_bundle', {
///     spec: wizardSpec,
///     outputPath: '/tmp/osler-bundle.zip'
///   });
#[tauri::command]
pub fn generator_assemble_bundle(
    spec: WizardSpec,
    output_path: String,
    state: State<crate::commands::ProjectRoot>,
) -> Result<BundleResult, String> {
    let project_root = state.0.lock().unwrap().clone();
    let output = PathBuf::from(&output_path);

    // Ensure parent dir exists
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    generator_bundle::assemble_bundle(&spec, &project_root, &output)
        .map_err(|e| e.to_string())
}

/// Start a local preview server for a generated bundle.
#[tauri::command]
pub fn generator_start_preview(
    bundle_path: String,
    port: Option<u16>,
) -> Result<preview_server::PreviewInfo, String> {
    let preferred = port.unwrap_or(5500);
    preview_server::start_preview(&PathBuf::from(bundle_path), preferred)
        .map_err(|e| e.to_string())
}

/// Stop the running preview server.
#[tauri::command]
pub fn generator_stop_preview() -> Result<(), String> {
    preview_server::stop_preview().map_err(|e| e.to_string())
}

/// Check whether the preview server is running.
#[tauri::command]
pub fn generator_preview_status() -> bool {
    preview_server::is_preview_running()
}

// =============================================================================
// Deploy commands (Phase 15)
// =============================================================================

/// Deploy a bundle to a provider.
#[tauri::command]
pub fn deploy_v2(
    bundle_path: String,
    provider: String,
    site_name: Option<String>,
    owner: Option<String>,
    state: State<crate::commands::ProjectRoot>,
) -> Result<crate::providers::DeployResult, String> {

    let project_root = state.0.lock().unwrap().clone();
    let provider = Provider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    let result = deploy_orchestrator::deploy(
        &PathBuf::from(&bundle_path),
        provider,
        site_name.as_deref(),
        owner.as_deref(),
        &project_root,
    ).map_err(|e| e.to_string())?;

    // Wrap in the providers::DeployResult shape (which is serializable)
    Ok(result)
}

/// Roll back to a previous deploy.
#[tauri::command]
pub fn deploy_v2_rollback(
    provider: String,
    site_name: Option<String>,
    deployment_id: String,
    state: State<crate::commands::ProjectRoot>,
) -> Result<(), String> {
    let project_root = state.0.lock().unwrap().clone();
    let provider = Provider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    deploy_orchestrator::rollback(
        provider,
        site_name.as_deref(),
        &deployment_id,
        &project_root,
    ).map_err(|e| e.to_string())
}

/// Get the deploy history for a provider + site.
#[tauri::command]
pub fn deploy_v2_history(
    provider: String,
    site_name: Option<String>,
    state: State<crate::commands::ProjectRoot>,
) -> Result<Vec<deploy_orchestrator::DeployHistoryEntry>, String> {
    let project_root = state.0.lock().unwrap().clone();
    let provider = Provider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    deploy_orchestrator::get_history(
        provider,
        site_name.as_deref(),
        &project_root,
    ).map_err(|e| e.to_string())
}

// =============================================================================
// Keyring commands (Phase 15)
// =============================================================================

/// Stored credentials (for the frontend — sensitive fields are redacted).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCredentialInfo {
    pub provider: String,
    pub configured: bool,
    pub preview: String,  // e.g. "nfp_...1234" — first 4 + last 4 chars
}

/// Store credentials for a provider.
///
/// Frontend call:
///   await window.__TAURI__.invoke('keyring_set', {
///     provider: 'netlify',
///     credentials: { access_token: 'nfp_abc...' }
///   });
#[tauri::command]
pub fn keyring_set(
    provider: String,
    credentials: serde_json::Value,
) -> Result<(), String> {
    let provider = Provider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    // Deserialize into the typed Credentials enum
    let creds: Credentials = serde_json::from_value(credentials)
        .map_err(|e| format!("Invalid credentials shape: {}", e))?;

    // Verify the credential type matches the provider
    let type_matches = match (&provider, &creds) {
        (Provider::GithubPages, Credentials::Github { .. }) => true,
        (Provider::Netlify, Credentials::Netlify { .. }) => true,
        (Provider::Vercel, Credentials::Vercel { .. }) => true,
        (Provider::Cloudflare, Credentials::Cloudflare { .. }) => true,
        _ => false,
    };
    if !type_matches {
        return Err(format!(
            "Credential type does not match provider {}",
            provider.as_str()
        ));
    }

    keyring_store::set_credentials(provider, &creds).map_err(|e| e.to_string())
}

/// Get credential info for a provider (redacted — does NOT return the actual token).
#[tauri::command]
pub fn keyring_get(provider: String) -> Result<StoredCredentialInfo, String> {
    let provider = Provider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    let creds = keyring_store::get_credentials(provider).map_err(|e| e.to_string())?;

    let (configured, preview) = match creds {
        Some(c) => (true, redact(&c)),
        None => (false, String::new()),
    };

    Ok(StoredCredentialInfo {
        provider: provider.as_str().to_string(),
        configured,
        preview,
    })
}

/// Delete credentials for a provider.
#[tauri::command]
pub fn keyring_delete(provider: String) -> Result<(), String> {
    let provider = Provider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    keyring_store::delete_credentials(provider).map_err(|e| e.to_string())
}

/// Test credentials by making a minimal API call to the provider.
#[tauri::command]
pub fn keyring_test(provider: String) -> Result<bool, String> {
    let provider = Provider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    keyring_store::test_credentials(provider).map_err(|e| e.to_string())
}

// =============================================================================
// Internal: redact credentials for display
// =============================================================================

fn redact(creds: &Credentials) -> String {
    match creds {
        Credentials::Github { token } => redact_string(token),
        Credentials::Netlify { access_token } => redact_string(access_token),
        Credentials::Vercel { access_token } => redact_string(access_token),
        Credentials::Cloudflare { api_token, account_id } => {
            format!("{} (acct: {})", redact_string(api_token), account_id)
        }
    }
}

fn redact_string(s: &str) -> String {
    if s.len() <= 8 {
        "****".to_string()
    } else {
        format!("{}...{}", &s[..4], &s[s.len() - 4..])
    }
}
