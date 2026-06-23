// auth.rs — GitHub OAuth + safe-storage token persistence (Phase 5.1).
//
// STATUS: STUB. Phase 5 Session P5.1 will implement this module.
//
// Plan (from llm-execution-guide.md P5.1):
//   1. GitHub OAuth device flow (no client secret in app — use device flow
//      so the user opens a browser, enters a code, and the app polls for a token).
//   2. Persist the token using Tauri 2's safe-storage plugin (encrypted at rest
//      by the OS keychain). NEVER plain localStorage, NEVER plaintext on disk.
//   3. Expose Tauri commands:
//        - `auth_login_github()` → starts device flow, returns user code + verification URI
//        - `auth_poll_github(device_code)` → polls for token, returns Ok(Some(token)) on success
//        - `auth_get_token()` → reads from safe-storage, returns Option<String>
//        - `auth_clear_token()` → wipes the safe-storage entry
//        - `auth_user_info()` → calls GitHub /user API with the stored token
//
// Security checklist (V21):
//   - [ ] Token stored in safeStorage only — never localStorage, never logs.
//   - [ ] Token never included in error messages or panic backtraces.
//   - [ ] All GitHub API calls rate-limited and retried with exponential backoff.
//   - [ ] Token cleared on explicit sign-out AND on uninstall (safeStorage auto-clears).
//
// Until P5.1 lands, this module exposes no-op stubs so cargo build succeeds
// and Phase 5.0 verification (`cargo build`) passes.

use serde_json::Value;

/// Stub: returns a "not implemented" error.
/// Phase 5.1 will replace this with the real GitHub OAuth device flow.
#[tauri::command]
pub async fn auth_login_github() -> Result<Value, String> {
    Err("auth_login_github not implemented — see Phase 5.1 (P5.1)".into())
}

/// Stub: returns a "not implemented" error.
#[tauri::command]
pub async fn auth_poll_github(_device_code: String) -> Result<Value, String> {
    Err("auth_poll_github not implemented — see Phase 5.1 (P5.1)".into())
}

/// Stub: returns None (no token stored yet).
/// Phase 5.1 will read from safe-storage.
#[tauri::command]
pub async fn auth_get_token() -> Result<Option<String>, String> {
    Ok(None)
}

/// Stub: no-op success.
#[tauri::command]
pub async fn auth_clear_token() -> Result<(), String> {
    Ok(())
}

/// Stub: returns None (no user info without a token).
#[tauri::command]
pub async fn auth_user_info() -> Result<Option<Value>, String> {
    Ok(None)
}
