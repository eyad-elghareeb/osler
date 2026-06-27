// lib.rs — Module root for osler-admin (Phase 5.0 reconciliation).
//
// This file exists so Phase 5 sessions can `use osler_admin::*` from integration
// tests and so cargo test has a lib target. The actual Tauri boot still lives
// in main.rs (which calls into these modules).
//
pub mod bundle_engines;
pub mod push_update;
pub mod updater;

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

// V2 modules (Phase 13/15) — deploy providers, generator bundle, preview,
// keyring credential store, and V2 command handlers.
pub mod providers;
pub mod keyring_store;
pub mod deploy_orchestrator;
pub mod generator_bundle;
pub mod preview_server;
pub mod commands_v2;

// Merged Generator modules — ZIP assembly, HTTP API helpers, embedded engine assets.
pub mod generator_zip;
pub mod api_helpers;
pub mod engine_assets;

// Re-export commonly used types for tests and convenience.
pub use commands::ProjectRoot;

/// Library version string. Matches Cargo.toml `version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
