// deploy.rs — Provider deploy (GitHub/Netlify/Vercel) + deploy metadata
// Ported from admin-dashboard.py deploy_to_github/netlify/vercel + read/write_deploy_metadata

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── Deploy metadata ───────────────────────────────────────────────────────────

fn deploy_dir(project_root: &Path) -> PathBuf {
    project_root.join(".quiztool")
}

fn deploy_meta_path(project_root: &Path) -> PathBuf {
    deploy_dir(project_root).join("deploy.json")
}

pub fn read_deploy_metadata(project_root: &Path) -> Option<Value> {
    let p = deploy_meta_path(project_root);
    let text = std::fs::read_to_string(&p).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_deploy_metadata(project_root: &Path, meta: &Value) {
    let dir = deploy_dir(project_root);
    let _ = std::fs::create_dir_all(&dir);
    // ensure .quiztool/ is in .gitignore
    ensure_gitignore_entry(project_root, ".quiztool/");
    if let Ok(s) = serde_json::to_string_pretty(meta) {
        let _ = std::fs::write(deploy_meta_path(project_root), s);
    }
}

fn ensure_gitignore_entry(project_root: &Path, entry: &str) {
    let gi = project_root.join(".gitignore");
    let content = std::fs::read_to_string(&gi).unwrap_or_default();
    if !content.lines().any(|l| l == entry) {
        let suffix = if content.ends_with('\n') { "" } else { "\n" };
        let _ = std::fs::write(&gi, format!("{}{}{}\n", content, suffix, entry));
    }
}

/// Infer GitHub metadata from git remote URL.
pub fn inferred_github_metadata(project_root: &Path) -> Option<Value> {
    let remote = crate::git::get_git_remote_url(project_root);
    let (owner, repo) = crate::git::parse_github_remote(&remote)?;
    let (_, branch_out, _) = {
        use std::process::Command;
        let mut cmd = Command::new("git");
        cmd.args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(project_root);
        
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let out = cmd.output().ok()?;
        (out.status.code().unwrap_or(1),
         String::from_utf8_lossy(&out.stdout).trim().to_string(),
         String::from_utf8_lossy(&out.stderr).trim().to_string())
    };
    let branch = if branch_out.is_empty() { "main".to_string() } else { branch_out };
    Some(json!({
        "provider": "github",
        "projectName": repo,
        "liveUrl": format!("https://{}.github.io/{}/", owner, repo),
        "providerUrl": format!("https://github.com/{}/{}", owner, repo),
        "github": { "owner": owner, "repo": repo, "branch": branch },
        "inferred": true,
    }))
}

pub fn get_deploy_metadata(project_root: &Path) -> Option<Value> {
    read_deploy_metadata(project_root).or_else(|| inferred_github_metadata(project_root))
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

fn http_request(
    method: &str, url: &str,
    token: Option<&str>, token_prefix: &str,
    json_body: Option<&Value>,
    raw_body: Option<&[u8]>, content_type: Option<&str>,
    timeout: u64,
) -> Result<(u16, Value), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(timeout))
        .timeout_read(std::time::Duration::from_secs(timeout + 30))
        .build();

    let mut req = agent.request(method, url).set("User-Agent", "QuizTool-Admin");
    if let Some(tok) = token {
        req = req.set("Authorization", &format!("{} {}", token_prefix, tok));
    }
    if let Some(ct) = content_type {
        req = req.set("Content-Type", ct);
    }

    let result = if let Some(body) = json_body {
        let s = serde_json::to_string(body).unwrap_or_default();
        req.set("Content-Type", "application/json").send_string(&s)
    } else if let Some(raw) = raw_body {
        req.send_bytes(raw)
    } else {
        req.send_bytes(&[])
    };

    match result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.into_string().unwrap_or_default();
            let json: Value = serde_json::from_str(&body).unwrap_or(json!({"message": body}));
            Ok((status, json))
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            let json: Value = serde_json::from_str(&body).unwrap_or(json!({"message": body}));
            Ok((code, json))
        }
        Err(e) => Err(format!("HTTP request failed: {}", e)),
    }
}

