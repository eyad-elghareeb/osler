use crate::bundle_engines;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static PUSH_STATUS: Mutex<Option<PushState>> = Mutex::new(None);

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PushState {
    pub in_progress: bool,
    pub instances_total: usize,
    pub instances_done: usize,
    pub current_instance: Option<String>,
    pub errors: Vec<String>,
    pub results: Vec<PushResult>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PushResult {
    pub instance: String,
    pub success: bool,
    pub pr_url: Option<String>,
    pub pr_number: Option<u64>,
    pub error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ManagedInstance {
    pub name: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub branch: Option<String>,
    pub deploy_url: Option<String>,
}

fn get_instances_file(root: &Path) -> PathBuf {
    root.join(".osler").join("instances.json")
}

pub fn load_instances(root: &Path) -> Result<Vec<ManagedInstance>, String> {
    let path = get_instances_file(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read instances: {}", e))?;
    let instances: Vec<ManagedInstance> =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse instances: {}", e))?;
    Ok(instances)
}

pub fn save_instances(root: &Path, instances: &[ManagedInstance]) -> Result<(), String> {
    let path = get_instances_file(root);
    let dir = path.parent().ok_or("Invalid path")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create .osler dir: {}", e))?;
    let text =
        serde_json::to_string_pretty(instances).map_err(|e| format!("Failed to serialize instances: {}", e))?;
    std::fs::write(&path, text).map_err(|e| format!("Failed to write instances: {}", e))?;
    Ok(())
}

fn get_push_status() -> PushState {
    PUSH_STATUS
        .lock()
        .unwrap()
        .clone()
        .unwrap_or(PushState {
            in_progress: false,
            instances_total: 0,
            instances_done: 0,
            current_instance: None,
            errors: Vec::new(),
            results: Vec::new(),
        })
}

fn set_push_status(f: impl FnOnce(&mut PushState)) {
    let mut guard = PUSH_STATUS.lock().unwrap();
    let mut state = guard.clone().unwrap_or(PushState {
        in_progress: false,
        instances_total: 0,
        instances_done: 0,
        current_instance: None,
        errors: Vec::new(),
        results: Vec::new(),
    });
    f(&mut state);
    *guard = Some(state);
}

pub async fn push_update_to_instance(
    instance: &ManagedInstance,
    project_root: &Path,
    version: &str,
    changelog: &str,
    token: &str,
) -> Result<PushResult, String> {
    let branch = instance
        .branch
        .as_deref()
        .unwrap_or("main");

    let update_branch = format!("update/v{}", version);
    let temp_dir = std::env::temp_dir().join(format!(
        "osler_push_{}_{}",
        instance.repo_name, version
    ));

    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).map_err(|e| format!("Failed to clean temp dir: {}", e))?;
    }

    let clone_url = format!(
        "https://github.com/{}/{}.git",
        instance.repo_owner, instance.repo_name
    );

    let repo = crate::git::clone_repo(&clone_url, token, &temp_dir)?;

    crate::git::checkout_branch(&repo, &update_branch)
        .map_err(|e| format!("Failed to create/checkout update branch: {}", e))?;

    let bundle = bundle_engines::create_update_bundle(project_root, version, changelog)?;

    let extract_dir = temp_dir.join("_update_bundle");
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create extract dir: {}", e))?;

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bundle))
        .map_err(|e| format!("Failed to open bundle: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if name == "update-manifest.json" {
            continue;
        }
        let out_path = temp_dir.join(&name);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let mut data = Vec::new();
        file.read_to_end(&mut data).ok();
        std::fs::write(&out_path, &data)
            .map_err(|e| format!("Failed to write {}: {}", name, e))?;
    }

    std::fs::remove_dir_all(&extract_dir).ok();

    let _ = crate::git::commit_file(
        &repo,
        "",
        "",
        &format!("[Update] v{} — {}", version, changelog),
    );

    crate::git::push(&repo, &update_branch, token)?;

    let pr_result = crate::git::create_pr(
        &instance.repo_owner,
        &instance.repo_name,
        &update_branch,
        branch,
        &format!("[Update] v{} — {}", version, changelog),
        &format!(
            "This PR updates the instance to version {}.\n\n{}",
            version,
            if changelog.is_empty() {
                "Automated update from Osler Admin."
            } else {
                changelog
            }
        ),
        token,
    )
    .await;

    match pr_result {
        Ok(pr_data) => {
            let pr_number = pr_data["number"].as_u64();
            let pr_url = pr_data["html_url"].as_str().map(|s| s.to_string());
            Ok(PushResult {
                instance: instance.name.clone(),
                success: true,
                pr_url,
                pr_number,
                error: None,
            })
        }
        Err(e) => Ok(PushResult {
            instance: instance.name.clone(),
            success: false,
            pr_url: None,
            pr_number: None,
            error: Some(format!("PR creation failed: {}", e)),
        }),
    }
}

pub async fn push_update(
    project_root: &Path,
    version: &str,
    changelog: &str,
    token: &str,
    instance_names: &[String],
) -> Result<Vec<PushResult>, String> {
    let all_instances = load_instances(project_root)?;
    let targets: Vec<&ManagedInstance> = if instance_names.is_empty() {
        all_instances.iter().collect()
    } else {
        all_instances
            .iter()
            .filter(|i| instance_names.contains(&i.name))
            .collect()
    };

    if targets.is_empty() {
        return Err("No matching instances found to push to.".into());
    }

    let mut results = Vec::new();
    set_push_status(|s| {
        s.in_progress = true;
        s.instances_total = targets.len();
        s.instances_done = 0;
        s.results.clear();
        s.errors.clear();
    });

    for instance in targets {
        set_push_status(|s| {
            s.current_instance = Some(instance.name.clone());
        });

        let result = push_update_to_instance(
            instance,
            project_root,
            version,
            changelog,
            token,
        )
        .await;
        let push_result = match result {
            Ok(r) => r,
            Err(e) => PushResult {
                instance: instance.name.clone(),
                success: false,
                pr_url: None,
                pr_number: None,
                error: Some(e),
            },
        };

        results.push(push_result.clone());
        set_push_status(|s| {
            s.instances_done += 1;
            s.results = results.clone();
            if !push_result.success {
                if let Some(err) = &push_result.error {
                    s.errors.push(format!(
                        "{}: {}",
                        push_result.instance, err
                    ));
                }
            }
        });
    }

    set_push_status(|s| {
        s.in_progress = false;
        s.current_instance = None;
    });

    Ok(results)
}

pub fn check_instance_versions(
    instances: &[ManagedInstance],
    token: &str,
) -> Result<Vec<Value>, String> {
    let mut results = Vec::new();
    let client = reqwest::blocking::Client::builder()
        .user_agent("Osler-Admin/5.1")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    for instance in instances {
        let manifest_url = format!(
            "https://raw.githubusercontent.com/{}/{}/main/update-manifest.json",
            instance.repo_owner, instance.repo_name
        );

        let version = client
            .get(&manifest_url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github+json")
            .send()
            .ok()
            .and_then(|resp| {
                if resp.status().is_success() {
                    resp.json::<Value>().ok()
                } else {
                    None
                }
            })
            .and_then(|m| {
                m.get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());

        results.push(json!({
            "name": instance.name,
            "repo": format!("{}/{}", instance.repo_owner, instance.repo_name),
            "version": version,
            "deployUrl": instance.deploy_url,
        }));
    }

    Ok(results)
}

pub fn get_push_status_command() -> Value {
    let status = get_push_status();
    json!(status)
}
