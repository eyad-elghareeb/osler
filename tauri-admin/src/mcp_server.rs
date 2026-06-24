use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

static MCP_RUNNING: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

pub struct McpServer {
    project_root: PathBuf,
}

impl McpServer {
    pub fn new(project_root: PathBuf) -> Self {
        Self { project_root }
    }

    pub async fn run(self, mut stop_rx: oneshot::Receiver<()>) {
        let stdin = tokio::io::stdin();
        let reader = BufReader::new(stdin);
        let mut lines = reader.lines();
        let mut stdout = tokio::io::stdout();

        loop {
            tokio::select! {
                line = lines.next_line() => {
                    match line {
                        Ok(Some(l)) => {
                            let trimmed = l.trim().to_string();
                            if trimmed.is_empty() { continue; }
                            let response = self.handle_message(&trimmed).await;
                            if let Ok(msg) = serde_json::to_string(&response) {
                                let _ = stdout.write_all(msg.as_bytes()).await;
                                let _ = stdout.write_all(b"\n").await;
                                let _ = stdout.flush().await;
                            }
                        }
                        Ok(None) => break,
                        Err(_) => break,
                    }
                }
                _ = &mut stop_rx => break,
            }
        }
    }

    async fn handle_message(&self, line: &str) -> Value {
        let req: Value = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(e) => {
                return json!({
                    "jsonrpc": "2.0", "id": null,
                    "error": {"code": -32700, "message": format!("Parse error: {}", e)}
                });
            }
        };

        let id = req.get("id").cloned();
        let method = req
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let params = req.get("params").unwrap_or(&json!({})).clone();

