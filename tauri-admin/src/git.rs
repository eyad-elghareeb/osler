// git.rs — Git operations using std::process::Command + git2

use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;
use git2::{Cred, FetchOptions, PushOptions, RemoteCallbacks, Repository, Signature};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn run_git(args: &[&str], cwd: &Path) -> (i32, String, String) {
    let mut cmd = Command::new("git");
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

pub fn git_available(project_root: &Path) -> bool {
    if !project_root.join(".git").exists() { return false; }
    let (code, _, _) = run_git(&["rev-parse", "--is-inside-work-tree"], project_root);
    code == 0
}

pub fn get_git_status(project_root: &Path) -> Value {
    if !git_available(project_root) {
        return json!({ "available": false, "branch": null, "dirtyCount": 0, "changedPaths": [], "ahead": 0, "behind": 0 });
    }

    let (_, branch, _) = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], project_root);
    let branch = branch.trim().to_string();

    let (up_code, upstream, _) = run_git(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], project_root);
    let (ahead, behind) = if up_code == 0 && !upstream.trim().is_empty() {
        let rev_arg = format!("{}...{}", branch, upstream.trim());
        let (_, counts, _) = run_git(&["rev-list", "--left-right", "--count", &rev_arg], project_root);
        let parts: Vec<i64> = counts.split_whitespace()
            .filter_map(|s| s.parse().ok()).collect();
        if parts.len() == 2 { (parts[0], parts[1]) } else { (0, 0) }
    } else { (0, 0) };

    let (_, short, _) = run_git(&["status", "--short"], project_root);
    let changed_paths: Vec<Value> = short.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let status = l[..2.min(l.len())].trim().to_string();
            let path = if l.len() > 3 { l[3..].to_string() } else { l.to_string() };
            json!({ "status": status, "path": path })
        })
        .collect();

    json!({
        "available": true,
        "branch": branch,
        "dirtyCount": changed_paths.len(),
        "changedPaths": changed_paths,
        "ahead": ahead,
        "behind": behind,
    })
}

pub fn git_commit(project_root: &Path, message: &str) -> Result<Value, String> {
    if !git_available(project_root) { return Err("Git is not available for this repository.".into()); }
    let msg = if message.trim().is_empty() { "Update quiz project files" } else { message.trim() };
    let (ac, _, ae) = run_git(&["add", "-A"], project_root);
    if ac != 0 { return Err(format!("Git add failed: {}", ae.trim())); }
    let (cc, co, ce) = run_git(&["commit", "-m", msg], project_root);
    if cc != 0 {
        let out = if co.trim().is_empty() { ce.trim().to_string() } else { co.trim().to_string() };
        return Err(format!("Git commit failed: {}", out));
    }
    Ok(json!({ "message": "Commit created successfully.", "output": co.trim() }))
}

pub fn git_pull(project_root: &Path) -> Result<Value, String> {
    if !git_available(project_root) { return Err("Git is not available for this repository.".into()); }
    let (code, out, err) = run_git(&["pull", "--rebase", "--autostash"], project_root);
    if code != 0 {
        let msg = if out.trim().is_empty() { err.trim().to_string() } else { out.trim().to_string() };
        return Err(format!("Git pull failed: {}", msg));
    }
    Ok(json!({ "message": "Pull completed successfully.", "output": out.trim() }))
}

pub fn git_push(project_root: &Path) -> Result<Value, String> {
    if !git_available(project_root) { return Err("Git is not available for this repository.".into()); }
    let (code, out, err) = run_git(&["push"], project_root);
    if code != 0 { return Err(format!("Git push failed: {}", err.trim())); }
    Ok(json!({ "message": "Push completed successfully.", "output": out.trim() }))
}

/// Force-push the current branch using `--force-with-lease`.
///
/// `--force-with-lease` (no-arg form) uses the recorded remote-tracking ref as
/// the lease, so it refuses to overwrite remote commits the local ref hasn't
/// seen. This protects collaborators: if someone else pushed after our last
/// fetch, the push is rejected (rather than clobbering their work as plain
/// `--force` would).
///
/// Used as the escape hatch when `gitSync`'s `pull --rebase --autostash` fails
/// on diverging files (typical cause: sync regenerated sw.js locally).
pub fn git_force_push(project_root: &Path) -> Result<Value, String> {
    if !git_available(project_root) { return Err("Git is not available for this repository.".into()); }
    let (_, branch, _) = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], project_root);
    let branch = branch.trim().to_string();
    if branch.is_empty() { return Err("Could not determine the current branch.".into()); }

    let (code, out, err) = run_git(&["push", "--force-with-lease", "origin", &branch], project_root);
    if code != 0 {
        let msg = if err.trim().is_empty() { out.trim().to_string() } else { err.trim().to_string() };
        return Err(format!("Git force-push failed: {}", msg));
    }
    Ok(json!({
        "message": "Force-push completed successfully.",
        "branch": branch,
        "output": out.trim()
    }))
}

pub fn get_git_remote_url(project_root: &Path) -> String {
    if !git_available(project_root) { return String::new(); }
    let (code, out, _) = run_git(&["remote", "get-url", "origin"], project_root);
    if code == 0 { out.trim().to_string() } else { String::new() }
}

