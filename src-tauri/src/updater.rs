//! Bridge command for the manual version-switch flow (Settings → About).
//!
//! Ported from the v1 app. `@tauri-apps/plugin-updater`'s `check()` has no
//! endpoint override, so TypeScript cannot point it at the worker's
//! `/{target}/at/{version}` route. Rust's `UpdaterBuilder` can, so this is a
//! thin command that builds a one-off updater pinned to that endpoint and runs
//! the same minisign-verified download-and-install path the automatic check
//! uses. Relaunch stays with the JS caller, which knows whether the person is
//! mid-edit.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Url;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_updater::UpdaterExt;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn install_update_from_endpoint(
    app: tauri::AppHandle,
    endpoint: String,
) -> Result<(), String> {
    let url = Url::parse(&endpoint).map_err(|error| format!("invalid endpoint: {error}"))?;

    // The default comparator rejects downgrades. This flow exists precisely so
    // someone can go back to a version that worked, so the comparator accepts
    // whatever the requested endpoint returns.
    let updater = app
        .updater_builder()
        .version_comparator(|_current, _remote| true)
        .endpoints(vec![url])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "no manifest at the requested endpoint".to_string())?;

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

/// Mobile stub so `generate_handler!` compiles uniformly. Mobile builds ship
/// through app stores and do not carry the updater plugin.
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn install_update_from_endpoint(_endpoint: String) -> Result<(), String> {
    Err("updater not available on mobile".to_string())
}
