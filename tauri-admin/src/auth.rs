use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Default GitHub OAuth client ID.
/// Override at build time with `OSLER_GITHUB_CLIENT_ID` env var,
/// or at runtime via the same env var.
const GITHUB_CLIENT_ID: &str = match option_env!("OSLER_GITHUB_CLIENT_ID") {
    Some(id) => id,
    None => "Iv1.todo-replace-with-your-github-oauth-client-id",
};
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API_USER_URL: &str = "https://api.github.com/user";
const STORE_KEY: &str = "github_token";
const STORE_FILE: &str = "auth.json";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Osler-Admin/5.1")
        .build()
        .expect("reqwest Client::new")
}

fn store_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY.to_string(), Value::String(token.to_string()));
    store.save().map_err(|e| e.to_string())
}

fn read_token(app: &AppHandle) -> Result<Option<String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store
        .get(STORE_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

fn clear_token(app: &AppHandle) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(STORE_KEY);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_login_github(_app: AppHandle) -> Result<Value, String> {
    let client_id =
        std::env::var("OSLER_GITHUB_CLIENT_ID").unwrap_or_else(|_| GITHUB_CLIENT_ID.to_string());

    let body = json!({
        "client_id": client_id,
        "scope": "repo,user"
    });

    let resp = client()
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Device code request failed: {}", e))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse device code response: {}", e))?;

    if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
        return Err(format!("GitHub device flow error: {}", err));
    }

    let user_code = data
        .get("user_code")
        .and_then(|v| v.as_str())
        .ok_or("Missing user_code in response")?
        .to_string();

    let device_code = data
        .get("device_code")
        .and_then(|v| v.as_str())
        .ok_or("Missing device_code in response")?
        .to_string();

    let verification_uri = data
        .get("verification_uri")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/login/device");

    let interval = data
        .get("interval")
        .and_then(|v| v.as_u64())
        .unwrap_or(5);

    // Open browser
    let _ = open::that(verification_uri);

    Ok(json!({
        "user_code": user_code,
        "device_code": device_code,
        "verification_uri": verification_uri,
        "interval": interval,
    }))
}

#[tauri::command]
pub async fn auth_poll_github(device_code: String, app: AppHandle) -> Result<Value, String> {
    let client_id =
        std::env::var("OSLER_GITHUB_CLIENT_ID").unwrap_or_else(|_| GITHUB_CLIENT_ID.to_string());

    let body = json!({
        "client_id": client_id,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    });

    let resp = client()
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Token poll request failed: {}", e))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    if let Some(access_token) = data.get("access_token").and_then(|v| v.as_str()) {
        store_token(&app, access_token)?;
        return Ok(json!({
            "access_token": access_token,
            "status": "success"
        }));
    }

    let error = data
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown_error");

    let error_description = data
        .get("error_description")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(json!({
        "status": "pending",
        "error": error,
        "error_description": error_description
    }))
}

#[tauri::command]
pub async fn auth_get_token(app: AppHandle) -> Result<Option<String>, String> {
    read_token(&app)
}

#[tauri::command]
pub async fn auth_clear_token(app: AppHandle) -> Result<(), String> {
    clear_token(&app)
}

#[tauri::command]
pub async fn auth_user_info(app: AppHandle) -> Result<Option<Value>, String> {
    let token = match read_token(&app)? {
        Some(t) => t,
        None => return Ok(None),
    };

    let resp = client()
        .get(API_USER_URL)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("GitHub user info request failed: {}", e))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse user info: {}", e))?;

    Ok(Some(json!({
        "login": data.get("login"),
        "id": data.get("id"),
        "avatar_url": data.get("avatar_url"),
        "name": data.get("name"),
        "email": data.get("email"),
    })))
}