fn gh(method: &str, path: &str, token: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
    let req = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(60))
        .build()
        .request(method, &format!("https://api.github.com{}", path))
        .set("Authorization", &format!("token {}", token))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "QuizTool-Admin")
        .set("X-GitHub-Api-Version", "2022-11-28");

    let result = if let Some(b) = body {
        let s = serde_json::to_string(b).unwrap_or_default();
        req.set("Content-Type", "application/json").send_string(&s)
    } else {
        req.send_bytes(&[])
    };

    match result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.into_string().unwrap_or_default();
            let json: Value = serde_json::from_str(&body).unwrap_or(json!({"message": body}));
            Ok((status, json))
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            let json: Value = serde_json::from_str(&body).unwrap_or(json!({"message": body}));
            Ok((code, json))
        }
        Err(e) => Err(e.to_string()),
    }
}

// ── Token verification ────────────────────────────────────────────────────────

pub fn verify_provider_token(provider: &str, token: &str) -> Result<(), String> {
    match provider {
        "github" => {
            let (status, data) = gh("GET", "/user", token, None)?;
            if status == 200 { Ok(()) } else {
                Err(data.get("message").and_then(|v| v.as_str()).unwrap_or("Invalid GitHub token").to_string())
            }
        }
        "netlify" => {
            let (status, data) = http_request("GET", "https://api.netlify.com/api/v1/user", Some(token), "Bearer", None, None, None, 15)?;
            if status == 200 { Ok(()) } else {
                Err(data.get("message").and_then(|v| v.as_str()).unwrap_or("Invalid Netlify token").to_string())
            }
        }
        "vercel" => {
            let (status, data) = http_request("GET", "https://api.vercel.com/v2/user", Some(token), "Bearer", None, None, None, 15)?;
            if status == 200 { Ok(()) } else {
                let msg = data.get("error").and_then(|e| e.get("message")).and_then(|v| v.as_str())
                    .or_else(|| data.get("message").and_then(|v| v.as_str()))
                    .unwrap_or("Invalid Vercel token");
                Err(msg.to_string())
            }
        }
        _ => Err("Unknown provider.".to_string()),
    }
}

// ── Build ZIP for deploy ──────────────────────────────────────────────────────

