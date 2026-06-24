use serde_json::{json, Value};
use std::sync::Mutex;

static UPDATE_STATUS: Mutex<Option<UpdateState>> = Mutex::new(None);

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct UpdateState {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: Option<String>,
    pub release_notes: Option<String>,
    pub bundle_hash: Option<String>,
    pub downloaded_bytes: Option<usize>,
    pub total_bytes: Option<usize>,
    pub error: Option<String>,
    pub checking: bool,
    pub downloading: bool,
}

const GITHUB_OWNER: &str = "osler-app";
const GITHUB_REPO: &str = "osler";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn get_update_status() -> UpdateState {
    UPDATE_STATUS
        .lock()
        .unwrap()
        .clone()
        .unwrap_or(UpdateState {
            available: false,
            current_version: CURRENT_VERSION.to_string(),
            latest_version: CURRENT_VERSION.to_string(),
            download_url: None,
            release_notes: None,
            bundle_hash: None,
            downloaded_bytes: None,
            total_bytes: None,
            error: None,
            checking: false,
            downloading: false,
        })
}

fn set_status(f: impl FnOnce(&mut UpdateState)) {
    let mut guard = UPDATE_STATUS.lock().unwrap();
    let mut state = guard.clone().unwrap_or(UpdateState {
        available: false,
        current_version: CURRENT_VERSION.to_string(),
        latest_version: CURRENT_VERSION.to_string(),
        download_url: None,
        release_notes: None,
        bundle_hash: None,
        downloaded_bytes: None,
        total_bytes: None,
        error: None,
        checking: false,
        downloading: false,
    });
    f(&mut state);
    *guard = Some(state);
}

fn fetch_latest_release() -> Result<Value, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_OWNER, GITHUB_REPO
    );
    let client = reqwest::blocking::Client::builder()
        .user_agent("Osler-Admin/5.1")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("Failed to fetch latest release: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GitHub API returned {}: {}",
            resp.status(),
            resp.text().unwrap_or_default()
        ));
    }
    resp.json::<Value>()
        .map_err(|e| format!("Failed to parse release data: {}", e))
}

fn parse_semver(version: &str) -> Option<(u64, u64, u64)> {
    let v = version.trim_start_matches('v');
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() >= 3 {
        let major = parts[0].parse().ok()?;
        let minor = parts[1].parse().ok()?;
        let patch = parts[2].split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()?;
        Some((major, minor, patch))
    } else {
        None
    }
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => l > c,
        _ => latest != current,
    }
}

pub fn check_for_update() -> Result<UpdateState, String> {
    set_status(|s| {
        s.checking = true;
        s.error = None;
    });

    let release = match fetch_latest_release() {
        Ok(r) => r,
        Err(e) => {
            set_status(|s| {
                s.checking = false;
                s.error = Some(e.clone());
            });
            return Err(e);
        }
    };

    let tag = release["tag_name"].as_str().unwrap_or("").to_string();
    let latest = tag.trim_start_matches('v').to_string();
    let release_notes = release["body"].as_str().map(|s| s.to_string());
    let download_url = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|a| {
                    a["name"]
                        .as_str()
                        .map(|n| n.ends_with(".msi") || n.ends_with(".exe") || n.ends_with(".dmg") || n.ends_with(".AppImage") || n.ends_with(".deb"))
                        .unwrap_or(false)
                })
                .and_then(|a| a["browser_download_url"].as_str().map(|s| s.to_string()))
        });

    let available = is_newer(&latest, CURRENT_VERSION);

    let state = UpdateState {
        available,
        current_version: CURRENT_VERSION.to_string(),
        latest_version: latest.clone(),
        download_url,
        release_notes,
        bundle_hash: None,
        downloaded_bytes: None,
        total_bytes: None,
        error: None,
        checking: false,
        downloading: false,
    };

    set_status(|s| *s = state.clone());
    Ok(state)
}

pub fn download_update() -> Result<(Vec<u8>, usize), String> {
    let status = get_update_status();
    let url = status
        .download_url
        .as_ref()
        .ok_or("No download URL available. Check for updates first.")?;

    set_status(|s| {
        s.downloading = true;
        s.error = None;
    });

    let client = reqwest::blocking::Client::builder()
        .user_agent("Osler-Admin/5.1")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("Failed to download update: {}", e))?;

    let total = resp.content_length().unwrap_or(0) as usize;
    let bytes = resp
        .bytes()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    set_status(|s| {
        s.downloading = false;
        s.downloaded_bytes = Some(bytes.len());
        s.total_bytes = Some(total);
    });

    Ok((bytes.to_vec(), total))
}

pub fn swap_executable(_new_binary: &[u8]) -> Result<(), String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get current executable path: {}", e))?;

    let temp_dir = std::env::temp_dir().join("osler_update");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let backup_path = exe_path.with_extension("exe.bak");
    let new_path = temp_dir.join("osler-admin-update.exe");

    std::fs::write(&new_path, _new_binary)
        .map_err(|e| format!("Failed to write new binary: {}", e))?;

    std::fs::rename(&exe_path, &backup_path)
        .map_err(|e| format!("Failed to backup current binary: {}", e))?;

    std::fs::rename(&new_path, &exe_path)
        .map_err(|e| {
            let _ = std::fs::rename(&backup_path, &exe_path);
            format!("Failed to swap binary: {}", e)
        })?;

    Ok(())
}

pub fn get_update_status_command() -> Value {
    let status = get_update_status();
    json!(status)
}