pub fn parse_github_remote(remote: &str) -> Option<(String, String)> {
    let patterns = [
        r"github\.com[:/]([^/]+)/([^/.]+)(?:\.git)?/?$",
        r"https?://[^@/]+@github\.com/([^/]+)/([^/.]+)(?:\.git)?/?$",
    ];
    for pat in &patterns {
        if let Ok(re) = regex::Regex::new(pat) {
            if let Some(caps) = re.captures(remote) {
                let owner = caps.get(1).map(|m| m.as_str().to_string())?;
                let repo = caps.get(2).map(|m| m.as_str().to_string())?;
                return Some((owner, repo));
            }
        }
    }
    None
}

// ── git2-based helpers (Phase 5.2) ─────────────────────────────────────────
// Phase 6.5 fix #17: kept as `#[allow(dead_code)]` for Phase 8 use. The
// working `git_commit` / `git_push` / `git_force_push` commands still shell
// out via std::process::Command because the shell-out impl is well-tested
// with --force-with-lease and integrates with the user's git config (signing
// keys, hooks, etc.). These git2 helpers will be wired to new commands in
// Phase 8 when the push_update.rs module needs programmatic clone/commit/push
// without spawning a subprocess. Migrating the existing shell-out commands
// to git2 is OPTIONAL per the plan — both impls coexist fine.

#[allow(dead_code)]
fn git2_callbacks(token: &str) -> RemoteCallbacks<'static> {
    let token = token.to_string();
    let mut cb = RemoteCallbacks::new();
    cb.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("token", &token)
    });
    cb
}

#[allow(dead_code)]
pub fn clone_repo(url: &str, token: &str, dst: &Path) -> Result<Repository, String> {
    let cb = git2_callbacks(token);
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(cb);
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fo);
    builder.clone(url, dst).map_err(|e| format!("Clone failed: {}", e))
}

#[allow(dead_code)]
pub fn checkout_branch(repo: &Repository, branch: &str) -> Result<(), String> {
    if repo.find_branch(branch, git2::BranchType::Local).is_ok() {
        let oid = repo.refname_to_id(&format!("refs/heads/{}", branch))
            .map_err(|e| e.to_string())?;
        let obj = repo.find_object(oid, None).map_err(|e| e.to_string())?;
        repo.checkout_tree(&obj, None).map_err(|e| e.to_string())?;
        repo.set_head(&format!("refs/heads/{}", branch)).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let oid = repo.refname_to_id("HEAD").map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    repo.branch(branch, &commit, false).map_err(|e| e.to_string())?;
    repo.set_head(&format!("refs/heads/{}", branch)).map_err(|e| e.to_string())?;
    let obj = repo.find_object(commit.id(), None).map_err(|e| e.to_string())?;
    repo.checkout_tree(&obj, None).map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn commit_file(repo: &Repository, rel_path: &str, content: &str, message: &str) -> Result<git2::Oid, String> {
    let blob_oid = repo.blob(content.as_bytes()).map_err(|e| e.to_string())?;
    let parent = repo.head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|oid| repo.find_commit(oid).ok());
    let tree_oid = if let Some(p) = &parent {
        let tree = p.tree().map_err(|e| e.to_string())?;
        let mut builder = repo.treebuilder(Some(&tree)).map_err(|e| e.to_string())?;
        builder
            .insert(rel_path, blob_oid, 0o100644)
            .map_err(|e| e.to_string())?;
        builder.write().map_err(|e| e.to_string())?
    } else {
        let mut builder = repo.treebuilder(None).map_err(|e| e.to_string())?;
        builder
            .insert(rel_path, blob_oid, 0o100644)
            .map_err(|e| e.to_string())?;
        builder.write().map_err(|e| e.to_string())?
    };
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let sig =
        Signature::now("Osler Admin", "admin@osler.app").map_err(|e| e.to_string())?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn push(repo: &Repository, branch: &str, token: &str) -> Result<(), String> {
    let cb = git2_callbacks(token);
    let mut po = PushOptions::new();
    po.remote_callbacks(cb);
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
    remote.push(&[&refspec], Some(&mut po)).map_err(|e| e.to_string())
}

pub async fn create_pr(
    owner: &str,
    repo_name: &str,
    head: &str,
    base: &str,
    title: &str,
    body: &str,
    token: &str,
) -> Result<Value, String> {
    let url = format!("https://api.github.com/repos/{}/{}/pulls", owner, repo_name);
    let payload = json!({
        "title": title,
        "head": head,
        "base": base,
        "body": body,
    });
    let client = reqwest::Client::builder()
        .user_agent("Osler-Admin/5.1")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Create PR request failed: {}", e))?;
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse PR response: {}", e))?;
    Ok(data)
}

pub async fn merge_pr(
    owner: &str,
    repo_name: &str,
    pr_number: u64,
    token: &str,
) -> Result<Value, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls/{}/merge",
        owner, repo_name, pr_number
    );
    let payload = json!({"merge_method": "squash"});
    let client = reqwest::Client::builder()
        .user_agent("Osler-Admin/5.1")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Merge PR request failed: {}", e))?;
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse merge response: {}", e))?;
    Ok(data)
}

pub async fn list_prs(
    owner: &str,
    repo_name: &str,
    token: &str,
) -> Result<Value, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls?state=open&sort=updated&direction=desc",
        owner, repo_name
    );
    let client = reqwest::Client::builder()
        .user_agent("Osler-Admin/5.1")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("List PRs request failed: {}", e))?;
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse PR list: {}", e))?;
    Ok(data)
}
