// =============================================================================
// providers/cloudflare.rs  —  V2 (Phase 15)
// -----------------------------------------------------------------------------
// Deploys a generated site bundle to Cloudflare Pages via their REST API.
//
// Flow:
//   1. Create a project (POST /accounts/{account_id}/pages/projects)
//   2. Create a deployment with the bundle files (POST /accounts/{account_id}/pages/projects/{name}/deployments)
//   3. Poll the deployment until status is "success"
//   4. Return the URL: https://{project-name}.pages.dev
//
// Rollback: Cloudflare keeps every deploy. Rollback = rollback to a previous.
// =============================================================================

use super::*;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

const CF_API_BASE: &str = "https://api.cloudflare.com/client/v4";
const POLL_INTERVAL_SECS: u64 = 3;
const POLL_TIMEOUT_SECS: u64 = 300;

pub struct CloudflareDeployer {
    pub account_id: String,
    pub project_name: Option<String>,
}

impl CloudflareDeployer {
    pub fn new(account_id: String) -> Self {
        Self { account_id, project_name: None }
    }

    pub fn with_project_name(mut self, name: String) -> Self {
        self.project_name = Some(name);
        self
    }
}

impl ProviderDeploy for CloudflareDeployer {
    fn deploy(&self, bundle_path: &PathBuf, credentials: &Credentials) -> Result<DeployResult, ProviderError> {
        let (api_token, account_id) = match credentials {
            Credentials::Cloudflare { api_token, account_id } => (api_token, account_id),
            _ => return Err(ProviderError::Config("expected Cloudflare credentials".into())),
        };

        if *account_id != self.account_id {
            return Err(ProviderError::Config("account_id mismatch".into()));
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        // 1. Get or create the project
        let project_name = if let Some(n) = &self.project_name {
            n.clone()
        } else {
            format!("osler-site-{}", chrono::Utc::now().timestamp() % 100000)
        };

        if !project_exists(&client, api_token, account_id, &project_name)? {
            create_project(&client, api_token, account_id, &project_name)?;
        }

        // 2. Read the bundle zip + extract files
        let zip_bytes = std::fs::read(bundle_path).map_err(ProviderError::Io)?;
        let files = extract_files_manifest(&zip_bytes)?;

        // 3. Create a deployment (uses the manifest upload pattern)
        let deployment_id = create_deployment(&client, api_token, account_id, &project_name, &files)?;

        // 4. Poll until success
        let url = poll_deployment(&client, api_token, account_id, &project_name, &deployment_id)?;

        Ok(DeployResult {
            url,
            deployment_id,
            provider: Provider::Cloudflare,
            deployed_at: chrono::Utc::now(),
        })
    }

    fn rollback(&self, deployment_id: &str, credentials: &Credentials) -> Result<(), ProviderError> {
        let (api_token, account_id) = match credentials {
            Credentials::Cloudflare { api_token, account_id } => (api_token, account_id),
            _ => return Err(ProviderError::Config("expected Cloudflare credentials".into())),
        };

        let project_name = self.project_name.as_ref()
            .ok_or_else(|| ProviderError::Config("project_name required for rollback".into()))?;

        let client = Client::new();
        let url = format!("{}/accounts/{}/pages/projects/{}/deployments/{}/rollback",
            CF_API_BASE, account_id, project_name, deployment_id);

        let resp = client.post(&url)
            .header("Authorization", format!("Bearer {}", api_token))
            .send()
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        match resp.status() {
            s if s.is_success() => Ok(()),
            StatusCode::UNAUTHORIZED => Err(ProviderError::Unauthorized),
            StatusCode::FORBIDDEN => Err(ProviderError::Forbidden),
            StatusCode::TOO_MANY_REQUESTS => Err(ProviderError::RateLimited { retry_after_secs: 60 }),
            s => Err(ProviderError::ProviderError {
                status: s.as_u16(),
                body: resp.text().unwrap_or_default(),
            }),
        }
    }

}

// =============================================================================
// Internal helpers
// =============================================================================
// Internal helpers
// =============================================================================

fn project_exists(client: &Client, token: &str, account_id: &str, name: &str) -> Result<bool, ProviderError> {
    let url = format!("{}/accounts/{}/pages/projects/{}", CF_API_BASE, account_id, name);
    let resp = client.get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .map_err(|e| ProviderError::Network(e.to_string()))?;

    match resp.status() {
        StatusCode::OK => Ok(true),
        StatusCode::NOT_FOUND => Ok(false),
        StatusCode::UNAUTHORIZED => Err(ProviderError::Unauthorized),
        StatusCode::FORBIDDEN => Err(ProviderError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => Err(ProviderError::RateLimited { retry_after_secs: 60 }),
        s => Err(ProviderError::ProviderError {
            status: s.as_u16(),
            body: resp.text().unwrap_or_default(),
        }),
    }
}

fn create_project(client: &Client, token: &str, account_id: &str, name: &str) -> Result<(), ProviderError> {
    let body = json!({ "name": name, "production_branch": "main" });

    let url = format!("{}/accounts/{}/pages/projects", CF_API_BASE, account_id);
    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .map_err(|e| ProviderError::Network(e.to_string()))?;

    match resp.status() {
        s if s.is_success() => Ok(()),
        StatusCode::UNAUTHORIZED => Err(ProviderError::Unauthorized),
        StatusCode::FORBIDDEN => Err(ProviderError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => Err(ProviderError::RateLimited { retry_after_secs: 60 }),
        s => Err(ProviderError::ProviderError {
            status: s.as_u16(),
            body: resp.text().unwrap_or_default(),
        }),
    }
}

fn create_deployment(client: &Client, token: &str, account_id: &str, project_name: &str, files: &[(String, String)]) -> Result<String, ProviderError> {
    let files_json: Vec<_> = files.iter().map(|(path, hash)| {
        json!({ "path": path, "hash": hash, "size": 0 })
    }).collect();

    let body = json!({ "manifest": files_json });

    let url = format!("{}/accounts/{}/pages/projects/{}/deployments",
        CF_API_BASE, account_id, project_name);

    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .map_err(|e| ProviderError::Network(e.to_string()))?;

    match resp.status() {
        s if s.is_success() => {
            let body_text = resp.text().map_err(|e| ProviderError::Network(e.to_string()))?;
            let body: serde_json::Value = serde_json::from_str(&body_text).map_err(ProviderError::Json)?;
            body.get("result").and_then(|r| r.get("id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| ProviderError::Config("deployment response missing id".into()))
        },
        StatusCode::UNAUTHORIZED => Err(ProviderError::Unauthorized),
        StatusCode::FORBIDDEN => Err(ProviderError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => Err(ProviderError::RateLimited { retry_after_secs: 60 }),
        s => Err(ProviderError::ProviderError {
            status: s.as_u16(),
            body: resp.text().unwrap_or_default(),
        }),
    }
}

fn poll_deployment(client: &Client, token: &str, account_id: &str, project_name: &str, deployment_id: &str) -> Result<String, ProviderError> {
    let url = format!("{}/accounts/{}/pages/projects/{}/deployments/{}",
        CF_API_BASE, account_id, project_name, deployment_id);

    let start = std::time::Instant::now();

    loop {
        if start.elapsed().as_secs() > POLL_TIMEOUT_SECS {
            return Err(ProviderError::Network("deploy timed out".into()));
        }

        let resp = client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if resp.status().is_success() {
            let body_text = resp.text().map_err(|e| ProviderError::Network(e.to_string()))?;
            let body: serde_json::Value = serde_json::from_str(&body_text).map_err(ProviderError::Json)?;
            let result = body.get("result").ok_or_else(|| ProviderError::Config("missing result".into()))?;

            let stage = result.get("latest_stage").and_then(|s| s.get("status"))
                .and_then(|v| v.as_str()).unwrap_or("unknown");

            if stage == "success" {
                let url = result.get("url").and_then(|v| v.as_str())
                    .ok_or_else(|| ProviderError::Config("deployment missing url".into()))?;
                return Ok(url.to_string());
            }

            if stage == "failure" {
                let err = result.get("latest_stage").and_then(|s| s.get("name"))
                    .and_then(|v| v.as_str()).unwrap_or("unknown");
                return Err(ProviderError::ProviderError { status: 500, body: err.to_string() });
            }

            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
        } else {
            return Err(ProviderError::ProviderError {
                status: resp.status().as_u16(),
                body: resp.text().unwrap_or_default(),
            });
        }
    }
}

fn extract_files_manifest(zip_bytes: &[u8]) -> Result<Vec<(String, String)>, ProviderError> {
    use std::io::Read;
    use sha2::{Sha256, Digest};

    let cursor = std::io::Cursor::new(zip_bytes.to_vec());
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| ProviderError::Config(format!("Invalid zip: {}", e)))?;

    let mut files = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| ProviderError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

        let name = file.name().to_string();
        if name.ends_with('/') {
            continue;
        }

        let mut contents = Vec::new();
        file.read_to_end(&mut contents).map_err(ProviderError::Io)?;

        // Cloudflare wants the SHA-256 hash as the file identifier
        let mut hasher = Sha256::new();
        hasher.update(&contents);
        let hash = hasher.finalize();
        let hash_hex = format!("{:x}", hash);

        files.push((name, hash_hex));
    }
    Ok(files)
}