fn build_project_zip(project_root: &Path) -> Result<Vec<u8>, String> {
    use std::io::Write;
    let skip_dirs = ["node_modules", "target", "__pycache__", ".git"];
    let skip_files: &[&str] = &[];

    let buf = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(buf);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    fn walk(
        zip: &mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>,
        opts: zip::write::SimpleFileOptions,
        dir: &Path,
        project_root: &Path,
        skip_dirs: &[&str],
        skip_files: &[&str],
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') { continue; }
            if path.is_dir() {
                if skip_dirs.contains(&name_str.as_ref()) { continue; }
                walk(zip, opts, &path, project_root, skip_dirs, skip_files)?;
            } else {
                if skip_files.contains(&name_str.as_ref()) { continue; }
                let rel = path.strip_prefix(project_root).map_err(|e| e.to_string())?;
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                zip.start_file(&rel_str, opts).map_err(|e| e.to_string())?;
                let data = std::fs::read(&path).map_err(|e| e.to_string())?;
                zip.write_all(&data).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    walk(&mut zip, opts, project_root, project_root, &skip_dirs, skip_files)?;
    let result = zip.finish().map_err(|e| e.to_string())?;
    Ok(result.into_inner())
}

// ── GitHub deploy ─────────────────────────────────────────────────────────────

pub fn deploy_to_github(project_root: &Path, metadata: &Value, token: &str, commit_message: &str) -> Result<Value, String> {
    if !crate::git::git_available(project_root) {
        return Err("Git is not available for this repository.".into());
    }
    let github = metadata.get("github").unwrap_or(&Value::Null);
    let owner = github.get("owner").and_then(|v| v.as_str()).ok_or("Missing GitHub owner")?;
    let repo = github.get("repo").and_then(|v| v.as_str()).ok_or("Missing GitHub repo")?;
    let branch = github.get("branch").and_then(|v| v.as_str()).unwrap_or("main");

    ensure_gitignore_entry(project_root, ".quiztool/");

    // Pull
    let (pc, _, pe) = run_git_cwd(&["pull", "--rebase", "--autostash"], project_root);
    if pc != 0 { return Err(format!("Git pull failed: {}", pe.trim())); }
    // Add
    let (ac, _, ae) = run_git_cwd(&["add", "-A"], project_root);
    if ac != 0 { return Err(format!("Git add failed: {}", ae.trim())); }
    // Commit
    let msg = if commit_message.trim().is_empty() { "Update quiz project files" } else { commit_message.trim() };
    let (cc, co, ce) = run_git_cwd(&["commit", "-m", msg], project_root);
    let committed = cc == 0;
    if !committed {
        let out = if co.trim().is_empty() { ce.trim() } else { co.trim() };
        if !out.contains("nothing to commit") { return Err(format!("Git commit failed: {}", out)); }
    }

    // Set remote URL
    let remote_url = format!("https://{}@github.com/{}/{}.git", owner, owner, repo);
    let _ = run_git_cwd(&["remote", "set-url", "origin", &remote_url], project_root);

    // Push with GIT_ASKPASS
    let tmp_dir = std::env::temp_dir().join("quiztool-admin-askpass");
    let _ = std::fs::create_dir_all(&tmp_dir);
    let askpass = tmp_dir.join("askpass.bat");
    let _ = std::fs::write(&askpass,
        "@echo off\necho %1 | findstr /i \"Username\" >nul\nif %errorlevel%==0 (echo %GIT_USERNAME%) else (echo %GIT_PASSWORD%)\n"
    );

    let mut cmd = std::process::Command::new("git");
    cmd.args(["push", "origin", branch])
        .current_dir(project_root)
        .env("GIT_USERNAME", owner)
        .env("GIT_PASSWORD", token)
        .env("GIT_ASKPASS", askpass.to_string_lossy().as_ref())
        .env("GIT_TERMINAL_PROMPT", "0");

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let push_result = cmd.output().map_err(|e| format!("Failed to run git push: {}", e))?;

    let _ = std::fs::remove_file(&askpass);

    if !push_result.status.success() {
        let err = String::from_utf8_lossy(&push_result.stderr);
        return Err(format!("Git push failed: {}", err.trim()));
    }

    let live_url = metadata.get("liveUrl").and_then(|v| v.as_str())
        .unwrap_or(&format!("https://{}.github.io/{}/", owner, repo)).to_string();
    let provider_url = metadata.get("providerUrl").and_then(|v| v.as_str())
        .unwrap_or(&format!("https://github.com/{}/{}", owner, repo)).to_string();

    Ok(json!({
        "provider": "github",
        "liveUrl": live_url,
        "providerUrl": provider_url,
        "message": if committed { "GitHub Pages deploy pushed successfully." } else { "No changes to commit; pushed current branch." }
    }))
}

fn run_git_cwd(args: &[&str], cwd: &Path) -> (i32, String, String) {
    let mut cmd = std::process::Command::new("git");
    cmd.args(args).current_dir(cwd);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(out) => (
            out.status.code().unwrap_or(1),
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
        ),
        Err(e) => (1, String::new(), e.to_string()),
    }
}

// ── Netlify deploy ────────────────────────────────────────────────────────────

pub fn deploy_to_netlify(project_root: &Path, metadata: &mut Value, token: &str) -> Result<Value, String> {
    let site_id = metadata.pointer("/netlify/siteId")
        .and_then(|v| v.as_str())
        .ok_or("Netlify deployment metadata is missing siteId.")?
        .to_string();

    let zip_bytes = build_project_zip(project_root)?;
    let deploy_url = format!("https://api.netlify.com/api/v1/sites/{}/deploys", site_id);
    let (status, deploy_data) = http_request("POST", &deploy_url, Some(token), "Bearer",
        None, Some(&zip_bytes), Some("application/zip"), 120)?;

    if status != 200 && status != 201 {
        let msg = deploy_data.get("message").and_then(|v| v.as_str()).unwrap_or("Failed to upload Netlify deploy.");
        return Err(msg.to_string());
    }

    let deploy_id = deploy_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut deploy_state = deploy_data.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if !deploy_id.is_empty() && deploy_state != "ready" {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let poll_url = format!("https://api.netlify.com/api/v1/deploys/{}", deploy_id);
            if let Ok((ps, pd)) = http_request("GET", &poll_url, Some(token), "Bearer", None, None, None, 20) {
                if ps == 200 {
                    deploy_state = pd.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if deploy_state == "ready" { break; }
                    if deploy_state == "error" || deploy_state == "failed" {
                        let msg = pd.get("error_message").and_then(|v| v.as_str()).unwrap_or("Netlify deploy failed.");
                        return Err(msg.to_string());
                    }
                }
            }
        }
    }

    let live_url = deploy_data.get("ssl_url").or_else(|| deploy_data.get("deploy_ssl_url"))
        .and_then(|v| v.as_str())
        .or_else(|| metadata.get("liveUrl").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();

    if let Some(obj) = metadata.as_object_mut() {
        obj.insert("liveUrl".into(), json!(live_url));
    }
    write_deploy_metadata(project_root, metadata);

    Ok(json!({
        "provider": "netlify",
        "liveUrl": live_url,
        "providerUrl": metadata.get("providerUrl").and_then(|v| v.as_str()).unwrap_or(&live_url).to_string(),
        "message": if deploy_state == "ready" { "Netlify deploy completed." } else { "Netlify accepted the deploy and is still processing." }
    }))
}

// ── Vercel deploy ─────────────────────────────────────────────────────────────

pub fn deploy_to_vercel(project_root: &Path, metadata: &mut Value, token: &str) -> Result<Value, String> {
    let project_name = metadata.pointer("/vercel/projectName")
        .or_else(|| metadata.get("projectName"))
        .and_then(|v| v.as_str())
        .ok_or("Vercel deployment metadata is missing projectName.")?
        .to_string();

    let zip_bytes = build_project_zip(project_root)?;

    // Convert ZIP to base64 file list
    use base64::Engine as _;
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() { continue; }
        let mut content = Vec::new();
        std::io::Read::read_to_end(&mut f, &mut content).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&content);
        files.push(json!({ "file": f.name().replace('\\', "/"), "data": b64, "encoding": "base64" }));
    }

    let deploy_body = json!({
        "name": project_name,
        "project": project_name,
        "target": "production",
        "files": files,
        "projectSettings": { "framework": null, "buildCommand": null, "devCommand": null, "installCommand": null, "outputDirectory": null },
        "meta": { "source": "quiztool-admin-dashboard" }
    });

    let (status, deploy_data) = http_request(
        "POST",
        "https://api.vercel.com/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1",
        Some(token), "Bearer", Some(&deploy_body), None, None, 180,
    )?;

    if status != 200 && status != 201 {
        let err = deploy_data.get("error").unwrap_or(&deploy_data);
        let msg = err.get("message").and_then(|v| v.as_str()).unwrap_or("Failed to create Vercel deployment.");
        return Err(msg.to_string());
    }

    let deployment_id = deploy_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut ready_state = deploy_data.get("readyState").or_else(|| deploy_data.get("status"))
        .and_then(|v| v.as_str()).unwrap_or("").to_string();

    if !deployment_id.is_empty() && !["READY", "ERROR", "CANCELED"].contains(&ready_state.as_str()) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let poll_url = format!("https://api.vercel.com/v13/deployments/{}", deployment_id);
            if let Ok((ps, pd)) = http_request("GET", &poll_url, Some(token), "Bearer", None, None, None, 20) {
                if ps == 200 {
                    ready_state = pd.get("readyState").or_else(|| pd.get("status"))
                        .and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if ["READY", "ERROR", "CANCELED"].contains(&ready_state.as_str()) { break; }
                }
            }
        }
    }

    match ready_state.as_str() {
        "ERROR" => return Err(deploy_data.get("errorMessage").and_then(|v| v.as_str()).unwrap_or("Vercel deployment failed.").to_string()),
        "CANCELED" => return Err("Vercel deployment was canceled.".into()),
        _ => {}
    }

    let raw_url = deploy_data.get("url").or_else(|| deploy_data.get("aliasFinal"))
        .and_then(|v| v.as_str()).unwrap_or("");
    let live_url = if raw_url.starts_with("http") { raw_url.to_string() } else { format!("https://{}", raw_url) };
    let provider_url = deploy_data.get("inspectorUrl").and_then(|v| v.as_str()).unwrap_or(&live_url).to_string();

    if let Some(obj) = metadata.as_object_mut() {
        obj.insert("liveUrl".into(), json!(live_url));
        obj.insert("providerUrl".into(), json!(provider_url));
    }
    write_deploy_metadata(project_root, metadata);

    Ok(json!({
        "provider": "vercel",
        "liveUrl": live_url,
        "providerUrl": provider_url,
        "message": if ready_state == "READY" { "Vercel deploy completed." } else { "Vercel accepted the deployment and is still building." }
    }))
}
