// main.rs — Tauri boot for the Osler admin dashboard.
//
// The app starts with no project root selected. The frontend calls
// `pick_project_root` on launch (and from Settings) to bind the app to an
// Osler project folder. All subsequent commands operate relative to that root.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use osler_admin_lib::commands::{ProjectRoot, RunnerState};
use osler_admin_lib::{commands, config, deploy, github, instance_updater, prereq, setup};
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
            // Build / start
            commands::run_build,
            commands::run_start,
            commands::stop_runner,
            commands::runner_status,
            // Git — basic (status/add/commit/push/pull/remote)
            commands::git_status,
            commands::git_add,
            commands::git_commit,
            commands::git_push,
            commands::git_pull,
            commands::git_remote,
            // Git — extended (branch/checkout/push_branch/list_branches/clone/remote/fetch)
            commands::git_repo_identity,
            commands::git_create_branch,
            commands::git_checkout,
            commands::git_push_branch,
            commands::git_list_branches,
            commands::git_current_branch,
            commands::git_add_remote,
            commands::git_fetch_remote,
            commands::git_clone,
            // GitHub — OAuth sign-in, repos, fork, PR workflow
            github::gh_get_oauth_config,
            github::gh_set_oauth_config,
            github::gh_sign_in,
            github::gh_sign_out,
            github::gh_auth_status,
            github::gh_list_user_repos,
            github::gh_get_repo_info,
            github::gh_fork_repo,
            github::gh_create_pr,
            github::gh_list_prs,
            github::gh_merge_pr,
            github::gh_close_pr,
            // Deploy (Vercel / GitHub Pages / Cloudflare Pages / Netlify)
            deploy::get_deploy_config,
            deploy::set_deploy_config,
            deploy::clear_deploy_provider,
            deploy::test_deploy_connection,
            deploy::deploy,
            deploy::deploy_status,
            deploy::deploy_stop,
            deploy::clear_deploy_logs,
            deploy::deploy_pages_cli,
            deploy::deploy_worker_cli,
            deploy::deploy_cloudflare_full_stack,
            // Prerequisites
            prereq::check_prerequisites,
            prereq::install_prerequisite,
            // Assisted post-deploy setup (secrets, first admin, health check)
            setup::setup_generate_secret,
            setup::setup_write_secrets,
            setup::setup_promote_admin,
            setup::setup_check_health,
            setup::deploy_email_worker,
            // Instance updater & patches
            instance_updater::check_instance_update,
            instance_updater::apply_instance_patch,
            instance_updater::rollback_instance_patch,
            instance_updater::list_instance_backups,
            // osler.config.json
            config::read_config,
            config::write_config,
            config::config_exists,
            config::generate_instance,
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
