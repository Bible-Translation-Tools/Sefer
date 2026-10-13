//! A folder's files in one round trip: the `FolderTree` service's desktop
//! half (`src/core/resources/kinds/tree.ts`, `src/platform/tauri/tree.ts`).
//!
//! Through the fs plugin every file costs one IPC call, and a reference
//! resource is thousands of small files: Translation Notes' Psalms is about
//! 2,600 chunk files, which its freshness check stat'ed one at a time and its
//! first read read one at a time — 12 s and 40 s with the display awake
//! (2026-10-13). Here a listing and a bulk read are one call each, walked on a
//! blocking thread.
//!
//! Both are read-only. Like the git commands they take a path from the
//! webview rather than going through the fs plugin's scope: this process can
//! read anywhere the user can, and nothing here writes.

use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::errors::{fail, IO, REFUSED};

/// One file below the listed folder: its path relative to it (`/`-separated),
/// its size, and its modification time in milliseconds since the epoch (0
/// when the platform has none) — what `filesBelow` fingerprints.
#[derive(Serialize)]
pub struct ListedFile {
    path: String,
    size: u64,
    mtime: u64,
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn walk(root: &Path, directory: &Path, out: &mut Vec<ListedFile>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        // `metadata` follows a symlink, as the TypeScript walk's `stat` did.
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            walk(root, &path, out)?;
        } else if meta.is_file() {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |since| {
                    u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
                });
            out.push(ListedFile {
                path: relative(root, &path),
                size: meta.len(),
                mtime,
            });
        }
    }
    Ok(())
}

fn listing(directory: String) -> Result<Vec<ListedFile>, String> {
    let root = PathBuf::from(&directory);
    // No folder is no files, as the port says, not a failure.
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    walk(&root, &root, &mut files).map_err(|error| fail(IO, format!("{directory}: {error}")))?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Every file below `directory`, sorted by path, with its size and mtime.
#[tauri::command]
pub async fn tree_listing(directory: String) -> Result<Vec<ListedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || listing(directory))
        .await
        .map_err(|error| fail(IO, error.to_string()))?
}

fn read_all(directory: String, paths: Vec<String>) -> Result<Vec<u8>, String> {
    let root = PathBuf::from(&directory);
    let mut out = Vec::new();
    for path in &paths {
        let inside = Path::new(path);
        if inside
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(fail(REFUSED, format!("{path} is not inside {directory}")));
        }
        let bytes = std::fs::read(root.join(inside))
            .map_err(|error| fail(IO, format!("{path}: {error}")))?;
        let length = u32::try_from(bytes.len())
            .map_err(|_| fail(IO, format!("{path}: larger than 4 GiB")))?;
        out.extend_from_slice(&length.to_le_bytes());
        out.extend_from_slice(&bytes);
    }
    Ok(out)
}

/// The bytes of `paths` (relative to `directory`), in the order asked, as one
/// binary answer: each file is a little-endian `u32` length and its bytes.
/// Binary rather than JSON because a JSON byte array is several times larger
/// and has to be parsed.
#[tauri::command]
pub async fn tree_read(
    directory: String,
    paths: Vec<String>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || read_all(directory, paths))
        .await
        .map_err(|error| fail(IO, error.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
}
