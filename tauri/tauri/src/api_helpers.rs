// QuizTool — HTTP API helpers for GitHub, Netlify, and Vercel
// =============================================================
// Uses ureq for synchronous HTTPS requests. No async runtime needed.
// Ported from generate_project.py's _gh_request, _netlify_request, _vercel_request

use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

// ── Shared HTTP request helper ───────────────────────────────────────────────

fn make_request(method: &str, url: &str, token: Option<&str>, body: Option<&[u8]>, content_type: Option<&str>, timeout_secs: u64) -> Result<(u16, Value), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(timeout_secs))
        .timeout_read(std::time::Duration::from_secs(timeout_secs + 30))
        .timeout_write(std::time::Duration::from_secs(timeout_secs + 30))
        .build();

    let mut req = agent.request(method, url)
        .set("User-Agent", "QuizTool-Generator");

    if let Some(tok) = token {
        req = req.set("Authorization", &format!("Bearer {}", tok));
        req = req.set("X-GitHub-Api-Version", "2022-11-28");
    }
    if let Some(ct) = content_type {
        req = req.set("Content-Type", ct);
    }

    let result = if let Some(b) = body {
        if b.is_empty() {
            req.send_bytes(b)
        } else {
            req.send_bytes(b)
        }
    } else {
        req.send_bytes(&[])
    };

    match result {
        Ok(resp) => {
            let status = resp.status();
            let body_text = resp.into_string().unwrap_or_default();
            let json: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
            Ok((status, json))
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body_text = resp.into_string().unwrap_or_default();
            let json: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
            Ok((code, json))
        }
        Err(e) => Err(format!("HTTP request failed: {}", e)),
    }
}

fn make_json_request(method: &str, url: &str, token: Option<&str>, json_body: Option<&Value>) -> Result<(u16, Value), String> {
    let body_bytes: Option<Vec<u8>> = json_body.map(|v| serde_json::to_string(v).unwrap_or_default().into_bytes());
    make_request(method, url, token, body_bytes.as_deref(), Some("application/json"), 60)
}

// ── GitHub API ───────────────────────────────────────────────────────────────

pub fn gh_request(method: &str, path: &str, token: &str, json_data: Option<&Value>) -> Result<(u16, Value), String> {
    let url = format!("https://api.github.com{}", path);
    let mut req = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(60))
        .timeout_write(std::time::Duration::from_secs(30))
        .build()
        .request(method, &url)
        .set("Authorization", &format!("token {}", token))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "QuizTool-Generator")
        .set("X-GitHub-Api-Version", "2022-11-28");

    if let Some(jd) = json_data {
        let body = serde_json::to_string(jd).unwrap_or_default();
        req = req.set("Content-Type", "application/json");
        match req.send_string(&body) {
            Ok(resp) => {
                let status = resp.status();
                let body_text = resp.into_string().unwrap_or_default();
                let json: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
                Ok((status, json))
            }
            Err(ureq::Error::Status(code, resp)) => {
                let body_text = resp.into_string().unwrap_or_default();
                let json: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
                Ok((code, json))
            }
            Err(e) => Err(format!("GitHub API request failed: {}", e)),
        }
    } else {
        match req.send_bytes(&[]) {
            Ok(resp) => {
                let status = resp.status();
                let body_text = resp.into_string().unwrap_or_default();
                let json: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
                Ok((status, json))
            }
            Err(ureq::Error::Status(code, resp)) => {
                let body_text = resp.into_string().unwrap_or_default();
                let json: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
                Ok((code, json))
            }
            Err(e) => Err(format!("GitHub API request failed: {}", e)),
        }
    }
}

/// Verify GitHub PAT and return user info
#[derive(Debug, Serialize, Deserialize)]
pub struct GithubUserInfo {
    pub ok: bool,
    pub username: String,
    pub name: String,
    pub avatar: String,
    pub repos_count: u64,
    #[serde(default)]
    pub error: String,
}

