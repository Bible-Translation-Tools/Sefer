//! The Sefer desktop host.
//!
//! Everything the webview cannot do for itself arrives here as either a Tauri
//! plugin (files, dialogs, OS facts, the updater) or a command in one of the
//! modules below. The TypeScript side of each is a Layer in
//! `src/platform/tauri/`, and core never learns any of this exists — see
//! documentation/architecture/desktop.md and .../boundaries.md.
//!
//! `main.rs` is a two-line shim over `run()` so the same entry point serves
//! the desktop binary and a mobile entry point.

mod credentials;
mod errors;
mod git;
mod updater;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // `fs` backs the FileSystem port, `dialog` the Dialogs port, `os` the
        // locale HostInfo reports, `opener` the "reveal in Finder" affordances.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init());

    // Desktop-only: window geometry across restarts, the auto-updater, and the
    // relaunch the updater needs. Mobile builds update through app stores.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_window_state::Builder::new().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            git::git_open,
            git::git_init,
            git::git_status,
            git::git_commit,
            git::git_log,
            git::git_previous_versions,
            git::git_show,
            git::git_log_from,
            git::git_resolve_ref,
            git::git_current_branch,
            git::git_changed_paths_between,
            git::git_move_branch,
            git::git_abort_merge,
            git::git_ensure_remote,
            git::git_remote_url,
            git::git_fetch,
            git::git_pull,
            git::git_push,
            credentials::credentials_get,
            credentials::credentials_set,
            credentials::credentials_clear,
            updater::install_update_from_endpoint,
        ])
        .setup(move |#[allow(unused_variables)] app| {
            // Devtools open in a debug build only. An agent verifying a change
            // on the desktop host reads the console the same way it reads the
            // Web one, which is the whole point.
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sefer");
}
