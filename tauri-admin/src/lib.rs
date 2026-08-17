// lib.rs — module root for the Osler admin Tauri app.
//
// The Tauri boot lives in main.rs. This file exposes the modules so integration
// tests can `use osler_admin_lib::*` and so cargo test has a lib target.

pub mod commands;
pub mod config;
pub mod deploy;
pub mod github;
pub mod instance_updater;
pub mod manifest;
pub mod prereq;
pub mod runner;
pub mod validate;

/// Library version string. Matches Cargo.toml `version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