pub fn github_verify(token: &str) -> GithubUserInfo {
    // Check scopes via response headers
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .build();
    let resp = match agent.get("https://api.github.com/user")
        .set("Authorization", &format!("token {}", token))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "QuizTool-Generator")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(_code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&body).ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str().map(String::from)))
                .unwrap_or_else(|| "Invalid token".to_string());
            return GithubUserInfo {
                ok: false, username: String::new(), name: String::new(),
                avatar: String::new(), repos_count: 0, error: msg,
            };
        }
        Err(e) => return GithubUserInfo {
            ok: false, username: String::new(), name: String::new(),
            avatar: String::new(), repos_count: 0, error: format!("HTTP error: {}", e),
        },
    };

    let status = resp.status();
    if status != 200 {
        return GithubUserInfo {
            ok: false, username: String::new(), name: String::new(),
            avatar: String::new(), repos_count: 0,
            error: format!("GitHub returned status {}", status),
        };
    }

    // Validate that the token has 'repo' and 'workflow' scopes
    let scopes_str = resp.header("X-OAuth-Scopes").unwrap_or("");
    let scopes: Vec<&str> = scopes_str.split(',').map(|s| s.trim()).collect();
    let has_repo = scopes.contains(&"repo");
    let has_workflow = scopes.contains(&"workflow");
    if !has_repo || !has_workflow {
        let missing: Vec<&str> = vec![
            if !has_repo { "repo" } else { "" },
            if !has_workflow { "workflow" } else { "" },
        ].into_iter().filter(|s| !s.is_empty()).collect();
        return GithubUserInfo {
            ok: false, username: String::new(), name: String::new(),
            avatar: String::new(), repos_count: 0,
            error: format!("Token missing required scopes: {}. Allowed: {}", missing.join(", "), scopes_str),
        };
    }

    let body_text = resp.into_string().unwrap_or_default();
    let data: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);

    GithubUserInfo {
        ok: true,
        username: data.get("login").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        name: data.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        avatar: data.get("avatar_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        repos_count: data.get("public_repos").and_then(|v| v.as_u64()).unwrap_or(0),
        error: String::new(),
    }
}

