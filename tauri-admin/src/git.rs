// git.rs — Git operations using std::process::Command
// Ported from admin-dashboard.py git_available, get_git_status, git_commit, git_pull, git_push

use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

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