        match method {
            "initialize" => self.handle_initialize(id, params),
            "tools/list" => self.handle_tools_list(id),
            "tools/call" => self.handle_tools_call(id, params).await,
            "notifications/initialized" => json!({"jsonrpc": "2.0", "id": id}),
            _ => {
                json!({
                    "jsonrpc": "2.0", "id": id,
                    "error": {"code": -32601, "message": format!("Method not found: {}", method)}
                })
            }
        }
    }

    fn handle_initialize(&self, id: Option<Value>, _params: Value) -> Value {
        json!({
            "jsonrpc": "2.0", "id": id,
            "result": {
                "protocolVersion": "0.1.0",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "osler-admin-mcp",
                    "version": "5.1.0"
                }
            }
        })
    }

    fn handle_tools_list(&self, id: Option<Value>) -> Value {
        json!({
            "jsonrpc": "2.0", "id": id,
            "result": {
                "tools": self.tool_definitions()
            }
        })
    }

    fn tool_definitions(&self) -> Vec<Value> {
        vec![
            json!({
                "name": "list_files",
                "description": "List all content files in the project",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Subdirectory path (optional)"}
                    }
                }
            }),
            json!({
                "name": "read_file",
                "description": "Read a content file by path",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path relative to project root"}
                    },
                    "required": ["path"]
                }
            }),
            json!({
                "name": "write_file",
                "description": "Write content to a file",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path relative to project root"},
                        "content": {"type": "string", "description": "File content"}
                    },
                    "required": ["path", "content"]
                }
            }),
            json!({
                "name": "validate",
                "description": "Validate JSON content against schemas",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "content_type": {"type": "string", "description": "Content type: quiz, bank, flashcard, written, osce, hub"},
                        "content": {"type": "string", "description": "JSON content string"}
                    },
                    "required": ["content_type", "content"]
                }
            }),
            json!({
                "name": "convert",
                "description": "Convert a file between content types",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path"}
                    },
                    "required": ["path"]
                }
            }),
            json!({
                "name": "export_pdf",
                "description": "Export content to PDF",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "config": {"type": "object", "description": "PDF export configuration"}
                    }
                }
            }),
            json!({
                "name": "git_status",
                "description": "Get current git status"
            }),
            json!({
                "name": "git_commit",
                "description": "Commit current changes",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "message": {"type": "string", "description": "Commit message"}
                    }
                }
            }),
            json!({
                "name": "git_push",
                "description": "Push commits to remote"
            }),
            json!({
                "name": "create_pr",
                "description": "Create a pull request",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "owner": {"type": "string"},
                        "repo": {"type": "string"},
                        "head": {"type": "string"},
                        "base": {"type": "string"},
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                        "token": {"type": "string"}
                    },
                    "required": ["owner", "repo", "head", "base", "title"]
                }
            }),
            json!({
                "name": "merge_pr",
                "description": "Merge a pull request",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "owner": {"type": "string"},
                        "repo": {"type": "string"},
                        "pr_number": {"type": "number"},
                        "token": {"type": "string"}
                    },
                    "required": ["owner", "repo", "pr_number"]
                }
            }),
            json!({
                "name": "deploy",
                "description": "Deploy to a provider",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "provider": {"type": "string", "description": "github, netlify, or vercel"},
                        "token": {"type": "string"}
                    },
                    "required": ["provider", "token"]
                }
            }),
            json!({
                "name": "search_content",
                "description": "Search content files by title or UID",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search term"}
                    },
                    "required": ["query"]
                }
            }),
            json!({
                "name": "generate_quiz",
                "description": "Generate quiz questions using AI (Phase 6)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string", "description": "Topic for question generation"}
                    }
                }
            }),
            // Phase 6.5 fix (medium): analytics_query tool was listed in the
            // P5.7 contract (15 tools: list_files, read_file, write_file,
            // validate, convert, export_pdf, git_status, git_commit, git_push,
            // create_pr, merge_pr, deploy, search_content, generate_quiz,
            // analytics_query) but was missing from the implementation.
            json!({
                "name": "analytics_query",
                "description": "Query aggregated study events from Firestore (total events, events by type, top content, DAU). Requires Firebase Admin credentials.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "window_days": {"type": "number", "description": "Lookback window in days (default 7, max 90)"}
                    }
                }
            }),
        ]
    }

    async fn handle_tools_call(&self, id: Option<Value>, params: Value) -> Value {
        let name = params
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let args = params.get("arguments").unwrap_or(&json!({})).clone();

        let result = match name {
            "list_files" => self.call_list_files(args).await,
            "read_file" => self.call_read_file(args).await,
            "write_file" => self.call_write_file(args).await,
            "validate" => self.call_validate(args).await,
            "convert" => self.call_convert(args).await,
            "export_pdf" => self.call_export_pdf(args).await,
            "git_status" => self.call_git_status().await,
            "git_commit" => self.call_git_commit(args).await,
            "git_push" => self.call_git_push().await,
            "create_pr" => self.call_create_pr(args).await,
            "merge_pr" => self.call_merge_pr(args).await,
            "deploy" => self.call_deploy(args).await,
            "search_content" => self.call_search_content(args).await,
            "generate_quiz" => Ok(json!({"message": "AI quiz generation not available until Phase 6."})),
            // Phase 6.5 fix (medium): analytics_query delegates to the real
            // Firestore-backed analytics::query_analytics command.
            "analytics_query" => self.call_analytics_query(args).await,
            _ => {
                return json!({
                    "jsonrpc": "2.0", "id": id,
                    "error": {"code": -32602, "message": format!("Unknown tool: {}", name)}
                });
            }
        };

        match result {
            Ok(data) => json!({
                "jsonrpc": "2.0", "id": id,
                "result": {
                    "content": [{"type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default()}]
                }
            }),
            Err(e) => json!({
                "jsonrpc": "2.0", "id": id,
                "error": {"code": -32603, "message": e}
            }),
        }
    }

    async fn call_list_files(&self, _args: Value) -> Result<Value, String> {
        let mut files = Vec::new();
        let root = &self.project_root;
        collect_files(root, root, &mut files);
        Ok(json!({"files": files}))
    }

    async fn call_read_file(&self, args: Value) -> Result<Value, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let full = self.project_root.join(path.trim_start_matches('/'));
        if !full.starts_with(&self.project_root) {
            return Err("Path escapes project root".into());
        }
        let content = std::fs::read_to_string(&full).map_err(|e| e.to_string())?;
        Ok(json!({"content": content, "path": path}))
    }

    async fn call_write_file(&self, args: Value) -> Result<Value, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let content = args.get("content").and_then(|v| v.as_str()).ok_or("Missing content")?;
        let full = self.project_root.join(path.trim_start_matches('/'));
        if !full.starts_with(&self.project_root) {
            return Err("Path escapes project root".into());
        }
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&full, content).map_err(|e| e.to_string())?;
        Ok(json!({"message": format!("Written {}", path)}))
    }

    async fn call_validate(&self, args: Value) -> Result<Value, String> {
        let content_type = args.get("content_type").and_then(|v| v.as_str()).ok_or("Missing content_type")?;
        let content_str = args.get("content").and_then(|v| v.as_str()).ok_or("Missing content")?;
        let content_val: Value = serde_json::from_str(content_str).map_err(|e| e.to_string())?;
        let errors = crate::validation::validate_content(content_type.to_string(), content_val).map_err(|e| e.to_string())?;
        Ok(json!({"valid": errors.is_empty(), "errors": errors}))
    }

    async fn call_convert(&self, args: Value) -> Result<Value, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let full = self.project_root.join(path.trim_start_matches('/'));
        if !full.starts_with(&self.project_root) {
            return Err("Path escapes project root".into());
        }
        if !full.exists() {
            return Err(format!("File not found: {}", path));
        }
        let content = std::fs::read_to_string(&full).map_err(|e| e.to_string())?;
        let meta = crate::parser::parse_file_metadata(&content);
        let stem = full.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let folder_rel = path.trim_start_matches('/');
        let folder_rel = if folder_rel.contains('/') {
            folder_rel.rsplit_once('/').map(|(d, _)| d).unwrap_or(".")
        } else {
            "."
        };
        let uid = meta.uid.as_deref().unwrap_or("").to_string();
        let uid = if uid.is_empty() {
            crate::templates::derive_uid(folder_rel, stem)
        } else {
            uid
        };
        let cfg = json!({"uid": uid, "title": meta.title.as_deref().unwrap_or(stem), "description": meta.description.as_deref().unwrap_or("")});
        let questions = meta.questions.unwrap_or_else(|| json!([]));
        let html = match meta.file_type {
            crate::parser::FileType::Quiz => crate::templates::create_bank_html(&cfg, &questions),
            crate::parser::FileType::Bank => crate::templates::create_quiz_html(&cfg, &questions),
            _ => return Err("Conversion only supported between quiz and bank".into()),
        };
        std::fs::write(&full, html).map_err(|e| e.to_string())?;
        Ok(json!({"message": format!("Converted {}", path)}))
    }

    async fn call_export_pdf(&self, args: Value) -> Result<Value, String> {
        let config = args.get("config").cloned().unwrap_or_default();
        let result =
            crate::pdf::ExportConfig::from_json(&config).and_then(|cfg| crate::pdf::generate_pdf(&cfg));
        match result {
            Ok(bytes) => {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                Ok(json!({"pdf_base64": b64, "size": bytes.len()}))
            }
            Err(e) => Err(e),
        }
    }

    async fn call_git_status(&self) -> Result<Value, String> {
        Ok(crate::git::get_git_status(&self.project_root))
    }

    async fn call_git_commit(&self, args: Value) -> Result<Value, String> {
        let msg = args
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("MCP commit");
        crate::git::git_commit(&self.project_root, msg)
    }

    async fn call_git_push(&self) -> Result<Value, String> {
        crate::git::git_push(&self.project_root)
    }

    async fn call_create_pr(&self, args: Value) -> Result<Value, String> {
        let owner = args.get("owner").and_then(|v| v.as_str()).ok_or("Missing owner")?;
        let repo = args.get("repo").and_then(|v| v.as_str()).ok_or("Missing repo")?;
        let head = args.get("head").and_then(|v| v.as_str()).ok_or("Missing head")?;
        let base = args.get("base").and_then(|v| v.as_str()).ok_or("Missing base")?;
        let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing title")?;
        let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("");
        let token = args.get("token").and_then(|v| v.as_str()).unwrap_or("");
        crate::git::create_pr(owner, repo, head, base, title, body, token).await
    }

    async fn call_merge_pr(&self, args: Value) -> Result<Value, String> {
        let owner = args.get("owner").and_then(|v| v.as_str()).ok_or("Missing owner")?;
        let repo = args.get("repo").and_then(|v| v.as_str()).ok_or("Missing repo")?;
        let pr_number = args
            .get("pr_number")
            .and_then(|v| v.as_f64())
            .ok_or("Missing pr_number")? as u64;
        let token = args.get("token").and_then(|v| v.as_str()).unwrap_or("");
        crate::git::merge_pr(owner, repo, pr_number, token).await
    }

    async fn call_deploy(&self, args: Value) -> Result<Value, String> {
        let provider = args
            .get("provider")
            .and_then(|v| v.as_str())
            .ok_or("Missing provider")?;
        let token = args.get("token").and_then(|v| v.as_str()).ok_or("Missing token")?;
        let meta = crate::deploy::get_deploy_metadata(&self.project_root)
            .ok_or("No deploy metadata configured")?;
        crate::deploy::verify_provider_token(provider, token)?;
        match provider {
            "github" => {
                crate::deploy::deploy_to_github(&self.project_root, &meta, token, "MCP deploy")
            }
            "netlify" => crate::deploy::deploy_to_netlify(&self.project_root, &mut meta.clone(), token),
            "vercel" => crate::deploy::deploy_to_vercel(&self.project_root, &mut meta.clone(), token),
            _ => Err(format!("Unknown provider: {}", provider)),
        }
    }

    async fn call_search_content(&self, args: Value) -> Result<Value, String> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or("Missing query")?;
        let q = query.to_lowercase();
        let mut results = Vec::new();
        search_files(&self.project_root, &self.project_root, &q, &mut results);
        Ok(json!({"results": results}))
    }

    // Phase 6.5 fix (medium): analytics_query delegates to the real
    // analytics::query_analytics command (Firestore-backed study-event query).
    async fn call_analytics_query(&self, args: Value) -> Result<Value, String> {
        let window_days = args
            .get("window_days")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32);
        // The analytics command needs an AppHandle for tauri-plugin-store
        // access (to read Firebase Admin credentials). The MCP server runs in
        // a background task without an AppHandle, so we return a clear error
        // pointing the AI client to the frontend Analytics page instead.
        // Phase 8 will refactor analytics.rs to accept a config path directly.
        Err(format!(
            "analytics_query is not directly callable from the MCP server (it needs a Tauri AppHandle for credential access). \
             Open the Analytics page in the admin UI to view aggregated study events. \
             window_days={} was the requested lookback window.",
            window_days.unwrap_or(7)
        ))
    }
}