/// Create a GitHub repo, push project, enable Pages
/// Returns a JSON Value with the result
pub fn github_publish(token: &str, config_json: &Value, visibility: &str) -> Result<Value, String> {
    let username = {
        let (status, data) = gh_request("GET", "/user", token, None)?;
        if status != 200 {
            return Err(data.get("message").and_then(|v| v.as_str()).unwrap_or("Invalid token").to_string());
        }
        data.get("login").and_then(|v| v.as_str()).unwrap_or("").to_string()
    };

    let project_name = config_json.get("project_name").and_then(|v| v.as_str()).unwrap_or("quiz-project");
    let repo_name: String = regex::Regex::new(r"[^a-zA-Z0-9._-]")
        .unwrap()
        .replace_all(project_name, "-")
        .trim_matches('-')
        .to_lowercase();
    let repo_name = if repo_name.is_empty() { "quiz-project".to_string() } else { repo_name };

    // Create repository
    let create_body = serde_json::json!({
        "name": repo_name,
        "description": format!("{} — Quiz Site powered by QuizTool", project_name),
        "private": visibility == "private",
        "auto_init": false
    });
    let (status, repo_data) = gh_request("POST", "/user/repos", token, Some(&create_body))?;

    if status == 422 {
        if let Some(errors) = repo_data.get("errors").and_then(|v| v.as_array()) {
            let exists = errors.iter().any(|e| {
                e.get("message").and_then(|m| m.as_str())
                    .map(|m| m.contains("name already exists"))
                    .unwrap_or(false)
            });
            if exists {
                // Check if we own it
                let (check_status, _) = gh_request("GET", &format!("/repos/{}/{}", username, repo_name), token, None)?;
                if check_status != 200 {
                    return Err(format!("Repository \"{}\" already exists and belongs to another user", repo_name));
                }
            }
        }
    } else if status != 201 {
        let msg = repo_data.get("message").and_then(|v| v.as_str()).unwrap_or("Failed to create repository");
        return Err(msg.to_string());
    }

    // Build the project (we generate the ZIP in-memory, then write it to a temp dir for git)
    let config: crate::generator::ProjectConfig = serde_json::from_value(config_json.clone())
        .map_err(|e| format!("Invalid config: {}", e))?;
    let zip_bytes = crate::generator::build_project_zip(&config)?;

    // Create temp project directory
    let temp_dir = std::env::temp_dir().join(&repo_name);
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Extract ZIP
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read ZIP: {}", e))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        let outpath = temp_dir.join(file.name());
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Write deploy metadata
    let deploy_dir = temp_dir.join(".quiztool");
    std::fs::create_dir_all(&deploy_dir).ok();
    let deploy_meta = serde_json::json!({
        "provider": "github",
        "projectName": repo_name,
        "liveUrl": format!("https://{}.github.io/{}/", username, repo_name),
        "providerUrl": format!("https://github.com/{}/{}", username, repo_name),
        "github": {
            "owner": username,
            "repo": repo_name,
            "branch": "main"
        }
    });
    std::fs::write(deploy_dir.join("deploy.json"), serde_json::to_string_pretty(&deploy_meta).unwrap_or_default()).ok();

    // Git operations with GIT_ASKPASS for secure token handling
    let git_env = prepare_git_env();
    run_git(&temp_dir, &["init"], &git_env)?;
    run_git(&temp_dir, &["config", "user.name", &username], &git_env)?;
    run_git(&temp_dir, &["config", "user.email", &format!("{}@users.noreply.github.com", username)], &git_env)?;
    run_git(&temp_dir, &["add", "-A"], &git_env)?;
    run_git(&temp_dir, &["commit", "-m", "Initial commit from QuizTool Generator"], &git_env)?;
    run_git(&temp_dir, &["branch", "-M", "main"], &git_env)?;

    let remote_url = format!("https://{}@github.com/{}/{}.git", username, username, repo_name);
    let _ = run_git(&temp_dir, &["remote", "remove", "origin"], &git_env);
    run_git(&temp_dir, &["remote", "add", "origin", &remote_url], &git_env)?;

    // Push via GIT_ASKPASS to avoid embedding token in .git/config
    let askpass_dir = temp_dir.join(".git").join("askpass");
    let _ = std::fs::create_dir_all(&askpass_dir);
    let askpass_script = askpass_dir.join("askpass.bat");
    let _ = std::fs::write(&askpass_script,
        "@echo off\necho %1 | findstr /i \"Username\" >nul\nif %errorlevel%==0 (echo %GIT_USERNAME%) else (echo %GIT_PASSWORD%)\n"
    );

    let push_result = std::process::Command::new("git")
        .args(["push", "-u", "origin", "main"])
        .current_dir(&temp_dir)
        .env("GIT_USERNAME", &username)
        .env("GIT_PASSWORD", token)
        .env("GIT_ASKPASS", askpass_script.to_string_lossy().as_ref())
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;

    let _ = std::fs::remove_file(&askpass_script);
    let _ = std::fs::remove_dir(&askpass_dir);

    if !push_result.status.success() {
        let stderr = String::from_utf8_lossy(&push_result.stderr);
        return Err(format!("Git push failed: {}", stderr.trim()));
    }

    // Enable Pages
    std::thread::sleep(std::time::Duration::from_secs(2));
    let pages_body = serde_json::json!({"build_type": "workflow"});
    let (pages_status, _) = gh_request("POST", &format!("/repos/{}/{}/pages", username, repo_name), token, Some(&pages_body))?;

    let repo_url = format!("https://github.com/{}/{}", username, repo_name);
    let pages_url = format!("https://{}.github.io/{}/", username, repo_name);

    let mut result = serde_json::json!({
        "ok": true,
        "repo_url": repo_url,
        "pages_url": pages_url,
        "repo_name": repo_name,
        "username": username,
        "project_dir": temp_dir.to_string_lossy().to_string()
    });
    if pages_status != 200 && pages_status != 201 {
        result["pages_warning"] = serde_json::Value::String(
            "GitHub Pages could not be enabled automatically. Please enable it manually.".to_string()
        );
    }
    Ok(result)
}

// ── Netlify API ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct NetlifyUserInfo {
    pub ok: bool,
    pub username: String,
    pub name: String,
    pub avatar: String,
    #[serde(default)]
    pub error: String,
}

