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

// The embedded WebDriver server answers anyone on localhost with full control
// of the window. It exists for agents and `pnpm test:desktop`, and a release
// must never carry it, so asking for it in one is a build error, not a warning.
#[cfg(all(feature = "webdriver", not(debug_assertions)))]
compile_error!("the `webdriver` feature is for debug builds only; see documentation/architecture/desktop.md");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    git::configure_timeouts();
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

    // The driven build: the WebDriver server on `TAURI_WEBDRIVER_PORT`, and the
    // dev server at `SEFER_DEV_URL` rather than the compiled-in
    // `localhost:3000`, so the launcher can put each run on free ports and two
    // runs (two worktrees, say) never meet.
    #[cfg(feature = "webdriver")]
    {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(feature = "webdriver")]
    {
        if let Some(url) = std::env::var("SEFER_DEV_URL").ok().and_then(|url| url.parse().ok()) {
            context.config_mut().build.dev_url = Some(url);
        }
        // A driven window is usually not frontmost (the person is elsewhere, or
        // the screen is locked), and WKWebView throttles a hidden page until
        // every IPC round trip takes 0.4–1.8 s: Translation Notes' first read
        // of Psalms took minutes. A script must measure the app, not the nap.
        for window in &mut context.config_mut().app.windows {
            window.background_throttling =
                Some(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
        }
        // That covers WebKit's own suspension, not App Nap: once the process
        // has sat unseen for a few minutes macOS coalesces its run loop's
        // timers, and IPC answered on that loop went back to 2–3 s a call.
        // An activity held for the process's life keeps it awake.
        #[cfg(target_os = "macos")]
        {
            use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
            let activity = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
                NSActivityOptions::UserInitiatedAllowingIdleSystemSleep
                    | NSActivityOptions::LatencyCritical,
                &NSString::from_str("Sefer is being driven over WebDriver"),
            );
            std::mem::forget(activity);
        }
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
            git::git_walk,
            git::git_blobs,
            git::git_log_from,
            git::git_resolve_ref,
            git::git_current_branch,
            git::git_changed_paths_between,
            git::git_merge_base,
            git::git_fast_forward,
            git::git_probe,
            git::git_fetch_ref,
            git::git_abort_merge,
            git::git_ensure_remote,
            git::git_remote_url,
            git::git_clone,
            git::git_fetch,
            git::git_deepen,
            git::git_is_shallow,
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
        .run(context)
        .expect("error while running Sefer");
}