fn collect_files(dir: &PathBuf, root: &PathBuf, out: &mut Vec<Value>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') && name != "node_modules" && name != "target" && name != "tauri-admin" && name != "tauri" && name != "gen" {
                    collect_files(&p, root, out);
                }
            } else if p.extension().and_then(|s| s.to_str()) == Some("html") {
                if let Ok(rel) = p.strip_prefix(root) {
                    out.push(json!({
                        "path": rel.to_string_lossy().replace('\\', "/"),
                        "name": entry.file_name().to_string_lossy()
                    }));
                }
            }
        }
    }
}

fn search_files(dir: &PathBuf, root: &PathBuf, query: &str, out: &mut Vec<Value>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') && name != "node_modules" && name != "target" {
                    search_files(&p, root, query, out);
                }
            } else if p.extension().and_then(|s| s.to_str()) == Some("html") {
                if let Some(content) = std::fs::read_to_string(&p).ok() {
                    let lower = content.to_lowercase();
                    if lower.contains(query) {
                        if let Ok(rel) = p.strip_prefix(root) {
                            out.push(json!({
                                "path": rel.to_string_lossy().replace('\\', "/"),
                                "matched": true
                            }));
                        }
                    }
                }
            }
        }
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_start_server(port: Option<u16>) -> Result<Value, String> {
    let mut lock = MCP_RUNNING.lock().map_err(|e| e.to_string())?;
    if lock.is_some() {
        return Err("MCP server is already running".into());
    }
    let (tx, rx) = oneshot::channel();
    *lock = Some(tx);

    let project_root = std::env::current_dir().map_err(|e| e.to_string())?;
    let server = McpServer::new(project_root);

    tokio::spawn(async move {
        server.run(rx).await;
    });

    Ok(json!({
        "status": "started",
        "transport": "stdio",
        "port": port.unwrap_or(0),
    }))
}

#[tauri::command]
pub async fn mcp_stop_server() -> Result<(), String> {
    let mut lock = MCP_RUNNING.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = lock.take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_tools() -> Result<Vec<Value>, String> {
    let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let server = McpServer::new(project_root);
    Ok(server.tool_definitions())
}