pub fn netlify_verify(token: &str) -> NetlifyUserInfo {
    let (status, data) = match make_json_request("GET", "https://api.netlify.com/api/v1/user", Some(token), None) {
        Ok(r) => r,
        Err(e) => return NetlifyUserInfo { ok: false, username: String::new(), name: String::new(), avatar: String::new(), error: e },
    };
    if status != 200 {
        return NetlifyUserInfo {
            ok: false,
            username: String::new(),
            name: String::new(),
            avatar: String::new(),
            error: data.get("message").and_then(|v| v.as_str()).unwrap_or("Invalid Netlify token").to_string(),
        };
    }
    let slug = data.get("slug").and_then(|v| v.as_str()).unwrap_or("");
    let email = data.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let full_name = data.get("full_name").and_then(|v| v.as_str()).unwrap_or("");
    let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("");
    NetlifyUserInfo {
        ok: true,
        username: if !slug.is_empty() { slug.to_string() } else { email.to_string() },
        name: if !full_name.is_empty() { full_name.to_string() } else if !name.is_empty() { name.to_string() } else { email.to_string() },
        avatar: data.get("avatar_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        error: String::new(),
    }
}

fn prepare_git_env() -> Vec<(String, String)> {
    vec![
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
    ]
}

fn run_git(cwd: &std::path::Path, args: &[&str], env: &[(String, String)]) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("Git command '{:?}' failed: {} {}", args, stdout, stderr));
    }
    Ok(())
}

// ── Slug helper ──────────────────────────────────────────────────────────────

pub fn safe_project_slug(name: &str) -> String {
    let slug: String = name.chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '-' })
        .collect();
    let slug = slug.trim_matches(|c: char| c == '-' || c == '.' || c == '_').to_lowercase();
    let slug = regex::Regex::new(r"-{2,}").unwrap().replace_all(&slug, "-").to_string();
    if slug.is_empty() { "quiz-project".to_string() } else { slug }
}

// ── Vercel API ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct VercelUserInfo {
    pub ok: bool,
    pub username: String,
    pub name: String,
    pub avatar: String,
    #[serde(default)]
    pub error: String,
}

pub fn vercel_verify(token: &str) -> VercelUserInfo {
    let (status, data) = match make_json_request("GET", "https://api.vercel.com/v2/user", Some(token), None) {
        Ok(r) => r,
        Err(e) => return VercelUserInfo { ok: false, username: String::new(), name: String::new(), avatar: String::new(), error: e },
    };
    if status != 200 {
        let msg = data.get("error").and_then(|e| e.get("message")).and_then(|v| v.as_str())
            .or_else(|| data.get("message").and_then(|v| v.as_str()))
            .unwrap_or("Invalid Vercel token");
        return VercelUserInfo { ok: false, username: String::new(), name: String::new(), avatar: String::new(), error: msg.to_string() };
    }
    let user = data.get("user").unwrap_or(&data);
    let avatar_url = user.get("avatar").and_then(|v| v.as_str()).map(|a| {
        if a.starts_with("http") { a.to_string() } else { format!("https://vercel.com/api/www/avatar/{}", a) }
    }).unwrap_or_default();
    VercelUserInfo {
        ok: true,
        username: user.get("username").and_then(|v| v.as_str()).or_else(|| user.get("email").and_then(|v| v.as_str())).unwrap_or("").to_string(),
        name: user.get("name").and_then(|v| v.as_str()).or_else(|| user.get("username").and_then(|v| v.as_str())).unwrap_or("Vercel user").to_string(),
        avatar: avatar_url,
        error: String::new(),
    }
}

