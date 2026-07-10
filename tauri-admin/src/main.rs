// main.rs — Tauri boot for the Osler admin dashboard.
//
// The app starts with no project root selected. The frontend calls
// `pick_project_root` on launch (and from Settings) to bind the app to an
// Osler project folder. All subsequent commands operate relative to that root.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use osler_admin_lib::commands::{ProjectRoot, RunnerState};
use std::sync::Arc;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(ProjectRoot(Arc::new(std::sync::Mutex::new(None))))
        .manage(RunnerState::default())
        .invoke_handler(tauri::generate_handler![
            // Project / picker
            commands::set_project_root,
            commands::project_state,
            // File CRUD
            commands::list_files,
            commands::load_file,
            commands::save_file,
            commands::create_file,
            commands::create_folder,
            commands::delete_path,
            commands::move_path,
            commands::rename_path,
            // Manifest
            commands::generate_manifest,
            commands::read_manifest,
            commands::write_manifest,
            // Validate
            commands::validate_content,
            // Build / start
            commands::run_build,
            commands::run_start,
            commands::stop_runner,
            commands::runner_status,
            // Git
            commands::git_status,
            commands::git_add,
            commands::git_commit,
            commands::git_push,
            commands::git_pull,
            commands::git_remote,
            // Deploy (Vercel / GitHub Pages / Cloudflare Pages / Netlify)
            deploy::get_deploy_config,
            deploy::set_deploy_config,
            deploy::clear_deploy_provider,
            deploy::test_deploy_connection,
            deploy::deploy,
            deploy::deploy_status,
            deploy::clear_deploy_logs,
            // Shell / open
            commands::open_external,
            // Misc
            commands::ping,
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri_plugin_dialog::DialogExt;
                _app.dialog().message("Osler Admin ready. Pick a project root to begin.");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use osler_admin_lib::{commands, deploy};
