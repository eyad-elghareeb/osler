// mcp_server.rs — 14 MCP tools wrapping the existing Tauri commands (Phase 5.7).
//
// STATUS: STUB. Phase 5 Session P5.7 will implement this module.
//
// Plan (from llm-execution-guide.md P5.7):
//   Expose 14 MCP tools that wrap the existing commands in commands.rs:
//     1. list_files
//     2. read_file
//     3. write_file
//     4. validate
//     5. convert
//     6. export_pdf
//     7. git_status
//     8. git_commit
//     9. git_push
//    10. create_pr
//    11. merge_pr
//    12. deploy
//    13. search_content
//    14. generate_quiz  (Phase 6 — AI pipeline)
//
// The MCP server runs in-process (not as a separate binary) so it can call
// the existing Tauri commands directly without IPC overhead.
//
// Until P5.7 lands, this module exposes no-op stubs so cargo build succeeds.

use serde_json::Value;

/// Stub: returns "not implemented". Phase 5.7 will start the MCP server.
#[tauri::command]
pub async fn mcp_start_server(_port: Option<u16>) -> Result<Value, String> {
    Err("mcp_start_server not implemented — see Phase 5.7 (P5.7)".into())
}

/// Stub: returns "not implemented".
#[tauri::command]
pub async fn mcp_stop_server() -> Result<(), String> {
    Ok(())
}

/// Stub: returns the list of MCP tools that WILL be exposed once P5.7 lands.
/// Useful for Phase 5.0 verification — confirms the planned tool surface area.
#[tauri::command]
pub async fn mcp_list_tools() -> Result<Vec<String>, String> {
    Ok(vec![
        "list_files".into(),
        "read_file".into(),
        "write_file".into(),
        "validate".into(),
        "convert".into(),
        "export_pdf".into(),
        "git_status".into(),
        "git_commit".into(),
        "git_push".into(),
        "create_pr".into(),
        "merge_pr".into(),
        "deploy".into(),
        "search_content".into(),
        "generate_quiz".into(),
    ])
}
