// =============================================================================
// providers/vercel.rs  —  V2 (Phase 15)
// -----------------------------------------------------------------------------
// Deploys a generated site bundle to Vercel via their REST API.
//
// Flow:
//   1. Create a project (POST /v10/projects) — no Git repo required
//   2. Create a deployment with the bundle files inline (POST /v13/deployments)
//   3. Poll the deployment until status is READY
//   4. Return the URL: https://{project}.{hash}.vercel.app (production alias)
//
// Rollback: Vercel keeps every deploy. Rollback = promote a previous deploy.
// =============================================================================

use super::*;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

const VERCEL_API_BASE: &str = "https://api.vercel.com";
const POLL_INTERVAL_SECS: u64 = 3;
const POLL_TIMEOUT_SECS: u64 = 300;

pub struct VercelDeployer {
    pub project_id: Option<String>,
    pub project_name: Option<String>,
}

impl VercelDeployer {
    pub fn new() -> Self {
        Self { project_id: None, project_name: None }
    }

    pub fn with_project_name(mut self, name: String) -> Self {
        self.project_name = Some(name);
        self
    }
}

impl ProviderDeploy for VercelDeployer {
    fn deploy(&self, bundle_path: &PathBuf, credentials: &Credentials) -> Result<DeployResult, ProviderError> {
        let token = match credentials {
            Credentials::Vercel { access_token } => access_token,
            _ => return Err(ProviderError::Config("expected Vercel credentials".into())),
        };

        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        // 1. Get or create the project
        let (project_id, _project_name) = if let Some(id) = &self.project_id {
            let name = get_project_name(&client, token, id)?;
            (id.clone(), name)
        } else {
            let name = self.project_name.clone().unwrap_or_else(|| {
                format!("osler-site-{}", chrono::Utc::now().timestamp() % 100000)
            });
            let id = create_project(&client, token, &name)?;
            (id, name)
        };

        // 2. Read the bundle zip + extract file list
        let zip_bytes = std::fs::read(bundle_path).map_err(ProviderError::Io)?;
        let files = extract_files(&zip_bytes)?;

        // 3. Create a deployment with files inline
        let deployment_id = create_deployment(&client, token, &project_id, &files)?;

        // 4. Poll until READY
        let url = poll_deployment(&client, token, &deployment_id)?;

        Ok(DeployResult {
            url,
            deployment_id,
            provider: Provider::Vercel,
            deployed_at: chrono::Utc::now(),
        })
    }

    fn rollback(&self, deployment_id: &str, credentials: &Credentials) -> Result<(), ProviderError> {
        let token = match credentials {
            Credentials::Vercel { access_token } => access_token,
            _ => return Err(ProviderError::Config("expected Vercel credentials".into())),
        };

        let production_target = "production";
        let client = Client::new();
        let url = format!("{}/v13/deployments/{}/promote?target={}", VERCEL_API_BASE, deployment_id, production_target);

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

fn get_project_name(client: &Client, token: &str, project_id: &str) -> Result<String, ProviderError> {
    let url = format!("{}/v9/projects/{}", VERCEL_API_BASE, project_id);
    let resp = client.get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .map_err(|e| ProviderError::Network(e.to_string()))?;

    if resp.status().is_success() {
        let body_text = resp.text().map_err(|e| ProviderError::Network(e.to_string()))?;
        let body: serde_json::Value = serde_json::from_str(&body_text).map_err(ProviderError::Json)?;
        body.get("name").and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ProviderError::Config("project response missing name".into()))
    } else {
        Err(ProviderError::ProviderError {
            status: resp.status().as_u16(),
            body: resp.text().unwrap_or_default(),
        })
    }
}

fn create_project(client: &Client, token: &str, name: &str) -> Result<String, ProviderError> {
    let body = json!({ "name": name, "framework": null });

    let resp = client.post(&format!("{}/v10/projects", VERCEL_API_BASE))
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
                .ok_or_else(|| ProviderError::Config("project response missing id".into()))
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

fn create_deployment(client: &Client, token: &str, project_id: &str, files: &[(String, String)]) -> Result<String, ProviderError> {
    let files_json: Vec<_> = files.iter().map(|(path, data)| {
        json!({ "file": path, "data": data })
    }).collect();

    let body = json!({
        "name": project_id,
        "files": files_json,
        "target": "production",
        "projectSettings": {
            "framework": null,
            "outputDirectory": "."
        }
    });

    let resp = client.post(&format!("{}/v13/deployments", VERCEL_API_BASE))
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

fn poll_deployment(client: &Client, token: &str, deployment_id: &str) -> Result<String, ProviderError> {
    let url = format!("{}/v13/deployments/{}", VERCEL_API_BASE, deployment_id);
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
            let state = body.get("status").or_else(|| body.get("readyState"))
                .and_then(|v| v.as_str()).unwrap_or("UNKNOWN");

            if state == "READY" {
                // Production alias URL
                let alias = body.get("alias").and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ProviderError::Config("deployment missing alias URL".into()))?;
                return Ok(format!("https://{}", alias));
            }

            if state == "ERROR" {
                let err = body.get("errorMessage").and_then(|v| v.as_str()).unwrap_or("unknown");
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

fn extract_files(zip_bytes: &[u8]) -> Result<Vec<(String, String)>, ProviderError> {
    use std::io::Read;
    use base64::{engine::general_purpose, Engine as _};

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

        let b64 = general_purpose::STANDARD.encode(&contents);
        files.push((name, b64));
    }
    Ok(files)
}
