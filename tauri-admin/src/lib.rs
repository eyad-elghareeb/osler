// lib.rs — Module root for osler-admin (Phase 5.0 reconciliation).
//
// This file exists so Phase 5 sessions can `use osler_admin::*` from integration
// tests and so cargo test has a lib target. The actual Tauri boot still lives
// in main.rs (which calls into these modules).
//
// Phase 5 sessions will add new modules here as they're created:
//   - mod auth;          (P5.1 — GitHub OAuth + safe-storage)
//   - mod mcp_server;    (P5.7 — 14 MCP tools)
//   - mod validation;    (Phase 5 — wraps src/schemas/* for live preview validation)
//   - mod updater;       (Phase 8 — Tier 1 self-update)
//   - mod bundle_engines; (Phase 8 — Tier 2 update bundle)
//   - mod push_update;    (Phase 8 — Tier 2 push to instances)

pub mod commands;
pub mod deploy;
pub mod git;
pub mod parser;
pub mod pdf;
pub mod server;
pub mod templates;

// Phase 5 stubs — these modules will be filled in by Phase 5 sessions.
// Declared here so cargo build catches missing files early and so the
// invoke_handler in main.rs can reference them.
pub mod auth;
pub mod mcp_server;
pub mod validation;

// Re-export commonly used types for tests and convenience.
pub use commands::ProjectRoot;

/// Library version string. Matches Cargo.toml `version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
