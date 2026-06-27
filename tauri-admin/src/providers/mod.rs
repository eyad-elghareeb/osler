// =============================================================================
// providers/mod.rs  —  V2 (Phase 15)
// -----------------------------------------------------------------------------
// Provider integrations for deploying generated site bundles.
//
// Each provider module exposes the same trait:
//   - deploy(bundle_path, credentials) -> Result<Url, Error>
//   - rollback(deployment_id) -> Result<(), Error>
//   - get_status(deployment_id) -> Result<Status, Error>
//
// V2 supports: GitHub Pages, Netlify, Vercel, Cloudflare Pages.
// V2 explicitly does NOT support: AWS, GCP, Azure (anti-goal §5.12).
// =============================================================================

pub mod github_pages;
pub mod netlify;
pub mod vercel;
pub mod cloudflare;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// =============================================================================
// Shared types
// =============================================================================

/// Provider identifier. Used in deploy commands + storage of credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    GithubPages,
    Netlify,
    Vercel,
    Cloudflare,
}

impl Provider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::GithubPages => "github_pages",
            Provider::Netlify => "netlify",
            Provider::Vercel => "vercel",
            Provider::Cloudflare => "cloudflare",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "github_pages" => Some(Provider::GithubPages),
            "netlify" => Some(Provider::Netlify),
            "vercel" => Some(Provider::Vercel),
            "cloudflare" => Some(Provider::Cloudflare),
            _ => None,
        }
    }

    /// The OS keychain service name for this provider's credentials.
    pub fn keychain_service(&self) -> String {
        format!("com.osler.admin.{}", self.as_str())
    }
}

/// Result of a successful deploy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployResult {
    pub url: String,
    pub deployment_id: String,
    pub provider: Provider,
    pub deployed_at: chrono::DateTime<chrono::Utc>,
}

/// Trait every provider implements.
pub trait ProviderDeploy {
    /// Deploy the bundle at `bundle_path` and return the live URL.
    fn deploy(&self, bundle_path: &PathBuf, credentials: &Credentials) -> Result<DeployResult, ProviderError>;

    /// Roll back to a previous deployment.
    fn rollback(&self, deployment_id: &str, credentials: &Credentials) -> Result<(), ProviderError>;
}

/// Credentials for a provider. Stored in the OS keychain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Credentials {
    Github { token: String },          // reuses the admin's GitHub token
    Netlify { access_token: String },
    Vercel { access_token: String },
    Cloudflare { api_token: String, account_id: String },
}

/// Provider error. Maps cleanly to a Tauri command error response.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("Network error: {0}")]
    Network(String),

    #[error("Authentication failed (401) — token may be invalid or expired")]
    Unauthorized,

    #[error("Forbidden (403) — token lacks required scopes")]
    Forbidden,

    #[error("Rate limited (429) — retry after {retry_after_secs}s")]
    RateLimited { retry_after_secs: u64 },

    #[error("Provider returned error {status}: {body}")]
    ProviderError { status: u16, body: String },

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