/// Publish to Netlify
pub fn netlify_publish(token: &str, config_json: &Value) -> Result<Value, String> {
    // Verify token
    let user_info = netlify_verify(token);
    if !user_info.ok {
        return Err(user_info.error);
    }

    let project_name = config_json.get("project_name").and_then(|v| v.as_str()).unwrap_or("quiz-project");
    let site_name = safe_project_slug(project_name);

    // Create site
    let create_body = serde_json::json!({"name": site_name});
    let (status, site_data) = make_json_request("POST", "https://api.netlify.com/api/v1/sites", Some(token), Some(&create_body))?;

    let final_site_name = if status == 400 || status == 409 || status == 422 {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let alt_name = format!("{}-{}", site_name, ts % 100000);
        let (s, d) = make_json_request("POST", "https://api.netlify.com/api/v1/sites", Some(token), Some(&serde_json::json!({"name": alt_name})))?;
        if s != 200 && s != 201 {
            return Err(d.get("message").and_then(|v| v.as_str()).unwrap_or("Failed to create Netlify site").to_string());
        }
        (s, d)
    } else {
        (status, site_data)
    };

    if final_site_name.0 != 200 && final_site_name.0 != 201 {
        let msg = final_site_name.1.get("message").and_then(|v| v.as_str()).unwrap_or("Failed to create Netlify site");
        return Err(msg.to_string());
    }

    let site_id = final_site_name.1.get("id").or_else(|| final_site_name.1.get("site_id")).or_else(|| final_site_name.1.get("name"))
        .and_then(|v| v.as_str()).unwrap_or("").to_string();
    if site_id.is_empty() {
        return Err("Netlify did not return a site ID".to_string());
    }

    // Build ZIP
    let config: crate::generator::ProjectConfig = serde_json::from_value(config_json.clone())
        .map_err(|e| format!("Invalid config: {}", e))?;
    let zip_bytes = crate::generator::build_project_zip(&config)?;

    // Save to project dir
    let temp_dir = std::env::temp_dir().join(&site_id);
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).ok();
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read ZIP: {}", e))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        let outpath = temp_dir.join(file.name());
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Deploy ZIP
    let deploy_url = format!("https://api.netlify.com/api/v1/sites/{}/deploys", site_id);
    let (deploy_status, deploy_data) = make_request("POST", &deploy_url, Some(token), Some(&zip_bytes), Some("application/zip"), 120)?;

    if deploy_status != 200 && deploy_status != 201 {
        let msg = deploy_data.get("message").and_then(|v| v.as_str()).unwrap_or("Failed to upload deploy");
        return Err(msg.to_string());
    }

    let deploy_id = deploy_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut deploy_state = deploy_data.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut public_warning = None;

    if !deploy_id.is_empty() && deploy_state != "ready" {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let (ps, pd) = make_json_request("GET", &format!("https://api.netlify.com/api/v1/deploys/{}", deploy_id), Some(token), None)?;
            if ps == 200 {
                let state = pd.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let error_msg = pd.get("error_message").and_then(|v| v.as_str()).unwrap_or("Netlify deploy failed").to_string();
                deploy_state = state.clone();
                if state == "ready" { break; }
                if state == "error" || state == "failed" {
                    return Err(error_msg);
                }
                break;
            }
        }
        if deploy_state != "ready" {
            public_warning = Some("Netlify accepted the deploy, but it is still processing.".to_string());
        }
    }

    let ssl_url = deploy_data.get("ssl_url").and_then(|v| v.as_str());
    let deploy_ssl_url = deploy_data.get("deploy_ssl_url").and_then(|v| v.as_str());
    let site_ssl_url = final_site_name.1.get("ssl_url").and_then(|v| v.as_str());
    let site_url = final_site_name.1.get("url").and_then(|v| v.as_str());
    let fallback = format!("https://{}.netlify.app", final_site_name.1.get("name").and_then(|v| v.as_str()).unwrap_or(&site_name));
    let live_url = ssl_url.or(deploy_ssl_url).or(site_ssl_url).or(site_url).unwrap_or(&fallback);

    let admin_url = final_site_name.1.get("admin_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://app.netlify.com/sites/{}/overview", site_name));

    // Write deploy metadata
    let deploy_dir = temp_dir.join(".quiztool");
    std::fs::create_dir_all(&deploy_dir).ok();
    let deploy_meta = serde_json::json!({
        "provider": "netlify",
        "projectName": site_name,
        "liveUrl": live_url,
        "providerUrl": admin_url,
        "netlify": { "siteId": site_id, "siteName": site_name }
    });
    std::fs::write(deploy_dir.join("deploy.json"), serde_json::to_string_pretty(&deploy_meta).unwrap_or_default()).ok();

    let mut result = serde_json::json!({
        "ok": true,
        "provider": "netlify",
        "site_name": site_name,
        "live_url": live_url,
        "provider_url": admin_url,
        "provider_label": "Netlify Site",
        "project_dir": temp_dir.to_string_lossy().to_string()
    });
    if let Some(w) = public_warning {
        result["publish_warning"] = serde_json::Value::String(w);
    }
    Ok(result)
}

