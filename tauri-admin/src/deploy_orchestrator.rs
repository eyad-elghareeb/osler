// =============================================================================
// deploy_orchestrator.rs  —  V2 (Phase 15)
// -----------------------------------------------------------------------------
// Coordinates the deploy flow: takes a wizard spec + bundle path, picks the
// right provider, runs the deploy, and maintains a per-provider deploy history
// (last 5 deploys) for rollback.
//
// V1 deploy.rs uses shell-out commands (gh CLI, netlify CLI). V2's orchestrator
// uses the providers/ module's REST API clients instead — more reliable,
// cross-platform, and doesn't require the CLIs to be installed.
//
// The orchestrator is the bridge between:
//   - The frontend wizard (which produces a wizard spec + bundle path)
//   - The providers/ module (which does the actual API calls)
//   - The keyring_store module (which retrieves credentials)
// =============================================================================

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use chrono::{DateTime, Utc};

use crate::keyring_store;
use crate::providers::{
    Credentials, DeployResult, Provider, ProviderDeploy, ProviderError,
    github_pages::GithubPagesDeployer,
    netlify::NetlifyDeployer,
    vercel::VercelDeployer,
    cloudflare::CloudflareDeployer,
};

// =============================================================================
// Deploy history
//
// Stored in .osler/deploy-history.json (per-project). Each provider + site
// has its own list of deploys (max 5).
// =============================================================================

