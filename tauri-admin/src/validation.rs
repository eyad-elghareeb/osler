// validation.rs — Wraps src/schemas/* for live preview validation (Phase 5).
//
// STATUS: STUB. Phase 5 will implement this module to validate JSON content
// against the schemas in src/schemas/ (the same schemas src/lib/validate.js
// uses on the web side).
//
// Plan:
//   - Embed the schemas at compile time via include_str!.
//   - Compile them with jsonschema crate (or serde_json + manual checks).
//   - Expose `validate_content(type, content_json) -> Result<(), Vec<String>>`.
//   - Used by the ContentEditor page for live validation as the user types.
//
// Until Phase 5 implements this, the existing commands.rs `validate_file`
// command (which uses the Python-style parser.rs validation) remains the
// source of truth. This module will eventually replace it.

use serde_json::Value;

/// Stub: returns "not implemented". Phase 5 will implement schema-based validation.
#[tauri::command]
pub async fn validate_content(_content_type: String, _content_json: Value) -> Result<Vec<String>, String> {
    // Returns an empty vec on success — Phase 5 will return a vec of error strings.
    // For now, defer to the existing validate_file command in commands.rs.
    Err("validate_content not implemented — use validate_file from commands.rs".into())
}