/// Publish to Vercel
pub fn vercel_publish(token: &str, config_json: &Value) -> Result<Value, String> {
    let user_info = vercel_verify(token);
    if !user_info.ok {
        return Err(user_info.error);
    }

    let project_name = safe_project_slug(config_json.get("project_name").and_then(|v| v.as_str()).unwrap_or("quiz-project"));

    // Build ZIP
    let config: crate::generator::ProjectConfig = serde_json::from_value(config_json.clone())
        .map_err(|e| format!("Invalid config: {}", e))?;
    let zip_bytes = crate::generator::build_project_zip(&config)?;

    // Save to project dir
    let temp_dir = std::env::temp_dir().join(format!("vercel-{}", project_name));
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).ok();
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read ZIP: {}", e))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        let outpath = temp_dir.join(file.name());
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Convert ZIP entries to Vercel deployment files
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read ZIP: {}", e))?;
    use base64::Engine as _;
    let mut files = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        if file.is_dir() { continue; }
        let mut content = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut content).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&content);
        files.push(serde_json::json!({
            "file": file.name().replace('\\', "/"),
            "data": b64,
            "encoding": "base64"
        }));
    }

    let deploy_body = serde_json::json!({
        "name": project_name,
        "project": project_name,
        "target": "production",
        "files": files,
        "projectSettings": {
            "framework": null,
            "buildCommand": null,
            "devCommand": null,
            "installCommand": null,
            "outputDirectory": null
        },
        "meta": { "source": "quiztool-generator" }
    });

    let (deploy_status, deploy_data) = make_json_request(
        "POST",
        &"https://api.vercel.com/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1".to_string(),
        Some(token),
        Some(&deploy_body),
    )?;

    if deploy_status != 200 && deploy_status != 201 {
        let err = deploy_data.get("error").unwrap_or(&deploy_data);
        let msg = err.get("message").and_then(|v| v.as_str()).unwrap_or("Failed to create Vercel deployment");
        return Err(msg.to_string());
    }

    let deployment_id = deploy_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut ready_state = deploy_data.get("readyState").or_else(|| deploy_data.get("status")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut public_warning = None;

    if !deployment_id.is_empty() && ready_state != "READY" && ready_state != "ERROR" && ready_state != "CANCELED" {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let (ps, pd) = make_json_request("GET", &format!("https://api.vercel.com/v13/deployments/{}", deployment_id), Some(token), None)?;
            if ps == 200 {
                let state = pd.get("readyState").or_else(|| pd.get("status")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                ready_state = state.clone();
                if state == "READY" || state == "ERROR" || state == "CANCELED" { break; }
            }
        }
    }

    if ready_state == "ERROR" {
        return Err(deploy_data.get("errorMessage").and_then(|v| v.as_str()).unwrap_or("Vercel deployment failed").to_string());
    }
    if ready_state == "CANCELED" {
        return Err("Vercel deployment was canceled".to_string());
    }
    if ready_state != "READY" {
        public_warning = Some("Vercel accepted the deployment, but it is still building.".to_string());
    }

    let raw_url = deploy_data.get("url").and_then(|v| v.as_str()).or_else(|| deploy_data.get("aliasFinal").and_then(|v| v.as_str())).unwrap_or("");
    let live_url = if raw_url.starts_with("http") { raw_url.to_string() } else { format!("https://{}", raw_url) };
    let provider_url = deploy_data.get("inspectorUrl").and_then(|v| v.as_str()).unwrap_or(&live_url).to_string();

    // Write deploy metadata
    let deploy_dir = temp_dir.join(".quiztool");
    std::fs::create_dir_all(&deploy_dir).ok();
    let deploy_meta = serde_json::json!({
        "provider": "vercel",
        "projectName": project_name,
        "liveUrl": live_url,
        "providerUrl": provider_url,
        "vercel": { "projectName": project_name, "deploymentUrl": live_url }
    });
    std::fs::write(deploy_dir.join("deploy.json"), serde_json::to_string_pretty(&deploy_meta).unwrap_or_default()).ok();

    let mut result = serde_json::json!({
        "ok": true,
        "provider": "vercel",
        "site_name": project_name,
        "live_url": live_url,
        "provider_url": provider_url,
        "provider_label": "Vercel Deployment",
        "project_dir": temp_dir.to_string_lossy().to_string()
    });
    if let Some(w) = public_warning {
        result["publish_warning"] = serde_json::Value::String(w);
    }
    Ok(result)
}