const HISTORY_FILE: &str = "deploy-history.json";
const MAX_HISTORY_PER_SITE: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployHistoryEntry {
    pub deployment_id: String,
    pub url: String,
    pub provider: String,
    pub site_name: Option<String>,
    pub version: String,
    pub deployed_at: DateTime<Utc>,
    pub status: String,  // "success" | "failed" | "rolled_back"
    pub bundle_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeployHistory {
    pub deploys: HashMap<String, Vec<DeployHistoryEntry>>,  // key: "{provider}:{site_name}"
}

// =============================================================================
// Public API
// =============================================================================

/// Deploy a bundle using the V2 provider integrations.
///
/// `bundle_path` — path to the assembled zip (from generator_bundle.rs)
/// `provider` — which provider to deploy to
/// `site_name` — provider-specific site name (None = create new)
/// `project_root` — used to locate .osler/ for history
pub fn deploy(
    bundle_path: &Path,
    provider: Provider,
    site_name: Option<&str>,
    owner: Option<&str>,  // GitHub owner (required for GithubPages)
    project_root: &Path,
) -> Result<DeployResult, DeployError> {
    // 1. Load credentials
    let credentials = keyring_store::get_credentials(provider)?
        .ok_or(DeployError::NoCredentials)?;

    // 2. Pick the deployer
    let result = match provider {
        Provider::GithubPages => {
            let owner = owner.ok_or(DeployError::MissingParam("owner"))?;
            let repo = site_name.ok_or(DeployError::MissingParam("site_name (repo)"))?;
            let deployer = GithubPagesDeployer::new(repo.to_string(), owner.to_string());
            deployer.deploy(&bundle_path.to_path_buf(), &credentials)?
        }
        Provider::Netlify => {
            let mut deployer = NetlifyDeployer::new();
            if let Some(name) = site_name {
                deployer = deployer.with_site_name(name.to_string());
            }
            deployer.deploy(&bundle_path.to_path_buf(), &credentials)?
        }
        Provider::Vercel => {
            let mut deployer = VercelDeployer::new();
            if let Some(name) = site_name {
                deployer = deployer.with_project_name(name.to_string());
            }
            deployer.deploy(&bundle_path.to_path_buf(), &credentials)?
        }
        Provider::Cloudflare => {
            // Cloudflare requires account_id from credentials
            let account_id = match &credentials {
                Credentials::Cloudflare { account_id, .. } => account_id.clone(),
                _ => return Err(DeployError::CredentialsMismatch),
            };
            let mut deployer = CloudflareDeployer::new(account_id);
            if let Some(name) = site_name {
                deployer = deployer.with_project_name(name.to_string());
            }
            deployer.deploy(&bundle_path.to_path_buf(), &credentials)?
        }
    };

    // 3. Record in history
    let entry = DeployHistoryEntry {
        deployment_id: result.deployment_id.clone(),
        url: result.url.clone(),
        provider: provider.as_str().to_string(),
        site_name: site_name.map(|s| s.to_string()),
        version: "2.0.0".to_string(),  // TODO: from spec
        deployed_at: result.deployed_at,
        status: "success".to_string(),
        bundle_hash: String::new(),  // TODO: from bundle result
    };
    add_to_history(project_root, provider, site_name, entry)?;

    Ok(result)
}

/// Roll back to a previous deploy.
pub fn rollback(
    provider: Provider,
    site_name: Option<&str>,
    deployment_id: &str,
    project_root: &Path,
) -> Result<(), DeployError> {
    let credentials = keyring_store::get_credentials(provider)?
        .ok_or(DeployError::NoCredentials)?;

    match provider {
        Provider::GithubPages => {
            // GithubPages needs owner + repo
            // For rollback, we look up the original deploy in history to get them
            let history = load_history(project_root)?;
            let key = history_key(provider, site_name);
            let entries = history.deploys.get(&key).ok_or(DeployError::NoHistory)?;
            let _original = entries.iter()
                .find(|e| e.deployment_id == deployment_id)
                .ok_or_else(|| DeployError::DeploymentNotFound(deployment_id.to_string()))?;

            // We need the owner — but it's not in history. The caller must provide it.
            // For now, return an error indicating the caller should use the GitHub-specific API.
            return Err(DeployError::MissingParam("owner (required for GitHub Pages rollback)"));
        }
        Provider::Netlify => {
            let site_id = site_name.ok_or(DeployError::MissingParam("site_name (site_id)"))?;
            let deployer = NetlifyDeployer::new().with_site_id(site_id.to_string());
            deployer.rollback(deployment_id, &credentials)?
        }
        Provider::Vercel => {
            let deployer = VercelDeployer::new();
            deployer.rollback(deployment_id, &credentials)?
        }
        Provider::Cloudflare => {
            let account_id = match &credentials {
                Credentials::Cloudflare { account_id, .. } => account_id.clone(),
                _ => return Err(DeployError::CredentialsMismatch),
            };
            let project_name = site_name.ok_or(DeployError::MissingParam("site_name (project_name)"))?;
            let deployer = CloudflareDeployer::new(account_id).with_project_name(project_name.to_string());
            deployer.rollback(deployment_id, &credentials)?
        }
    }

    // Mark the rolled-back deploy in history
    mark_rolled_back(project_root, provider, site_name, deployment_id)?;

    Ok(())
}

/// Get the deploy history for a provider + site.
pub fn get_history(
    provider: Provider,
    site_name: Option<&str>,
    project_root: &Path,
) -> Result<Vec<DeployHistoryEntry>, DeployError> {
    let history = load_history(project_root)?;
    let key = history_key(provider, site_name);
    Ok(history.deploys.get(&key).cloned().unwrap_or_default())
}

// =============================================================================
// Internal: history file management
// =============================================================================

fn history_path(project_root: &Path) -> PathBuf {
    project_root.join(".osler").join(HISTORY_FILE)
}

fn load_history(project_root: &Path) -> Result<DeployHistory, DeployError> {
    let path = history_path(project_root);
    if !path.exists() {
        return Ok(DeployHistory::default());
    }
    let text = std::fs::read_to_string(&path).map_err(DeployError::Io)?;
    serde_json::from_str(&text).map_err(|e| DeployError::Serialization(e.to_string()))
}

fn save_history(project_root: &Path, history: &DeployHistory) -> Result<(), DeployError> {
    let path = history_path(project_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(DeployError::Io)?;
    }
    let text = serde_json::to_string_pretty(history)
        .map_err(|e| DeployError::Serialization(e.to_string()))?;
    std::fs::write(&path, text).map_err(DeployError::Io)?;
    Ok(())
}

fn history_key(provider: Provider, site_name: Option<&str>) -> String {
    format!("{}:{}", provider.as_str(), site_name.unwrap_or("_default"))
}

fn add_to_history(
    project_root: &Path,
    provider: Provider,
    site_name: Option<&str>,
    entry: DeployHistoryEntry,
) -> Result<(), DeployError> {
    let mut history = load_history(project_root)?;
    let key = history_key(provider, site_name);
    let entries = history.deploys.entry(key).or_insert_with(Vec::new);
    entries.push(entry);

    // Trim to MAX_HISTORY_PER_SITE (drop oldest)
    if entries.len() > MAX_HISTORY_PER_SITE {
        let drop_count = entries.len() - MAX_HISTORY_PER_SITE;
        entries.drain(0..drop_count);
    }

    save_history(project_root, &history)
}

fn mark_rolled_back(
    project_root: &Path,
    provider: Provider,
    site_name: Option<&str>,
    deployment_id: &str,
) -> Result<(), DeployError> {
    let mut history = load_history(project_root)?;
    let key = history_key(provider, site_name);
    if let Some(entries) = history.deploys.get_mut(&key) {
        for entry in entries.iter_mut() {
            if entry.deployment_id == deployment_id {
                entry.status = "rolled_back".to_string();
            }
        }
    }
    save_history(project_root, &history)
}

// =============================================================================
// Errors
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum DeployError {
    #[error("No credentials stored for this provider. Configure in Settings → Deploy Providers.")]
    NoCredentials,

    #[error("Credentials type does not match provider")]
    CredentialsMismatch,

    #[error("Missing parameter: {0}")]
    MissingParam(&'static str),

    #[error("No deploy history for this provider + site")]
    NoHistory,

    #[error("Deployment not found in history: {0}")]
    DeploymentNotFound(String),

    #[error("Keyring error: {0}")]
    Keyring(#[from] keyring_store::KeyringError),

    #[error("Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),
}
