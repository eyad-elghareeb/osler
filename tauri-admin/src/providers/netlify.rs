// =============================================================================
// providers/netlify.rs  —  V2 (Phase 15)
// -----------------------------------------------------------------------------
// Deploys a generated site bundle to Netlify via their REST API.
//
// Flow:
//   1. Create a new site (POST /api/v1/sites) — gets a random subdomain
//   2. Upload the bundle zip as a deploy (POST /api/v1/sites/{id}/deploys)
//   3. Poll the deploy status until "ready"
//   4. Return the URL: https://{random}.netlify.app
//
// Rollback: Netlify keeps every deploy. Rollback = restore a previous deploy.
// =============================================================================

use super::*;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

const NETLIFY_API_BASE: &str = "https://api.netlify.com/api/v1";
const POLL_INTERVAL_SECS: u64 = 3;
const POLL_TIMEOUT_SECS: u64 = 300; // 5 minutes

pub struct NetlifyDeployer {
    pub site_id: Option<String>, // None = create new site
    pub site_name: Option<String>, // None = random
}

impl NetlifyDeployer {
    pub fn new() -> Self {
        Self { site_id: None, site_name: None }
    }

    pub fn with_site_id(mut self, site_id: String) -> Self {
        self.site_id = Some(site_id);
        self
    }

    pub fn with_site_name(mut self, name: String) -> Self {
        self.site_name = Some(name);
        self
    }
}

impl ProviderDeploy for NetlifyDeployer {
    fn deploy(&self, bundle_path: &PathBuf, credentials: &Credentials) -> Result<DeployResult, ProviderError> {
        let token = match credentials {
            Credentials::Netlify { access_token } => access_token,
            _ => return Err(ProviderError::Config("expected Netlify credentials".into())),
        };

        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        // 1. Get or create the site
        let site_id = if let Some(id) = &self.site_id {
            id.clone()
        } else {
            create_site(&client, token, self.site_name.as_deref())?
        };

        // 2. Read the bundle zip
        let zip_bytes = std::fs::read(bundle_path).map_err(ProviderError::Io)?;

        // 3. Create a deploy (upload the zip)
        let deploy_id = create_deploy(&client, token, &site_id, &zip_bytes)?;

        // 4. Poll until ready
        let url = poll_deploy(&client, token, &site_id, &deploy_id)?;

        Ok(DeployResult {
            url,
            deployment_id: deploy_id,
            provider: Provider::Netlify,
            deployed_at: chrono::Utc::now(),
        })
    }

    fn rollback(&self, deployment_id: &str, credentials: &Credentials) -> Result<(), ProviderError> {
        let token = match credentials {
            Credentials::Netlify { access_token } => access_token,
            _ => return Err(ProviderError::Config("expected Netlify credentials".into())),
        };

        let site_id = self.site_id.as_ref()
            .ok_or_else(|| ProviderError::Config("site_id required for rollback".into()))?;

        let client = Client::new();
        let url = format!("{}/sites/{}/deploys/{}/restore", NETLIFY_API_BASE, site_id, deployment_id);

        let resp = client.post(&url)
            .header("Authorization", format!("Bearer {}", token))
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

fn create_site(client: &Client, token: &str, name: Option<&str>) -> Result<String, ProviderError> {
    let body = match name {
        Some(n) => json!({ "name": n }),
        None => json!({}),
    };

    let resp = client.post(&format!("{}/sites", NETLIFY_API_BASE))
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .map_err(|e| ProviderError::Network(e.to_string()))?;

    match resp.status() {
        s if s.is_success() => {
            let body_text = resp.text().map_err(|e| ProviderError::Network(e.to_string()))?;
            let body: serde_json::Value = serde_json::from_str(&body_text).map_err(ProviderError::Json)?;
            body.get("id").and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| ProviderError::Config("Netlify response missing site id".into()))
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

fn create_deploy(client: &Client, token: &str, site_id: &str, zip_bytes: &[u8]) -> Result<String, ProviderError> {
    let url = format!("{}/sites/{}/deploys", NETLIFY_API_BASE, site_id);

    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/zip")
        .body(zip_bytes.to_vec())
        .send()
        .map_err(|e| ProviderError::Network(e.to_string()))?;

    match resp.status() {
        s if s.is_success() => {
            let body_text = resp.text().map_err(|e| ProviderError::Network(e.to_string()))?;
            let body: serde_json::Value = serde_json::from_str(&body_text).map_err(ProviderError::Json)?;
            body.get("id").and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| ProviderError::Config("Netlify response missing deploy id".into()))
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

fn poll_deploy(client: &Client, token: &str, site_id: &str, deploy_id: &str) -> Result<String, ProviderError> {
    let url = format!("{}/sites/{}/deploys/{}", NETLIFY_API_BASE, site_id, deploy_id);
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
            let state = body.get("state").and_then(|v| v.as_str()).unwrap_or("unknown");

            match state {
                "ready" => {
                    let url = body.get("ssl_url").or_else(|| body.get("url"))
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| ProviderError::Config("missing url in deploy response".into()))?
                        .to_string();
                    return Ok(url);
                },
                "error" => {
                    let err_msg = body.get("error_message").and_then(|v| v.as_str()).unwrap_or("unknown");
                    return Err(ProviderError::ProviderError { status: 500, body: err_msg.to_string() });
                },
                _ => {
                    std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
                },
            }
        } else {
            return Err(ProviderError::ProviderError {
                status: resp.status().as_u16(),
                body: resp.text().unwrap_or_default(),
            });
        }
    }
}
