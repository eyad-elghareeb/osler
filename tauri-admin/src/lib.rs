// lib.rs — Module root for osler-admin (Phase 5.0 reconciliation).
//
// This file exists so Phase 5 sessions can `use osler_admin::*` from integration
// tests and so cargo test has a lib target. The actual Tauri boot still lives
// in main.rs (which calls into these modules).
//
// Future Phase 8 modules (not yet created):
//   - mod updater;        (Phase 8 — Tier 1 self-update)
//   - mod bundle_engines; (Phase 8 — Tier 2 update bundle)
//   - mod push_update;    (Phase 8 — Tier 2 push to instances)

pub mod commands;
pub mod deploy;
pub mod git;
pub mod parser;
pub mod pdf;
pub mod server;
pub mod templates;

// Phase 5 modules — auth.rs (Device Flow + keychain storage, P5.1),
// mcp_server.rs (14 MCP tools over stdio JSON-RPC, P5.7), validation.rs
// (schema-based content validation, P5.3). All implemented in Phase 5/6.5.
// analytics.rs (Firestore-backed study-event query, Phase 6.5 fix #18).
pub mod analytics;
pub mod auth;
pub mod mcp_server;
pub mod validation;

// Re-export commonly used types for tests and convenience.
pub use commands::ProjectRoot;

/// Library version string. Matches Cargo.toml `version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
